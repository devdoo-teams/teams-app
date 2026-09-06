import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const matrixPath = new URL('../docs/superpowers/evidence/chatgpt-teams-capability-matrix.md', import.meta.url);
const markdown = await fs.readFile(matrixPath, 'utf8');
const match = /```json\n([\s\S]*?)\n```/u.exec(markdown);
assert.ok(match, 'capability matrix must contain a machine-readable JSON block');

const matrix = JSON.parse(match[1]);
assert.equal(matrix.schemaVersion, 1, 'capability matrix schema version is pinned');
assert.equal(matrix.accountFeatureInventoryComplete, false, 'account-specific feature inventory must remain explicit until observed');
assert.ok(Array.isArray(matrix.sources) && matrix.sources.length >= 4, 'matrix must cite primary contract sources');
assert.ok(matrix.sources.every((url) => /^https:\/\/(?:learn\.microsoft\.com|developers\.openai\.com|platform\.openai\.com|help\.openai\.com)\//u.test(url)), 'matrix sources must be first-party contract URLs');
assert.ok(Array.isArray(matrix.capabilities) && matrix.capabilities.length >= 17, 'matrix must cover the planned capability families');

const allowedStatuses = new Set([
  'SOURCE_TESTED',
  'IMPLEMENTED_UNVERIFIED',
  'OPTIONAL_UNCONFIGURED',
  'UNSUPPORTED_BY_CONTRACT',
  'MOBILE_UNVERIFIED',
  'LIVE_UNVERIFIED',
  'NOT_IMPLEMENTED',
]);
const ids = new Set();
for (const capability of matrix.capabilities) {
  for (const field of ['id', 'surface', 'officialContract', 'implementationEvidence', 'entitlement', 'negativeState', 'focusedTest', 'status']) {
    assert.equal(typeof capability[field], 'string', `${field} is required for ${capability.id ?? 'unknown capability'}`);
    assert.ok(capability[field].trim(), `${field} is non-empty for ${capability.id ?? 'unknown capability'}`);
  }
  assert.ok(!ids.has(capability.id), `capability id is unique: ${capability.id}`);
  ids.add(capability.id);
  assert.ok(allowedStatuses.has(capability.status), `status is controlled for ${capability.id}`);
  assert.match(capability.officialContract, /^https:\/\//u, `official contract is linked for ${capability.id}`);
  assert.match(capability.focusedTest, /(?:scripts\/|npm run|npx tsx|N\/A)/u, `focused verification is named for ${capability.id}`);
}

assert.ok(matrix.capabilities.some((capability) => capability.id === 'chatgpt-original-history' && capability.status === 'UNSUPPORTED_BY_CONTRACT'));
assert.ok(matrix.capabilities.some((capability) => capability.id === 'teams-core-agent' && capability.status === 'SOURCE_TESTED'));
assert.ok(matrix.capabilities.some((capability) => capability.id === 'teams-mobile-ui' && capability.status === 'MOBILE_UNVERIFIED'));
console.log(`capability-matrix-test: PASS (${matrix.capabilities.length} rows)`);
