import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { buildServerAtomically } from './build-server-atomic.mjs';
import { ensureFileProviderRuntimeDependencies } from './fileprovider-runtime-deps.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const outputDir = path.join(resolveRuntimeDistRoot(root), 'server');
const coreBuild = process.argv.includes('--core');
const reuseFileProviderBundle = process.env.TEAMS_FILEPROVIDER_SERVER_REUSE === '1';

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

async function assertReusableServerBundle() {
  const entryPath = path.join(outputDir, 'index.js');
  const markerPath = path.join(outputDir, '.teams-server-build-commit');
  const [entryStat, marker] = await Promise.all([
    fs.stat(entryPath),
    fs.readFile(markerPath, 'utf8'),
  ]);
  if (entryStat.size <= 0 || (Number.isInteger(entryStat.blocks) && entryStat.blocks === 0)) {
    throw new Error(`FileProvider server fallback requires a materialized bundle: ${entryPath}`);
  }
  const markerCommit = marker.trim();
  if (!/^[a-f0-9]{40}$/.test(markerCommit)) {
    throw new Error('FileProvider server fallback marker is missing a full Git commit');
  }
  return { entryPath, markerCommit };
}

async function materializeGitServerSource() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-sdk-mvp-server-'));
  const relativeFiles = execFileSync('git', ['ls-files', 'src/server', 'src/shared'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  }).split('\n').filter(Boolean);
  for (const relativeFile of relativeFiles) {
    const target = path.join(temporaryRoot, relativeFile.slice('src/'.length));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const contents = execFileSync('git', ['show', `HEAD:${relativeFile}`], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });
    await fs.writeFile(target, contents, 'utf8');
  }
  return {
    entryPoint: path.join(temporaryRoot, 'server', 'index.ts'),
    cleanup: () => fs.rm(temporaryRoot, { recursive: true, force: true }),
  };
}

let reusedBundle = null;
let materializedSource = null;
let fileProviderRuntimeNodeModules = null;
if (reuseFileProviderBundle) {
  reusedBundle = await assertReusableServerBundle();
  fileProviderRuntimeNodeModules = await ensureFileProviderRuntimeDependencies(root);
  const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (reusedBundle.markerCommit === currentCommit) {
    console.log(`Server bundle reused from ${reusedBundle.markerCommit} under FileProvider fallback: ${path.relative(root, reusedBundle.entryPath)}`);
  } else {
    materializedSource = await materializeGitServerSource();
    console.log(`Server source materialized from ${currentCommit} under FileProvider fallback: ${path.relative(root, materializedSource.entryPoint)}`);
  }
  await ensureRuntimeNodeModulesLink(path.join(outputDir, 'node_modules'), fileProviderRuntimeNodeModules);
}

if (!reusedBundle || materializedSource) {
  if (materializedSource && !fileProviderRuntimeNodeModules) {
    fileProviderRuntimeNodeModules = await ensureFileProviderRuntimeDependencies(root);
  }
  await buildServerAtomically({
    outputDir,
    buildImplementation: (temporaryDir) => build({
      entryPoints: [materializedSource?.entryPoint ?? path.join(root, 'src/server/index.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      nodePaths: [fileProviderRuntimeNodeModules ?? path.join(root, 'node_modules')],
      // Bundle the Teams SDK and its transitive runtime dependencies in the
      // normal local build. A FileProvider materialized fallback uses the
      // local runtime dependency cache as external imports because resolving
      // this graph from the temporary tree can otherwise reproduce the known
      // Node 24/esbuild 0%-CPU CJS graph hang.
      packages: materializedSource ? 'external' : 'bundle',
      mainFields: ['module', 'main'],
      // These imports are only reached by explicitly enabled optional branches.
      // Leave them external in the core artifact so the deterministic Teams
      // server has no MCP/CopilotKit chunks to ship or initialize.
      external: coreBuild
        ? [
          '@copilotkit/*',
          '@modelcontextprotocol/*',
          './mcp-genui.js',
          './copilot-agent.js',
          './copilot-channels-shadow.js',
        ]
        : [],
      outdir: temporaryDir,
      entryNames: 'index',
      splitting: coreBuild,
      sourcemap: coreBuild ? false : true,
      // The Core build receives a compile-time true flag. Simplify the
      // derived optional-runtime guards so esbuild can remove their dynamic
      // imports and never emit optional provider chunks into the API-free ZIP.
      minifySyntax: coreBuild,
      banner: {
        js: "import { createRequire as __teamsCreateRequire } from 'node:module'; const require = __teamsCreateRequire(import.meta.url);",
      },
      define: coreBuild ? { 'process.env.TEAMS_CORE_BUILD': '"true"' } : {},
      logLevel: 'info',
    }),
  });
  if (materializedSource) {
    const runtimeNodeModulesLink = path.join(outputDir, 'node_modules');
    await ensureRuntimeNodeModulesLink(runtimeNodeModulesLink, fileProviderRuntimeNodeModules);
  }
  await fs.writeFile(path.join(outputDir, '.teams-server-build-commit'), `${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()}\n`);
}

await materializedSource?.cleanup();

console.log(`Server bundle created: ${path.relative(root, outputDir)}`);
