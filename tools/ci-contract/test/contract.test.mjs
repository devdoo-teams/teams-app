import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { complete, historicalRerun, reused, reseal, hash } from '../fixtures/factory.mjs';
import { validateResult, assessResult, notificationFor, compareNotifications, renderNotification, contractDigest } from '../lib/contract.mjs';
import { schema } from '../lib/schema.mjs';

test('strict schema accepts a complete fixture and distinguishes all four SHAs', () => {
  const value = complete(); assert.equal(validateResult(value).valid, true);
  const text = renderNotification(value);
  for (const sha of ['a', 'b', 'c', 'd']) assert.ok(text.includes(sha.repeat(40)));
  assert.match(text, /FIXTURE/); assert.match(text, /UNVERIFIED/);
});

for (const [name, mutate] of [
  ['missing identity', (x) => { delete x.identity; }],
  ['unknown command', (x) => { x.command = 'echo unsafe'; }],
  ['destination URL', (x) => { x.delivery.url = 'https://invalid.example'; }],
  ['unsafe endpoint', (x) => { x.observation.endpoint = 'https://invalid.example'; }],
  ['traversal workflow', (x) => { x.identity.workflow = '.github/workflows/../../private.yml'; }],
  ['unsafe numeric ID', (x) => { x.identity.runId = 9007199254740994; }],
  ['negative tests', (x) => { x.jobs[0].receipt.tests.executed = -1; }],
  ['malformed SHA', (x) => { x.identity.testedSha = 'short'; }],
  ['invalid date', (x) => { x.observation.fetchedAt = '2026-02-30T00:00:00Z'; }],
]) {
  test(`rejects ${name}`, () => { const x = complete(); mutate(x); assert.equal(validateResult(x).valid, false); });
}

test('API success with no receipt/artifact remains success and evidence UNKNOWN', () => {
  const result = assessResult(historicalRerun());
  assert.equal(result.apiConclusion, 'success'); assert.equal(result.evidenceGate, 'UNKNOWN');
  assert.equal(result.jobs[0].executionRelation, 'CARRY_FORWARD_CANDIDATE');
  assert.equal(result.jobs[0].carriedForwardFrom, null); assert.equal(result.newExecutionTests, 0);
  assert.equal(result.observedModelCalls, null);
});

test('valid current receipt has a scope gate, never an installed/UI pass', () => {
  const result = assessResult(complete());
  assert.equal(result.scopes[0].gate, 'PASS'); assert.equal(result.evidenceGate, 'CONSISTENT');
  assert.equal(result.jobs[0].executionRelation, 'CURRENT_EXECUTION_VERIFIED');
  assert.equal(result.newExecutionTests, 12); assert.equal(result.releaseAdmission, 'UNVERIFIED');
  assert.ok(result.liveGates.every((x) => x.state === 'UNVERIFIED'));
});

test('checksummed carried receipts do not add tests or duration to new execution', () => {
  const result = assessResult(reused());
  assert.equal(result.jobs[0].executionRelation, 'CARRY_FORWARD_VERIFIED');
  assert.equal(result.newExecutionTests, 0); assert.equal(result.newExecutionSeconds, 0);
  assert.equal(result.carriedForwardTests, 12);
});

test('reused dependency digests must match actual recorded consumption', () => {
  const x = reused(); x.jobs[0].expectedDependencyDigests = [hash('new-dependency')];
  assert.equal(assessResult(x).evidenceGate, 'BLOCKED');
});

for (const [name, mutate] of [
  ['receipt digest mismatch', (x) => { x.jobs[0].receipt.exitCode = 1; }],
  ['wrong tested SHA', (x) => { x.jobs[0].receipt.inputs.testedSha = 'e'.repeat(40); reseal(x.jobs[0]); }],
  ['different source run', (x) => { x.jobs[0].receipt.producer.runId = '1002'; reseal(x.jobs[0]); }],
  ['wrong matrix', (x) => { x.jobs[0].receipt.producer.matrixDigest = hash('other'); reseal(x.jobs[0]); }],
  ['duplicate job', (x) => { x.jobs.push(structuredClone(x.jobs[0])); }],
  ['zero tests', (x) => { x.jobs[0].receipt.tests.expected = 0; x.jobs[0].receipt.tests.executed = 0; reseal(x.jobs[0]); }],
  ['unexpected skip', (x) => { x.jobs[0].receipt.tests.unexpectedSkipped = 1; reseal(x.jobs[0]); }],
  ['cleanup failed', (x) => { x.jobs[0].receipt.cleanup = 'FAILED'; reseal(x.jobs[0]); }],
]) {
  test(`blocks ${name} without replacing API conclusion`, () => {
    const x = complete(); mutate(x); const result = assessResult(x);
    assert.equal(result.evidenceGate, 'BLOCKED'); assert.equal(result.apiConclusion, 'success');
  });
}

