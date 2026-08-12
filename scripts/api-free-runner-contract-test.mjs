import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as coreSourceCheckBehavior from './core-source-check-lib.mjs';

const runner = fs.readFileSync(new URL('./api-free-test-runner.mjs', import.meta.url), 'utf8');
const clientBuild = fs.readFileSync(new URL('./build-client.mjs', import.meta.url), 'utf8');
const serverBuild = fs.readFileSync(new URL('./build-server.mjs', import.meta.url), 'utf8');
const responseModeApiTest = fs.readFileSync(new URL('./response-mode-api-test.ts', import.meta.url), 'utf8');
const authStartupTest = fs.readFileSync(new URL('./auth-startup-gate-test.mjs', import.meta.url), 'utf8');
const operatorAllowlistTest = fs.readFileSync(new URL('./operator-allowlist-runtime-test.mjs', import.meta.url), 'utf8');
const coreSourceCheck = fs.readFileSync(new URL('./core-source-check.mjs', import.meta.url), 'utf8');
const coreSourceCheckModule = fs.readFileSync(new URL('./core-source-check-lib.mjs', import.meta.url), 'utf8');
const esbuildBounded = fs.readFileSync(new URL('./esbuild-bounded.mjs', import.meta.url), 'utf8');

assert.match(
  runner,
  /'typecheck:core'/,
  'the default API-free suite must use the bounded core typecheck',
);
assert.doesNotMatch(
  runner,
  /\n\s*'typecheck',/,
  'the default API-free suite must not invoke the unbounded full typecheck',
);
assert.match(
  runner,
  /TEAMS_FILEPROVIDER_SERVER_REUSE/,
  'the default API-free suite must propagate the FileProvider-safe core fallback',
);
assert.match(
  runner,
  /statSync|blocks/,
  'the API-free runner must detect dataless FileProvider source before spawning child scripts',
);
assert.doesNotMatch(
  runner,
  /'test:channels-shadow'/,
  'the API-free runner must not execute the optional CopilotKit Channels shadow test',
);
assert.match(
  clientBuild,
  /os\.tmpdir\(\)/,
  'FileProvider-safe client builds must materialize source in the local system temp directory',
);
assert.match(
  clientBuild,
  /nodePaths:\s*\[runtimeNodeModules\]/,
  'FileProvider-safe client builds must resolve dependencies from the materialized runtime cache',
);
assert.match(
  serverBuild,
  /materializeGitServerSource|os\.tmpdir\(\)/,
  'FileProvider-safe server builds must materialize committed source in the local system temp directory when the bundle is stale',
);
assert.match(
  serverBuild,
  /nodePaths:\s*\[fileProviderRuntimeNodeModules \?\? path\.join\(root, 'node_modules'\)\]/,
  'normal server builds must preserve project dependency resolution from the workspace',
);
assert.match(
  serverBuild,
  /ensureFileProviderRuntimeDependencies/,
  'FileProvider-safe server builds must materialize runtime dependencies outside the workspace',
);
assert.match(
  responseModeApiTest,
  /resolveRuntimeDistRoot\(root\)/,
  'runtime API tests must execute the verified runtime distribution, not a dataless workspace dist path',
);
assert.match(
  responseModeApiTest,
  /join\(runtimeDistRoot, 'server', 'index\.js'\)/,
  'runtime API tests must launch the server bundle from the resolved runtime distribution',
);
assert.match(
  authStartupTest,
  /resolveRuntimeDistRoot\(root\)/,
  'production auth startup tests must resolve the verified runtime distribution',
);
assert.match(
  authStartupTest,
  /path\.join\(runtimeDistRoot, 'server', 'index\.js'\)/,
  'production auth startup tests must launch the server bundle from the resolved runtime distribution',
);
assert.match(
  operatorAllowlistTest,
  /resolveRuntimeDistRoot\(root\)/,
  'operator authorization runtime tests must resolve the verified runtime distribution',
);
assert.match(
  operatorAllowlistTest,
  /path\.join\(runtimeDistRoot, 'server', 'index\.js'\)/,
  'operator authorization runtime tests must launch the server bundle from the resolved runtime distribution',
);
assert.match(
  coreSourceCheck,
  /runCoreSourceCheck/,
  'the npm typecheck:core entrypoint must delegate to the deep Core source-check module',
);
assert.match(
  coreSourceCheckModule,
  /createRequire/,
  'core source checks must resolve the platform esbuild CLI through createRequire',
);
assert.match(
  coreSourceCheckModule,
  /@esbuild\/\$\{process\.platform\}-\$\{process\.arch\}\/bin\/esbuild/,
  'core source checks must resolve the platform esbuild CLI binary package path directly',
);
assert.doesNotMatch(
  coreSourceCheckModule,
  /transformSync/,
  "core source checks must not use esbuild's transformSync API",
);
assert.doesNotMatch(
  coreSourceCheckModule,
  /\btransform\s*\(/,
  'core source checks must not use the old async esbuild transform() path',
);
assert.doesNotMatch(
  coreSourceCheckModule,
  /\.stop\s*\(/,
  'core source checks must not manage a long-lived esbuild service with stop()',
);
assert.doesNotMatch(
  coreSourceCheckModule,
  /--service(?:=|\b)/,
  'core source checks must not invoke esbuild service mode',
);
assert.doesNotMatch(
  coreSourceCheckModule,
  /transformWithBoundedRetry/,
  'core source checks must not use the old transformWithBoundedRetry implementation',
);
{
  const timeoutMatch = coreSourceCheckModule.match(/const CORE_COMPILE_TIMEOUT_MS = ([\d_]+);/);
  assert.ok(timeoutMatch, 'core source checks must declare a finite compile timeout');
  const timeoutMs = Number(timeoutMatch[1].replaceAll('_', ''));
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10_000);
}
assert.match(
  coreSourceCheckModule,
  /git', \['show', `HEAD:\$\{relativePath\}`\]/,
  'FileProvider fallback must read checked Core sources from git show HEAD:<path>',
);
assert.match(
  esbuildBounded,
  /attempt <= 2|retrying once/,
  'esbuild builds must retry the known service-stop failure once and then fail fast',
);

{
  const captured = {};
  const adapters = coreSourceCheckBehavior.createDefaultAdapters('/tmp/core-source-check-root', {
    runCommandSync(command, args, options) {
      captured.command = command;
      captured.args = args;
      captured.options = options;
      return 'const ok = true;\n';
    },
  });

  const result = adapters.compileSource({
    relativePath: 'src/server/index.ts',
    source: 'export const ok = true;',
    loader: 'ts',
  });

  assert.equal(result.code, 'const ok = true;\n');
  assert.equal(typeof captured.command, 'string');
  assert.equal(captured.command.startsWith('/'), true);
  assert.deepEqual(captured.args, [
    '--loader=ts',
    '--format=esm',
    '--target=es2022',
    '--jsx=automatic',
    '--log-level=warning',
    '--sourcefile=src/server/index.ts',
  ]);
  assert.equal(captured.options.cwd, '/tmp/core-source-check-root');
  assert.equal(captured.options.encoding, 'utf8');
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.input, 'export const ok = true;');
  assert.equal(captured.options.timeout, 10_000);
  assert.ok(!captured.args.includes('--service'));
}

