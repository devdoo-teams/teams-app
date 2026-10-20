import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { producerFixture } from '../fixtures/producer.mjs';
import { githubFixture } from '../fixtures/github.mjs';
import { readGithubCapture } from '../lib/github-reader.mjs';
import { hash, complete } from '../fixtures/factory.mjs';
import { validateReceipt, assessResult, digest } from '../lib/contract.mjs';
import { readProducerCapture, workflowJobPlan } from '../lib/producer.mjs';

function materialize(t, data) {
  const root = mkdtempSync(join(tmpdir(), 'ci-producer-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ ...data.files, 'producer.json': JSON.stringify(data.capture) })) writeFileSync(join(root, name), value);
  return root;
}
function change(data, file, update) {
  const value = JSON.parse(data.files[file]); update(value); data.files[file] = JSON.stringify(value);
  for (const descriptor of [...Object.values(data.capture), ...data.capture.scopes]) {
    if (descriptor?.file === file) descriptor.sha256 = hash(data.files[file]);
  }
}
test('producer preserves original run/attempt/source/scope and hashes actual artifact bytes', (t) => {
  const data = producerFixture(); const value = readProducerCapture(materialize(t, data));
  assert.equal(validateReceipt(value.receipt), true);
  assert.equal(value.receipt.producer.runId, '1001'); assert.equal(value.receipt.producer.runNumber, '42');
  assert.equal(value.receipt.producer.attempt, 1); assert.equal(value.receipt.inputs.testedSha, 'a'.repeat(40));
  assert.deepEqual(value.receipt.tests, { expected: 5, executed: 5, failed: 0, unexpectedSkipped: 0 });
  assert.deepEqual(value.receipt.producedArtifactDigests, [hash('synthetic package bytes')]);
  assert.equal(value.scopeReport.planned.length, 2); assert.equal(value.scopeReport.observed.length, 2);
  assert.equal(value.provenance.evidenceKind, 'FIXTURE'); assert.equal(value.provenance.sourceAuthenticity, 'UNVERIFIED');
  assert.equal(value.receipt.modelMeasurement.observedModelCalls, null);
});

test('producer rejects missing, duplicate, extra or mismatched execution scopes', (t) => {
  for (const mutate of [
    (x) => { x.capture.scopes.pop(); },
    (x) => { x.capture.scopes[1].scopeId = 'step-1'; },
    (x) => { x.capture.scopes[1].scopeId = 'step-3'; },
    (x) => { change(x, 'step-2.json', (row) => { row.definitionDigest = 'e'.repeat(64); }); },
    (x) => { change(x, 'step-2.json', (row) => { row.scopeId = 'step-1'; }); },
  ]) {
    const data = producerFixture(); mutate(data);
    assert.throws(() => readProducerCapture(materialize(t, data)), /SCOPE_INVENTORY_MISMATCH/);
  }
});

test('original job and step context cannot be relabeled to a different run, attempt or commit', (t) => {
  for (const file of ['job.json', 'step-1.json']) for (const [key, value] of Object.entries({ runId: '1002', runNumber: '43', attempt: 2, jobKey: 'a2a', invocationId: 'other-invocation', testedSha: 'b'.repeat(40) })) {
    const data = producerFixture(); change(data, file, (row) => { row.context[key] = value; });
    assert.throws(() => readProducerCapture(materialize(t, data)), /EXECUTION_CONTEXT_MISMATCH/, `${file}:${key}`);
  }
});

test('source commit and full workflow/package/lock bytes must match the source observation', (t) => {
  for (const key of ['testedSha', 'workflowSha256', 'packageSha256', 'lockSha256']) {
    const data = producerFixture(); change(data, 'source.json', (row) => { row[key] = 'b'.repeat(key === 'testedSha' ? 40 : 64); });
    assert.throws(() => readProducerCapture(materialize(t, data)), /SOURCE_IDENTITY_MISMATCH/, key);
  }
});

test('execution times, status, exit and counter evidence must be internally consistent', (t) => {
  for (const [file, mutate] of [
    ['job.json', (row) => { row.completedAt = '2026-10-20T00:00:00Z'; }],
    ['step-1.json', (row) => { row.startedAt = '2026-10-20T00:00:00Z'; }],
    ['step-2.json', (row) => { row.startedAt = '2026-10-20T00:01:10Z'; }],
    ['step-1.json', (row) => { row.exitCode = 1; }],
    ['step-1.json', (row) => { row.tests.failed = 3; }],
    ['step-1.json', (row) => { row.tests = null; }],
    ['step-1.json', (row) => { row.testEvidence = 'NONE'; }],
    ['step-1.json', (row) => { row.state = 'NOT_RUN'; }],
  ]) {
    const data = producerFixture(); change(data, file, mutate);
    assert.throws(() => readProducerCapture(materialize(t, data)), /EXECUTION_OBSERVATION_MISMATCH/);
  }
});

test('failed original execution keeps its exit, cleanup and explicit unexecuted scope', (t) => {
  const data = producerFixture();
  change(data, 'job.json', (row) => { row.exitCode = 7; row.cleanup = 'FAILED'; });
  change(data, 'step-1.json', (row) => { row.exitCode = 7; row.tests.failed = 1; });
  change(data, 'step-2.json', (row) => { row.state = 'NOT_RUN'; row.startedAt = null; row.completedAt = null; row.exitCode = null; row.testEvidence = 'UNKNOWN'; row.tests = null; });
  const value = readProducerCapture(materialize(t, data));
  assert.equal(value.receipt.exitCode, 7); assert.equal(value.receipt.cleanup, 'FAILED');
  assert.equal(value.receipt.tests.executed, null); assert.equal(value.scopeReport.observed[1].state, 'NOT_RUN');
  assert.equal(value.scopeReport.observed[0].tests.failed, 1);
});

test('cancelled execution preserves its original partial time and unknown tests', (t) => {
  const data = producerFixture(); change(data, 'job.json', (row) => { row.exitCode = 130; row.cleanup = 'UNKNOWN'; });
  change(data, 'step-1.json', (row) => { row.state = 'CANCELLED'; row.completedAt = null; row.exitCode = null; row.testEvidence = 'UNKNOWN'; row.tests = null; });
  change(data, 'step-2.json', (row) => { row.state = 'NOT_RUN'; row.startedAt = null; row.completedAt = null; row.exitCode = null; row.testEvidence = 'UNKNOWN'; row.tests = null; });
  const { receipt, scopeReport } = readProducerCapture(materialize(t, data));
  assert.equal(receipt.exitCode, 130); assert.equal(receipt.cleanup, 'UNKNOWN'); assert.equal(receipt.tests.executed, null);
  assert.equal(scopeReport.observed[0].startedAt, '2026-10-20T00:01:00.000Z'); assert.equal(scopeReport.observed[0].completedAt, null);
  assert.equal(scopeReport.observed[0].state, 'CANCELLED');
});

test('declared artifact inventory and measured toolchain identity cannot silently shrink or conflict', (t) => {
  for (const mutate of [
    (x) => { x.capture.producedArtifacts = []; },
    (x) => { change(x, 'profile.json', (row) => { row.consumedArtifacts = ['seed']; }); },
    (x) => { x.capture.producedArtifacts[0].name = 'other-package'; },
  ]) {
    const data = producerFixture(); mutate(data);
    assert.throws(() => readProducerCapture(materialize(t, data)), /ARTIFACT_INVENTORY_MISMATCH/);
  }
  const data = producerFixture(); change(data, 'toolchain.json', (row) => { row.tools[0].version = '25.0.0'; });
  assert.throws(() => readProducerCapture(materialize(t, data)), /TOOLCHAIN_IDENTITY_MISMATCH/);
});

test('fixture producer source remains labeled inside the receipt and cannot pass as an observation', (t) => {
  const { receipt } = readProducerCapture(materialize(t, producerFixture()));
  assert.equal(receipt.evidenceKind, 'FIXTURE');
  const document = complete(); document.evidenceKind = 'OBSERVATION';
  const job = document.jobs[0]; job.receipt = receipt; job.receiptDigest = digest(receipt);
  job.expectedInputs = receipt.inputs; job.matrixDigest = receipt.producer.matrixDigest;
  document.requirements[0].jobs[0].matrixDigest = job.matrixDigest; document.requirements[0].expectedTests = 5;
  document.artifacts[0].digest = receipt.producedArtifactDigests[0];
  const result = assessResult(document);
  assert.equal(result.apiConclusion, 'success'); assert.equal(result.evidenceGate, 'BLOCKED');
  assert.ok(result.jobs[0].issues.includes('FIXTURE_RECEIPT_IN_OBSERVATION'));
});

test('producer CLI creates an immutable hash-bound five-file packet and never reports an ACK', (t) => {
  const root = materialize(t, producerFixture()); const output = join(root, 'packet');
  const cli = fileURLToPath(new URL('../produce-receipt.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [cli, '--capture-dir', root, '--output-dir', output], { encoding: 'utf8', timeout: 10000, env: { LANG: 'C.UTF-8' } });
  const first = run(); assert.equal(first.status, 0, first.stderr);
  const summary = JSON.parse(first.stdout); assert.equal(summary.status, 'RECEIPT_WRITTEN');
  const receiptBytes = readFileSync(join(output, 'receipt.json')); const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.sourceEvidenceDigest, hash(readFileSync(join(output, 'producer-provenance.json'))));
  const provenance = JSON.parse(readFileSync(join(output, 'producer-provenance.json')));
  assert.equal(provenance.scopeReportSha256, hash(readFileSync(join(output, 'execution-scope.json'))));
  const index = JSON.parse(readFileSync(join(output, 'receipt-index.json')));
  assert.equal(index.deliveryState, 'NOT_ATTEMPTED'); assert.equal(index.releaseAdmission, 'UNVERIFIED');
  assert.equal(index.receiptDigest, digest(receipt));
  const sums = readFileSync(join(output, 'SHA256SUMS'), 'utf8').trim().split('\n'); assert.equal(sums.length, 4);
  for (const line of sums) { const [sha, file] = line.split('  '); assert.equal(hash(readFileSync(join(output, file))), sha); }
  assert.equal(run().status, 2); assert.deepEqual(readFileSync(join(output, 'receipt.json')), receiptBytes);
});

test('unknown or incomplete counters remain null without substituting the number of commands', (t) => {
  for (const mutate of [
    (row) => { row.testEvidence = 'UNKNOWN'; row.tests = null; },
    (row) => { row.tests.executed = null; },
  ]) {
    const data = producerFixture(); change(data, 'step-1.json', mutate);
    const value = readProducerCapture(materialize(t, data));
    assert.deepEqual(value.receipt.tests, { expected: null, executed: null, failed: null, unexpectedSkipped: null });
    assert.equal(value.scopeReport.countsKnown, false); assert.equal(value.scopeReport.planned.length, 2);
  }
});

test('partial runner observation retains missing exit/time evidence without becoming full execution proof', (t) => {
  const data = producerFixture();
  change(data, 'job.json', (row) => { row.exitCode = null; row.coverageComplete = false; row.executionBoundary = 'RUN_SCOPES'; });
  change(data, 'step-1.json', (row) => { row.state = 'MISSING'; row.completedAt = null; row.exitCode = null; row.testEvidence = 'UNKNOWN'; row.tests = null; });
  const value = readProducerCapture(materialize(t, data));
  assert.equal(value.receipt.exitCode, null); assert.equal(value.receipt.coverageComplete, false);
  assert.equal(value.receipt.executionBoundary, 'RUN_SCOPES'); assert.equal(value.receipt.tests.executed, null);
  const input = readerInput(t, value.receipt, 1); const assessment = assessResult(input.result);
  assert.equal(assessment.jobs[0].executionRelation, 'UNKNOWN'); assert.equal(assessment.evidenceGate, 'UNKNOWN');
});

test('individual test deficits, excess, zero suites and skips cannot cancel into aggregate success', (t) => {
  for (const mutate of [
    (x) => { change(x, 'step-1.json', (row) => { row.tests.executed = 1; }); change(x, 'step-2.json', (row) => { row.tests.executed = 4; }); },
    (x) => { change(x, 'step-1.json', (row) => { row.tests.expected = 0; row.tests.executed = 0; }); },
    (x) => { change(x, 'step-1.json', (row) => { row.tests.unexpectedSkipped = 1; }); },
  ]) {
    const data = producerFixture(); mutate(data);
    assert.throws(() => readProducerCapture(materialize(t, data)), /SCOPE_TEST_COUNT_MISMATCH/);
  }
});

function readerInput(t, receipt, attempt, runNumber = 42) {
  const data = githubFixture(); data.capture.attempt = attempt; data.capture.jobPages[0].attempt = attempt;
  const fetchedAt = attempt === 1 ? '2026-10-20T00:03:00Z' : '2026-10-20T01:03:00Z';
  for (const descriptor of [data.capture.run, ...data.capture.jobPages, ...data.capture.artifactPages]) descriptor.fetchedAt = fetchedAt;
  data.files['run.json'].run_number = runNumber;
  data.files['run.json'].run_attempt = attempt; data.files['run.json'].run_started_at = attempt === 1 ? '2026-10-20T00:00:00Z' : '2026-10-20T01:00:00Z';
  Object.assign(data.files['jobs-1.json'].jobs[0], { run_attempt: attempt, started_at: receipt.startedAt, completed_at: receipt.completedAt });
  data.files['receipt-core.json'] = receipt; data.files['artifact.bin'] = Buffer.from('synthetic package bytes');
  data.files['artifacts-1.json'].artifacts[0].digest = 'sha256:' + receipt.producedArtifactDigests[0];
  Object.assign(data.policy.bindings[0], { matrixDigest: receipt.producer.matrixDigest, expectedInputs: structuredClone(receipt.inputs), expectedDependencyDigests: [...receipt.consumedArtifactDigests] });
  data.policy.requirements[0].jobs[0].matrixDigest = receipt.producer.matrixDigest; data.policy.requirements[0].expectedTests = 5;
  const root = mkdtempSync(join(tmpdir(), 'ci-producer-reader-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, value] of Object.entries({ ...data.files, 'capture.json': data.capture, 'policy.json': data.policy })) writeFileSync(join(root, file), Buffer.isBuffer(value) ? value : JSON.stringify(value));
  return readGithubCapture(root, join(root, 'policy.json'));
}
test('P1 blocks a contradictory API run number and keeps a missing new-producer run number unverified', (t) => {
  const { receipt } = readProducerCapture(materialize(t, producerFixture()));
  const mismatch = readerInput(t, receipt, 1, 43); const blocked = assessResult(mismatch.result);
  assert.equal(mismatch.result.identity.runNumber, '43');
  assert.equal(blocked.evidenceGate, 'BLOCKED'); assert.ok(blocked.jobs[0].issues.includes('RUN_NUMBER_MISMATCH'));
  const missing = readerInput(t, receipt, 1, null); const unknown = assessResult(missing.result);
  assert.equal(missing.result.identity.runNumber, null); assert.equal(unknown.evidenceGate, 'UNKNOWN');
  assert.equal(unknown.jobs[0].executionRelation, 'UNKNOWN');
});
test('P1 preserves original receipts on partial reruns and counts only a newly observed attempt as new work', (t) => {
  const first = readProducerCapture(materialize(t, producerFixture())).receipt;
  const original = structuredClone(first);
  const carry = readerInput(t, first, 2); const carryAssessment = assessResult(carry.result);
  assert.equal(carry.result.jobs[0].listedAttempt, 2); assert.equal(carry.result.jobs[0].receipt.producer.attempt, 1);
  assert.equal(carry.result.jobs[0].receipt.producer.runNumber, '42');
  assert.equal(carry.result.jobs[0].receipt.sourceEvidenceDigest, first.sourceEvidenceDigest);
  assert.equal(carryAssessment.jobs[0].executionRelation, 'CARRY_FORWARD_CANDIDATE');
  assert.equal(carryAssessment.evidenceGate, 'UNKNOWN'); assert.equal(carryAssessment.newExecutionTests, 0);
  const second = readProducerCapture(materialize(t, producerFixture({ attempt: 2 }))).receipt;
  assert.deepEqual(second.inputs, first.inputs); assert.notEqual(second.producer.invocationId, first.producer.invocationId);
  const fresh = readerInput(t, second, 2); const assessment = assessResult(fresh.result);
  assert.equal(assessment.jobs[0].executionRelation, 'CURRENT_EXECUTION_VERIFIED');
  assert.equal(assessment.newExecutionTests, 5); assert.equal(assessment.observedModelCalls, null);
  assert.equal(assessment.releaseAdmission, 'UNVERIFIED'); assert.equal(assessment.deliveryState, 'NOT_ATTEMPTED');
  assert.deepEqual(first, original);
});

test('all eight current workflow jobs retain every original step in their scope inventory', (t) => {
  const workflow = readFileSync(new URL('../../../.github/workflows/core-ci.yml', import.meta.url), 'utf8');
  const jobs = { core: ['teams-core', 'TEST', 8], a2a: ['teams-a2a', 'TEST', 7], continuity: ['teams-continuity', 'TEST', 6],
    azure: ['teams-azure', 'TEST', 4], optional: ['teams-optional', 'TEST', 5], copilot_ui: ['teams-optional', 'TEST', 5],
    container: ['teams-container', 'BUILD', 6], artifact: ['teams-candidate', 'BUILD', 6] };
  let steps = 0;
  for (const [jobKey, [scope, kind, expectedSteps]] of Object.entries(jobs)) {
    const planned = workflowJobPlan(workflow, jobKey); assert.equal(planned.length, expectedSteps, jobKey); steps += planned.length;
    const data = producerFixture(); data.capture.context.jobKey = jobKey;
    data.files['workflow.yml'] = workflow; data.capture.workflow.sha256 = hash(workflow);
    change(data, 'source.json', (row) => { row.workflowSha256 = hash(workflow); });
    change(data, 'profile.json', (row) => { row.scope = scope; row.kind = kind; });
    change(data, 'job.json', (row) => { row.context = structuredClone(data.capture.context); });
    data.capture.scopes = planned.map((step, index) => {
      const file = `actual-step-${index + 1}.json`;
      data.files[file] = JSON.stringify({ schemaVersion: 'ci-scope-observation/1', context: data.capture.context, scopeId: step.id, definitionDigest: step.definitionDigest,
        state: 'EXECUTED', startedAt: new Date(Date.parse('2026-10-20T00:01:00Z') + index * 2000).toISOString(),
        completedAt: new Date(Date.parse('2026-10-20T00:01:00Z') + index * 2000 + 1000).toISOString(), exitCode: 0, testEvidence: 'UNKNOWN', tests: null });
      return { scopeId: step.id, file, sha256: hash(data.files[file]) };
    });
    const value = readProducerCapture(materialize(t, data));
    assert.equal(value.scopeReport.planned.length, expectedSteps); assert.equal(value.scopeReport.observed.length, expectedSteps);
    assert.equal(value.receipt.producer.jobKey, jobKey); assert.equal(value.provenance.evidenceKind, 'FIXTURE');
    assert.equal(value.receipt.tests?.executed ?? null, null);
  }
  assert.equal(steps, 47);
});

test('source digest, filename, schema and file type violations fail before output without changing inputs', (t) => {
  const mutations = [
    (x) => { delete x.capture.context.runNumber; }, (x) => { delete x.capture.context.attempt; },
    (x) => { x.capture.context.runId = 9007199254740994; },
    (x) => { x.capture.command = 'DO_NOT_EXECUTE_PRIVATE_VALUE'; },
    (x) => { x.capture.source.file = '../private.json'; },
    (x) => { x.files['package.bin'] = 'tampered'; },
    (x) => { delete x.files['step-1.json']; },
  ];
  const cli = fileURLToPath(new URL('../produce-receipt.mjs', import.meta.url));
  for (const mutate of mutations) {
    const data = producerFixture(); mutate(data); const root = materialize(t, data); const output = join(root, 'packet');
    const before = readFileSync(join(root, 'producer.json'));
    const result = spawnSync(process.execPath, [cli, '--capture-dir', root, '--output-dir', output], { encoding: 'utf8', timeout: 10000, env: { LANG: 'C.UTF-8' } });
    assert.equal(result.status, 2); assert.equal(result.stderr.trim(), 'CI_PRODUCER_INPUT_OR_OUTPUT_REJECTED');
    assert.equal(existsSync(output), false); assert.deepEqual(readFileSync(join(root, 'producer.json')), before);
  }
  const root = materialize(t, producerFixture()); rmSync(join(root, 'workflow.yml')); symlinkSync(join(root, 'package.json'), join(root, 'workflow.yml'));
  assert.throws(() => readProducerCapture(root));
});