test('partial or incomplete pages cannot pass', () => {
  for (const field of ['status', 'paginationComplete']) {
    const x = complete(); x.observation[field] = field === 'status' ? 'in_progress' : false;
    assert.equal(assessResult(x).evidenceGate, 'UNKNOWN');
  }
});
test('missing matrix slot is UNKNOWN even if every returned job succeeds', () => {
  const x = complete(); x.requirements[0].jobs.push({ key: 'windows', matrixDigest: hash('windows') });
  assert.equal(assessResult(x).scopes[0].gate, 'UNKNOWN');
});
test('native Help scope cannot become full UI coverage', () => {
  const result = assessResult(historicalRerun());
  assert.deepEqual(result.scopes.map((x) => x.scope), ['iphone-help']);
  assert.ok(!renderNotification(historicalRerun()).includes('iphone-native-full: PASS'));
});
test('incomplete model measurement keeps null even when input claims zero', () => {
  const x = complete(); x.jobs[0].receipt.modelMeasurement.observedModelCalls = 0; reseal(x.jobs[0]);
  assert.equal(assessResult(x).observedModelCalls, null);
});
test('zero calls requires complete coverage, isolation and no unobserved paths', () => {
  const x = complete(); const m = x.jobs[0].receipt.modelMeasurement;
  Object.assign(m, { coverageComplete: true, credentialIsolationVerified: true, unobservedPaths: [], observedModelCalls: 0, blockedModelAttempts: 0 });
  reseal(x.jobs[0]); assert.equal(assessResult(x).observedModelCalls, 0);
  m.blockedModelAttempts = 1; reseal(x.jobs[0]);
  const result = assessResult(x); assert.equal(result.blockedModelAttempts, 1); assert.equal(result.scopes[0].gate, 'BLOCKED');
});
test('optional failure does not overwrite successful required Core scope', () => {
  const x = complete(); const job = structuredClone(x.jobs[0]);
  job.key = 'optional'; job.listedJobId = '9003'; job.apiConclusion = 'failure';
  job.receipt.producer.jobKey = 'optional'; job.receipt.producer.invocationId = 'synthetic-optional-1';
  job.receipt.exitCode = 1; job.receipt.tests.failed = 1; reseal(job); x.jobs.push(job);
  x.requirements.push({ scope: 'teams-optional', required: false, expectedTests: 12, jobs: [{ key: job.key, matrixDigest: job.matrixDigest }] });
  const result = assessResult(x); assert.equal(result.scopes[0].gate, 'PASS'); assert.equal(result.scopes[1].gate, 'FAIL');
  assert.equal(result.requiredScopesGate, 'PASS');
});
test('fetch time and delivery retry do not create a new notification', () => {
  const first = complete(); const second = complete(); second.observation.fetchedAt = '2026-10-20T00:04:00Z';
  second.observation.responseDigest = hash('same-result-fetched-again'); second.delivery.state = 'PENDING';
  assert.deepEqual(notificationFor(first), notificationFor(second));
  assert.equal(compareNotifications(notificationFor(first), notificationFor(second)), 'DUPLICATE');
});
test('duplicates, conflicting payloads, reverse events and separate runs stay distinct', () => {
  const first = notificationFor(complete());
  assert.equal(compareNotifications(first, { ...first, payloadDigest: hash('conflict') }), 'CONFLICT');
  assert.equal(compareNotifications({ ...first, sequence: 2 }, { ...first, id: hash('old'), sequence: 1 }), 'STALE');
  const other = complete(); other.identity.runId = '1002';
  assert.equal(compareNotifications(first, notificationFor(other)), 'UNRELATED');
});
test('evidence recovery makes a revision and a prior ACK cannot acknowledge it', () => {
  const before = historicalRerun(); const after = complete();
  before.delivery.state = 'ACKNOWLEDGED';
  const old = notificationFor(before);
  after.delivery = { state: 'ACKNOWLEDGED', ack: { notificationId: old.id, payloadDigest: old.payloadDigest, receiptDigest: hash('ack'), acknowledgedAt: '2026-10-20T00:04:00Z' } };
  assert.equal(assessResult(after).deliveryState, 'UNCERTAIN');
});
test('scheduled status or a missing ACK receipt cannot create acknowledgement', () => {
  const x = complete(); x.delivery.state = 'ACKNOWLEDGED';
  assert.equal(assessResult(x).deliveryState, 'UNCERTAIN');
});
test('output is deterministic, leaves input unchanged and has a shared contract digest', () => {
  const x = complete(); const original = structuredClone(x);
  assert.equal(renderNotification(x), renderNotification(x)); assert.deepEqual(x, original);
  assert.match(contractDigest(), /^[a-f0-9]{64}$/);
});
test('checked-in JSON fixtures share the same schema as runtime validation', () => {
  for (const name of ['teams-complete', 'iphone-rerun-unavailable', 'teams-reused']) {
    const value = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
    assert.equal(validateResult(value).valid, true, name);
  }
});

