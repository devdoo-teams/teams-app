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
const artifactStepsStart = artifactJob.indexOf('\n    steps:');
assert.notEqual(artifactStepsStart, -1, 'immutable artifact job must define its steps');
const artifactHeader = artifactJob.slice(0, artifactStepsStart);
assert.match(
  artifactHeader,
  /needs:\s*\[\s*core\s*,\s*a2a\s*,\s*continuity\s*,\s*container\s*\]/,
  'immutable artifact job must wait for Core, A2A, continuity, and Docker runtime verification',
);
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

const containerStart = workflow.indexOf('\n  container:');
assert.notEqual(containerStart, -1, 'workflow must define a container build job');
const containerJob = workflow.slice(containerStart, artifactStart);
assert.match(
  containerJob,
  /docker\/build-push-action@[0-9a-f]{40}/,
  'container job must use a pinned Docker build action',
);
assert.match(containerJob, /push:\s*false/, 'CI container verification must not publish before the hosting promotion gate');
assert.match(
  containerJob,
  /TEAMS_SOURCE_COMMIT=\$\{\{ github\.sha \}\}/,
  'container build must receive the exact GitHub source commit identity',
);
assert.match(containerJob, /load:\s*true/, 'container smoke must load the exact built image into the runner');
assert.match(containerJob, /docker run --detach/, 'container job must execute the built image, not only build it');
assert.match(containerJob, /\/api\/health/, 'container smoke must probe the production health endpoint');
assert.match(containerJob, /\/tabs\/home\//, 'container smoke must probe the Teams tab route');
assert.match(containerJob, /container source identity mismatch/, 'container smoke must verify the runtime source identity');
assert.match(containerJob, /hashed main\.js asset/, 'container smoke must verify the tab asset contract');

console.log(`ci-workflow-contract-test: PASS (${referencedScripts.length} npm commands)`);
