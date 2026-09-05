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

const a2aStart = workflow.indexOf('\n  a2a:');
const continuityStart = workflow.indexOf('\n  continuity:');
const azureStart = workflow.indexOf('\n  azure:');
const optionalStart = workflow.indexOf('\n  optional:');
assert.notEqual(a2aStart, -1, 'workflow must define an A2A job');
assert.notEqual(continuityStart, -1, 'workflow must define a continuity job');
assert.notEqual(azureStart, -1, 'workflow must define an Azure deployment-runner compatibility job');
assert.notEqual(optionalStart, -1, 'workflow must define an optional-provider job');
const a2aJob = workflow.slice(a2aStart, continuityStart);
assert.match(
  a2aJob,
  /npm run build:core/,
  'A2A runtime integration fixtures must build the commit-bound Core dist in their isolated job',
);
const azureJob = workflow.slice(azureStart, optionalStart);
assert.match(azureJob, /runs-on:\s*ubuntu-24\.04/, 'Azure compatibility must run on the pinned deployment OS');
assert.match(azureJob, /az bicep version/, 'Azure compatibility must validate the hosted Azure CLI Bicep integration');
assert.match(azureJob, /npm run test:azure-core/, 'Azure compatibility must run the complete explicit Azure Core inventory');
assert.match(azureJob, /npm run build:worker/, 'Azure compatibility must build the Linux worker before promotion');

const artifactStart = workflow.indexOf('\n  artifact:');
assert.notEqual(artifactStart, -1, 'workflow must define an immutable artifact job');
const artifactJob = workflow.slice(artifactStart);
const uploadStepStart = artifactJob.indexOf('\n      - name: Upload immutable release candidate');
assert.notEqual(uploadStepStart, -1, 'immutable artifact job must define its release candidate upload step');
const uploadStepEnd = artifactJob.indexOf('\n      - ', uploadStepStart + 1);
const uploadStep = artifactJob.slice(
  uploadStepStart,
  uploadStepEnd === -1 ? artifactJob.length : uploadStepEnd,
);
assert.match(
  uploadStep,
  /include-hidden-files:\s*true/,
  'release candidate upload must opt in to hidden files for the server build marker',
);
const uploadPathMatch = uploadStep.match(/\n          path:[ \t]*\|[ \t]*\n((?: {12}.*\n)+?)(?=          [A-Za-z0-9-]+:)/);
assert.ok(uploadPathMatch, 'release candidate upload must declare an explicit path block');
const uploadPaths = uploadPathMatch[1]
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
assert.deepEqual(
  uploadPaths,
  ['dist/', 'appPackage/build/teams-sdk-mvp.zip'],
  'release candidate upload must stay scoped to runtime dist and the exact Teams package ZIP',
);
const artifactStepsStart = artifactJob.indexOf('\n    steps:');
assert.notEqual(artifactStepsStart, -1, 'immutable artifact job must define its steps');
const artifactHeader = artifactJob.slice(0, artifactStepsStart);
assert.match(
  artifactHeader,
  /if:\s*github\.event_name\s*==\s*'workflow_dispatch'/,
  'immutable release candidates must require an explicit workflow dispatch',
);
assert.doesNotMatch(
  artifactHeader,
  /github\.event_name\s*!=\s*'pull_request'/,
  'ordinary main pushes must not generate a duplicate-version release candidate',
);
assert.match(
  artifactHeader,
  /needs:\s*\[\s*core\s*,\s*a2a\s*,\s*continuity\s*,\s*azure\s*,\s*container\s*\]/,
  'immutable artifact job must wait for Core, A2A, continuity, Azure, and Docker runtime verification',
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
  /devicePermissions[\s\S]*geolocation[\s\S]*false/,
  'immutable artifact job must reject removed geolocation in the packaged manifest',
);

const containerStart = workflow.indexOf('\n  container:');
assert.notEqual(containerStart, -1, 'workflow must define a container build job');
const containerJob = workflow.slice(containerStart, artifactStart);
assert.match(
  containerJob,
  /needs:\s*\[\s*core\s*,\s*a2a\s*,\s*continuity\s*,\s*azure\s*\]/,
  'container verification must wait for Azure deployment-runner compatibility',
);
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
