import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_JOB_LEDGER_SCOPE = Object.freeze({
  tenantId: 'teams-core-system',
  requesterId: 'agent-job-ledger',
  conversationId: 'global',
});

const EXPORT_SCHEMA = 'teamsapp.azure-state-export.v1';
const RECORD_SCHEMA = 'teamsapp.runtime-record-export.v1';
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
const SAFE_CREDENTIAL_METADATA_KEYS = new Set([
  'accountkeyreference',
  'apikeyreference',
  'authorizationscheme',
  'authorizationstatus',
  'authorizationurl',
  'connectionstatus',
  'credentialpolicyname',
  'credentialreference',
  'credentialstatus',
  'passwordpolicy',
  'passwordpolicyname',
  'secretpolicyname',
  'secretreference',
  'secretrotationpolicy',
  'secreturi',
  'tokenbudget',
  'tokenconfigured',
  'tokencount',
  'tokenenabled',
  'tokenexpiresat',
  'tokenid',
  'tokenname',
  'tokenpolicy',
  'tokenpolicyname',
  'tokenpresent',
  'tokenref',
  'tokenreference',
  'tokenscheme',
  'tokenstate',
  'tokenstatus',
  'tokentype',
  'tokenversion',
]);
const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/iu,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/iu,
  /PuTTY-User-Key-File-[0-9]+:/iu,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/iu,
  /\b(?:sk|xai)-[A-Za-z0-9_-]{16,}/u,
  /\b(?:ghp|github_pat|glpat)_[A-Za-z0-9_-]{16,}/u,
  /\bya29\.[A-Za-z0-9_-]{16,}/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u,
  /\b(?:AccountKey|SharedAccessKey|SharedAccessSignature)\s*=\s*[^;\s]{8,}/iu,
  /(?:^|[?&;])sig=[^&;\s]{8,}(?:[&;]|$)/iu,
  /(?:^|[?&;,\s{])["']?(?:access[\s_-]*token|refresh[\s_-]*token|bearer[\s_-]*token|client[\s_-]*secret|account[\s_-]*key|shared[\s_-]*access[\s_-]*(?:key|signature)|authorization|password|secret|token)["']?\s*[:=]\s*["']?[^"'&;,\s}]{8,}/iu,
];
const AGENT_TEXT_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

export function stableMigrationJson(value) {
  const seen = new Set();
  const normalize = (candidate) => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new Error('Migration value must contain only finite numbers.');
      return candidate;
    }
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Migration value must be JSON serializable.');
    }
    if (seen.has(candidate)) throw new Error('Migration value must not contain cycles.');
    seen.add(candidate);
    const output = Object.create(null);
    for (const key of Object.keys(candidate).sort()) {
      if (candidate[key] === undefined) throw new Error('Migration value must not contain undefined.');
      output[key] = normalize(candidate[key]);
    }
    seen.delete(candidate);
    return output;
  };
  return JSON.stringify(normalize(value));
}

export function migrationSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export const AGENT_JOB_LEDGER_PARTITION_KEY = `scope-${migrationSha256(stableMigrationJson([
  AGENT_JOB_LEDGER_SCOPE.tenantId,
  AGENT_JOB_LEDGER_SCOPE.requesterId,
  AGENT_JOB_LEDGER_SCOPE.conversationId,
]))}`;

function assertIdentifier(value, field, maxLength = 256) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxLength
    || value.trim() !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`Malformed AgentJob: ${field} must be a non-empty bounded identifier.`);
  }
}

function assertAgentText(value, field, maxLength, { optional = false } = {}) {
  if (value === undefined && optional) return;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxLength
    || value.trim() === ''
    || AGENT_TEXT_CONTROL_CHARACTERS.test(value)
  ) {
    throw new Error(`Malformed AgentJob: ${field} must be non-empty text no longer than ${maxLength} characters.`);
  }
}

function assertTimestamp(value, field) {
  if (typeof value !== 'string' || !value || new Date(value).toISOString() !== value) {
    throw new Error(`Malformed AgentJob: ${field} must be a canonical ISO timestamp.`);
  }
}

