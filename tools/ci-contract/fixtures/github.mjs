import { complete, hash } from './factory.mjs';
export function githubFixture() {
  const original = complete(); const receipt = original.jobs[0].receipt;
  const artifactBytes = Buffer.from('synthetic opaque artifact bytes; not executable');
  const capture = {
    captureVersion: '1.0.0', evidenceKind: 'FIXTURE', repository: original.identity.repository,
    runId: '1001', attempt: 1, run: { file: 'run.json', fetchedAt: '2026-10-20T00:03:00Z' },
    jobPages: [{ file: 'jobs-1.json', attempt: 1, page: 1, perPage: 100, fetchedAt: '2026-10-20T00:03:00Z' }],
    historyJobPages: [],
    artifactPages: [{ file: 'artifacts-1.json', page: 1, perPage: 100, fetchedAt: '2026-10-20T00:03:00Z' }],
    receiptFiles: [{ listedJobId: '9001', file: 'receipt-core.json' }],
    artifactFiles: [{ artifactId: '7001', file: 'artifact.bin' }], releaseIdentityFiles: [],
  };
  const run = {
    id: 1001, run_attempt: 1, head_sha: original.identity.testedSha,
    repository: { full_name: original.identity.repository }, path: original.identity.workflow,
    status: 'completed', conclusion: 'success', run_started_at: '2026-10-20T00:00:00Z',
    pull_requests: [],
  };
  const job = {
    id: 9001, run_id: 1001, run_attempt: 1, head_sha: original.identity.testedSha,
    name: 'Core verification', status: 'completed', conclusion: 'success',
    started_at: '2026-10-20T00:01:00Z', completed_at: '2026-10-20T00:02:00Z',
  };
  const policy = {
    policyVersion: 'github-reader/1', repository: original.identity.repository,
    workflow: original.identity.workflow, runHeadSha: original.identity.testedSha, profile: 'core',
    requirements: original.requirements,
    bindings: [{ name: job.name, key: 'core', matrixDigest: original.jobs[0].matrixDigest, kind: 'TEST',
      expectedInputs: original.jobs[0].expectedInputs, expectedDependencyDigests: [] }],
  };
  receipt.producedArtifactDigests = [hash(artifactBytes)];
  return { capture, policy, files: {
    'run.json': run, 'jobs-1.json': { total_count: 1, jobs: [job] },
    'artifacts-1.json': { total_count: 1, artifacts: [{ id: 7001, name: 'fixture-artifact',
      digest: 'sha256:' + hash(artifactBytes), expired: false, size_in_bytes: artifactBytes.length,
      workflow_run: { id: 1001, head_sha: run.head_sha } }] },
    'receipt-core.json': receipt, 'artifact.bin': artifactBytes,
  } };
}
