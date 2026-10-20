import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readTextFile, readJsonFile, hashRegularFile } from './io.mjs';
import { canonical, digest, contractDigest, validateReceipt } from './contract.mjs';
import { producerSchemas } from './producer-schemas.mjs';
const ajv = new Ajv2020({ strict: true, ownProperties: true }); addFormats(ajv);
const validators = Object.fromEntries(Object.entries(producerSchemas).map(([key, schema]) => [key, ajv.compile(schema)]));
const requireValue = (value, code = 'PRODUCER_INPUT_REJECTED') => { if (!value) throw new Error(code); };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const jobKinds = { core: ['teams-core', 'TEST'], a2a: ['teams-a2a', 'TEST'], continuity: ['teams-continuity', 'TEST'], azure: ['teams-azure', 'TEST'],
  optional: ['teams-optional', 'TEST'], copilot_ui: ['teams-optional', 'TEST'], container: ['teams-container', 'BUILD'], artifact: ['teams-candidate', 'BUILD'] };
export function producerDigest() {
  const sources = ['producer.mjs', 'producer-schemas.mjs', '../produce-receipt.mjs'].map((file) => ({ file, sha256: hash(readFileSync(new URL(file, import.meta.url))) }));
  return digest({ sources, contractDigest: contractDigest() });
}

// This is a bounded text-layout inventory, not a general YAML interpreter.
// Each complete step block is hashed verbatim, including its run/uses settings.
export function workflowJobPlan(text, jobKey) {
  requireValue(typeof text === 'string' && !text.includes('\r') && text.split('\njobs:\n').length === 2, 'WORKFLOW_LAYOUT_UNSUPPORTED');
  const jobs = [...text.matchAll(/^  ([A-Za-z0-9_]+):\n/gm)].filter((match) => match.index > text.indexOf('\njobs:\n'));
  requireValue(jobs.length > 0 && jobs.length <= 16 && new Set(jobs.map((x) => x[1])).size === jobs.length, 'WORKFLOW_LAYOUT_UNSUPPORTED');
  const index = jobs.findIndex((match) => match[1] === jobKey); requireValue(index >= 0 && Object.hasOwn(jobKinds, jobKey), 'JOB_NOT_IN_WORKFLOW');
  const block = text.slice(jobs[index].index, jobs[index + 1]?.index ?? text.length);
  requireValue((block.match(/^    steps:\n/gm) ?? []).length === 1, 'WORKFLOW_LAYOUT_UNSUPPORTED');
  const starts = [...block.matchAll(/^      - name: ([^\r\n]{1,160})\n/gm)];
  requireValue(starts.length > 0 && starts.length <= 100 && (block.match(/^      - /gm) ?? []).length === starts.length, 'WORKFLOW_LAYOUT_UNSUPPORTED');
  return starts.map((match, index) => {
    const definition = block.slice(match.index, starts[index + 1]?.index ?? block.length);
    const actions = [...definition.matchAll(/^        (run|uses):/gm)];
    requireValue(actions.length === 1, 'WORKFLOW_LAYOUT_UNSUPPORTED');
    return { id: `step-${index + 1}`, name: match[1], type: actions[0][1] === 'run' ? 'RUN' : 'ACTION', definitionDigest: hash(definition) };
  });
}

