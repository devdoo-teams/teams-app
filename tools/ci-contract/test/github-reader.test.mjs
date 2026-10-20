import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { githubFixture } from '../fixtures/github.mjs';
import { complete, hash } from '../fixtures/factory.mjs';
import { assessResult, validateResult } from '../lib/contract.mjs';
import { readGithubCapture } from '../lib/github-reader.mjs';
function materialize(t, data) {
  const root = mkdtempSync(join(tmpdir(), 'github-reader-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ ...data.files, 'capture.json': data.capture, 'policy.json': data.policy })) {
    writeFileSync(join(root, name), Buffer.isBuffer(value) ? value : JSON.stringify(value));
  }
  return root;
}
const read = (root) => readGithubCapture(root, join(root, 'policy.json'));
test('reads captured actual-format run/jobs/artifacts, hashes bytes and preserves producer receipt', (t) => {
  const data = githubFixture(); const root = materialize(t, data); const value = read(root);
  assert.equal(validateResult(value.result).valid, true);
  assert.equal(value.result.identity.runId, '1001'); assert.equal(value.result.identity.runHeadSha, 'a'.repeat(40));
  assert.equal(value.result.jobs[0].listedJobId, '9001'); assert.equal(value.result.jobs[0].receipt.producer.attempt, 1);
  assert.equal(value.result.artifacts[0].digestVerified, true);
  assert.equal(value.provenance.artifacts[0].archiveSha256, hash(data.files['artifact.bin']));
  assert.equal(value.provenance.files.find((x) => x.file === 'receipt-core.json').sha256, hash(readFileSync(join(root, 'receipt-core.json'))));
});
test('missing original receipts never turn API head SHA into tested SHA or missing inputs into invented digests', (t) => {
  const data = githubFixture(); data.capture.receiptFiles = [];
  data.policy.bindings[0].expectedInputs = Object.fromEntries(Object.keys(data.policy.bindings[0].expectedInputs).map((x) => [x, null]));
  const value = read(materialize(t, data));
  assert.equal(value.result.identity.testedSha, null); assert.equal(value.result.jobs[0].receipt, null);
  assert.equal(value.result.jobs[0].expectedInputs.toolchainDigest, null);
  const assessment = assessResult(value.result); assert.equal(assessment.apiConclusion, 'success');
  assert.equal(assessment.evidenceGate, 'UNKNOWN'); assert.equal(assessment.observedModelCalls, null);
});
test('absent API run_attempt is preserved as null instead of copied from the request', (t) => {
  const data = githubFixture(); delete data.files['jobs-1.json'].jobs[0].run_attempt; data.capture.receiptFiles = [];
  const value = read(materialize(t, data)); assert.equal(value.result.jobs[0].listedAttempt, null);
});
test('API attempt and original producer attempt remain separate on partial rerun', (t) => {
  const data = githubFixture(); data.capture.attempt = 2; data.capture.jobPages[0].attempt = 2;
  data.files['run.json'].run_attempt = 2; data.files['run.json'].run_started_at = '2026-10-20T01:00:00Z';
  const old = structuredClone(data.files['jobs-1.json'].jobs[0]);
  data.files['jobs-1.json'].jobs[0].id = 9002; data.files['jobs-1.json'].jobs[0].run_attempt = 2;
  data.capture.receiptFiles[0].listedJobId = '9002';
  data.capture.historyJobPages = [{ ...data.capture.jobPages[0], file: 'history-1.json', attempt: 1 }];
  data.files['history-1.json'] = { total_count: 1, jobs: [old] };
  const value = read(materialize(t, data)); const job = value.result.jobs[0];
  assert.equal(job.listedAttempt, 2); assert.equal(job.receipt.producer.attempt, 1);
  assert.equal(value.provenance.jobs[0].candidateOrigins[0].listedJobId, '9001');
  assert.equal(assessResult(value.result).jobs[0].executionRelation, 'CARRY_FORWARD_CANDIDATE');
  assert.equal(job.carriedForwardFrom, null); assert.equal(job.reuseProof, null);
});
test('missing page and incomplete artifact collection remain explicit', (t) => {
  const data = githubFixture(); data.files['jobs-1.json'].total_count = 101;
  data.files['artifacts-1.json'].total_count = 2;
  const value = read(materialize(t, data)); assert.equal(value.result.observation.paginationComplete, false);
  assert.equal(value.provenance.jobsComplete, false); assert.equal(value.provenance.artifactsComplete, false);
});
test('artifact digest mismatch preserves both digests and blocks the record', (t) => {
  const data = githubFixture(); data.files['artifact.bin'] = Buffer.from('wrong bytes');
  const value = read(materialize(t, data)); assert.equal(value.result.artifacts[0].digestVerified, false);
  assert.notEqual(value.provenance.artifacts[0].apiDigest, value.provenance.artifacts[0].archiveSha256);
  assert.equal(assessResult(value.result).evidenceGate, 'BLOCKED');
});
test('legacy release identity preserves SHA/package hash without inventing a job receipt', (t) => {
  const data = githubFixture(); data.capture.receiptFiles = [];
  data.capture.releaseIdentityFiles = [{ artifactId: '7001', file: 'release-identity.json' }];
  data.files['release-identity.json'] = { schema: 1, sourceCommit: 'a'.repeat(40), version: '1.0.151', teamsPackageSha256: hash('package') };
  const value = read(materialize(t, data)); assert.equal(value.result.jobs[0].receipt, null);
  assert.equal(value.provenance.releaseIdentities[0].teamsPackageSha256, hash('package'));
  assert.equal(value.provenance.releaseIdentities[0].archiveMembership, 'UNVERIFIED');
});
test('unknown matrix and unbound API job keys stay unverified', (t) => {
  const data = githubFixture(); data.policy.bindings = []; data.capture.receiptFiles = [];
  const value = read(materialize(t, data)); assert.equal(value.result.jobs[0].keySource, 'API_ID');
  assert.equal(value.result.jobs[0].matrixDigest, null); assert.equal(assessResult(value.result).requiredScopesGate, 'UNKNOWN');
});
for (const [name, mutate] of [
  ['mixed run', (x) => { x.files['jobs-1.json'].jobs[0].run_id = 1002; }],
  ['wrong workflow', (x) => { x.files['run.json'].path = '.github/workflows/other.yml'; }],
  ['wrong run head SHA', (x) => { x.files['run.json'].head_sha = 'b'.repeat(40); }],
  ['unsafe integer ID', (x) => { x.files['jobs-1.json'].jobs[0].id = 9007199254740994; }],
  ['duplicate pages', (x) => { x.capture.jobPages.push(structuredClone(x.capture.jobPages[0])); }],
  ['path traversal', (x) => { x.capture.run.file = '../private.json'; }],
  ['arbitrary URL', (x) => { x.capture.destination = 'https://invalid.example'; }],
]) test(`rejects ${name} without mutating capture files`, (t) => {
  const data = githubFixture(); mutate(data); const root = materialize(t, data);
  const before = readFileSync(join(root, 'capture.json')); assert.throws(() => read(root));
  assert.deepEqual(readFileSync(join(root, 'capture.json')), before);
});
test('rejects symlink source files', (t) => {
  const data = githubFixture(); const root = materialize(t, data);
  rmSync(join(root, 'run.json')); symlinkSync(join(root, 'jobs-1.json'), join(root, 'run.json'));
  assert.throws(() => read(root));
});
test('common contract accepts explicit unknown source identity without producing verified execution', () => {
  const x = complete(); x.schemaVersion = '1.1.0'; x.identity.testedSha = null; x.identity.runHeadSha = 'a'.repeat(40);
  x.jobs[0].expectedInputs = Object.fromEntries(Object.keys(x.jobs[0].expectedInputs).map((k) => [k, null]));
  x.jobs[0].matrixDigest = null; x.requirements[0].jobs[0].matrixDigest = null; x.jobs[0].receipt = null; x.jobs[0].receiptDigest = null; x.jobs[0].receiptAvailability = 'UNKNOWN';
  assert.equal(validateResult(x).valid, true); assert.equal(assessResult(x).evidenceGate, 'UNKNOWN');
});
test('provenance preserves each API request and uses the raw current-page digest', (t) => {
  const data = githubFixture(); const root = materialize(t, data); const value = read(root);
  assert.equal(value.result.observation.responseDigestKind, 'RAW_BODY');
  assert.equal(value.result.observation.responseDigest, hash(readFileSync(join(root, 'jobs-1.json'))));
  const jobRead = value.provenance.apiReads.find((x) => x.file === 'jobs-1.json');
  assert.equal(jobRead.endpoint, '/repos/devdoo-teams/teams-app/actions/runs/1001/attempts/1/jobs?per_page=100&page=1');
  assert.equal(jobRead.fetchedAt, data.capture.jobPages[0].fetchedAt);
});
test('absent timestamps do not suggest that an unstarted old job executed', (t) => {
  const data = githubFixture(); data.capture.receiptFiles = []; data.capture.attempt = 2; data.capture.jobPages[0].attempt = 2;
  data.files['run.json'].run_attempt = 2; const job = data.files['jobs-1.json'].jobs[0];
  job.run_attempt = 2; job.started_at = null; job.completed_at = null; job.status = 'queued'; job.conclusion = null;
  data.capture.historyJobPages = [{ ...data.capture.jobPages[0], file: 'history-1.json', attempt: 1 }];
  data.files['history-1.json'] = { total_count: 1, jobs: [{ ...job, id: 9000, run_attempt: 1 }] };
  const value = read(materialize(t, data)); assert.deepEqual(value.result.jobs[0].candidateOrigins, []);
  assert.equal(assessResult(value.result).jobs[0].executionRelation, 'UNKNOWN');
});
test('read CLI emits a bound five-file packet and no delivery acknowledgement', (t) => {
  const data = githubFixture(); const root = materialize(t, data); const output = join(root, 'packet');
  const cli = fileURLToPath(new URL('../read-github.mjs', import.meta.url));
  const x = spawnSync(process.execPath, [cli, '--capture-dir', root, '--policy', join(root, 'policy.json'), '--output-dir', output], { encoding: 'utf8', timeout: 10000, env: { LANG: 'C.UTF-8' } });
  assert.equal(x.status, 0, x.stderr);
  const sums = readFileSync(join(output, 'SHA256SUMS'), 'utf8').trim().split('\n'); assert.equal(sums.length, 4);
  for (const line of sums) { const [sha, file] = line.split('  '); assert.equal(hash(readFileSync(join(output, file))), sha); }
  const index = JSON.parse(readFileSync(join(output, 'evidence-index.json')));
  assert.equal(index.assessment.deliveryState, 'NOT_ATTEMPTED'); assert.equal(index.releaseAdmission, 'UNVERIFIED');
  assert.ok(index.files.some((file) => file.path === 'source-provenance.json'));
});
