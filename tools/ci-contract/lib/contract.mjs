import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = new URL('../', import.meta.url);
const ajv = new Ajv2020({ strict: true, allErrors: true, ownProperties: true });
addFormats(ajv);
const resultSchema = JSON.parse(readFileSync(new URL('ci-result.schema.json', root)));
const validate = ajv.compile(resultSchema);
const receiptValidator = ajv.getSchema(`${resultSchema.$id}#/$defs/receipt`);
export const validateReceipt = (value) => receiptValidator(value);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const digest = (value) => sha256(canonical(value));
const equal = (a, b) => canonical(a) === canonical(b);
const sameSet = (a, b) => equal([...a].sort(), [...b].sort());
const slot = (job) => `${job.key}/${job.matrixDigest}`;
const time = (value) => value === null ? null : Date.parse(value);
const combine = (gates) => ['BLOCKED', 'FAIL', 'UNKNOWN'].find((gate) => gates.includes(gate)) ?? 'PASS';
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const primaryScopes = {
  'devdoo-teams/teams-app': { core: 'teams-core', optional: 'teams-optional', candidate: 'teams-candidate', collector: 'collector' },
  'doosanofficial-ui/WebDashboard': { 'native-full': 'iphone-native-full', 'native-se': 'iphone-se', 'native-help': 'iphone-help', candidate: 'iphone-candidate', collector: 'collector' },
};

export function validateResult(value) {
  const valid = validate(value);
  // Do not include supplied values or unknown property names in diagnostics.
  return { valid, errors: valid ? [] : validate.errors.slice(0, 16).map(({ keyword, schemaPath }) => ({ keyword, schemaPath })) };
}