test('completed jobs without a conclusion cannot pass a receipt gate', () => {
  const x = complete(); x.jobs[0].apiConclusion = null;
  assert.equal(assessResult(x).scopes[0].gate, 'UNKNOWN');
});
test('an absent required scope is not a successful empty aggregate', () => {
  const x = complete(); x.requirements[0].required = false;
  assert.equal(assessResult(x).requiredScopesGate, 'BLOCKED');
});
test('duplicate invocations across different job keys do not inflate execution totals', () => {
  const x = complete(); const job = structuredClone(x.jobs[0]);
  job.key = 'second'; job.listedJobId = '9005'; job.receipt.producer.jobKey = 'second'; reseal(job); x.jobs.push(job);
  const result = assessResult(x); assert.equal(result.evidenceGate, 'BLOCKED'); assert.equal(result.newExecutionTests, null);
});
test('an available digest cannot conceal another expired artifact ID', () => {
  const x = complete(); x.artifacts.push({ ...x.artifacts[0], id: '7002', availability: 'EXPIRED' });
  assert.equal(assessResult(x).evidenceGate, 'UNKNOWN');
});
test('missing all expected jobs leaves execution attribution incomplete', () => {
  const x = complete(); x.jobs = [];
  assert.equal(assessResult(x).executionCountComplete, false);
});
test('a Help profile cannot declare full iPhone UI scope or use Teams evidence', () => {
  const x = historicalRerun(); x.requirements[0].scope = 'iphone-native-full';
  assert.equal(assessResult(x).evidenceGate, 'BLOCKED');
  const y = complete(); y.requirements[0].scope = 'iphone-help';
  assert.equal(assessResult(y).evidenceGate, 'BLOCKED');
});
test('old attempt receipts cannot claim execution after the new attempt started', () => {
  const x = reused(); x.observation.attemptStartedAt = '2026-10-20T00:00:00Z';
  assert.equal(assessResult(x).evidenceGate, 'BLOCKED');
});
test('artifact and receipt evidence changes create a result revision even when all gates stay equal', () => {
  const x = complete(); const y = complete(); y.artifacts[0].digest = hash('changed-bundle');
  y.jobs[0].receipt.producedArtifactDigests = [y.artifacts[0].digest]; reseal(y.jobs[0]);
  assert.notEqual(notificationFor(x).resultRevision, notificationFor(y).resultRevision);
});
test('a late partial event cannot supersede a final event with a higher sequence', () => {
  const x = notificationFor(complete());
  assert.equal(compareNotifications(x, { ...x, kind: 'partial-failure', id: hash('late-partial'), sequence: 2, previousNotificationId: x.id }), 'STALE');
});
test('matching ACK metadata has a distinct consistency state and preserves authenticity as unverified', () => {
  const x = complete(); const notice = notificationFor(x);
  x.delivery = { state: 'ACKNOWLEDGED', ack: { notificationId: notice.id, payloadDigest: notice.payloadDigest, receiptDigest: hash('external-ack'), acknowledgedAt: '2026-10-20T00:04:00Z' } };
  assert.equal(assessResult(x).deliveryState, 'ACK_METADATA_MATCHED');
});

