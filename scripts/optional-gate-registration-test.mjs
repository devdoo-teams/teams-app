import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = fs.readFileSync(new URL('../.github/workflows/core-ci.yml', import.meta.url), 'utf8');
const scripts = packageJson.scripts ?? {};

function npmRunNames(command = '') {
  return [...String(command).matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((match) => match[1]);
}

const expectedOptionalBuilds = [
  'build:client',
  'build:server',
  'build:mcp',
  'build:optional-providers',
];

function testTarget(command = '') {
  const match = String(command).match(/^(?:node(?: --import \S+)?|tsx) (scripts\/[A-Za-z0-9._/-]+-test\.(?:mjs|ts))(?:\s|$)/u);
  return match?.[1];
}

const providerFixturePattern = /^(?:grok-(?:response-engine|bot-runtime|provider-runtime-adapter)|github-agent-tasks-[A-Za-z0-9-]+|external-collaboration-boundary|optional-provider-build)-test\.(?:mjs|ts)$/u;
const requiredOptionalFixtures = fs.readdirSync(path.join(root, 'scripts'))
  .filter((file) => providerFixturePattern.test(file))
  .map((file) => `scripts/${file}`)
  .sort();
const scriptsByFixture = new Map();
for (const [name, command] of Object.entries(scripts)) {
  const target = testTarget(command);
  if (target) scriptsByFixture.set(target, [...(scriptsByFixture.get(target) ?? []), name]);
}

assert.deepEqual(
  npmRunNames(scripts['build:optional']),
  expectedOptionalBuilds,
  'build:optional must compile the complete optional client, server, and MCP surfaces',
);

const optionalTests = npmRunNames(scripts['test:optional']);
for (const fixture of requiredOptionalFixtures) {
  const mappedScripts = scriptsByFixture.get(fixture) ?? [];
  assert.equal(mappedScripts.length, 1, `${fixture} must be mapped by exactly one declared npm test script`);
  const [testName] = mappedScripts;
  assert.equal(
    optionalTests.filter((name) => name === testName).length,
    1,
    `test:optional must register ${testName} (${fixture}) exactly once`,
  );
  assert.equal(testTarget(scripts[testName]), fixture, `${testName} must execute ${fixture}`);
}
assert.equal(
  optionalTests.includes('test:azure-github-handoff'),
  false,
  'azure-github-handoff is an Azure release handoff contract, not an optional provider fixture',
);
assert.equal(
  optionalTests.some((name) => /buzz/iu.test(name)),
  false,
  'MP-264 must not register Buzz before MP-266 has an approved concrete action',
);

const coreStart = workflow.indexOf('\n  core:');
const optionalStart = workflow.indexOf('\n  optional:');
const containerStart = workflow.indexOf('\n  container:');
assert.notEqual(coreStart, -1, 'workflow must define the Core job');
assert.notEqual(optionalStart, -1, 'workflow must define an independent optional job');
assert.notEqual(containerStart, -1, 'workflow must define the container job after optional');

const coreJob = workflow.slice(coreStart, optionalStart);
const optionalJob = workflow.slice(optionalStart, containerStart);
assert.match(optionalJob, /npm run build:optional/u, 'optional CI job must execute the aggregate optional build gate');
assert.match(optionalJob, /npm run test:optional/u, 'optional CI job must execute the aggregate optional test gate');
assert.doesNotMatch(coreJob, /npm run (?:build|test):optional/u, 'Core CI must not execute optional gates');
assert.doesNotMatch(optionalJob, /npm run test:grok-|npm run test:github-agent-tasks/u, 'optional CI must not bypass the deterministic aggregate gate');

const artifactStart = workflow.indexOf('\n  artifact:');
assert.notEqual(artifactStart, -1, 'workflow must define the immutable artifact job');
const artifactHeader = workflow.slice(artifactStart, workflow.indexOf('\n    steps:', artifactStart));
assert.doesNotMatch(artifactHeader, /needs:[^\n]*optional/u, 'optional failures must not block the Core artifact job');

console.log('optional-gate-registration-test: PASS');