function makeCoreSourceAdapters(compileSource) {
  return {
    statFile() {
      return { size: 12, blocks: 8 };
    },
    readWorkspaceFile() {
      return 'export const ok = true;';
    },
    getTrackedWorktreeStatus() {
      return '';
    },
    readCommittedSource() {
      return 'export const ok = true;';
    },
    compileSource,
  };
}

{
  let attempts = 0;
  coreSourceCheckBehavior.runCoreSourceCheck({
    files: ['src/server/index.ts'],
    env: {},
    adapters: makeCoreSourceAdapters(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('The service was stopped');
      return { code: 'const ok = true;\n' };
    }),
  });
  assert.equal(attempts, 2, 'core compile must retry the exact service-stop failure once');
}

{
  let attempts = 0;
  assert.throws(
    () =>
      coreSourceCheckBehavior.runCoreSourceCheck({
        files: ['src/server/index.ts'],
        env: {},
        adapters: makeCoreSourceAdapters(() => {
          attempts += 1;
          throw new Error('The service was stopped');
        }),
      }),
    /Core source compile check failed for src\/server\/index\.ts: The service was stopped/,
  );
  assert.equal(attempts, 2, 'core compile must fail after exactly two service-stop attempts');
}

console.log('PASS: API-free runner avoids the unbounded full typecheck');