export function readProducerCapture(captureDirectory) {
  const directory = resolve(captureDirectory); const sources = []; const used = new Set(); let bytes = 0; let opaqueBytes = 0;
  const record = (file, kind, value) => { sources.push({ file, kind, bytes: value.bytes, sha256: value.sha256 }); return value; };
  const reserve = (file) => {
    requireValue(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(file) && !used.has(file) && used.size < 200, 'SOURCE_FILE_BOUNDARY'); used.add(file);
  };
  const read = (descriptor, kind, format = 'json') => {
    reserve(descriptor.file);
    const value = format === 'opaque' ? hashRegularFile(join(directory, descriptor.file))
      : format === 'text' ? readTextFile(join(directory, descriptor.file)) : readJsonFile(join(directory, descriptor.file));
    if (format === 'opaque') { opaqueBytes += value.bytes; requireValue(opaqueBytes <= 128 * 1024 * 1024, 'OPAQUE_TOTAL_BOUNDARY'); }
    else { bytes += value.bytes; requireValue(bytes <= 16 * 1024 * 1024, 'JSON_TOTAL_BOUNDARY'); }
    requireValue(descriptor.sha256 === undefined || descriptor.sha256 === value.sha256, 'SOURCE_DIGEST_MISMATCH');
    record(descriptor.file, kind, value); return value;
  };
  const capture = read({ file: 'producer.json' }, 'CAPTURE').value;
  requireValue(validators.capture(capture));
  const values = {};
  for (const key of ['source', 'workflow', 'package', 'lock', 'toolchain', 'profile', 'job']) {
    const value = read(capture[key], key.toUpperCase(), key === 'workflow' ? 'text' : 'json'); values[key] = value;
    if (validators[key]) requireValue(validators[key](value.value));
  }
  const context = capture.context; const profile = values.profile.value;
  const tools = values.toolchain.value.tools;
  requireValue(new Set(tools.map((tool) => tool.name)).size === tools.length
    && tools.find((tool) => tool.name === 'node')?.version === values.toolchain.value.matrix.node, 'TOOLCHAIN_IDENTITY_MISMATCH');
  for (const [descriptors, expected] of [[capture.producedArtifacts, profile.producedArtifacts], [capture.consumedArtifacts, profile.consumedArtifacts]]) {
    const names = descriptors.map((row) => row.name);
    requireValue(new Set(names).size === names.length && canonical([...names].sort()) === canonical([...expected].sort()), 'ARTIFACT_INVENTORY_MISMATCH');
  }
  requireValue(new Set(capture.inputs.map((row) => row.name)).size === capture.inputs.length, 'INPUT_INVENTORY_MISMATCH');
  requireValue(canonical(values.job.value.context) === canonical(context), 'EXECUTION_CONTEXT_MISMATCH');
  const source = values.source.value;
  requireValue(source.repository === context.repository && source.testedSha === context.testedSha
    && source.workflowSha256 === values.workflow.sha256 && source.packageSha256 === values.package.sha256 && source.lockSha256 === values.lock.sha256, 'SOURCE_IDENTITY_MISMATCH');
  const planned = workflowJobPlan(values.workflow.value, context.jobKey);
  requireValue(profile.scope === jobKinds[context.jobKey][0] && profile.kind === jobKinds[context.jobKey][1], 'PROFILE_SCOPE_MISMATCH');
  const expectedScopes = new Map(planned.map((scope) => [scope.id, scope])); const seenScopes = new Set();
  requireValue(capture.scopes.length === planned.length, 'SCOPE_INVENTORY_MISMATCH');
  const observed = capture.scopes.map((descriptor) => {
    const value = read(descriptor, 'SCOPE_OBSERVATION'); requireValue(validators.observation(value.value));
    requireValue(canonical(value.value.context) === canonical(context), 'EXECUTION_CONTEXT_MISMATCH');
    requireValue(!seenScopes.has(descriptor.scopeId) && expectedScopes.has(descriptor.scopeId)
      && value.value.scopeId === descriptor.scopeId && value.value.definitionDigest === expectedScopes.get(descriptor.scopeId).definitionDigest, 'SCOPE_INVENTORY_MISMATCH');
    seenScopes.add(descriptor.scopeId);
    return value.value;
  });
  const job = values.job.value; const jobStart = Date.parse(job.startedAt); const jobEnd = Date.parse(job.completedAt);
  requireValue(jobStart <= jobEnd, 'EXECUTION_OBSERVATION_MISMATCH');
  const byScope = new Map(observed.map((row) => [row.scopeId, row])); let previousEnd = jobStart;
  for (const scope of planned) {
    const row = byScope.get(scope.id);
    requireValue(row.testEvidence === 'COUNTS' ? row.tests !== null : row.tests === null, 'EXECUTION_OBSERVATION_MISMATCH');
    if (row.tests) requireValue(row.tests.failed === null || row.tests.executed === null || row.tests.failed <= row.tests.executed, 'EXECUTION_OBSERVATION_MISMATCH');
    if (row.state === 'EXECUTED') {
      requireValue(row.startedAt !== null && row.completedAt !== null && row.exitCode !== null, 'EXECUTION_OBSERVATION_MISMATCH');
      const start = Date.parse(row.startedAt); const end = Date.parse(row.completedAt);
      requireValue(start >= previousEnd && end >= start && end <= jobEnd, 'EXECUTION_OBSERVATION_MISMATCH'); previousEnd = end;
    } else {
      requireValue(row.exitCode === null && row.tests === null, 'EXECUTION_OBSERVATION_MISMATCH');
      if (row.state !== 'CANCELLED') requireValue(row.startedAt === null && row.completedAt === null, 'EXECUTION_OBSERVATION_MISMATCH');
      else {
        const start = row.startedAt === null ? null : Date.parse(row.startedAt); const end = row.completedAt === null ? null : Date.parse(row.completedAt);
        requireValue((start === null || start >= previousEnd && start <= jobEnd) && (end === null || end >= (start ?? previousEnd) && end <= jobEnd), 'EXECUTION_OBSERVATION_MISMATCH');
        if (end !== null) previousEnd = end;
      }
    }
    if (job.exitCode === 0) requireValue(row.state === 'EXECUTED' && row.exitCode === 0 && !(row.tests?.failed > 0), 'EXECUTION_OBSERVATION_MISMATCH');
    if (job.exitCode === 0 && row.tests) requireValue((row.tests.expected === null || row.tests.expected > 0)
      && (row.tests.expected === null || row.tests.executed === null || row.tests.expected === row.tests.executed)
      && !(row.tests.unexpectedSkipped > 0), 'SCOPE_TEST_COUNT_MISMATCH');
  }
  const inputFiles = capture.inputs.map((descriptor) => ({ name: descriptor.name, ...read(descriptor, 'INPUT', 'opaque') }));
  const artifacts = (descriptors, kind) => descriptors.map((descriptor) => ({ name: descriptor.name, ...read(descriptor, kind, 'opaque') }));
  const produced = artifacts(capture.producedArtifacts, 'PRODUCED_ARTIFACT'); const consumed = artifacts(capture.consumedArtifacts, 'CONSUMED_ARTIFACT');
  const countsKnown = observed.every((row) => row.testEvidence === 'NONE' || row.testEvidence === 'COUNTS' && row.tests && Object.values(row.tests).every((count) => count !== null));
  const counts = { expected: null, executed: null, failed: null, unexpectedSkipped: null };
  if (countsKnown) for (const key of Object.keys(counts)) counts[key] = observed.reduce((total, row) => total + (row.tests?.[key] ?? 0), 0);
  const scopeReport = { schemaVersion: 'ci-execution-scope/1', evidenceKind: capture.evidenceKind, context: structuredClone(context),
    kind: profile.kind, scope: profile.scope, planned, observed, countsKnown };
  const scopeBytes = `${canonical(scopeReport)}\n`;
  const provenance = { schemaVersion: 'ci-producer-provenance/1', evidenceKind: capture.evidenceKind, context: structuredClone(context),
    producerDigest: producerDigest(), contractDigest: contractDigest(),
    sourceAuthenticity: 'UNVERIFIED', sourceBinding: 'SUPPLIED_SOURCE_OBSERVATION', files: sources,
    scopeReportSha256: hash(scopeBytes), producedArtifacts: produced, consumedArtifacts: consumed };
  const { testedSha, ...producer } = context;
  const receipt = { evidenceKind: capture.evidenceKind, producer: { ...producer, matrixDigest: digest(values.toolchain.value.matrix) },
    inputs: { testedSha, toolchainDigest: values.toolchain.sha256, suiteDigest: digest({ workflow: values.workflow.sha256, package: values.package.sha256, lock: values.lock.sha256, jobKey: context.jobKey, planned }),
      inputDigest: digest(inputFiles), profileDigest: values.profile.sha256 },
    startedAt: values.job.value.startedAt, completedAt: values.job.value.completedAt, exitCode: values.job.value.exitCode,
    tests: profile.kind === 'TEST' ? counts : null, cleanup: values.job.value.cleanup,
    producedArtifactDigests: [...new Set(produced.map((row) => row.sha256))], consumedArtifactDigests: [...new Set(consumed.map((row) => row.sha256))],
    modelMeasurement: { measurementScope: 'supplied-job-observations', instrumentationVersion: 'ci-producer/1', coverageComplete: false,
      credentialIsolationVerified: false, unobservedPaths: ['descendant-processes', 'provider-requests'], observedModelCalls: null, blockedModelAttempts: null },
    sourceEvidenceDigest: hash(`${canonical(provenance)}\n`) };
  requireValue(validateReceipt(receipt), 'PRODUCER_RECEIPT_INVALID');
  return { receipt, provenance, scopeReport };
}

