// Synthetic identities and digests only. No historical success is a current run.
import { createHash } from 'node:crypto';

export const hash = (text) => createHash('sha256').update(text).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const digest = (value) => hash(canonical(value));
export const inputs = {
  testedSha: 'a'.repeat(40), toolchainDigest: hash('node24'), suiteDigest: hash('core'),
  inputDigest: hash('synthetic-input'), profileDigest: hash('core-profile'),
};
export function reseal(job) { job.receiptDigest = digest(job.receipt); return job; }
export function complete() {
  const job = {
    key: 'core', matrixDigest: hash('linux-node24'), kind: 'TEST',
    listedJobId: '9001', listedAttempt: 1, status: 'completed', apiConclusion: 'success',
    startedAt: '2026-10-20T00:01:00Z', completedAt: '2026-10-20T00:02:00Z',
    receiptAvailability: 'AVAILABLE', expectedInputs: { ...inputs },
    expectedDependencyDigests: [], candidateOrigins: [], carriedForwardFrom: null, reuseProof: null,
    receipt: {
      producer: {
        repository: 'devdoo-teams/teams-app', workflow: '.github/workflows/core-ci.yml',
        runId: '1001', attempt: 1, jobKey: 'core', matrixDigest: hash('linux-node24'),
        invocationId: 'synthetic-core-1',
      },
      inputs: { ...inputs }, startedAt: '2026-10-20T00:01:00Z', completedAt: '2026-10-20T00:02:00Z',
      exitCode: 0, tests: { expected: 12, executed: 12, failed: 0, unexpectedSkipped: 0 },
      cleanup: 'VERIFIED', producedArtifactDigests: [hash('synthetic-package')], consumedArtifactDigests: [],
      modelMeasurement: {
        measurementScope: 'synthetic-process-tree', instrumentationVersion: 'fixture/1',
        coverageComplete: false, credentialIsolationVerified: false, unobservedPaths: ['grandchildren'],
        observedModelCalls: null, blockedModelAttempts: null,
      },
    },
  };
  reseal(job);
  return {
    schemaVersion: '1.0.0', policyVersion: 'ci-contract-p0/1', evidenceKind: 'FIXTURE',
    identity: {
      repository: 'devdoo-teams/teams-app', workflow: '.github/workflows/core-ci.yml',
      runId: '1001', attempt: 1, profile: 'core', testedSha: inputs.testedSha,
      prHeadSha: 'b'.repeat(40), mergeSha: 'c'.repeat(40), collectorSha: 'd'.repeat(40),
    },
    observation: {
      status: 'completed', apiConclusion: 'success', attemptStartedAt: '2026-10-20T00:00:00Z',
      fetchedAt: '2026-10-20T00:03:00Z', paginationComplete: true,
      endpoint: '/repos/devdoo-teams/teams-app/actions/runs/1001/attempts/1/jobs', responseDigest: hash('synthetic-api'),
    },
    requirements: [{ scope: 'teams-core', required: true, expectedTests: 12, jobs: [{ key: job.key, matrixDigest: job.matrixDigest }] }],
    jobs: [job],
    artifacts: [{ id: '7001', digest: hash('synthetic-package'), availability: 'AVAILABLE', digestVerified: true }],
    liveGates: ['server', 'personal-app', 'organization-catalog', 'teams-web', 'teams-desktop', 'iphone', 'carplay']
      .map((surface) => ({ surface, state: 'UNVERIFIED', evidenceDigest: null })),
    delivery: { state: 'NOT_ATTEMPTED', ack: null },
    revision: { kind: 'final', sequence: 1, previousNotificationId: null },
  };
}
export function historicalRerun() {
  const value = complete();
  value.identity.repository = 'doosanofficial-ui/WebDashboard';
  value.identity.workflow = '.github/workflows/native-reliability.yml';
  value.identity.runId = '37226525438'; value.identity.attempt = 2; value.identity.profile = 'native-help';
  value.observation.attemptStartedAt = '2026-10-20T01:00:00Z';
  value.observation.fetchedAt = '2026-10-20T01:04:00Z';
  value.observation.endpoint = '/repos/doosanofficial-ui/WebDashboard/actions/runs/37226525438/attempts/2/jobs';
  value.requirements[0].scope = 'iphone-help'; value.requirements[0].expectedTests = 4;
  value.jobs[0].listedAttempt = 2; value.jobs[0].listedJobId = '9002';
  value.jobs[0].receipt = null; value.jobs[0].receiptDigest = null;
  value.jobs[0].receiptAvailability = 'NOT_AVAILABLE_AT_READ';
  value.artifacts = [];
  return value;
}
export function reused() {
  const value = complete();
  value.identity.attempt = 2;
  value.observation.attemptStartedAt = '2026-10-20T01:00:00Z';
  value.observation.fetchedAt = '2026-10-20T01:04:00Z';
  value.observation.endpoint = '/repos/devdoo-teams/teams-app/actions/runs/1001/attempts/2/jobs';
  const job = value.jobs[0]; job.listedAttempt = 2; job.listedJobId = '9002';
  job.carriedForwardFrom = { runId: '1001', attempt: 1, jobKey: job.key, matrixDigest: job.matrixDigest, receiptDigest: job.receiptDigest };
  job.reuseProof = { policyVersion: value.policyVersion, originReceiptDigest: job.receiptDigest,
    compatibilityDigest: digest(job.expectedInputs), consumedArtifactDigests: [] };
  return value;
}