function assessJob(document, job) {
  const issues = [];
  const result = {
    key: job.key, matrixDigest: job.matrixDigest, kind: job.kind, apiConclusion: job.apiConclusion,
    executionRelation: 'UNKNOWN', carriedForwardFrom: null, gate: 'UNKNOWN', issues,
    verifiedTests: null, verifiedSeconds: null, modelMeasurement: null, failureClass: null,
  };
  const block = (code) => { issues.push(code); result.gate = 'BLOCKED'; };
  const unknown = (code) => { issues.push(code); };
  // API outcome classification is available even when upload/receipts are absent.
  if (job.apiConclusion === 'cancelled') result.failureClass = 'CANCELLED';
  if (job.apiConclusion === 'timed_out') result.failureClass = 'TIMEOUT';
  const expectedComplete = Object.values(job.expectedInputs).every((value) => value !== null)
    && job.expectedDependencyDigests !== null && job.matrixDigest !== null
    && job.listedAttempt !== null && job.keySource !== 'API_ID' && job.kind !== 'UNKNOWN' && document.identity.testedSha !== null;
  if (!expectedComplete) unknown('EXPECTED_EXECUTION_IDENTITY_UNKNOWN');
  if (job.listedAttempt !== null && job.listedAttempt !== document.identity.attempt) block('LISTED_ATTEMPT_MISMATCH');
  if (job.expectedInputs.testedSha !== null && document.identity.testedSha !== null && job.expectedInputs.testedSha !== document.identity.testedSha) block('TESTED_SHA_MISMATCH');
  const attemptStart = time(document.observation.attemptStartedAt);
  const apiStart = time(job.startedAt);
  const receipt = job.receipt;
  if (!receipt || job.receiptAvailability !== 'AVAILABLE') {
    unknown('RECEIPT_UNAVAILABLE');
    if (job.candidateOrigins.length > 0 || (apiStart !== null && attemptStart !== null && apiStart < attemptStart)) result.executionRelation = 'CARRY_FORWARD_CANDIDATE';
    return result;
  }
  if (job.receiptDigest !== digest(receipt)) block('RECEIPT_DIGEST_MISMATCH');
  const producer = receipt.producer;
  if (producer.repository !== document.identity.repository || producer.workflow !== document.identity.workflow
      || producer.runId !== document.identity.runId || (job.keySource !== 'API_ID' && producer.jobKey !== job.key)
      || (job.matrixDigest !== null && producer.matrixDigest !== job.matrixDigest)) block('PRODUCER_IDENTITY_MISMATCH');
  if (producer.attempt > document.identity.attempt) block('FUTURE_PRODUCER_ATTEMPT');
  if (Object.keys(job.expectedInputs).some((key) => receipt.inputs[key] !== null && job.expectedInputs[key] !== null && receipt.inputs[key] !== job.expectedInputs[key])) block('INPUT_COMPATIBILITY_MISMATCH');
  if (job.expectedDependencyDigests !== null && !sameSet(receipt.consumedArtifactDigests, job.expectedDependencyDigests)) block('DEPENDENCY_CONSUMPTION_MISMATCH');
  const started = time(receipt.startedAt); const completed = time(receipt.completedAt);
  if (completed < started || started !== apiStart || completed !== time(job.completedAt)) block('EXECUTION_TIME_MISMATCH');
  if (result.gate === 'BLOCKED') return result;
  if (!expectedComplete || Object.values(receipt.inputs).some((value) => value === null)) {
    unknown('EXECUTION_INPUTS_UNKNOWN');
    if (producer.attempt < document.identity.attempt) result.executionRelation = 'CARRY_FORWARD_CANDIDATE';
    return result;
  }
  if (producer.attempt === document.identity.attempt) {
    if (attemptStart === null) unknown('ATTEMPT_START_UNKNOWN');
    else if (started < attemptStart || job.carriedForwardFrom !== null || job.reuseProof !== null) block('CURRENT_EXECUTION_CONFLICT');
    else result.executionRelation = 'CURRENT_EXECUTION_VERIFIED';
  } else if (producer.attempt < document.identity.attempt) {
    result.executionRelation = 'CARRY_FORWARD_CANDIDATE';
    const origin = job.carriedForwardFrom; const proof = job.reuseProof;
    if (attemptStart === null) unknown('ATTEMPT_START_UNKNOWN');
    else if (completed > attemptStart) block('CARRY_FORWARD_TIME_CONFLICT');
    else if (!origin || !proof || job.candidateOrigins.length > 1) unknown('REUSE_PROOF_UNAVAILABLE_OR_AMBIGUOUS');
    else if (!equal(origin, {
      runId: producer.runId, attempt: producer.attempt, jobKey: producer.jobKey,
      matrixDigest: producer.matrixDigest, receiptDigest: job.receiptDigest,
    }) || proof.policyVersion !== document.policyVersion || proof.originReceiptDigest !== job.receiptDigest
        || proof.compatibilityDigest !== digest(job.expectedInputs)
        || !sameSet(proof.consumedArtifactDigests, receipt.consumedArtifactDigests)) block('REUSE_PROOF_MISMATCH');
    else { result.executionRelation = 'CARRY_FORWARD_VERIFIED'; result.carriedForwardFrom = structuredClone(origin); }
  } else block('FUTURE_PRODUCER_ATTEMPT');
  if (result.gate === 'BLOCKED' || !result.executionRelation.endsWith('_VERIFIED')) return result;

  result.verifiedSeconds = (completed - started) / 1000; result.gate = 'PASS';
  if (job.status !== 'completed') { result.gate = 'UNKNOWN'; unknown('JOB_NOT_COMPLETED'); }
  if (job.apiConclusion === null) { result.gate = combine([result.gate, 'UNKNOWN']); unknown('JOB_CONCLUSION_UNKNOWN'); }
  if (['cancelled', 'timed_out', 'skipped', 'action_required', 'stale', 'startup_failure', 'neutral'].includes(job.apiConclusion)) {
    result.gate = 'BLOCKED'; result.failureClass = job.apiConclusion === 'cancelled' ? 'CANCELLED' : job.apiConclusion === 'timed_out' ? 'TIMEOUT' : 'NOT_SUCCESSFUL'; issues.push('API_JOB_NOT_SUCCESSFUL');
  }
  if (receipt.exitCode !== 0 || job.apiConclusion === 'failure') {
    result.gate = combine([result.gate, 'FAIL']); result.failureClass = receipt.tests?.failed > 0 ? 'CODE_OR_TEST_FAILURE' : 'UNKNOWN_FAILURE';
  }
  if (receipt.cleanup === 'FAILED') block('CLEANUP_FAILED');
  else if (receipt.cleanup === 'UNKNOWN') { result.gate = combine([result.gate, 'UNKNOWN']); unknown('CLEANUP_UNKNOWN'); }
  if (job.kind === 'TEST') {
    const counts = receipt.tests;
    if (!counts || Object.values(counts).some((value) => value === null)) { result.gate = combine([result.gate, 'UNKNOWN']); unknown('TEST_COUNTS_UNKNOWN'); }
    else {
      result.verifiedTests = counts.executed;
      if (counts.expected === 0 || counts.executed !== counts.expected || counts.unexpectedSkipped !== 0 || counts.failed > counts.executed) block('TEST_COUNTS_INCOMPLETE');
      if (counts.failed > 0) { result.gate = combine([result.gate, 'FAIL']); result.failureClass = 'CODE_OR_TEST_FAILURE'; }
    }
  }
  const measurement = receipt.modelMeasurement;
  const complete = measurement.coverageComplete && measurement.credentialIsolationVerified
    && measurement.unobservedPaths.length === 0 && measurement.measurementScope !== null
    && measurement.instrumentationVersion !== null && measurement.observedModelCalls !== null && measurement.blockedModelAttempts !== null;
  result.modelMeasurement = {
    complete, measurementScope: measurement.measurementScope, instrumentationVersion: measurement.instrumentationVersion,
    observedModelCalls: complete ? measurement.observedModelCalls : null, blockedModelAttempts: measurement.blockedModelAttempts,
  };
  if (measurement.observedModelCalls > 0) block('MODEL_CALL_OBSERVED');
  if (measurement.blockedModelAttempts > 0) block('MODEL_ATTEMPT_BLOCKED');
  return result;
}