export function writeProducerPacket(captureDirectory, outputDirectory) {
  const { receipt, provenance, scopeReport } = readProducerCapture(captureDirectory);
  const files = { 'receipt.json': `${canonical(receipt)}\n`, 'producer-provenance.json': `${canonical(provenance)}\n`, 'execution-scope.json': `${canonical(scopeReport)}\n` };
  const summary = { status: 'RECEIPT_WRITTEN', evidenceKind: receipt.evidenceKind, producer: receipt.producer,
    receiptDigest: digest(receipt), producerDigest: provenance.producerDigest, contractDigest: contractDigest() };
  files['receipt-index.json'] = `${canonical({ schemaVersion: 'ci-producer-index/1', ...summary,
    producerAuthenticity: 'UNVERIFIED', sourceBinding: 'SUPPLIED_SOURCE_OBSERVATION', releaseAdmission: 'UNVERIFIED', deliveryState: 'NOT_ATTEMPTED',
    files: Object.entries(files).map(([path, value]) => ({ path, sha256: hash(value) })) })}\n`;
  mkdirSync(outputDirectory, { mode: 0o700 });
  for (const [name, value] of Object.entries(files)) writeFileSync(join(outputDirectory, name), value, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(outputDirectory, 'SHA256SUMS'), `${Object.keys(files).sort().map((file) => `${hash(files[file])}  ${file}`).join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  return summary;
}
