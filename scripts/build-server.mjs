import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { buildServerAtomically } from './build-server-atomic.mjs';
import { ensureFileProviderRuntimeDependencies } from './fileprovider-runtime-deps.mjs';
import { buildWithBoundedRetry } from './esbuild-bounded.mjs';
import {
  assertCleanTrackedWorktreeForFileProvider,
  resolvePinnedCommitOid,
} from './fileprovider-git-clean.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';
import { createServerBuildMarker, isReusableServerBuild, parseServerBuildMarker } from './server-build-marker.mjs';

const root = process.cwd();
const outputDir = path.join(resolveRuntimeDistRoot(root), 'server');
const coreBuild = process.argv.includes('--core');
const optionalExternalPackages = [
  '@copilotkit/*',
  '@modelcontextprotocol/*',
];
const reuseFileProviderBundle = process.env.TEAMS_FILEPROVIDER_SERVER_REUSE === '1';
const dockerBuild = process.env.TEAMS_BUILD_CONTEXT === 'docker';
const sourceCommit = process.env.TEAMS_SOURCE_COMMIT ?? resolvePinnedCommitOid(root);
const sourceVerification = assertCleanTrackedWorktreeForFileProvider(root, {
  commitOid: sourceCommit,
  excludedTrackedPaths: dockerBuild ? ['Dockerfile', '.dockerignore'] : [],
});
if (sourceVerification.commitOid !== sourceCommit) {
  throw new Error('Server build source verification changed the pinned Git OID');
}