test('profile primary scope must be present and required; Seed is auxiliary', () => {
  const core = complete(); core.requirements[0].scope = 'teams-a2a';
  assert.equal(assessResult(core).requiredScopesGate, 'BLOCKED');
  const help = complete(); help.identity.repository = 'doosanofficial-ui/WebDashboard'; help.identity.profile = 'native-help';
  help.observation.endpoint = '/repos/doosanofficial-ui/WebDashboard/actions/runs/1001/attempts/1/jobs';
  help.requirements[0].scope = 'iphone-seed'; help.requirements[0].expectedTests = null;
  help.jobs[0].kind = 'SEED'; help.jobs[0].receipt.tests = null;
  help.jobs[0].receipt.producer.repository = help.identity.repository; reseal(help.jobs[0]);
  assert.equal(assessResult(help).requiredScopesGate, 'BLOCKED');
});
test('reordering set-like collections preserves semantic notification identity', () => {
  const x = complete(); x.artifacts.push({ ...x.artifacts[0], id: '7002' });
  const other = structuredClone(x.jobs[0]); other.key = 'other'; other.listedJobId = '9005';
  other.receipt.producer.jobKey = 'other'; other.receipt.producer.invocationId = 'other-invocation'; reseal(other); x.jobs.push(other);
  x.requirements[0].jobs.push({ key: other.key, matrixDigest: other.matrixDigest }); x.requirements[0].expectedTests = 24;
  const y = structuredClone(x); y.jobs.reverse(); y.artifacts.reverse(); y.liveGates.reverse(); y.requirements[0].jobs.reverse();
  assert.deepEqual(notificationFor(x), notificationFor(y));
});
test('missing receipts retain explicit cancellation and timeout classification', () => {
  for (const [conclusion, classification] of [['cancelled', 'CANCELLED'], ['timed_out', 'TIMEOUT']]) {
    const x = historicalRerun(); x.jobs[0].apiConclusion = conclusion;
    assert.equal(assessResult(x).jobs[0].failureClass, classification);
    assert.equal(assessResult(x).jobs[0].executionRelation, 'CARRY_FORWARD_CANDIDATE');
  }
});
test('a completed workflow with no conclusion has unknown record evidence', () => {
  const x = complete(); x.observation.apiConclusion = null;
  assert.equal(assessResult(x).evidenceGate, 'UNKNOWN');
});
test('generated portable JSON Schema cannot drift from its source', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../ci-result.schema.json', import.meta.url), 'utf8')), schema);
});
test('notification comparison rejects malformed envelopes', () => {
  assert.throws(() => compareNotifications({}, {}), /INVALID_NOTIFICATION/);
});

test('unknown job kind cannot pass or turn unclassified work into zero tests', () => {
  const x = complete(); x.schemaVersion = '1.1.0'; x.jobs[0].kind = 'UNKNOWN';
  x.requirements[0].expectedTests = null;
  const result = assessResult(x);
  assert.equal(result.evidenceGate, 'UNKNOWN'); assert.equal(result.requiredScopesGate, 'UNKNOWN');
  assert.equal(result.jobs[0].executionRelation, 'UNKNOWN');
  assert.equal(result.scopes[0].verifiedExecutedTests, null);
  assert.equal(result.newExecutionTests, null); assert.equal(result.carriedForwardTests, null);
  assert.equal(result.newExecutionSeconds, null); assert.equal(result.executionCountComplete, false);
  assert.equal(result.observedModelCalls, null);
});

test('a known future producer attempt blocks even when expected or receipt inputs are unknown', () => {
  for (const boundary of ['expectedInputs', 'receipt']) {
    const x = complete(); x.schemaVersion = '1.1.0'; x.jobs[0].receipt.producer.attempt = 2;
    if (boundary === 'expectedInputs') x.jobs[0].expectedInputs.toolchainDigest = null;
    else x.jobs[0].receipt.inputs.toolchainDigest = null;
    reseal(x.jobs[0]);
    const result = assessResult(x);
    assert.equal(result.evidenceGate, 'BLOCKED', boundary);
    assert.ok(result.jobs[0].issues.includes('FUTURE_PRODUCER_ATTEMPT'), boundary);
    assert.equal(x.jobs[0].receipt.producer.attempt, 2);
  }
});
