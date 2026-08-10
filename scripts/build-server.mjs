import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { buildServerAtomically } from './build-server-atomic.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const outputDir = path.join(resolveRuntimeDistRoot(root), 'server');
const coreBuild = process.argv.includes('--core');
const reuseFileProviderBundle = process.env.TEAMS_FILEPROVIDER_SERVER_REUSE === '1';

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

async function assertWorkingTreeServerSourceIsCommitted() {
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src/server', 'src/shared'], {
      cwd: root,
      timeout: 10_000,
      stdio: 'ignore',
    });
  } catch {
    throw new Error('FileProvider server fallback requires src/server and src/shared changes to be committed before building');
  }
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
if (reuseFileProviderBundle) {
  reusedBundle = await assertReusableServerBundle();
  await assertWorkingTreeServerSourceIsCommitted();
  const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (reusedBundle.markerCommit === currentCommit) {
    console.log(`Server bundle reused from ${reusedBundle.markerCommit} under FileProvider fallback: ${path.relative(root, reusedBundle.entryPath)}`);
  } else {
    materializedSource = await materializeGitServerSource();
    console.log(`Server source materialized from ${currentCommit} under FileProvider fallback: ${path.relative(root, materializedSource.entryPoint)}`);
  }
}

if (!reusedBundle || materializedSource) {
  await buildServerAtomically({
    outputDir,
    buildImplementation: (temporaryDir) => build({
      entryPoints: [materializedSource?.entryPoint ?? path.join(root, 'src/server/index.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      nodePaths: [path.join(root, 'node_modules')],
      // Bundle the Teams SDK and its transitive runtime dependencies so the
      // production process does not pay the very large cold module-load cost on
      // every start. Prefer the SDK's ESM entry point: selecting its CommonJS
      // main entry with the current esbuild release can hang indefinitely while
      // resolving the dynamic export graph (0% CPU, no output).
      packages: 'bundle',
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
      banner: {
        js: "import { createRequire as __teamsCreateRequire } from 'node:module'; const require = __teamsCreateRequire(import.meta.url);",
      },
      define: coreBuild ? { __TEAMS_CORE_BUILD__: 'true' } : {},
      logLevel: 'info',
    }),
  });
  await fs.writeFile(path.join(outputDir, '.teams-server-build-commit'), `${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()}\n`);
}

await materializedSource?.cleanup();

console.log(`Server bundle created: ${path.relative(root, outputDir)}`);
