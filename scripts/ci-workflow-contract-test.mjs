import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/core-ci.yml', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const declaredScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const referencedScripts = [
  ...workflow.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g),
].map((match) => match[1]);
const missingScripts = [...new Set(
  referencedScripts.filter((name) => !declaredScripts.has(name)),
)].sort();

assert.deepEqual(
  missingScripts,
  [],
  `GitHub Actions references undefined npm scripts: ${missingScripts.join(', ')}`,
);

const artifactStart = workflow.indexOf('\n  artifact:');
assert.notEqual(artifactStart, -1, 'workflow must define an immutable artifact job');
const artifactJob = workflow.slice(artifactStart);
for (const script of [
  'check:deployment',
  'validate:manifest',
  'package:app',
  'test:package-determinism',
  'test:package-output-determinism',
  'test:package-atomic',
  'test:release-timeout',
]) {
  assert.match(
    artifactJob,
    new RegExp(`npm run ${script.replaceAll(':', '\\:')}`),
    `immutable artifact job must run ${script} against the artifact source`,
  );
}
assert.match(
  artifactJob,
  /devicePermissions[\s\S]*geolocation/,
  'immutable artifact job must verify geolocation in the packaged manifest',
);

console.log(`ci-workflow-contract-test: PASS (${referencedScripts.length} npm commands)`);