async function ensureRuntimeNodeModulesLink(targetPath, dependencyPath) {
  try {
    const stat = await fs.lstat(targetPath);
    if (!stat.isSymbolicLink()) {
      throw new Error(`FileProvider runtime dependency path is not a symlink: ${targetPath}`);
    }
    const currentTarget = path.resolve(path.dirname(targetPath), await fs.readlink(targetPath));
    if (currentTarget === path.resolve(dependencyPath)) return;
    await fs.unlink(targetPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.symlink(dependencyPath, targetPath, 'junction');
}

async function findReusableServerBundle() {
  const entryPath = path.join(outputDir, 'index.js');
  const markerPath = path.join(outputDir, '.teams-server-build-commit');
  try {
    const [entryStat, entryBytes, markerRaw] = await Promise.all([
      fs.stat(entryPath),
      fs.readFile(entryPath),
      fs.readFile(markerPath, 'utf8'),
    ]);
    if (entryStat.size <= 0 || (Number.isInteger(entryStat.blocks) && entryStat.blocks === 0)) return null;
    const marker = parseServerBuildMarker(markerRaw);
    if (!marker) return null;
    const bundleSha256 = crypto.createHash('sha256').update(entryBytes).digest('hex');
    if (marker.bundleSha256 !== bundleSha256) return null;
    return { entryPath, marker, bundleSha256 };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function materializeGitServerSource(sourceCommit) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-sdk-mvp-server-'));
  try {
    const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
    const relativeFiles = execFileSync('git', [
      'ls-tree',
      '-r',
      '--name-only',
      '-z',
      sourceCommit,
      '--',
      'src/server',
      'src/shared',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: gitEnv,
      timeout: 10_000,
      killSignal: 'SIGKILL',
    }).split('\0').filter(Boolean);
    for (const relativeFile of relativeFiles) {
      const target = path.join(temporaryRoot, relativeFile.slice('src/'.length));
      await fs.mkdir(path.dirname(target), { recursive: true });
      const contents = execFileSync('git', ['show', `${sourceCommit}:${relativeFile}`], {
        cwd: root,
        env: gitEnv,
        timeout: 10_000,
        killSignal: 'SIGKILL',
      });
      await fs.writeFile(target, contents);
    }
    return {
      // Keep esbuild's working directory inside the materialized tree, but do
      // not pass its random absolute path as the entry point. Absolute temp
      // paths leak into esbuild's legal comments and change the bundle hash on
      // every FileProvider fallback build.
      sourceRoot: temporaryRoot,
      entryPointRelative: 'server/index.ts',
      entryPoint: path.join(temporaryRoot, 'server', 'index.ts'),
      cleanup: () => fs.rm(temporaryRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

let reusedBundle = null;
let materializedSource = null;
let fileProviderRuntimeNodeModules = null;
if (reuseFileProviderBundle) {
  reusedBundle = await findReusableServerBundle();
  fileProviderRuntimeNodeModules = await ensureFileProviderRuntimeDependencies(root);
  if (reusedBundle && isReusableServerBuild(
    JSON.stringify(reusedBundle.marker),
    { sourceCommit, coreBuild, bundleSha256: reusedBundle.bundleSha256 },
  )) {
    console.log(`Server ${coreBuild ? 'Core' : 'optional'} bundle reused from ${reusedBundle.marker.sourceCommit} under FileProvider fallback: ${path.relative(root, reusedBundle.entryPath)}`);
  } else {
    materializedSource = await materializeGitServerSource(sourceCommit);
    console.log(`Server source materialized from ${sourceCommit} for ${coreBuild ? 'Core' : 'optional'} build under FileProvider fallback: ${path.relative(root, materializedSource.entryPoint)}`);
  }
  await ensureRuntimeNodeModulesLink(path.join(outputDir, 'node_modules'), fileProviderRuntimeNodeModules);
}

if (!reusedBundle && !materializedSource) {
  materializedSource = await materializeGitServerSource(sourceCommit);
}

try {
  if (!reusedBundle || materializedSource) {
    if (reuseFileProviderBundle && materializedSource && !fileProviderRuntimeNodeModules) {
      fileProviderRuntimeNodeModules = await ensureFileProviderRuntimeDependencies(root);
    }
    await buildServerAtomically({
      outputDir,
      buildImplementation: (temporaryDir) => buildWithBoundedRetry(build, {
      absWorkingDir: materializedSource?.sourceRoot ?? root,
      entryPoints: [materializedSource?.entryPointRelative ?? 'src/server/index.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      nodePaths: [fileProviderRuntimeNodeModules ?? path.join(root, 'node_modules')],
      // Bundle the Teams SDK and its transitive runtime dependencies in the
      // normal local build. A FileProvider materialized fallback uses the
      // local runtime dependency cache as external imports because resolving
      // this graph from the temporary tree can otherwise reproduce the known
      // Node 24/esbuild 0%-CPU CJS graph hang.
      packages: reuseFileProviderBundle ? 'external' : 'bundle',
      mainFields: ['module', 'main'],
      // These imports are only reached by explicitly enabled optional branches.
      // Leave them external in the core artifact so the deterministic Teams
      // server has no MCP/CopilotKit chunks to ship or initialize.
      // Optional providers are runtime dependencies, not part of the Core
      // bundle. Keeping their large CJS/SDK graphs external avoids the known
      // Node 24/esbuild service stall while preserving the opt-in runtime.
      external: coreBuild
        ? [
          ...optionalExternalPackages,
          './mcp-genui.js',
          './mcp-provider-tools.js',
          './copilot-agent.js',
          './copilot-channels-shadow.js',
        ]
        : optionalExternalPackages,
      outdir: temporaryDir,
      entryNames: 'index',
      // Keep optional provider chunks lazy as well. The default production
      // startup must not parse the large optional graph before listen().
      splitting: true,
      // Node 24 + esbuild can stall while emitting the large optional
      // CopilotKit/provider source map. Production runtime identity is
      // carried by the build marker and bundle SHA instead.
      sourcemap: false,
      // The Core build receives a compile-time true flag. Simplify the
      // derived optional-runtime guards so esbuild can remove their dynamic
      // imports and never emit optional provider chunks into the API-free ZIP.
      minifySyntax: coreBuild,
      banner: {
        js: "import { createRequire as __teamsCreateRequire } from 'node:module'; const require = __teamsCreateRequire(import.meta.url);",
      },
      define: coreBuild ? { 'process.env.TEAMS_CORE_BUILD': '"true"' } : {},
      logLevel: 'info',
        }, `${coreBuild ? 'Core' : 'optional'} server bundle`),
    });
    if (reuseFileProviderBundle && materializedSource) {
      const runtimeNodeModulesLink = path.join(outputDir, 'node_modules');
      await ensureRuntimeNodeModulesLink(runtimeNodeModulesLink, fileProviderRuntimeNodeModules);
    }
    const bundleSha256 = crypto.createHash('sha256')
      .update(await fs.readFile(path.join(outputDir, 'index.js')))
      .digest('hex');
    await fs.writeFile(
      path.join(outputDir, '.teams-server-build-commit'),
      createServerBuildMarker({ sourceCommit, coreBuild, bundleSha256 }),
    );
  }
} finally {
  await materializedSource?.cleanup();
}

// Normal optional builds keep provider SDKs external. The stable runtime
// directory must therefore resolve them through the source workspace's
// dependency tree; Core never imports this graph.
if (!coreBuild && !fileProviderRuntimeNodeModules) {
  await ensureRuntimeNodeModulesLink(
    path.join(outputDir, 'node_modules'),
    path.join(root, 'node_modules'),
  );
}

console.log(`Server bundle created from ${sourceCommit}: ${path.relative(root, outputDir)}`);
