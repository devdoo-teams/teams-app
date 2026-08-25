import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

import { buildClientAtomically } from './build-client-atomic.mjs';
import { buildWithBoundedRetry } from './esbuild-bounded.mjs';
import { ensureFileProviderRuntimeDependencies } from './fileprovider-runtime-deps.mjs';
import { filterClientSourceFiles } from './fileprovider-client-source.mjs';
import {
  assertCleanTrackedWorktreeForFileProvider,
  resolvePinnedCommitOid,
} from './fileprovider-git-clean.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const outputDir = path.join(resolveRuntimeDistRoot(root), 'client');
const coreBuild = process.argv.includes('--core');
const reuseFileProviderSources = process.env.TEAMS_FILEPROVIDER_SERVER_REUSE === '1';
const dockerBuild = process.env.TEAMS_BUILD_CONTEXT === 'docker';
const sourceCommit = process.env.TEAMS_SOURCE_COMMIT ?? resolvePinnedCommitOid(root);
const sourceVerification = assertCleanTrackedWorktreeForFileProvider(root, {
  commitOid: sourceCommit,
  excludedTrackedPaths: dockerBuild ? ['Dockerfile', '.dockerignore'] : [],
});
if (sourceVerification.commitOid !== sourceCommit) {
  throw new Error('Client build source verification changed the pinned Git OID');
}
const runtimeNodeModules = reuseFileProviderSources
  ? await ensureFileProviderRuntimeDependencies(root)
  : path.join(root, 'node_modules');

async function materializeGitClientSource(sourceCommit) {
  // Do not put the materialized tree back under the FileProvider workspace.
  // On macOS that would create another dataless placeholder and esbuild can
  // wait indefinitely while reading it. The system temp directory is local.
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-sdk-mvp-client-'));
  try {
    const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
    const relativeFiles = filterClientSourceFiles(execFileSync('git', [
      'ls-tree',
      '-r',
      '--name-only',
      '-z',
      sourceCommit,
      '--',
      'src/client',
      'src/shared',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: gitEnv,
      timeout: 10_000,
      killSignal: 'SIGKILL',
    }).split('\0').filter(Boolean), { coreBuild });
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
      sourceRoot: path.join(temporaryRoot, 'client'),
      cleanup: () => fs.rm(temporaryRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

const materializedSource = await materializeGitClientSource(sourceCommit);
const sourceRoot = materializedSource.sourceRoot;

try {
  await buildClientAtomically({
    outputDir,
    buildImplementation: async (temporaryDir) => {
      const assetsDir = path.join(temporaryDir, 'assets');
      await fs.mkdir(assetsDir, { recursive: true });

      await buildWithBoundedRetry(build, {
      entryPoints: [path.join(sourceRoot, 'main.tsx')],
      bundle: true,
      format: 'esm',
      // Source files use TypeScript's react-jsx contract and intentionally do
      // not rely on a global React identifier. Keep the production bundle on
      // the same automatic JSX runtime as tsconfig and core-source-check.
      jsx: 'automatic',
      splitting: true,
      nodePaths: [runtimeNodeModules],
      minify: true,
      outdir: assetsDir,
      entryNames: 'main',
      chunkNames: 'chunks/[name]-[hash]',
      // CopilotKit v2 produces a large split bundle. With the current
      // Node 24 + esbuild API combination, generating a source map for that
      // graph can hang indefinitely. Production Teams tabs do not need
      // source maps, so keep this bounded and opt-in only for a separate
      // debugging build when the toolchain is known to support it.
      sourcemap: false,
      loader: { '.css': 'css', '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
      define: { __TEAMS_OPTIONAL_RUNTIME__: coreBuild ? 'false' : 'true' },
      // The core tab never renders the optional CopilotKit runtime. Keep its
      // lazy import external so esbuild does not emit an optional component or
      // stylesheet into the API-free Teams artifact; optional builds bundle it
      // normally when the feature flag is explicitly enabled.
      external: coreBuild
        ? ['@copilotkit/*', '@modelcontextprotocol/*', './CopilotWorkspaceAssistant.js']
        : [],
      logLevel: 'info',
      }, `${coreBuild ? 'Core' : 'optional'} client bundle`);

      const sourceHtml = await fs.readFile(path.join(sourceRoot, 'index.html'), 'utf8');
      const clientBundle = await fs.readFile(path.join(assetsDir, 'main.js'));
      const assetVersion = crypto.createHash('sha256').update(clientBundle).digest('hex').slice(0, 12);
      const html = sourceHtml
        .replace('<meta name="theme-color" content="#6264a7" />', '<meta name="theme-color" content="#6264a7" />\n    <link rel="stylesheet" href="./assets/main.css" />')
        .replace('<script type="module" src="/main.tsx"></script>', `<script type="module" src="./assets/main.js?v=${assetVersion}"></script>`);

      await fs.writeFile(path.join(temporaryDir, 'index.html'), html, 'utf8');
    },
  });
} finally {
  await materializedSource.cleanup();
}

console.log(`Client bundle created from ${sourceCommit}: ${path.relative(root, outputDir)}`);