function assessBase(document) {
  if (!validateResult(document).valid) throw new TypeError('INVALID_CI_RESULT');
  const issues = [...(document.evidenceIssues ?? [])]; const identity = document.identity;
  const endpoint = `/repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.attempt}/jobs`;
  if (document.observation.endpoint !== endpoint) issues.push('OBSERVATION_IDENTITY_MISMATCH');
  const seenSlots = new Set(); const seenIds = new Set(); const seenInvocations = new Set();
  for (const job of document.jobs) {
    if (seenSlots.has(slot(job)) || seenIds.has(job.listedJobId)) issues.push('DUPLICATE_JOB');
    seenSlots.add(slot(job)); seenIds.add(job.listedJobId);
    if (job.receipt) {
      const { repository, workflow, runId, attempt, invocationId } = job.receipt.producer;
      const invocation = canonical({ repository, workflow, runId, attempt, invocationId });
      if (seenInvocations.has(invocation)) issues.push('DUPLICATE_INVOCATION');
      seenInvocations.add(invocation);
    }
  }
  const seenArtifacts = new Set();
  for (const artifact of document.artifacts) { if (seenArtifacts.has(artifact.id)) issues.push('DUPLICATE_ARTIFACT_ID'); seenArtifacts.add(artifact.id); }
  const jobs = document.jobs.map((job) => assessJob(document, job)).sort((a, b) => lexical(slot(a), slot(b)));
  const bySlot = new Map(jobs.map((job) => [slot(job), job])); const seenScopes = new Set();
  const scopes = document.requirements.map((requirement) => {
    if (seenScopes.has(requirement.scope)) issues.push('DUPLICATE_SCOPE'); seenScopes.add(requirement.scope);
    const iphone = identity.repository === 'doosanofficial-ui/WebDashboard';
    const nativeProfiles = { 'native-full': ['iphone-native-full', 'iphone-se', 'iphone-seed'], 'native-se': ['iphone-se', 'iphone-seed'], 'native-help': ['iphone-help', 'iphone-seed'] };
    const nativeCounts = { 'iphone-native-full': 31, 'iphone-se': 2, 'iphone-help': 4 };
    const wrongProduct = iphone ? requirement.scope.startsWith('teams-') : requirement.scope.startsWith('iphone-');
    const wrongProfile = iphone && nativeProfiles[identity.profile] && !nativeProfiles[identity.profile].includes(requirement.scope);
    const wrongNativeCount = iphone && nativeCounts[requirement.scope] !== undefined && requirement.expectedTests !== nativeCounts[requirement.scope];
    if (wrongProduct || wrongProfile || wrongNativeCount || (!iphone && identity.profile.startsWith('native-'))) issues.push('SCOPE_POLICY_MISMATCH');
    const expectedSlots = requirement.jobs.map(slot);
    if (new Set(expectedSlots).size !== expectedSlots.length) issues.push('DUPLICATE_REQUIRED_SLOT');
    const selected = expectedSlots.map((key) => bySlot.get(key)); let gate = combine(selected.map((job) => job?.gate ?? 'UNKNOWN'));
    if (selected.some((job) => !job)) issues.push(`MISSING_JOB:${requirement.scope}`);
    const countable = selected.filter((job) => job?.kind === 'TEST');
    const executed = selected.some((job) => !job || job.kind === 'UNKNOWN') || countable.some((job) => job.verifiedTests === null)
      ? null : countable.reduce((total, job) => total + job.verifiedTests, 0);
    if (requirement.expectedTests !== null && executed !== null && executed !== requirement.expectedTests) gate = 'BLOCKED';
    if (document.observation.status !== 'completed' || !document.observation.paginationComplete) gate = combine([gate, 'UNKNOWN']);
    return { scope: requirement.scope, required: requirement.required, gate, expectedTests: requirement.expectedTests, verifiedExecutedTests: executed };
  }).sort((a, b) => lexical(a.scope, b.scope));
  if (document.observation.status !== 'completed') issues.push('PARTIAL_RESULT');
  if (document.observation.apiConclusion === null) issues.push('WORKFLOW_CONCLUSION_UNKNOWN');
  if (!document.observation.paginationComplete) issues.push('PAGINATION_INCOMPLETE');
  if (!document.requirements.some((requirement) => requirement.required)) issues.push('NO_REQUIRED_SCOPE');
  const primary = primaryScopes[identity.repository][identity.profile];
  if (!primary || !document.requirements.some((requirement) => requirement.scope === primary && requirement.required)) issues.push('MISSING_PRIMARY_SCOPE');
  const available = new Set(document.artifacts.filter((artifact) => artifact.availability === 'AVAILABLE' && artifact.digestVerified && artifact.digest !== null).map((artifact) => artifact.digest));
  const produced = document.jobs.flatMap((job) => job.receipt?.producedArtifactDigests ?? []);
  const artifactIncomplete = document.artifacts.length === 0 || document.artifacts.some((artifact) => artifact.availability !== 'AVAILABLE' || !artifact.digestVerified || artifact.digest === null) || produced.some((hash) => !available.has(hash));
  if (artifactIncomplete) issues.push('ARTIFACT_EVIDENCE_UNAVAILABLE');
  const integrityBlocked = issues.some((code) => /^(DUPLICATE_|OBSERVATION_IDENTITY|SCOPE_POLICY|MISSING_PRIMARY_SCOPE|ARTIFACT_DIGEST_MISMATCH|LEGACY_RELEASE_IDENTITY_MISMATCH|RECEIPT_TESTED_SHA_CONFLICT)/.test(code));
  const evidenceGate = integrityBlocked || jobs.some((job) => job.gate === 'BLOCKED') || scopes.some((scope) => scope.gate === 'BLOCKED')
    ? 'BLOCKED' : artifactIncomplete || issues.length > 0 || jobs.some((job) => job.gate === 'UNKNOWN') ? 'UNKNOWN' : 'CONSISTENT';
  const current = jobs.filter((job) => job.executionRelation === 'CURRENT_EXECUTION_VERIFIED');
  const carried = jobs.filter((job) => job.executionRelation === 'CARRY_FORWARD_VERIFIED');
  const unknownKind = jobs.some((job) => job.kind === 'UNKNOWN');
  const unknownExecution = jobs.some((job) => !job.executionRelation.endsWith('_VERIFIED')) || issues.some((code) => /^(MISSING_JOB|PARTIAL_RESULT|PAGINATION)/.test(code));
  const sumTests = (values) => values.some((job) => job.kind === 'TEST' && job.verifiedTests === null) ? null : values.reduce((total, job) => total + (job.verifiedTests ?? 0), 0);
  const measurementComplete = !integrityBlocked && !unknownExecution && current.length > 0 && current.every((job) => job.modelMeasurement?.complete);
  return {
    apiConclusion: document.observation.apiConclusion, evidenceGate, releaseAdmission: 'UNVERIFIED',
    requiredScopesGate: integrityBlocked ? 'BLOCKED' : issues.includes('NO_REQUIRED_SCOPE') ? 'UNKNOWN' : combine(scopes.filter((scope) => scope.required).map((scope) => scope.gate)),
    jobs, scopes, issues: [...new Set(issues)].sort(), executionCountComplete: !integrityBlocked && !unknownExecution,
    newExecutionTests: integrityBlocked || unknownKind ? null : sumTests(current.filter((job) => job.kind === 'TEST')), carriedForwardTests: integrityBlocked || unknownKind ? null : sumTests(carried),
    newExecutionSeconds: integrityBlocked || unknownKind ? null : current.reduce((total, job) => total + (job.verifiedSeconds ?? 0), 0),
    observedModelCalls: measurementComplete ? current.reduce((total, job) => total + job.modelMeasurement.observedModelCalls, 0) : null,
    blockedModelAttempts: current.some((job) => job.modelMeasurement?.blockedModelAttempts > 0)
      ? current.reduce((total, job) => total + (job.modelMeasurement?.blockedModelAttempts ?? 0), 0) : measurementComplete ? 0 : null,
    measurementComplete,
    // Host observations need their own verifier; P0 never upgrades them.
    liveGates: document.liveGates.map((gate) => ({ ...gate, declaredState: gate.state, state: 'UNVERIFIED' })).sort((a, b) => lexical(a.surface, b.surface)),
  };
}

