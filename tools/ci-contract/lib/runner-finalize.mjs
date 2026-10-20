import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, lstatSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { ensureSession, runnerLocation, sha256, jsonBytes, writeNewJson } from './runner-capture.mjs';
import { readJsonFile, readTextFile, hashRegularFile } from './io.mjs';
import { jobPolicies } from './workflow-plan.mjs';
const valid = (value, code = 'RUNNER_FINALIZE_REJECTED') => { if (!value) throw new Error(code); };
const outcomes = new Set(['success', 'failure', 'cancelled', 'skipped']);
const date = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const same = (a, b) => a && Object.keys(a).length === Object.keys(b).length && Object.keys(b).every((key) => a[key] === b[key]);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function readRaw(state, scope, suffix) {
  const file = `${scope.id}-${suffix}.json`; const path = join(state.base, 'raw', file); if (!existsSync(path)) return null;
  const source = readTextFile(path, 16384); valid(sha256(source.value) === source.sha256, 'RAW_ENCODING_MISMATCH'); const value = JSON.parse(source.value);
  const keys = ['schemaVersion', 'evidenceKind', 'context', 'scopeId', 'definitionDigest', 'scriptSha256', 'shell', 'startedAt'];
  if (suffix === 'result') keys.push('completedAt', 'exitCode', 'signal', 'requestedSignal');
  valid(Object.keys(value).sort().join(',') === keys.sort().join(',') && value.schemaVersion === 'ci-runner-command/1'
    && same(value.context, state.session.context) && value.scopeId === scope.id && value.evidenceKind === state.session.evidenceKind
    && value.definitionDigest === scope.definitionDigest && digest(value.scriptSha256) && date(value.startedAt) && value.shell === 'bash -e', 'RAW_IDENTITY_MISMATCH');
  if (suffix === 'result') valid(date(value.completedAt) && Date.parse(value.completedAt) >= Date.parse(value.startedAt)
    && (value.exitCode === null || Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255)
    && (value.signal === null || Object.hasOwn(osConstants.signals, value.signal))
    && (value.exitCode === null) !== (value.signal === null)
    && [null, 'SIGINT', 'SIGTERM'].includes(value.requestedSignal), 'RAW_RESULT_INVALID');
  return { file: `raw/${file}`, sha256: source.sha256, text: source.value, value };
}
function retainRaw(directory, source) {
  const path = join(directory, source.file);
  if (existsSync(path)) valid(readTextFile(path, 16384).sha256 === source.sha256, 'RETAINED_RAW_MISMATCH');
  else writeFileSync(path, source.text, { flag: 'wx', mode: 0o600 });
  return { file: source.file, sha256: source.sha256 };
}
// Failure retention never relaxes execution/source admission. It can only retain
// closed, bounded metadata from an already existing session; no source is inferred.
export function retainFinalizationFailure(env = process.env) {
  const state = runnerLocation(env); const session = readJsonFile(join(state.base, 'session.json'), 32768).value;
  const context = { repository: env.GITHUB_REPOSITORY, workflow: '.github/workflows/core-ci.yml', runId: env.GITHUB_RUN_ID,
    runNumber: env.GITHUB_RUN_NUMBER, attempt: Number(env.GITHUB_RUN_ATTEMPT), jobKey: env.GITHUB_JOB,
    invocationId: session.context?.invocationId, testedSha: env.GITHUB_SHA };
  valid(session.schemaVersion === 'ci-runner-session/1' && /^[a-f0-9-]{36}$/.test(context.invocationId ?? '') && same(session.context, context)
    && session.evidenceKind === (env.TEAMS_CI_RECEIPT_MODE === 'fixture' ? 'FIXTURE' : 'OBSERVATION')
    && Array.isArray(session.planned) && session.planned.length > 0 && session.planned.length <= 100);
  valid(session.planned.every((scope, index) => scope.id === `step-${index + 1}` && ['RUN', 'ACTION'].includes(scope.type) && digest(scope.definitionDigest)));
  state.session = session;
  const raw = lstatSync(join(state.base, 'raw')); valid(raw.isDirectory() && !raw.isSymbolicLink() && (raw.mode & 0o077) === 0);
  const directory = join(state.base, 'export');
  if (existsSync(join(directory, 'runner-evidence.json')) || existsSync(join(directory, 'capture-failure.json'))) return false;
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  const stat = lstatSync(directory); valid(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  if (!existsSync(join(directory, 'raw'))) mkdirSync(join(directory, 'raw'), { mode: 0o700 });
  const rawStat = lstatSync(join(directory, 'raw')); valid(rawStat.isDirectory() && !rawStat.isSymbolicLink() && (rawStat.mode & 0o077) === 0);
  const rawDigests = []; let rejected = false;
  for (const scope of session.planned.filter((row) => row.type === 'RUN')) for (const suffix of ['start', 'result']) {
    try { const source = readRaw(state, scope, suffix); if (source) rawDigests.push(retainRaw(directory, source)); }
    catch { rejected = true; }
  }
  const failure = { schemaVersion: 'ci-runner-failure/1', evidenceKind: session.evidenceKind, context,
    integrity: 'BLOCKED', failureBoundary: 'FINALIZER_VALIDATION', capturedAt: new Date().toISOString(),
    issues: ['SOURCE_OR_CAPTURE_VALIDATION_FAILED', ...(rejected ? ['RAW_METADATA_REJECTED'] : [])], rawDigests,
    producerCaptureAvailable: false, sourceAuthenticity: 'UNVERIFIED', releaseAdmission: 'UNVERIFIED', deliveryState: 'NOT_ATTEMPTED' };
  writeNewJson(join(directory, 'capture-failure.json'), failure);
  writeFileSync(join(directory, 'failure-SHA256SUMS'), [{ file: 'capture-failure.json', sha256: sha256(jsonBytes(failure)) }, ...rawDigests]
    .map(({ file, sha256 }) => `${sha256}  ${file}\n`).join(''), { flag: 'wx', mode: 0o600 });
  return true;
}
export function finalizeRunner(env = process.env) {
  const state = ensureSession(env); const { session } = state;
  valid(['success', 'failure', 'cancelled'].includes(env.CI_RECEIPT_JOB_STATUS));
  valid(typeof env.CI_RECEIPT_RESULTS === 'string' && Buffer.byteLength(env.CI_RECEIPT_RESULTS) <= 32768);
  const results = JSON.parse(env.CI_RECEIPT_RESULTS); valid(results && !Array.isArray(results) && typeof results === 'object');
  valid(Object.keys(results).every((key) => session.planned.some((scope) => scope.id === key)));
  for (const row of Object.values(results)) valid(row && !Array.isArray(row) && Object.keys(row).sort().join(',') === 'conclusion,outcome'
    && (row.outcome === '' || outcomes.has(row.outcome)) && (row.conclusion === '' || outcomes.has(row.conclusion)));
  const captureDirectory = join(state.base, 'capture'); const exportDirectory = join(state.base, 'export');
  mkdirSync(captureDirectory, { mode: 0o700 }); mkdirSync(exportDirectory, { mode: 0o700 }); mkdirSync(join(exportDirectory, 'raw'), { mode: 0o700 });
  const issues = []; const rawDigests = []; const starts = []; const ends = []; let complete = true;
  const observations = session.planned.map((scope) => {
    const engine = results[scope.id]; const outcome = engine?.outcome || null; const conclusion = engine?.conclusion || null;
    if (outcome === null || conclusion === null) issues.push('ENGINE_RESULT_MISSING');
    if (outcome !== conclusion) issues.push('ENGINE_OUTCOME_CONFLICT');
    const row = { schemaVersion: 'ci-scope-observation/1', context: session.context, scopeId: scope.id, definitionDigest: scope.definitionDigest,
      state: 'MISSING', startedAt: null, completedAt: null, exitCode: null, testEvidence: 'UNKNOWN', tests: null,
      runner: { source: 'MISSING', outcome, conclusion, scriptSha256: null, signal: null, requestedSignal: null } };
    if (scope.type === 'ACTION') { row.state = outcome === null ? 'MISSING' : 'OUTCOME_ONLY'; row.runner.source = 'ENGINE'; complete = false; return row; }
    const read = (suffix) => {
      const source = readRaw(state, scope, suffix); if (!source) return null;
      rawDigests.push(retainRaw(exportDirectory, source)); return source.value;
    };
    const start = read('start'); const result = read('result');
    if (start) { row.startedAt = start.startedAt; row.runner.scriptSha256 = start.scriptSha256; starts.push(start.startedAt); }
    if (result) {
      valid(start && result.startedAt === start.startedAt && result.scriptSha256 === start.scriptSha256, 'RAW_RESULT_INVALID');
      row.state = result.signal === null ? 'EXECUTED' : result.requestedSignal !== null || outcome === 'cancelled' ? 'CANCELLED' : 'SIGNALLED';
      row.completedAt = result.completedAt; row.exitCode = result.exitCode;
      row.runner.source = 'SHELL'; row.runner.signal = result.signal; row.runner.requestedSignal = result.requestedSignal; ends.push(result.completedAt);
      if (outcome !== 'cancelled' && (result.exitCode === 0 ? outcome !== 'success' : outcome !== 'failure')) issues.push('ENGINE_RUN_RESULT_CONFLICT');
    } else if (!start && outcome === 'skipped') row.state = 'NOT_RUN';
    else { issues.push(start ? 'TERMINAL_RECEIPT_MISSING' : 'RUN_RECEIPT_MISSING'); complete = false; }
    if (row.state !== 'EXECUTED') complete = false;
    return row;
  });
  const artifacts = [];
  const expectedArtifacts = session.context.jobKey === 'artifact'
    ? [['teams-package', 'appPackage/build/teams-sdk-mvp.zip', 'teams-package.zip'], ['server-tree-checksums', 'dist/evidence/SHA256SUMS', 'server-tree.sha256'], ['release-identity', 'dist/evidence/release-identity.json', 'release-identity.json']] : [];
  for (const [name, path, file] of expectedArtifacts) {
    const absolute = join(state.workspace, path);
    if (!existsSync(absolute)) { issues.push('PRODUCED_ARTIFACT_MISSING'); complete = false; continue; }
    const source = hashRegularFile(absolute); copyFileSync(absolute, join(captureDirectory, file));
    valid(hashRegularFile(join(captureDirectory, file)).sha256 === source.sha256, 'ARTIFACT_CHANGED_DURING_COPY');
    artifacts.push({ name, file, sha256: source.sha256 });
  }
  const proof = { schemaVersion: 'ci-runner-source-proof/1', evidenceKind: session.evidenceKind, context: session.context,
    method: 'GIT_OBJECT_AND_WORKTREE_BYTES', sourceTreeSha: session.sourceTreeSha, workflowSourceSha: session.workflowSourceSha,
    observerSha256: state.source.observerSha256, observerFiles: state.source.observerFiles, observerSourceBinding: state.source.observerSourceBinding,
    sourceAuthenticity: 'UNVERIFIED', workflowSha256: session.workflowSha256,
    packageSha256: state.source.files['package.json'].sha256, lockSha256: state.source.files['package-lock.json'].sha256 };
  const evidence = { schemaVersion: 'ci-runner-evidence/1', evidenceKind: session.evidenceKind, context: session.context,
    capturedAt: new Date().toISOString(), observedJobStatusBeforeFinalizer: env.CI_RECEIPT_JOB_STATUS,
    executionBoundary: 'RUN_SCOPES', coverageComplete: complete, planned: session.planned, observed: observations,
    rawDigests, expectedArtifacts: expectedArtifacts.map(([name]) => name), artifactDigests: artifacts.map(({ name, sha256 }) => ({ name, sha256 })),
    issues: [...new Set(issues)], modelCalls: null, deliveryState: 'NOT_ATTEMPTED', releaseAdmission: 'UNVERIFIED' };
  writeNewJson(join(exportDirectory, 'runner-evidence.json'), evidence); writeNewJson(join(exportDirectory, 'source-proof.json'), proof);
  writeFileSync(join(exportDirectory, 'runner-SHA256SUMS'), [
    { file: 'runner-evidence.json', sha256: sha256(jsonBytes(evidence)) }, { file: 'source-proof.json', sha256: sha256(jsonBytes(proof)) }, ...rawDigests,
  ].map(({ file, sha256 }) => `${sha256}  ${file}\n`).join(''), { flag: 'wx', mode: 0o600 });
  let producerCaptureAvailable = false;
  if (starts.length > 0 && !issues.includes('PRODUCED_ARTIFACT_MISSING')) {
    const put = (file, value) => { const bytes = typeof value === 'string' ? value : jsonBytes(value);
      writeFileSync(join(captureDirectory, file), bytes, { flag: 'wx', mode: 0o600 }); return { file, sha256: sha256(bytes) }; };
    const workflow = put('workflow.yml', state.source.files['.github/workflows/core-ci.yml'].value);
    const pkg = put('package.json', state.source.files['package.json'].value); const lock = put('lock.json', state.source.files['package-lock.json'].value);
    const source = put('source.json', { schemaVersion: 'ci-source/1', repository: session.context.repository, testedSha: session.context.testedSha,
      worktree: 'clean', workflowSha256: workflow.sha256, packageSha256: pkg.sha256, lockSha256: lock.sha256 });
    const input = put('input-manifest.json', { sourceCommit: session.context.testedSha, sourceTreeSha: session.sourceTreeSha,
      workflowSha256: workflow.sha256, packageSha256: pkg.sha256, lockSha256: lock.sha256 });
    const [scope, kind] = jobPolicies[session.context.jobKey];
    const profile = put('profile.json', { schemaVersion: 'ci-profile/1', profile: session.context.jobKey === 'artifact' ? 'candidate' : 'core',
      scope, kind, producedArtifacts: expectedArtifacts.map(([name]) => name), consumedArtifacts: [] });
    const codes = observations.filter((row) => row.runner.source === 'SHELL').map((row) => row.exitCode);
    const knownFailure = codes.find((code) => code !== null && code !== 0);
    const job = put('job.json', { schemaVersion: 'ci-job-observation/1', context: session.context,
      startedAt: [...starts].sort()[0], completedAt: [...ends, ...starts].sort().at(-1),
      exitCode: knownFailure ?? (codes.length > 0 && codes.every((code) => code === 0) ? 0 : null),
      cleanup: 'UNKNOWN', coverageComplete: complete, executionBoundary: 'RUN_SCOPES' });
    const capture = { schemaVersion: 'ci-producer/1', evidenceKind: session.evidenceKind, context: session.context,
      source, workflow, package: pkg, lock, toolchain: put('toolchain.json', session.toolchain), profile, job,
      inputs: [{ name: 'source-inputs', ...input }],
      evidenceFiles: [put('runner-evidence.json', evidence), put('source-proof.json', proof)],
      scopes: observations.map((row) => ({ scopeId: row.scopeId, ...put(`${row.scopeId}.json`, row) })), producedArtifacts: artifacts, consumedArtifacts: [] };
    put('producer.json', capture); producerCaptureAvailable = true;
  }
  return { integrity: issues.length === 0 ? 'PASS' : 'BLOCKED', issues: [...new Set(issues)], producerCaptureAvailable, captureDirectory, exportDirectory };
}
