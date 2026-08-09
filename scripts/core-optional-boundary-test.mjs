import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const scripts = packageJson.scripts ?? {};

function npmRunNames(command = '') {
  return [...String(command).matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((match) => match[1]);
}

function assertIncludesAll(actual, expected, message) {
  for (const name of expected) assert.ok(actual.includes(name), `${message} must include ${name}`);
}

const coreTests = npmRunNames(scripts['test:core']);
const optionalTests = npmRunNames(scripts['test:optional']);
const apiFreeTests = npmRunNames(scripts['test:api-free']);
const coreBuild = npmRunNames(scripts['build:core']);
const optionalBuild = npmRunNames(scripts['build:optional']);
const combinedBuild = npmRunNames(scripts.build);
const allBuild = npmRunNames(scripts['build:all']);

assert.equal(scripts['test:core'], 'node scripts/core-test-runner.mjs');
assert.equal(scripts['test'], 'npm run test:api-free');
assert.equal(scripts['test:api-free'], 'node scripts/api-free-test-runner.mjs');
assert.equal(apiFreeTests.includes('test:optional'), false, 'test:api-free must not call the optional provider suite');
assertIncludesAll(optionalTests, ['test:openai-engine', 'test:local-engine', 'test:mcp-response-mode', 'test:mcp-direct-factory'], 'test:optional');
assert.equal(optionalTests.includes('test:copilot-item-seeding-failure'), false, 'CopilotKit runtime probe must not be part of the default optional provider suite');
assert.match(scripts['build:core'], /build-client\.mjs --core/, 'build:core must compile the core client');
assert.match(scripts['build:core'], /build-server\.mjs --core/, 'build:core must compile the core server');
assertIncludesAll(optionalBuild, ['build:mcp'], 'build:optional');
assertIncludesAll(combinedBuild, ['build:core'], 'build');
assert.equal(combinedBuild.includes('build:optional'), false, 'default build must not call optional provider build');
assertIncludesAll(allBuild, ['build:core', 'build:optional'], 'build:all');

for (const optionalCommand of ['test:openai-engine', 'test:local-engine', 'test:mcp-response-mode', 'test:mcp-direct-factory', 'test:optional:copilotkit', 'build:mcp', 'test:optional', 'build:optional']) {
  assert.equal(coreTests.includes(optionalCommand), false, `test:core must not call ${optionalCommand}`);
  assert.equal(apiFreeTests.includes(optionalCommand), false, `test:api-free must not call ${optionalCommand}`);
  assert.equal(coreBuild.includes(optionalCommand), false, `build:core must not call ${optionalCommand}`);
}

const releaseGate = await import('./release-gate.mjs');
assert.equal(typeof releaseGate.createPreflightCommands, 'function');
const preflight = releaseGate.createPreflightCommands(17);
assert.deepEqual(preflight, [
  ['core-source-check', 'typecheck:core', 17],
  ['core-build', 'build:core', 17],
  ['core-test', 'test:core', 17],
  ['deployment', 'check:deployment', 17],
]);
assert.equal(preflight.some(([, script]) => script === 'test'), false, 'preflight must not call full npm test');
assert.equal(preflight.some(([, script]) => script === 'build'), false, 'preflight must not call full npm build');
assert.equal(preflight.some(([, script]) => /openai|local-engine|mcp|optional/i.test(script)), false);

console.log('PASS: Teams core and optional commands remain separated at package and release-gate boundaries');
