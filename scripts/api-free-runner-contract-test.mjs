import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner = fs.readFileSync(new URL('./api-free-test-runner.mjs', import.meta.url), 'utf8');
const clientBuild = fs.readFileSync(new URL('./build-client.mjs', import.meta.url), 'utf8');
const serverBuild = fs.readFileSync(new URL('./build-server.mjs', import.meta.url), 'utf8');
const responseModeApiTest = fs.readFileSync(new URL('./response-mode-api-test.ts', import.meta.url), 'utf8');
const authStartupTest = fs.readFileSync(new URL('./auth-startup-gate-test.mjs', import.meta.url), 'utf8');
const operatorAllowlistTest = fs.readFileSync(new URL('./operator-allowlist-runtime-test.mjs', import.meta.url), 'utf8');
const coreSourceCheck = fs.readFileSync(new URL('./core-source-check.mjs', import.meta.url), 'utf8');
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
  /transformWithBoundedRetry|service was stopped/i,
  'core source checks must retry only the known transient esbuild service-stop failure within a bounded attempt count',
);
assert.match(
  esbuildBounded,
  /attempt <= 2|retrying once/,
  'esbuild builds must retry the known service-stop failure once and then fail fast',
);

console.log('PASS: API-free runner avoids the unbounded full typecheck');