function keyWords(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function isSafeCredentialMetadataKey(normalized) {
  return SAFE_CREDENTIAL_METADATA_KEYS.has(normalized);
}

function isSensitiveCredentialKey(key) {
  const words = keyWords(key);
  const normalized = words.join('');
  if (isSafeCredentialMetadataKey(normalized)) return false;
  if (
    /(?:connectionstrings?|accountkeys?|accesskeys?|sharedaccesskeys?|sharedaccesssignatures?|privatekeys?|clientsecrets?|apikeys?|devicecodes?|authjson)/u.test(normalized)
  ) return true;
  return words.some((word) => [
    'authorization', 'credential', 'credentials', 'password', 'passwords', 'secret', 'secrets', 'token', 'tokens',
  ].includes(word));
}

export function assertNoSensitiveMaterial(value, location = 'record', seen = new Set()) {
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new Error(`Sensitive credential material detected at ${location}.`);
    }
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (!value || typeof value !== 'object') throw new Error(`Malformed migration value at ${location}.`);
  if (seen.has(value)) throw new Error(`Malformed cyclic migration value at ${location}.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveMaterial(entry, `${location}[${index}]`, seen));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveCredentialKey(key)) throw new Error(`Sensitive credential field detected at ${location}.${key}.`);
      assertNoSensitiveMaterial(entry, `${location}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function validateAgentJobs(jobs) {
  if (!Array.isArray(jobs)) throw new Error('Malformed AgentJob export source: expected a JSON array.');
  const ids = new Set();
  const byId = new Map();
  const idempotencyScopes = new Set();
  for (const [index, job] of jobs.entries()) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      throw new Error(`Malformed AgentJob record ${index}: expected an object.`);
    }
    assertIdentifier(job.id, `record ${index} id`, 200);
    assertIdentifier(job.tenantId, `record ${index} tenantId`);
    assertIdentifier(job.requesterId, `record ${index} requesterId`);
    assertIdentifier(job.conversationId, `record ${index} conversationId`);
    assertAgentText(job.prompt, `record ${index} prompt`, 2_000);
    if (!['read-only', 'workspace-write'].includes(job.mode)) {
      throw new Error(`Malformed AgentJob: record ${index} mode is invalid.`);
    }
    if (!['queued', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled'].includes(job.status)) {
      throw new Error(`Malformed AgentJob: record ${index} status is invalid.`);
    }
    if (job.provider !== undefined && !['codex', 'copilot'].includes(job.provider)) {
      throw new Error(`Malformed AgentJob: record ${index} provider is invalid.`);
    }
    if (ids.has(job.id)) throw new Error(`Duplicate AgentJob ID: ${job.id}.`);
    ids.add(job.id);
    byId.set(job.id, job);
    if (!Array.isArray(job.progress) || job.progress.length > 100) {
      throw new Error(`Malformed AgentJob: record ${index} progress must be a string array.`);
    }
    job.progress.forEach((entry, entryIndex) => assertAgentText(entry, `record ${index} progress[${entryIndex}]`, 2_000));
    assertAgentText(job.result, `record ${index} result`, 20_000, { optional: true });
    assertAgentText(job.error, `record ${index} error`, 10_000, { optional: true });
    assertAgentText(job.commitMessage, `record ${index} commitMessage`, 2_000, { optional: true });
    if (job.status === 'completed' && !job.result) {
      throw new Error(`Malformed AgentJob: completed record ${index} must contain a result.`);
    }
    if (job.parentJobId !== undefined) assertAgentText(job.parentJobId, `record ${index} parentJobId`, 200);
    if (job.threadId !== undefined) assertAgentText(job.threadId, `record ${index} threadId`, 200);
    if (job.commitHash !== undefined) assertAgentText(job.commitHash, `record ${index} commitHash`, 200);
    if (job.changedPaths !== undefined) {
      if (!Array.isArray(job.changedPaths) || job.changedPaths.length > 256) {
        throw new Error(`Malformed AgentJob: record ${index} changedPaths must be a bounded array.`);
      }
      const changedPaths = new Set();
      for (const [pathIndex, changedPath] of job.changedPaths.entries()) {
        assertAgentText(changedPath, `record ${index} changedPaths[${pathIndex}]`, 512);
        if (changedPaths.has(changedPath)) throw new Error(`Malformed AgentJob: record ${index} changedPaths must be unique.`);
        changedPaths.add(changedPath);
      }
    }
    assertTimestamp(job.createdAt, `record ${index} createdAt`);
    if (job.startedAt !== undefined) assertTimestamp(job.startedAt, `record ${index} startedAt`);
    if (job.finishedAt !== undefined) assertTimestamp(job.finishedAt, `record ${index} finishedAt`);
    if (job.idempotencyKey !== undefined || job.requestHash !== undefined) {
      assertIdentifier(job.idempotencyKey, `record ${index} idempotencyKey`);
      if (typeof job.requestHash !== 'string' || !SHA256_PATTERN.test(job.requestHash)) {
        throw new Error(`Malformed AgentJob: record ${index} requestHash must be a SHA-256 digest.`);
      }
      const scopedKey = stableMigrationJson([job.tenantId, job.requesterId, job.conversationId, job.idempotencyKey]);
      if (idempotencyScopes.has(scopedKey)) {
        throw new Error(`Duplicate AgentJob idempotency key within tenant scope at record ${index}.`);
      }
      idempotencyScopes.add(scopedKey);
    }
    assertNoSensitiveMaterial(job, `record ${index}`);
    stableMigrationJson(job);
  }
  for (const [index, job] of jobs.entries()) {
    if (!job.parentJobId) continue;
    const parent = byId.get(job.parentJobId);
    if (!parent) continue;
    if (
      parent.tenantId !== job.tenantId
      || parent.requesterId !== job.requesterId
      || parent.conversationId !== job.conversationId
    ) {
      throw new Error(`AgentJob record ${index} parent belongs to a different tenant scope.`);
    }
  }
}

function recordStableId(record) {
  return `${record.kind}/${record.document.id}`;
}

function recordsText(records) {
  return records.map((record) => stableMigrationJson(record)).join('\n') + (records.length > 0 ? '\n' : '');
}

function withoutBundleDigest(manifest) {
  const { bundleSha256: _digest, ...unsigned } = manifest;
  return unsigned;
}

function finalizeBundle({ records, sourceCommit, exportedAt, sourceKind }) {
  if (!COMMIT_PATTERN.test(sourceCommit ?? '')) throw new Error('Source commit must be a lowercase full Git OID.');
  assertTimestamp(exportedAt, 'exportedAt');
  const sorted = [...records].sort((left, right) => recordStableId(left).localeCompare(recordStableId(right)));
  const stableIds = sorted.map(recordStableId);
  if (new Set(stableIds).size !== stableIds.length) throw new Error('Duplicate stable IDs in migration bundle.');
  const tenantCounts = new Map();
  for (const record of sorted) {
    const tenant = record.document.value.tenantId;
    tenantCounts.set(tenant, (tenantCounts.get(tenant) ?? 0) + 1);
  }
  const byTenant = Object.fromEntries([...tenantCounts.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const contentHashes = sorted.map((record) => record.contentHash);
  const manifest = {
    schemaVersion: EXPORT_SCHEMA,
    exportedAt,
    source: { kind: sourceKind, commit: sourceCommit },
    schemaVersions: { agentJob: 'agent-job.v1', runtimeRecord: 'runtime-record.v1' },
    recordCounts: { agentJobs: sorted.length, byTenant, total: sorted.length },
    stableIds,
    stableIdsSha256: migrationSha256(stableMigrationJson(stableIds)),
    contentHashesSha256: migrationSha256(stableMigrationJson(contentHashes)),
    recordsSha256: migrationSha256(recordsText(sorted)),
  };
  manifest.bundleSha256 = migrationSha256(stableMigrationJson(manifest));
  return { manifest, records: sorted };
}

export function createAgentJobExportBundle({
  jobs,
  sourceCommit,
  exportedAt = new Date().toISOString(),
  sourceKind = 'local-agent-job-store',
}) {
  validateAgentJobs(jobs);
  const records = jobs.map((job) => {
    const value = structuredClone(job);
    const canonicalValue = stableMigrationJson(value);
    const contentHash = migrationSha256(canonicalValue);
    const updatedAt = job.finishedAt ?? job.startedAt ?? job.createdAt;
    const document = {
      id: job.id,
      ...AGENT_JOB_LEDGER_SCOPE,
      partitionKey: AGENT_JOB_LEDGER_PARTITION_KEY,
      idempotencyKey: `agent-job:${contentHash}`,
      contentHash,
      value,
      etag: '',
      createdAt: job.createdAt,
      updatedAt,
    };
    return {
      schemaVersion: RECORD_SCHEMA,
      kind: 'agent-job',
      scope: { ...AGENT_JOB_LEDGER_SCOPE },
      id: job.id,
      contentHash,
      canonicalValue,
      document,
    };
  });
  return finalizeBundle({ records, sourceCommit, exportedAt, sourceKind });
}

export function createRuntimeSnapshotBundle({ documents, sourceCommit, exportedAt = new Date().toISOString() }) {
  if (!Array.isArray(documents)) throw new Error('Azure snapshot documents must be an array.');
  const records = documents.map((document, index) => {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new Error(`Malformed Azure snapshot document ${index}.`);
    }
    if (
      document.tenantId !== AGENT_JOB_LEDGER_SCOPE.tenantId
      || document.requesterId !== AGENT_JOB_LEDGER_SCOPE.requesterId
      || document.conversationId !== AGENT_JOB_LEDGER_SCOPE.conversationId
      || document.partitionKey !== AGENT_JOB_LEDGER_PARTITION_KEY
    ) {
      throw new Error(`Azure snapshot document ${index} uses an unexpected ledger scope.`);
    }
    assertIdentifier(document.id, `snapshot document ${index} id`);
    const applicationDocument = structuredClone(document);
    const canonicalValue = stableMigrationJson(applicationDocument.value);
    const contentHash = migrationSha256(canonicalValue);
    if (applicationDocument.contentHash !== contentHash) {
      throw new Error(`Azure snapshot document ${index} content hash is invalid.`);
    }
    assertNoSensitiveMaterial(applicationDocument, `snapshot document ${index}`);
    return {
      schemaVersion: RECORD_SCHEMA,
      kind: 'agent-job',
      scope: { ...AGENT_JOB_LEDGER_SCOPE },
      id: applicationDocument.id,
      contentHash,
      canonicalValue,
      document: applicationDocument,
    };
  });
  validateAgentJobs(records.map((record) => record.document.value));
  return finalizeBundle({
    records,
    sourceCommit,
    exportedAt,
    sourceKind: 'azure-pre-import-snapshot',
  });
}

export function validateMigrationBundle(bundle) {
  assertNoSensitiveMaterial(bundle, 'migration bundle');
  if (!bundle || typeof bundle !== 'object' || !bundle.manifest || !Array.isArray(bundle.records)) {
    throw new Error('Malformed migration bundle.');
  }
  const { manifest, records } = bundle;
  if (manifest.schemaVersion !== EXPORT_SCHEMA) throw new Error('Unsupported migration bundle schema version.');
  if (!COMMIT_PATTERN.test(manifest.source?.commit ?? '')) throw new Error('Migration bundle source commit is invalid.');
  if (manifest.schemaVersions?.agentJob !== 'agent-job.v1' || manifest.schemaVersions?.runtimeRecord !== 'runtime-record.v1') {
    throw new Error('Migration bundle record schema versions are invalid.');
  }
  const ids = new Set();
  const jobs = [];
  for (const [index, record] of records.entries()) {
    if (record?.schemaVersion !== RECORD_SCHEMA || record.kind !== 'agent-job') {
      throw new Error(`Malformed migration record ${index}.`);
    }
    const stableId = recordStableId(record);
    if (ids.has(stableId)) throw new Error(`Duplicate stable ID in migration bundle: ${stableId}.`);
    ids.add(stableId);
    if (stableMigrationJson(record.scope) !== stableMigrationJson(AGENT_JOB_LEDGER_SCOPE)) {
      throw new Error(`Migration record ${index} escaped the durable ledger scope.`);
    }
    const document = record.document;
    if (!document || document.id !== record.id || document.contentHash !== record.contentHash) {
      throw new Error(`Migration record ${index} document identity or content hash is inconsistent.`);
    }
    if (stableMigrationJson(document.value) !== record.canonicalValue) {
      throw new Error(`Migration record ${index} canonical value mismatch.`);
    }
    if (
      document.tenantId !== AGENT_JOB_LEDGER_SCOPE.tenantId
      || document.requesterId !== AGENT_JOB_LEDGER_SCOPE.requesterId
      || document.conversationId !== AGENT_JOB_LEDGER_SCOPE.conversationId
      || document.partitionKey !== AGENT_JOB_LEDGER_PARTITION_KEY
    ) {
      throw new Error(`Migration record ${index} runtime document scope mismatch.`);
    }
    if (migrationSha256(record.canonicalValue) !== record.contentHash) {
      throw new Error(`Migration record ${index} content hash mismatch.`);
    }
    jobs.push(document.value);
  }
  validateAgentJobs(jobs);
  const rebuilt = finalizeBundle({
    records,
    sourceCommit: manifest.source.commit,
    exportedAt: manifest.exportedAt,
    sourceKind: manifest.source.kind,
  });
  if (stableMigrationJson(rebuilt.manifest) !== stableMigrationJson(manifest)) {
    throw new Error('Migration bundle manifest counts, IDs, or digests do not match its records.');
  }
  return bundle;
}

export async function writeMigrationBundle(outputDirectory, bundle) {
  validateMigrationBundle(bundle);
  const resolved = path.resolve(outputDirectory);
  let created = false;
  try {
    await fs.mkdir(resolved, { recursive: false, mode: 0o700 });
    created = true;
    await fs.writeFile(path.join(resolved, 'records.ndjson'), recordsText(bundle.records), { flag: 'wx', mode: 0o400 });
    await fs.writeFile(path.join(resolved, 'manifest.json'), `${JSON.stringify(bundle.manifest, null, 2)}\n`, { flag: 'wx', mode: 0o400 });
    await fs.chmod(resolved, 0o500);
  } catch (error) {
    if (created) {
      await fs.chmod(resolved, 0o700).catch(() => {});
      await fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
    }
    if (error?.code === 'EEXIST') throw new Error(`Immutable migration output already exists: ${resolved}.`);
    throw error;
  }
  return resolved;
}

export async function readMigrationBundle(bundleDirectory) {
  const resolved = path.resolve(bundleDirectory);
  const manifestPath = path.join(resolved, 'manifest.json');
  const recordsPath = path.join(resolved, 'records.ndjson');
  const [manifestStat, recordsStat] = await Promise.all([fs.stat(manifestPath), fs.stat(recordsPath)]);
  if (!manifestStat.isFile() || !recordsStat.isFile() || manifestStat.size + recordsStat.size > MAX_BUNDLE_BYTES) {
    throw new Error('Migration bundle files are missing or exceed the size boundary.');
  }
  const [manifestRaw, recordsRaw] = await Promise.all([
    fs.readFile(manifestPath, 'utf8'),
    fs.readFile(recordsPath, 'utf8'),
  ]);
  const records = recordsRaw.trim() ? recordsRaw.trimEnd().split('\n').map((line) => JSON.parse(line)) : [];
  return validateMigrationBundle({ manifest: JSON.parse(manifestRaw), records });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--source') options.source = argv[++index];
    else if (argument === '--output') options.output = argv[++index];
    else if (argument === '--source-commit') options.sourceCommit = argv[++index];
    else throw new Error(`Unknown export argument: ${argument}`);
  }
  if (!options.output) throw new Error('Usage: node scripts/azure-state-export.mjs --output <immutable-directory> [--source <agent-jobs.json>] [--source-commit <git-oid>]');
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sourcePath = path.resolve(options.source ?? process.env.AGENT_JOB_STORE_PATH ?? path.join(root, 'data', 'agent-jobs.json'));
  const sourceCommit = options.sourceCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceStat = await fs.stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size > MAX_BUNDLE_BYTES) throw new Error('AgentJob source must be a bounded regular file.');
  const jobs = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const bundle = createAgentJobExportBundle({ jobs, sourceCommit });
  const output = await writeMigrationBundle(options.output, bundle);
  console.log(JSON.stringify({
    status: 'EXPORTED',
    evidenceClass: 'local-contract',
    output,
    sourceCommit,
    recordCounts: bundle.manifest.recordCounts,
    bundleSha256: bundle.manifest.bundleSha256,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'BLOCKED', blocker: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
