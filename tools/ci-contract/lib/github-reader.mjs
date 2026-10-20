import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { captureSchema, policySchema } from './github-schemas.mjs';
import { readJsonFile, hashRegularFile } from './io.mjs';
import { digest, contractDigest, validateResult, validateReceipt } from './contract.mjs';
const ajv = new Ajv2020({ strict: true, ownProperties: true }); addFormats(ajv);
const validCapture = ajv.compile(captureSchema); const validPolicy = ajv.compile(policySchema);
const requireValue = (value, message = 'INVALID_CAPTURE_SOURCE') => { if (!value) throw new Error(message); };
const emptyInputs = () => ({ testedSha: null, toolchainDigest: null, suiteDigest: null, inputDigest: null, profileDigest: null });
const nullable = (value) => value === undefined ? null : value;
function id(value) {
  requireValue(typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)), 'UNSAFE_API_ID');
  const text = String(value); requireValue(/^[1-9][0-9]{0,19}$/.test(text), 'INVALID_API_ID'); return text;
}
function listedAttempt(value) {
  if (value === undefined || value === null) return null;
  requireValue(Number.isSafeInteger(value) && value >= 1 && value <= 10000); return value;
}
function apiDigest(value) {
  if (value === undefined || value === null) return null;
  requireValue(typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value), 'UNSUPPORTED_ARTIFACT_DIGEST'); return value.slice(7);
}
function pages(descriptors, read, field, maxRows) {
  if (descriptors.length === 0) return { rows: [], complete: false, total: null };
  const sorted = [...descriptors].sort((a, b) => a.page - b.page); const seen = new Set(); const rows = [];
  let total = null; let complete = true; const perPage = sorted[0].perPage;
  for (const descriptor of sorted) {
    requireValue(!seen.has(descriptor.page), 'DUPLICATE_API_PAGE'); seen.add(descriptor.page);
    const value = read(descriptor.file, field.toUpperCase());
    requireValue(Number.isSafeInteger(value.total_count) && value.total_count >= 0 && Array.isArray(value[field]));
    requireValue(value[field].length <= descriptor.perPage && rows.length + value[field].length <= maxRows, 'COLLECTION_BOUNDARY');
    if (total !== null && total !== value.total_count) complete = false;
    total = value.total_count;
    if (descriptor.perPage !== perPage) complete = false;
    rows.push(...value[field]);
  }
  const needed = Math.max(1, Math.ceil(total / perPage));
  for (let page = 1; page <= Math.min(needed, 31); page++) if (!seen.has(page)) complete = false;
  if (needed > 30 || rows.length !== total) complete = false;
  return { rows, complete, total };
}
export function readGithubCapture(captureDirectory, policyFile) {
  const directory = resolve(captureDirectory); const sourceFiles = []; const used = new Set();
  let jsonBytes = 0; let artifactBytes = 0;
  const read = (file, kind) => {
    requireValue(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(file), 'UNSAFE_SOURCE_PATH');
    requireValue(!used.has(file) && sourceFiles.length < 64, 'SOURCE_FILE_BOUNDARY'); used.add(file);
    const source = readJsonFile(join(directory, file)); jsonBytes += source.bytes;
    requireValue(jsonBytes <= 16 * 1024 * 1024, 'JSON_TOTAL_BOUNDARY');
    sourceFiles.push({ file, kind, bytes: source.bytes, sha256: source.sha256 }); return source.value;
  };
  const capture = read('capture.json', 'CAPTURE'); const policySource = readJsonFile(policyFile, 256 * 1024); const policy = policySource.value;
  requireValue(validCapture(capture) && validPolicy(policy), 'INVALID_CAPTURE_OR_POLICY');
  requireValue(capture.repository === policy.repository, 'REPOSITORY_MISMATCH');
  requireValue(capture.jobPages.length + capture.historyJobPages.length + capture.artifactPages.length <= 30, 'PAGE_BUDGET');
  requireValue(capture.jobPages.every((page) => page.attempt === capture.attempt)
    && capture.historyJobPages.every((page) => page.attempt < capture.attempt), 'ATTEMPT_PAGE_MISMATCH');
  const run = read(capture.run.file, 'RUN');
  requireValue(id(run.id) === capture.runId && listedAttempt(run.run_attempt) === capture.attempt, 'RUN_ATTEMPT_MISMATCH');
  requireValue(run.repository?.full_name === capture.repository && run.path === policy.workflow, 'WORKFLOW_IDENTITY_MISMATCH');
  requireValue(typeof run.head_sha === 'string' && /^[a-f0-9]{40}$/.test(run.head_sha));
  requireValue(policy.runHeadSha === null || policy.runHeadSha === run.head_sha, 'RUN_HEAD_SHA_MISMATCH');
  const bindingByName = new Map();
  for (const binding of policy.bindings) { requireValue(!bindingByName.has(binding.name), 'AMBIGUOUS_JOB_BINDING'); bindingByName.set(binding.name, binding); }
  const current = pages(capture.jobPages, read, 'jobs', 500);
  const historical = []; let historyComplete = true;
  for (const attempt of [...new Set(capture.historyJobPages.map((page) => page.attempt))]) {
    const value = pages(capture.historyJobPages.filter((page) => page.attempt === attempt), read, 'jobs', 500);
    historical.push(...value.rows.map((job) => ({ job, requestedAttempt: attempt })));
    historyComplete &&= value.complete;
  }
  const artifactData = pages(capture.artifactPages, read, 'artifacts', 200);
  const assertJobRun = (job) => {
    requireValue(id(job.run_id) === capture.runId, 'JOB_RUN_MISMATCH');
    requireValue(job.head_sha === undefined || job.head_sha === null || job.head_sha === run.head_sha, 'JOB_HEAD_SHA_MISMATCH');
    id(job.id); listedAttempt(job.run_attempt);
  };
  const currentById = new Map();
  for (const job of current.rows) { assertJobRun(job); requireValue(!currentById.has(id(job.id)), 'DUPLICATE_API_JOB'); currentById.set(id(job.id), job); }
  for (const { job } of historical) assertJobRun(job);
  const receiptByJob = new Map();
  for (const descriptor of capture.receiptFiles) {
    requireValue(currentById.has(descriptor.listedJobId) && !receiptByJob.has(descriptor.listedJobId), 'UNBOUND_RECEIPT');
    const value = read(descriptor.file, 'PRODUCER_RECEIPT'); requireValue(validateReceipt(value), 'INVALID_PRODUCER_RECEIPT'); receiptByJob.set(descriptor.listedJobId, value);
  }
  const evidenceIssues = []; const artifactSources = []; const artifactById = new Map();
  for (const artifact of artifactData.rows) {
    const artifactId = id(artifact.id); requireValue(!artifactById.has(artifactId), 'DUPLICATE_API_ARTIFACT');
    requireValue(artifact.workflow_run?.id === undefined || id(artifact.workflow_run.id) === capture.runId, 'ARTIFACT_RUN_MISMATCH');
    requireValue(artifact.workflow_run?.head_sha === undefined || artifact.workflow_run.head_sha === run.head_sha, 'ARTIFACT_HEAD_SHA_MISMATCH');
    requireValue(typeof artifact.expired === 'boolean'); artifactById.set(artifactId, artifact);
  }
  const localById = new Map();
  for (const descriptor of capture.artifactFiles) {
    requireValue(artifactById.has(descriptor.artifactId) && !localById.has(descriptor.artifactId) && !used.has(descriptor.file), 'UNBOUND_ARTIFACT');
    used.add(descriptor.file); const source = hashRegularFile(join(directory, descriptor.file)); artifactBytes += source.bytes;
    requireValue(artifactBytes <= 128 * 1024 * 1024, 'ARTIFACT_TOTAL_BOUNDARY');
    sourceFiles.push({ file: descriptor.file, kind: 'ARTIFACT_BYTES', ...source }); localById.set(descriptor.artifactId, source);
  }
  const artifacts = [...artifactById].map(([artifactId, artifact]) => {
    const expected = apiDigest(artifact.digest); const local = localById.get(artifactId);
    const matches = expected !== null && local?.sha256 === expected;
    if (local && expected !== null && !matches) evidenceIssues.push('ARTIFACT_DIGEST_MISMATCH');
    artifactSources.push({ artifactId, apiDigest: expected, archiveSha256: local?.sha256 ?? null,
      archiveBytes: local?.bytes ?? null, apiExpired: artifact.expired,
      producerRunId: artifact.workflow_run?.id === undefined ? null : id(artifact.workflow_run.id), producerAttempt: null });
    return { id: artifactId, digest: expected ?? local?.sha256 ?? null,
      availability: local ? 'AVAILABLE' : artifact.expired ? 'EXPIRED' : 'NOT_AVAILABLE_AT_READ', digestVerified: matches };
  });
  const releaseIdentities = [];
  for (const descriptor of capture.releaseIdentityFiles) {
    requireValue(artifactById.has(descriptor.artifactId), 'UNBOUND_RELEASE_IDENTITY');
    const value = read(descriptor.file, 'LEGACY_RELEASE_IDENTITY');
    requireValue(value.schema === 1 && /^[a-f0-9]{40}$/.test(value.sourceCommit ?? '')
      && /^[a-f0-9]{64}$/.test(value.teamsPackageSha256 ?? '') && typeof value.version === 'string' && value.version.length <= 40, 'INVALID_RELEASE_IDENTITY');
    if (value.sourceCommit !== run.head_sha) evidenceIssues.push('LEGACY_RELEASE_IDENTITY_MISMATCH');
    releaseIdentities.push({ artifactId: descriptor.artifactId, sourceCommit: value.sourceCommit, version: value.version,
      teamsPackageSha256: value.teamsPackageSha256, archiveMembership: 'UNVERIFIED' });
  }
  const jobSources = [];
  const jobs = current.rows.map((raw) => {
    const jobId = id(raw.id); const binding = bindingByName.get(raw.name); const receipt = receiptByJob.get(jobId) ?? null;
    const origins = typeof raw.started_at === 'string' && typeof raw.completed_at === 'string'
      ? historical.filter(({ job }) => job.name === raw.name && job.started_at === raw.started_at && job.completed_at === raw.completed_at) : [];
    jobSources.push({ listedJobId: jobId, listedAttempt: listedAttempt(raw.run_attempt), requestedAttempt: capture.attempt,
      apiName: typeof raw.name === 'string' ? raw.name.slice(0, 200) : null,
      originalProducerRunId: receipt?.producer.runId ?? null, originalProducerAttempt: receipt?.producer.attempt ?? null,
      candidateOrigins: origins.map(({ job, requestedAttempt }) => ({ listedJobId: id(job.id), listedAttempt: listedAttempt(job.run_attempt), requestedAttempt })) });
    return { key: binding?.key ?? `api-${jobId}`, keySource: binding ? 'POLICY' : 'API_ID', matrixDigest: binding?.matrixDigest ?? null,
      kind: binding?.kind ?? 'UNKNOWN', listedJobId: jobId, listedAttempt: listedAttempt(raw.run_attempt), status: raw.status,
      apiConclusion: nullable(raw.conclusion), startedAt: nullable(raw.started_at), completedAt: nullable(raw.completed_at),
      receiptAvailability: receipt ? 'AVAILABLE' : 'NOT_AVAILABLE_AT_READ', receipt, receiptDigest: receipt ? digest(receipt) : null,
      expectedInputs: structuredClone(binding?.expectedInputs ?? emptyInputs()), expectedDependencyDigests: structuredClone(binding?.expectedDependencyDigests ?? null),
      candidateOrigins: binding ? origins.map(({ requestedAttempt }) => ({ runId: capture.runId, attempt: requestedAttempt,
        jobKey: binding.key, matrixDigest: binding.matrixDigest, receiptDigest: null })) : [],
      carriedForwardFrom: null, reuseProof: null,
    };
  });
  const tested = [...new Set(jobs.filter((job) => job.receipt?.producer.runId === capture.runId && job.receipt.producer.repository === capture.repository)
    .map((job) => job.receipt.inputs.testedSha).filter((sha) => sha !== null))];
  if (tested.length > 1) evidenceIssues.push('RECEIPT_TESTED_SHA_CONFLICT');
  const heads = [...new Set((Array.isArray(run.pull_requests) ? run.pull_requests : []).map((pr) => pr.head?.sha).filter((sha) => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha)))];
  const fetched = [capture.run, ...capture.jobPages, ...capture.historyJobPages, ...capture.artifactPages].map((x) => x.fetchedAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
  const currentResponses = capture.jobPages.map((page) => ({ page: page.page, file: page.file, sha256: sourceFiles.find((file) => file.file === page.file).sha256 })).sort((a, b) => a.page - b.page);
  const result = {
    schemaVersion: '1.1.0', policyVersion: 'ci-contract-p0/1', evidenceKind: capture.evidenceKind,
    identity: { repository: capture.repository, workflow: policy.workflow, runId: capture.runId, attempt: capture.attempt, profile: policy.profile,
      runHeadSha: run.head_sha, testedSha: tested.length === 1 ? tested[0] : null, prHeadSha: heads.length === 1 ? heads[0] : null, mergeSha: null, collectorSha: null },
    observation: { status: run.status, apiConclusion: nullable(run.conclusion), attemptStartedAt: nullable(run.run_started_at), fetchedAt: fetched,
      paginationComplete: current.complete && artifactData.complete && historyComplete,
      endpoint: `/repos/${capture.repository}/actions/runs/${capture.runId}/attempts/${capture.attempt}/jobs`,
      responseDigest: currentResponses.length === 1 ? currentResponses[0].sha256 : digest(currentResponses),
      responseDigestKind: currentResponses.length === 1 ? 'RAW_BODY' : 'PAGE_MANIFEST' },
    requirements: structuredClone(policy.requirements), jobs, artifacts, evidenceIssues: [...new Set(evidenceIssues)],
    liveGates: ['server', 'personal-app', 'organization-catalog', 'teams-web', 'teams-desktop', 'iphone', 'carplay'].map((surface) => ({ surface, state: 'UNVERIFIED', evidenceDigest: null })),
    delivery: { state: 'NOT_ATTEMPTED', ack: null }, revision: { kind: run.status === 'completed' ? 'final' : 'partial-failure', sequence: 1, previousNotificationId: null },
  };
  requireValue(validateResult(result).valid, 'NORMALIZED_RESULT_INVALID');
  const sources = ['github-reader.mjs', 'github-schemas.mjs', '../read-github.mjs'].map((file) => ({ file, sha256: createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex') }));
  const endpointBase = `/repos/${capture.repository}/actions/runs/${capture.runId}`;
  const apiReads = [
    { ...capture.run, endpoint: `${endpointBase}/attempts/${capture.attempt}`, requestedAttempt: capture.attempt },
    ...[...capture.jobPages, ...capture.historyJobPages].map((page) => ({ ...page, requestedAttempt: page.attempt, endpoint: `${endpointBase}/attempts/${page.attempt}/jobs?per_page=${page.perPage}&page=${page.page}` })),
    ...capture.artifactPages.map((page) => ({ ...page, requestedAttempt: null, endpoint: `${endpointBase}/artifacts?per_page=${page.perPage}&page=${page.page}` })),
  ].map((entry) => ({ ...entry, sha256: sourceFiles.find((file) => file.file === entry.file).sha256 }));
  const provenance = { adapterVersion: 'github-reader/1', adapterDigest: digest({ sources, contractDigest: contractDigest() }),
    sourceAuthenticity: 'UNVERIFIED', readMode: 'LOCAL_SNAPSHOT', repository: capture.repository, runId: capture.runId, requestedAttempt: capture.attempt,
    policyFileSha256: policySource.sha256, files: sourceFiles, apiReads, jobs: jobSources, artifacts: artifactSources, releaseIdentities,
    jobsComplete: current.complete, artifactsComplete: artifactData.complete, historyComplete,
    jobsTotal: current.total, jobsReturned: current.rows.length, artifactsTotal: artifactData.total, artifactsReturned: artifactData.rows.length };
  return { result, provenance };
}
