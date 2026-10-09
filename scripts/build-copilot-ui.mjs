import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { buildWithBoundedRetry } from './esbuild-bounded.mjs';
import { buildClientAtomically } from './build-client-atomic.mjs';
import { assertCleanTrackedWorktreeForFileProvider, resolvePinnedCommitOid } from './fileprovider-git-clean.mjs';
import { ensureFileProviderRuntimeDependencies } from './fileprovider-runtime-deps.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const sourceCommit = process.env.TEAMS_SOURCE_COMMIT ?? resolvePinnedCommitOid(root);
assertCleanTrackedWorktreeForFileProvider(root, { commitOid: sourceCommit });
const outputDir = path.join(resolveRuntimeDistRoot(root), 'copilot-ui');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-copilot-ui-source-'));
try {
  const archive = execFileSync('git', ['archive', sourceCommit, 'src/server', 'src/shared', 'src/client', 'src/optional-ui'],
    { cwd: root, timeout: 10_000, maxBuffer: 30 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', temporaryRoot], { input: archive, timeout: 10_000 });
  const dependencies = await ensureFileProviderRuntimeDependencies(root);
  const readPackage = async name => JSON.parse(await fs.readFile(path.join(dependencies, name, 'package.json'), 'utf8')).version;
  const runtimeVersion = await readPackage('@copilotkit/runtime');
  const agUiVersion = await readPackage('@ag-ui/client');
  if (runtimeVersion !== '1.66.2' || agUiVersion !== '0.0.57') throw new Error('COPILOT_UI_INSTALLED_CONTRACT_DRIFT');
  await buildClientAtomically({ outputDir, validateRuntime: async dir => {
    for (const file of ['server.js', '.teams-copilot-ui-build.json', 'client/index.html', 'client/assets/main.js', 'client/assets/main.css']) {
      if ((await fs.stat(path.join(dir, file))).size <= 0) throw new Error(`COPILOT_UI_BUILD_INCOMPLETE: ${file}`);
    }
  }, buildImplementation: async temporaryDir => {
    await buildWithBoundedRetry(build, {
      absWorkingDir: temporaryRoot, entryPoints: ['src/server/copilot-ui-runtime.ts'],
      bundle: true, platform: 'node', format: 'esm', packages: 'external',
      outfile: path.join(temporaryDir, 'server.js'), legalComments: 'none', sourcemap: false,
      nodePaths: [dependencies],
    }, 'CopilotKit read-only server');
    const clientDir = path.join(temporaryDir, 'client');
    await buildWithBoundedRetry(build, {
      absWorkingDir: temporaryRoot, entryPoints: ['src/optional-ui/main.tsx'],
      bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', splitting: true,
      outdir: path.join(clientDir, 'assets'), entryNames: 'main', chunkNames: 'chunks/[name]-[hash]',
      legalComments: 'none', sourcemap: false, minify: true,
      loader: { '.css': 'css', '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
      define: { __TEAMS_OPTIONAL_RUNTIME__: 'true', 'process.env.NODE_ENV': '"production"' },
      nodePaths: [dependencies],
    }, 'CopilotKit real SDK client');
    const html = await fs.readFile(path.join(temporaryRoot, 'src/optional-ui/index.html'), 'utf8');
    await fs.writeFile(path.join(clientDir, 'index.html'), html
      .replace(/src="\/main\.tsx"/, 'src="./assets/main.js"')
      .replace('</head>', '<link rel="stylesheet" href="./assets/main.css" /></head>'));
    const files = {};
    async function hashTree(dir, rel = '') {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const relative = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await hashTree(path.join(dir, entry.name), relative);
        else files[relative] = createHash('sha256').update(await fs.readFile(path.join(dir, entry.name))).digest('hex');
      }
    }
    await hashTree(temporaryDir);
    await fs.writeFile(path.join(temporaryDir, '.teams-copilot-ui-build.json'), JSON.stringify({
      schemaVersion: 1, mode: 'copilot-ui', worktree: 'clean', sourceCommit, runtimeVersion, agUiVersion, files,
    }, null, 2));
  } });
  console.log(`CopilotKit UI built from ${sourceCommit}: ${outputDir}`);
} finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
