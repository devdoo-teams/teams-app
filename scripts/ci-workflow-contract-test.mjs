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

console.log(`ci-workflow-contract-test: PASS (${referencedScripts.length} npm commands)`);
