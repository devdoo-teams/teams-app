import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, stop } from 'esbuild';
import { buildClientAtomically } from './build-client-atomic.mjs';
import { assertCleanTrackedWorktreeForFileProvider, isFullCommitOid, resolvePinnedCommitOid } from './fileprovider-git-clean.mjs';
import { ensureFileProviderRuntimeDependencies } from './fileprovider-runtime-deps.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

// Explicit renderer-only artifact. Core build and startup never call this script.
// Git archive materializes only pinned tracked source; no worktree attributes or extra files.
// https://git-scm.com/docs/git-archive
// https://esbuild.github.io/api/#packages
export const CHANNELS_RENDERER_OUTPUT = 'channels-native-card-renderer.js';
export const CHANNELS_RENDERER_MARKER = '.teams-channels-renderer-build.json';
const SOURCE_FILES = Object.freeze([
  'src/server/channels-native-card-renderer.ts',
  'src/shared/genui.ts',
  'src/shared/response-mode.ts',
]);
const PACKAGE_VERSIONS = Object.freeze({
  '@copilotkit/channels-ui': '0.7.3',
  '@copilotkit/channels-teams': '0.7.3',
});
const EXTERNAL_IMPORTS = new Set(['node:util', 'zod', '@copilotkit/channels-ui', '@copilotkit/channels-teams/render']);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function artifactError(reason, cause) {
  const error = new Error(`CHANNELS_RENDERER_ARTIFACT_INVALID: ${reason}`, { cause });
  error.code = 'CHANNELS_RENDERER_ARTIFACT_INVALID';
  return error;
}

async function regularFile(file) {
  const metadata = await fs.lstat(file);
  if (!metadata.isFile() || metadata.size <= 0) throw new Error(`Expected nonempty regular file: ${file}`);
  return fs.readFile(file);
}

async function installedContract(nodeModulesDir) {
  for (const [name, version] of Object.entries(PACKAGE_VERSIONS)) {
    const pkg = JSON.parse(await regularFile(path.join(nodeModulesDir, name, 'package.json')));
    if (pkg.name !== name || pkg.version !== version || pkg.license !== 'MIT') {
      throw new Error(`CHANNELS_RENDERER_INSTALLED_CONTRACT_DRIFT: ${name} requires ${version}, MIT`);
    }
    if (name === '@copilotkit/channels-teams'
      && pkg.exports?.['./render']?.import !== './dist/render/index.js') {
      throw new Error('CHANNELS_RENDERER_INSTALLED_CONTRACT_DRIFT: renderer-only export is missing');
    }
  }
}

/** Read-back contract used by release tooling; runtime must check identity/hash before import. */
export async function validateChannelsRendererArtifact(outputDir, expectedSourceCommit) {
  try {
    if (!isFullCommitOid(expectedSourceCommit)) throw new Error('Expected a full pinned commit OID');
    const marker = JSON.parse(await regularFile(path.join(outputDir, CHANNELS_RENDERER_MARKER)));
    if (marker.schemaVersion !== 1 || marker.mode !== 'channels-native-renderer' || marker.worktree !== 'clean'
      || marker.commit !== expectedSourceCommit || marker.sourceCommit !== expectedSourceCommit
      || !isFullCommitOid(marker.sourceCommit) || marker.output !== CHANNELS_RENDERER_OUTPUT
      || !/^[0-9a-f]{64}$/.test(marker.artifactSha256 ?? '')
      || Object.keys(marker.packageVersions ?? {}).length !== Object.keys(PACKAGE_VERSIONS).length
      || Object.entries(PACKAGE_VERSIONS).some(([name, version]) => marker.packageVersions?.[name] !== version)) {
      throw new Error('Marker schema, mode, clean source identity, output or installed package pins differ');
    }
    const artifact = await regularFile(path.join(outputDir, CHANNELS_RENDERER_OUTPUT));
    if (sha256(artifact) !== marker.artifactSha256) throw new Error('Artifact SHA-256 differs');
    if (JSON.parse(await regularFile(path.join(outputDir, 'package.json'))).type !== 'module') {
      throw new Error('Artifact directory must preserve ESM module identity');
    }
    await installedContract(path.join(outputDir, 'node_modules'));
    return marker;
  } catch (error) { throw artifactError(error instanceof Error ? error.message : String(error), error); }
}

function verifySource(root, sourceCommit) {
  if (!isFullCommitOid(sourceCommit)) throw new Error('Channels renderer build requires a full pinned commit OID');
  if (resolvePinnedCommitOid(root) !== sourceCommit) throw new Error('Channels renderer pinned source commit differs from HEAD');
  assertCleanTrackedWorktreeForFileProvider(root, { commitOid: sourceCommit });
}