function notificationFrom(document, assessment) {
  const { repository, workflow, runId, attempt, profile } = document.identity;
  const executionKey = canonical({ repository, workflow, runId, attempt, profile });
  const evidence = structuredClone(document);
  delete evidence.delivery; delete evidence.revision;
  delete evidence.observation.fetchedAt; delete evidence.observation.responseDigest;
  delete evidence.observation.responseDigestKind;
  // These are sets in the contract. Receipt internals retain their original
  // array order because their canonical digest binds those bytes separately.
  const sortBy = (values, key) => values.sort((a, b) => lexical(key(a), key(b)));
  sortBy(evidence.jobs, slot); sortBy(evidence.requirements, (row) => row.scope);
  sortBy(evidence.artifacts, (row) => row.id); sortBy(evidence.liveGates, (row) => row.surface);
  for (const row of evidence.requirements) sortBy(row.jobs, slot);
  for (const job of evidence.jobs) {
    if (job.expectedDependencyDigests !== null) job.expectedDependencyDigests.sort(); sortBy(job.candidateOrigins, canonical);
    if (job.reuseProof) job.reuseProof.consumedArtifactDigests.sort();
  }
  const resultRevision = digest({ contractDigest: contractDigest(), evidence, assessment });
  const { kind, sequence, previousNotificationId } = document.revision;
  const payloadDigest = digest({ executionKey, resultRevision, kind, sequence, previousNotificationId });
  return { executionKey, resultRevision, kind, sequence, previousNotificationId, id: digest({ executionKey, resultRevision, kind, sequence }), payloadDigest };
}
export function notificationFor(document) { return notificationFrom(document, assessBase(document)); }
export function assessResult(document) {
  const result = assessBase(document); const notification = notificationFrom(document, result); const ack = document.delivery.ack;
  const deliveryState = document.delivery.state === 'ACKNOWLEDGED'
    ? ack && ack.notificationId === notification.id && ack.payloadDigest === notification.payloadDigest ? 'ACK_METADATA_MATCHED' : 'UNCERTAIN'
    : document.delivery.state;
  return { ...result, deliveryState };
}
export function compareNotifications(previous, next) {
  for (const value of [previous, next]) {
    if (!value || typeof value !== 'object' || !/^[a-f0-9]{64}$/.test(value.id ?? '')
        || !/^[a-f0-9]{64}$/.test(value.payloadDigest ?? '') || !/^[a-f0-9]{64}$/.test(value.resultRevision ?? '')
        || typeof value.executionKey !== 'string' || value.executionKey.length > 1024
        || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > 1000000000
        || !['partial-failure', 'final', 'evidence-update'].includes(value.kind)
        || (value.previousNotificationId !== null && !/^[a-f0-9]{64}$/.test(value.previousNotificationId ?? ''))) throw new TypeError('INVALID_NOTIFICATION');
  }
  if (previous.id === next.id) return previous.payloadDigest === next.payloadDigest ? 'DUPLICATE' : 'CONFLICT';
  if (previous.executionKey !== next.executionKey) return 'UNRELATED';
  if (previous.kind !== 'partial-failure' && next.kind === 'partial-failure') return 'STALE';
  if (next.sequence <= previous.sequence) return 'STALE';
  return next.previousNotificationId === previous.id ? 'UPDATE' : 'CONFLICT';
}