async function boundedCompile(options, timeoutMs) {
  const started = Date.now();
  let halfTimer;
  let deadlineTimer;
  try {
    const deadline = new Promise((_, reject) => {
      halfTimer = setTimeout(() => console.log(JSON.stringify({ process: 'channels-renderer-build', pid: process.pid,
        elapsed: Date.now() - started, lastActivity: 'esbuild running', health: 'pending', nextAction: 'wait until bounded deadline' })), timeoutMs / 2);
      deadlineTimer = setTimeout(() => {
        console.error(JSON.stringify({ process: 'channels-renderer-build', pid: process.pid,
          elapsed: Date.now() - started, lastActivity: 'bounded compiler timeout', health: 'failed', nextAction: 'stop owned esbuild service and retain prior artifact' }));
        const error = new Error('Channels renderer compiler exceeded its bounded deadline');
        error.code = 'ETIMEDOUT';
        reject(error);
      }, timeoutMs);
    });
    return await Promise.race([build(options), deadline]);
  } catch (error) {
    if (error?.code === 'ETIMEDOUT') await stop();
    throw error;
  } finally { clearTimeout(halfTimer); clearTimeout(deadlineTimer); }
}

/** Builds from one clean HEAD into a separate atomic output, with no provider runtime entry. */
export async function buildChannelsRenderer(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const sourceCommit = options.sourceCommit ?? process.env.TEAMS_SOURCE_COMMIT ?? resolvePinnedCommitOid(root);
  verifySource(root, sourceCommit);
  const outputDir = path.resolve(options.outputDir ?? path.join(resolveRuntimeDistRoot(root), 'channels-renderer'));
  const timeoutMs = Number(options.timeoutMs ?? process.env.TEAMS_TEST_TIMEOUT_MS ?? 45_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error('Invalid bounded renderer compiler timeout');
  const nodeModulesDir = path.resolve(options.nodeModulesDir ?? (process.env.TEAMS_FILEPROVIDER_SERVER_REUSE === '1'
    ? await ensureFileProviderRuntimeDependencies(root) : path.join(root, 'node_modules')));
  await installedContract(nodeModulesDir);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-channels-renderer-source-'));
  let marker;
  try {
    const archive = execFileSync('git', ['archive', sourceCommit, ...SOURCE_FILES], { cwd: root,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', temporaryRoot], { input: archive, timeout: 10_000, killSignal: 'SIGKILL' });
    for (const file of SOURCE_FILES) await regularFile(path.join(temporaryRoot, file));
    await buildClientAtomically({ outputDir,
      validateRuntime: directory => validateChannelsRendererArtifact(directory, sourceCommit),
      buildImplementation: async directory => {
        const result = await boundedCompile({
          absWorkingDir: temporaryRoot, entryPoints: [SOURCE_FILES[0]],
          bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'external',
          nodePaths: [nodeModulesDir], outfile: path.join(directory, CHANNELS_RENDERER_OUTPUT),
          legalComments: 'none', sourcemap: false, metafile: true,
        }, timeoutMs);
        const inputs = Object.keys(result.metafile.inputs);
        if (inputs.length !== SOURCE_FILES.length || inputs.some(file => !SOURCE_FILES.includes(file))
          || Object.values(result.metafile.outputs).some(output => output.imports.some(entry => !entry.external || !EXTERNAL_IMPORTS.has(entry.path)))) {
          throw new Error('CHANNELS_RENDERER_SOURCE_CLOSURE_DRIFT: renderer build contains unexpected source or runtime imports');
        }
        await fs.symlink(nodeModulesDir, path.join(directory, 'node_modules'), 'dir');
        await fs.writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n');
        marker = { schemaVersion: 1, mode: 'channels-native-renderer', worktree: 'clean',
          commit: sourceCommit, sourceCommit, output: CHANNELS_RENDERER_OUTPUT,
          artifactSha256: sha256(await regularFile(path.join(directory, CHANNELS_RENDERER_OUTPUT))),
          packageVersions: { ...PACKAGE_VERSIONS },
        };
        await fs.writeFile(path.join(directory, CHANNELS_RENDERER_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
        // Refuse to publish if the source changed while compiling. Untracked files remain untouched.
        verifySource(root, sourceCommit);
      },
    });
    return marker;
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/build-channels-renderer.mjs\nBuild an explicit renderer-only artifact from clean HEAD.\nTEAMS_SOURCE_COMMIT: full HEAD commit; TEAMS_RUNTIME_DIST_DIR: output root; TEAMS_TEST_TIMEOUT_MS: 1000..120000.');
  } else {
    if (process.argv.length > 2) throw new Error('Unknown Channels renderer build argument');
    const marker = await buildChannelsRenderer();
    console.log(`Channels native renderer built from ${marker.sourceCommit}: ${marker.artifactSha256}`);
  }
}