export function contractDigest() {
  const files = ['ci-result.schema.json', 'lib/contract.mjs', 'lib/io.mjs', 'lib/packet.mjs', 'templates/notification.md', 'package.json', 'package-lock.json', 'cli.mjs'];
  return digest(files.sort().map((name) => ({ name, sha256: sha256(readFileSync(new URL(name, root))) })));
}
const display = (value) => value === null ? 'unknown' : String(value).replace(/[\\`*_[\]<>|]/g, '\\$&').replace(/[\r\n\u0000-\u001f]/g, ' ');
export function renderNotification(document) {
  const result = assessResult(document); const notice = notificationFor(document); const id = document.identity;
  const rows = result.scopes.map((scope) => `| ${display(scope.scope)} | ${scope.required} | ${scope.gate} | ${display(scope.verifiedExecutedTests)} / ${display(scope.expectedTests)} |`).join('\n');
  const jobRows = result.jobs.map((job) => `| ${display(job.key)} | ${job.apiConclusion ?? 'unknown'} | ${job.executionRelation} | ${job.gate} | ${job.failureClass ?? 'none'} |`).join('\n');
  const allIssues = [...result.issues, ...result.jobs.flatMap((job) => job.issues.map((issue) => `${job.key}:${issue}`))].sort();
  const fields = {
    evidenceKind: document.evidenceKind,
    identity: `${id.repository} · ${id.workflow} · run ${id.runId} / attempt ${id.attempt} · profile ${id.profile}\n\nhttps://github.com/${id.repository}/actions/runs/${id.runId}/attempts/${id.attempt}`,
    sourceIdentity: `Tested SHA: ${display(id.testedSha)}\n\nAPI run head SHA: ${display(id.runHeadSha ?? null)}\n\nPR head SHA: ${display(id.prHeadSha)}\n\nMerge SHA: ${display(id.mergeSha)}\n\nCollector SHA: ${display(id.collectorSha)}`,
    gates: `API conclusion: ${result.apiConclusion ?? 'unknown'} · record evidence: ${result.evidenceGate} · required scope receipts: ${result.requiredScopesGate} · release: UNVERIFIED`,
    scopeTable: `| Scope | Required | Receipt gate | Verified tests / expected |\n| --- | --- | --- | --- |\n${rows}`,
    jobTable: `| Job | API | Execution relation | Receipt gate | Failure class |\n| --- | --- | --- | --- | --- |\n${jobRows}`,
    usage: `Verified new tests: ${display(result.newExecutionTests)}; carried tests: ${display(result.carriedForwardTests)}; execution attribution complete: ${result.executionCountComplete}.\n\nVerified new runner seconds: ${display(result.newExecutionSeconds)}; observed model calls: ${display(result.observedModelCalls)}; blocked attempts observed: ${display(result.blockedModelAttempts)}; measurement complete: ${result.measurementComplete}. Costs: unknown.`,
    delivery: `Delivery: ${result.deliveryState}; ACK authenticity: UNVERIFIED.`,
    liveGates: `Host gates: ${result.liveGates.map((gate) => `${gate.surface}=${gate.state} (declared ${gate.declaredState})`).join('; ')}.`,
    issues: `Evidence issues: ${allIssues.length ? allIssues.map(display).join(', ') : 'none in normalized record'}.`,
    notification: `Notification candidate: ${notice.id}\n\nResult revision: ${notice.resultRevision}\n\nPayload digest: ${notice.payloadDigest}\n\nContract digest: ${contractDigest()}`,
  };
  return readFileSync(new URL('templates/notification.md', root), 'utf8').replace(/\{\{([A-Za-z]+)\}\}/g, (_, key) => {
    if (!(key in fields)) throw new Error('UNKNOWN_TEMPLATE_FIELD'); return fields[key];
  });
}
