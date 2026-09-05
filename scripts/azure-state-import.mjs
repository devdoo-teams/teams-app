import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_JOB_LEDGER_SCOPE,
  AGENT_JOB_LEDGER_PARTITION_KEY,
  assertNoSensitiveMaterial,
  createRuntimeSnapshotBundle,
  migrationSha256,
  readMigrationBundle,
  stableMigrationJson,
  validateMigrationBundle,
  writeMigrationBundle,
} from './azure-state-export.mjs';

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [100, 200];
const AUTHENTICATED_AZURE_TARGET = Symbol('authenticated-azure-migration-target');
const DURABLE_RECEIPT_WRITERS = new WeakSet();
const IMMUTABLE_SNAPSHOT_WRITERS = new WeakSet();
const VERIFIED_ORIGINATING_IMPORT_RECEIPTS = new WeakMap();

function migrationHttpStatusCode(error) {
  for (const candidate of [error?.statusCode, error?.code]) {
    const parsed = typeof candidate === 'string' && /^\d{3}$/u.test(candidate)
      ? Number(candidate)
      : candidate;
    if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed;
  }
  return undefined;
}

function createFailureMayHaveCommitted(error) {
  const statusCode = migrationHttpStatusCode(error);
  return statusCode === undefined || TRANSIENT_STATUS_CODES.has(statusCode);
}

function declaredMigrationTargetBinding(target) {
  const authenticatedBinding = target?.[AUTHENTICATED_AZURE_TARGET];
  const localBinding = target?.migrationTargetBinding;
  const binding = authenticatedBinding ?? localBinding;
  if (!binding) return undefined;
  assertNoSensitiveMaterial(binding, 'migration target binding');
  const canonical = stableMigrationJson(binding);
  if (Buffer.byteLength(canonical, 'utf8') > 4096) {
    throw new Error('Migration target binding exceeds the 4 KiB safety limit.');
  }
  return structuredClone(binding);
}

export function classifyMigrationTarget(target) {
  const authenticated = Boolean(target?.[AUTHENTICATED_AZURE_TARGET]);
  const targetBinding = declaredMigrationTargetBinding(target);
  return targetBinding
    ? {
      evidenceClass: 'local-contract',
      targetObservation: authenticated ? 'AZURE_DEFAULT_CREDENTIAL_CLIENT_UNATTESTED' : 'LOCAL_FIXTURE',
      targetBinding,
    }
    : { evidenceClass: 'local-contract', targetObservation: target ? 'LOCAL_FIXTURE' : 'UNVERIFIED' };
}

function assertTargetDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Azure migration target returned a malformed document.');
  }
  if (
    document.tenantId !== AGENT_JOB_LEDGER_SCOPE.tenantId
    || document.requesterId !== AGENT_JOB_LEDGER_SCOPE.requesterId
    || document.conversationId !== AGENT_JOB_LEDGER_SCOPE.conversationId
  ) {
    throw new Error(`Azure migration target document ${document.id ?? '<unknown>'} escaped the AgentJob ledger scope.`);
  }
}

function documentsEqual(current, wanted) {
  return current.id === wanted.id
    && current.partitionKey === wanted.partitionKey
    && current.tenantId === wanted.tenantId
    && current.requesterId === wanted.requesterId
    && current.conversationId === wanted.conversationId
    && current.contentHash === wanted.contentHash
    && stableMigrationJson(current.value) === stableMigrationJson(wanted.value);
}

function documentsExactlyEqual(current, wanted) {
  return stableMigrationJson(current) === stableMigrationJson(wanted);
}

async function retry(operation, { maxAttempts, delay }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_STATUS_CODES.has(migrationHttpStatusCode(error)) || attempt === maxAttempts) throw error;
      await delay(DEFAULT_RETRY_DELAYS_MS[Math.min(attempt - 1, DEFAULT_RETRY_DELAYS_MS.length - 1)]);
    }
  }
  throw lastError;
}

function migrationPlan(bundle, currentDocuments) {
  const current = new Map();
  for (const document of currentDocuments) {
    assertTargetDocument(document);
    if (current.has(document.id)) throw new Error(`Azure migration target returned duplicate ID ${document.id}.`);
    current.set(document.id, document);
  }
  const creates = [];
  const unchanged = [];
  const conflicts = [];
  for (const record of bundle.records) {
    const existing = current.get(record.document.id);
    if (!existing) creates.push(record);
    else if (documentsEqual(existing, record.document)) unchanged.push(record);
    else conflicts.push(recordStableId(record));
  }
  return { creates, unchanged, conflicts, currentDocuments };
}

function recordStableId(record) {
  return `${record.kind}/${record.document.id}`;
}

function targetStableId(id) {
  return `agent-job/${id}`;
}

function documentSha256(document) {
  return migrationSha256(stableMigrationJson(document));
}

function assertEtag(etag, location) {
  if (
    typeof etag !== 'string'
    || etag.length === 0
    || etag.length > 1024
    || /[\u0000-\u001f\u007f-\u009f]/u.test(etag)
  ) {
    throw new Error(`${location} must contain a non-empty bounded concurrency ETag.`);
  }
}

function targetBindingsEqual(left, right) {
  return left !== undefined
    && right !== undefined
    && stableMigrationJson(left) === stableMigrationJson(right);
}

function migrationSafetyError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createImportOwnership(record, observation) {
  const document = observation?.document;
  const etag = observation?.etag;
  assertTargetDocument(document);
  assertEtag(etag, `Import post-image ${recordStableId(record)}`);
  if (!documentsExactlyEqual(document, record.document)) {
    throw migrationSafetyError(
      `Import post-image ${recordStableId(record)} does not exactly match the requested document.`,
      'MIGRATION_POST_IMAGE_UNVERIFIED',
    );
  }
  return {
    action: 'create',
    stableId: recordStableId(record),
    id: document.id,
    partitionKey: document.partitionKey,
    postImageSha256: documentSha256(document),
    etag,
  };
}

function migrationPersistenceError(message, code, receipt, cause) {
  const error = new Error(message, { cause });
  error.code = code;
  error.operationId = receipt?.operationId;
  error.requestSha256 = receipt?.requestSha256;
  error.recoveryRequired = code === 'MIGRATION_RECOVERY_REQUIRED';
  return error;
}

async function persistMutationProgress(persistReceipt, receipt, { mutationMayHaveCommitted = false } = {}) {
  if (typeof persistReceipt !== 'function' || !DURABLE_RECEIPT_WRITERS.has(persistReceipt)) {
    throw new Error('A durable immutable receipt ledger writer is required for every mutating invocation.');
  }
  try {
    await persistReceipt(structuredClone(receipt));
  } catch (cause) {
    if (mutationMayHaveCommitted) {
      throw migrationPersistenceError(
        `Migration receipt persistence failed after a target mutation may have committed; operation ${receipt.operationId} requires ledger inspection and reconciliation before retry.`,
        'MIGRATION_RECOVERY_REQUIRED',
        receipt,
        cause,
      );
    }
    throw migrationPersistenceError(
      `Migration receipt persistence failed before the next target mutation for operation ${receipt.operationId}.`,
      'MIGRATION_RECEIPT_PERSIST_FAILED',
      receipt,
      cause,
    );
  }
}

function mutationFailureCode(error) {
  const statusCode = migrationHttpStatusCode(error);
  return statusCode ? `HTTP_${statusCode}` : 'MUTATION_FAILED';
}

export async function importMigrationBundle({
  bundle,
  target,
  apply = false,
  resumeImportReceipt,
  resumeSnapshot,
  maxAttempts = 3,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  writeSnapshot,
  persistReceipt,
}) {
  validateMigrationBundle(bundle);
  const resumeRequested = resumeImportReceipt !== undefined || resumeSnapshot !== undefined;
  if (resumeRequested && (!resumeImportReceipt || !resumeSnapshot)) {
    throw new Error('Import resume requires both the verified previous import receipt and its original snapshot.');
  }
  if (resumeRequested && !apply) {
    throw new Error('Import resume is only available for an explicit apply retry.');
  }
  if (resumeSnapshot) validateMigrationBundle(resumeSnapshot);
  const provenance = classifyMigrationTarget(target);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error('Migration maxAttempts must be an integer from 1 through 5.');
  }
  if (!target) {
    if (apply) throw new Error('An Azure migration target is required for --apply.');
    return {
      schemaVersion: 1,
      status: 'DRY_RUN',
      ...provenance,
      sourceCommit: bundle.manifest.source.commit,
      bundleSha256: bundle.manifest.bundleSha256,
      plannedCreates: bundle.records.length,
      unchanged: 0,
      conflicts: [],
    };
  }

  if (apply && (typeof persistReceipt !== 'function' || !DURABLE_RECEIPT_WRITERS.has(persistReceipt))) {
    throw new Error('Apply requires a durable immutable receipt ledger writer.');
  }
  if (apply && !resumeRequested && (typeof writeSnapshot !== 'function' || !IMMUTABLE_SNAPSHOT_WRITERS.has(writeSnapshot))) {
    throw new Error('Apply requires a repository-created immutable pre-import Azure snapshot writer.');
  }
  if (resumeRequested && writeSnapshot !== undefined) {
    throw new Error('Import resume must reuse the original immutable snapshot instead of writing a new snapshot.');
  }
  if (apply && !provenance.targetBinding) {
    throw new Error('Apply requires an exact durable migration target binding.');
  }

  const currentDocuments = await target.list(bundle.records[0]?.document.partitionKey ?? expectedPartitionKey(bundle));
  const plan = migrationPlan(bundle, currentDocuments);
  if (plan.conflicts.length > 0) {
    throw new Error(`Migration target content conflict for stable IDs: ${plan.conflicts.join(', ')}.`);
  }
  if (!apply) {
    return {
      schemaVersion: 1,
      status: 'DRY_RUN',
      ...provenance,
      sourceCommit: bundle.manifest.source.commit,
      bundleSha256: bundle.manifest.bundleSha256,
      plannedCreates: plan.creates.length,
      unchanged: plan.unchanged.length,
      conflicts: [],
    };
  }
  const inheritedOwnership = resumeRequested
    ? await validateResumedImport({
      bundle,
      plan,
      provenance,
      receipt: resumeImportReceipt,
      snapshot: resumeSnapshot,
      target,
    })
    : [];
  const snapshot = resumeRequested
    ? structuredClone(resumeSnapshot)
    : createRuntimeSnapshotBundle({
      documents: currentDocuments,
      sourceCommit: bundle.manifest.source.commit,
    });
  if (!resumeRequested) await writeSnapshot(snapshot);

  const receipt = {
    schemaVersion: 1,
    operationId: crypto.randomUUID(),
    operation: 'IMPORT',
    status: 'IN_PROGRESS',
    ...provenance,
    sourceCommit: bundle.manifest.source.commit,
    bundleSha256: bundle.manifest.bundleSha256,
    snapshotBundleSha256: snapshot.manifest.bundleSha256,
    ...(resumeRequested ? {
      resumedFromImportOperationId: resumeImportReceipt.operationId,
      resumedFromImportReceiptSha256: resumeImportReceipt.ledgerIntegrity.entrySha256,
    } : {}),
    planned: { creates: plan.creates.length, unchanged: plan.unchanged.length },
    completedIds: inheritedOwnership.map(({ stableId }) => stableId),
    failedIds: [],
    ownedMutations: inheritedOwnership,
    progress: [],
    inFlight: null,
    reconciliationRequired: true,
  };
  receipt.requestSha256 = migrationSha256(stableMigrationJson({
    operation: receipt.operation,
    sourceCommit: receipt.sourceCommit,
    bundleSha256: receipt.bundleSha256,
    snapshotBundleSha256: receipt.snapshotBundleSha256,
    targetBinding: receipt.targetBinding,
    ...(resumeRequested ? {
      resumedFromImportOperationId: receipt.resumedFromImportOperationId,
      resumedFromImportReceiptSha256: receipt.resumedFromImportReceiptSha256,
    } : {}),
    plannedCreates: plan.creates.map(recordStableId),
    unchanged: plan.unchanged.map(recordStableId),
  }));
  await persistMutationProgress(persistReceipt, receipt);
  for (const record of plan.creates) {
    const stableId = recordStableId(record);
    receipt.inFlight = { action: 'create', stableId };
    await persistMutationProgress(persistReceipt, receipt);
    let createMayHaveCommitted = false;
    try {
      const observation = await retry(async () => {
        try {
          return await target.create(structuredClone(record.document));
        } catch (error) {
          createMayHaveCommitted ||= createFailureMayHaveCommitted(error);
          throw error;
        }
      }, { maxAttempts, delay });
      let ownership;
      try {
        ownership = createImportOwnership(record, observation);
      } catch (cause) {
        throw migrationPersistenceError(
          `Import mutation ${stableId} may have committed without a verified post-image hash and concurrency ETag.`,
          'MIGRATION_RECOVERY_REQUIRED',
          receipt,
          cause,
        );
      }
      receipt.completedIds.push(stableId);
      receipt.ownedMutations.push(ownership);
      receipt.progress.push({ action: 'create', stableId, status: 'COMPLETED' });
    } catch (error) {
      if (error?.recoveryRequired) throw error;
      if (createMayHaveCommitted) {
        throw migrationPersistenceError(
          `Import mutation ${stableId} may have committed without verified ownership evidence; inspect the immutable ledger and reconcile the target before retry.`,
          'MIGRATION_RECOVERY_REQUIRED',
          receipt,
          error,
        );
      }
      receipt.failedIds.push(stableId);
      receipt.progress.push({ action: 'create', stableId, status: 'FAILED', failureCode: mutationFailureCode(error) });
      receipt.status = 'PARTIAL';
    }
    receipt.inFlight = null;
    await persistMutationProgress(persistReceipt, receipt, { mutationMayHaveCommitted: true });
  }
  receipt.status = receipt.failedIds.length === 0 ? 'APPLIED' : 'PARTIAL';
  receipt.created = receipt.completedIds.length;
  receipt.unchanged = plan.unchanged.length;
  receipt.final = true;
  await persistMutationProgress(persistReceipt, receipt, { mutationMayHaveCommitted: plan.creates.length > 0 });
  return structuredClone(receipt);
}

function validateOriginatingImportReceipt({ receipt, snapshot, provenance }) {
  const verifiedReceiptSha256 = receipt && typeof receipt === 'object'
    ? VERIFIED_ORIGINATING_IMPORT_RECEIPTS.get(receipt)
    : undefined;
  if (!verifiedReceiptSha256) {
    throw migrationSafetyError(
      'Rollback requires the originating import receipt loaded from its verified immutable ledger.',
      'MIGRATION_IMPORT_RECEIPT_UNVERIFIED',
    );
  }
  const unhashedReceipt = structuredClone(receipt);
  delete unhashedReceipt.ledgerIntegrity?.entrySha256;
  if (
    receipt.ledgerIntegrity?.entrySha256 !== verifiedReceiptSha256
    || migrationSha256(stableMigrationJson(unhashedReceipt)) !== verifiedReceiptSha256
  ) {
    throw migrationSafetyError(
      'Originating import receipt was modified after immutable ledger verification.',
      'MIGRATION_IMPORT_RECEIPT_UNVERIFIED',
    );
  }
  assertNoSensitiveMaterial(receipt, 'originating import receipt');
  if (
    receipt.operation !== 'IMPORT'
    || receipt.final !== true
    || !['APPLIED', 'PARTIAL'].includes(receipt.status)
    || !/^[0-9a-f-]{36}$/u.test(receipt.operationId ?? '')
    || !/^[0-9a-f]{64}$/u.test(receipt.requestSha256 ?? '')
  ) {
    throw migrationSafetyError(
      'Rollback requires a terminal originating IMPORT receipt.',
      'MIGRATION_IMPORT_RECEIPT_UNVERIFIED',
    );
  }
  if (
    receipt.sourceCommit !== snapshot.manifest.source.commit
    || receipt.snapshotBundleSha256 !== snapshot.manifest.bundleSha256
  ) {
    throw migrationSafetyError(
      'Originating import receipt does not bind the exact rollback snapshot.',
      'MIGRATION_RECEIPT_SNAPSHOT_MISMATCH',
    );
  }
  if (!targetBindingsEqual(receipt.targetBinding, provenance.targetBinding)) {
    throw migrationSafetyError(
      'Originating import receipt does not bind the exact rollback target.',
      'MIGRATION_RECEIPT_TARGET_MISMATCH',
    );
  }
  if (!Array.isArray(receipt.completedIds) || !Array.isArray(receipt.ownedMutations)) {
    throw migrationSafetyError(
      'Originating import receipt lacks per-record import ownership evidence.',
      'MIGRATION_IMPORT_RECEIPT_UNVERIFIED',
    );
  }
  const completedIds = [...receipt.completedIds].sort();
  const ownershipIds = receipt.ownedMutations.map(({ stableId }) => stableId).sort();
  if (
    new Set(completedIds).size !== completedIds.length
    || new Set(ownershipIds).size !== ownershipIds.length
    || stableMigrationJson(completedIds) !== stableMigrationJson(ownershipIds)
  ) {
    throw migrationSafetyError(
      'Originating import receipt ownership entries do not exactly match completed import mutations.',
      'MIGRATION_IMPORT_RECEIPT_UNVERIFIED',
    );
  }
  const snapshotIds = new Set(snapshot.records.map(({ document }) => document.id));
  const ownership = receipt.ownedMutations.map((entry) => {
    if (
      entry?.action !== 'create'
      || typeof entry.id !== 'string'
      || entry.stableId !== targetStableId(entry.id)
      || typeof entry.partitionKey !== 'string'
      || !/^[0-9a-f]{64}$/u.test(entry.postImageSha256 ?? '')
      || snapshotIds.has(entry.id)
    ) {
      throw migrationSafetyError(
        `Originating import receipt contains malformed ownership evidence for ${entry?.stableId ?? '<unknown>'}.`,
        'MIGRATION_IMPORT_RECEIPT_UNVERIFIED',
      );
    }
    assertEtag(entry.etag, `Import ownership ${entry.stableId}`);
    return structuredClone(entry);
  });
  return ownership;
}

async function validateResumedImport({ bundle, plan, provenance, receipt, snapshot, target }) {
  if (receipt.bundleSha256 !== bundle.manifest.bundleSha256) {
    throw migrationSafetyError(
      'Import resume receipt does not bind the exact migration bundle.',
      'MIGRATION_RESUME_BUNDLE_MISMATCH',
    );
  }
  const ownership = validateOriginatingImportReceipt({ receipt, snapshot, provenance });
  const ownershipObservation = await planOwnedRollback({ target, ownership });
  if (ownershipObservation.alreadyAbsent.length > 0) {
    throw migrationSafetyError(
      `Import resume refused because prior import-owned records are absent: ${ownershipObservation.alreadyAbsent.join(', ')}.`,
      'MIGRATION_OWNERSHIP_CONFLICT',
    );
  }
  const unchangedIds = new Set(plan.unchanged.map(recordStableId));
  const nonMatchingIds = ownership
    .map(({ stableId }) => stableId)
    .filter((stableId) => !unchangedIds.has(stableId));
  if (nonMatchingIds.length > 0) {
    throw migrationSafetyError(
      `Import resume refused because prior ownership does not match the current bundle: ${nonMatchingIds.join(', ')}.`,
      'MIGRATION_OWNERSHIP_CONFLICT',
    );
  }
  return ownership;
}

async function planOwnedRollback({ target, ownership }) {
  if (typeof target.read !== 'function') {
    throw migrationSafetyError(
      'Rollback target must support exact post-image and ETag reads.',
      'MIGRATION_TARGET_READ_UNAVAILABLE',
    );
  }
  const deletes = [];
  const alreadyAbsent = [];
  for (const entry of ownership) {
    const observation = await target.read(entry.id, entry.partitionKey);
    if (!observation) {
      alreadyAbsent.push(entry.stableId);
      continue;
    }
    const document = observation.document;
    const etag = observation.etag;
    assertTargetDocument(document);
    assertEtag(etag, `Rollback target ${entry.stableId}`);
    if (
      document.id !== entry.id
      || document.partitionKey !== entry.partitionKey
      || documentSha256(document) !== entry.postImageSha256
      || etag !== entry.etag
    ) {
      throw migrationSafetyError(
        `Rollback refused ${entry.stableId}: its current post-image hash or concurrency ETag is no longer import-owned.`,
        'MIGRATION_OWNERSHIP_CONFLICT',
      );
    }
    deletes.push({ ...entry, currentEtag: etag });
  }
  return { deletes, alreadyAbsent };
}

export async function rollbackMigrationSnapshot({
  snapshot,
  target,
  originatingImportReceipt,
  apply = false,
  maxAttempts = 3,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  persistReceipt,
}) {
  validateMigrationBundle(snapshot);
  if (!target) throw new Error('Rollback requires an Azure migration target.');
  if (apply && (typeof persistReceipt !== 'function' || !DURABLE_RECEIPT_WRITERS.has(persistReceipt))) {
    throw new Error('Rollback apply requires a durable immutable receipt ledger writer.');
  }
  const provenance = classifyMigrationTarget(target);
  const ownership = validateOriginatingImportReceipt({
    receipt: originatingImportReceipt,
    snapshot,
    provenance,
  });
  const plan = await planOwnedRollback({ target, ownership });
  if (!apply) {
    return {
      schemaVersion: 1,
      status: 'DRY_RUN',
      ...provenance,
      sourceCommit: snapshot.manifest.source.commit,
      snapshotBundleSha256: snapshot.manifest.bundleSha256,
      originatingImportOperationId: originatingImportReceipt.operationId,
      originatingImportRequestSha256: originatingImportReceipt.requestSha256,
      plannedDeletes: plan.deletes.length,
      plannedCreates: 0,
      plannedReplaces: 0,
      alreadyAbsent: plan.alreadyAbsent.length,
    };
  }
  const receipt = {
    schemaVersion: 1,
    operationId: crypto.randomUUID(),
    operation: 'ROLLBACK',
    status: 'IN_PROGRESS',
    ...provenance,
    sourceCommit: snapshot.manifest.source.commit,
    snapshotBundleSha256: snapshot.manifest.bundleSha256,
    originatingImportOperationId: originatingImportReceipt.operationId,
    originatingImportRequestSha256: originatingImportReceipt.requestSha256,
    originatingImportReceiptSha256: originatingImportReceipt.ledgerIntegrity.entrySha256,
    planned: { deletes: plan.deletes.length, creates: 0, replaces: 0, alreadyAbsent: plan.alreadyAbsent.length },
    completedIds: [],
    failedIds: [],
    progress: [],
    inFlight: null,
    reconciliationRequired: true,
  };
  receipt.requestSha256 = migrationSha256(stableMigrationJson({
    operation: receipt.operation,
    sourceCommit: receipt.sourceCommit,
    snapshotBundleSha256: receipt.snapshotBundleSha256,
    targetBinding: receipt.targetBinding,
    originatingImportOperationId: receipt.originatingImportOperationId,
    originatingImportRequestSha256: receipt.originatingImportRequestSha256,
    originatingImportReceiptSha256: receipt.originatingImportReceiptSha256,
    deletes: plan.deletes.map(({ stableId, postImageSha256, etag }) => ({ stableId, postImageSha256, etag })),
    alreadyAbsent: plan.alreadyAbsent,
  }));
  await persistMutationProgress(persistReceipt, receipt);
  const operations = plan.deletes.map((entry) => ({
    action: 'delete',
    stableId: entry.stableId,
    run: () => target.delete(entry.id, entry.partitionKey, { ifMatch: entry.etag }),
  }));
  for (const operation of operations) {
    receipt.inFlight = { action: operation.action, stableId: operation.stableId };
    await persistMutationProgress(persistReceipt, receipt);
    try {
      await retry(operation.run, { maxAttempts, delay });
      receipt.completedIds.push(operation.stableId);
      receipt.progress.push({ action: operation.action, stableId: operation.stableId, status: 'COMPLETED' });
    } catch (error) {
      receipt.failedIds.push(operation.stableId);
      receipt.progress.push({
        action: operation.action,
        stableId: operation.stableId,
        status: 'FAILED',
        failureCode: mutationFailureCode(error),
      });
      receipt.status = 'PARTIAL';
    }
    receipt.inFlight = null;
    await persistMutationProgress(persistReceipt, receipt, { mutationMayHaveCommitted: true });
    if (receipt.progress.at(-1)?.failureCode === 'HTTP_412') break;
  }
  receipt.status = receipt.failedIds.length === 0 ? 'ROLLED_BACK' : 'PARTIAL';
  receipt.deleted = receipt.progress.filter(({ action, status }) => action === 'delete' && status === 'COMPLETED').length;
  receipt.created = receipt.progress.filter(({ action, status }) => action === 'create' && status === 'COMPLETED').length;
  receipt.replaced = receipt.progress.filter(({ action, status }) => action === 'replace' && status === 'COMPLETED').length;
  receipt.alreadyAbsent = plan.alreadyAbsent.length;
  receipt.final = true;
  await persistMutationProgress(persistReceipt, receipt, { mutationMayHaveCommitted: operations.length > 0 });
  return structuredClone(receipt);
}

function expectedPartitionKey(bundle) {
  const first = bundle.records[0]?.document.partitionKey;
  return first ?? AGENT_JOB_LEDGER_PARTITION_KEY;
}

function requiredAzureSetting(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Azure migration target.`);
  return value;
}

export async function createAzureMigrationTarget(env = process.env) {
  for (const [name, value] of Object.entries(env)) {
    if (value?.trim() && /COSMOS.*(?:KEY|CONNECTION.?STRING)|(?:KEY|CONNECTION.?STRING).*COSMOS/iu.test(name)) {
      throw new Error(`Key-based Cosmos authentication is forbidden: ${name}.`);
    }
  }
  const endpoint = requiredAzureSetting(env, 'AZURE_COSMOS_ENDPOINT');
  const databaseId = requiredAzureSetting(env, 'AZURE_COSMOS_DATABASE');
  const containerId = requiredAzureSetting(env, 'AZURE_COSMOS_CONTAINER');
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== 'https:' || endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash) {
    throw new Error('AZURE_COSMOS_ENDPOINT must be a credential-free HTTPS URL.');
  }
  const [{ CosmosClient }, { DefaultAzureCredential }] = await Promise.all([
    import('@azure/cosmos'),
    import('@azure/identity'),
  ]);
  const credential = new DefaultAzureCredential({ managedIdentityClientId: env.AZURE_CLIENT_ID?.trim() || undefined });
  const container = new CosmosClient({ endpoint, aadCredentials: credential }).database(databaseId).container(containerId);
  const target = {
    async list(partitionKey) {
      const response = await container.items.query({
        query: 'SELECT * FROM c WHERE c.partitionKey = @partitionKey',
        parameters: [{ name: '@partitionKey', value: partitionKey }],
      }, { partitionKey }).fetchAll();
      return response.resources.map(stripCosmosSystemFields);
    },
    async create(document) {
      const response = await container.items.create(document, { disableAutomaticIdGeneration: true });
      return cosmosMutationObservation(response, 'Created');
    },
    async read(id, partitionKey) {
      try {
        const response = await container.item(id, partitionKey).read();
        if (!response.resource) return undefined;
        return cosmosMutationObservation(response, 'Read');
      } catch (error) {
        if (migrationHttpStatusCode(error) === 404) return undefined;
        throw error;
      }
    },
    async delete(id, partitionKey, { ifMatch } = {}) {
      assertEtag(ifMatch, `Delete target ${targetStableId(id)}`);
      try {
        await container.item(id, partitionKey).delete({
          accessCondition: { type: 'IfMatch', condition: ifMatch },
        });
        return { deleted: true };
      } catch (error) {
        if (migrationHttpStatusCode(error) === 404) return { absent: true };
        throw error;
      }
    },
  };
  Object.defineProperty(target, AUTHENTICATED_AZURE_TARGET, {
    value: Object.freeze({
      endpoint,
      database: databaseId,
      container: containerId,
    }),
  });
  return target;
}

function cosmosMutationObservation(response, operation) {
  const document = response?.resource;
  const etag = response?.etag ?? document?._etag;
  if (!document) {
    throw migrationSafetyError(`${operation} Cosmos document post-image is unavailable.`, 'MIGRATION_POST_IMAGE_UNVERIFIED');
  }
  assertEtag(etag, `${operation} Cosmos document`);
  return {
    document: stripCosmosSystemFields(document),
    etag,
  };
}

function stripCosmosSystemFields(document) {
  const { _rid, _self, _etag, _attachments, _ts, ...applicationDocument } = document;
  return applicationDocument;
}

async function writeAtomicImmutableJson(filePath, value) {
  const resolved = path.resolve(filePath);
  const temporary = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${process.pid}.${Date.now()}.tmp`,
  );
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.chmod(0o400);
    await handle.close();
    handle = undefined;
    await fs.link(temporary, resolved);
    await fs.unlink(temporary);
    const directory = await fs.open(path.dirname(resolved), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    if (error?.code === 'EEXIST') throw new Error(`Immutable receipt output already exists: ${resolved}.`);
    throw error;
  }
}

export async function createImmutableReceiptLedger(receiptPath) {
  if (!receiptPath?.trim()) throw new Error('A non-empty immutable receipt path is required.');
  const resolvedReceipt = path.resolve(receiptPath);
  const ledgerDirectory = `${resolvedReceipt}.ledger`;
  try {
    await fs.lstat(resolvedReceipt);
    throw new Error(`Immutable receipt output already exists: ${resolvedReceipt}.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const rejectExistingLedger = async (cause) => {
    const inspection = await inspectImmutableReceiptLedger(receiptPath);
    if (inspection.lastReceipt) {
      throw migrationPersistenceError(
        `Immutable receipt ledger is incomplete for operation ${inspection.lastReceipt.operationId ?? '<unknown>'}; inspect the ledger and reconcile the target before retry.`,
        'MIGRATION_RECOVERY_REQUIRED',
        inspection.lastReceipt,
        cause,
      );
    }
    throw new Error(`Immutable receipt ledger already exists: ${ledgerDirectory}.`);
  };
  try {
    await fs.lstat(ledgerDirectory);
    await rejectExistingLedger();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  let initialized = false;
  const ensureLedgerDirectory = async () => {
    if (initialized) return;
    try {
      await fs.mkdir(ledgerDirectory, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await rejectExistingLedger(error);
    }
    initialized = true;
  };
  let sequence = 0;
  let sealed = false;
  let previousEntrySha256 = null;
  let operationId;
  let requestSha256;
  const appendLedgerReceipt = async (receipt) => {
    const persistedReceipt = structuredClone(receipt);
    persistedReceipt.ledgerIntegrity = {
      sequence,
      previousEntrySha256,
    };
    persistedReceipt.ledgerIntegrity.entrySha256 = migrationSha256(stableMigrationJson(persistedReceipt));
    const entry = `${String(sequence).padStart(6, '0')}.json`;
    await writeAtomicImmutableJson(path.join(ledgerDirectory, entry), persistedReceipt);
    previousEntrySha256 = persistedReceipt.ledgerIntegrity.entrySha256;
    sequence += 1;
    return persistedReceipt;
  };
  const persistReceipt = async (receipt) => {
    await ensureLedgerDirectory();
    if (sealed) throw new Error(`Immutable receipt ledger is already sealed: ${ledgerDirectory}.`);
    assertNoSensitiveMaterial(receipt, 'migration receipt');
    if (!/^[0-9a-f-]{36}$/u.test(receipt?.operationId ?? '') || !/^[0-9a-f]{64}$/u.test(receipt?.requestSha256 ?? '')) {
      throw new Error('Migration receipt must bind a UUID operationId and SHA-256 requestSha256.');
    }
    operationId ??= receipt.operationId;
    requestSha256 ??= receipt.requestSha256;
    if (receipt.operationId !== operationId || receipt.requestSha256 !== requestSha256) {
      throw new Error('Migration receipt ledger operationId or requestSha256 changed during the operation.');
    }
    if (receipt?.final === true && ['APPLIED', 'PARTIAL', 'ROLLED_BACK'].includes(receipt?.status)) {
      const sealingReceipt = structuredClone(receipt);
      const terminalStatus = sealingReceipt.status;
      sealingReceipt.status = 'IN_PROGRESS';
      delete sealingReceipt.final;
      sealingReceipt.terminalIntent = {
        status: terminalStatus,
        completedIds: [...(receipt.completedIds ?? [])],
        failedIds: [...(receipt.failedIds ?? [])],
      };
      await appendLedgerReceipt(sealingReceipt);
      const terminalReceipt = structuredClone(receipt);
      terminalReceipt.ledgerIntegrity = {
        sequence,
        previousEntrySha256,
        terminal: true,
      };
      terminalReceipt.ledgerIntegrity.entrySha256 = migrationSha256(stableMigrationJson(terminalReceipt));
      await writeAtomicImmutableJson(resolvedReceipt, terminalReceipt);
      sealed = true;
      await fs.chmod(ledgerDirectory, 0o500);
      return;
    }
    await appendLedgerReceipt(receipt);
  };
  DURABLE_RECEIPT_WRITERS.add(persistReceipt);
  return persistReceipt;
}

export async function inspectImmutableReceiptLedger(receiptPath) {
  if (!receiptPath?.trim()) throw new Error('A non-empty immutable receipt path is required.');
  const resolvedReceipt = path.resolve(receiptPath);
  const ledgerDirectory = `${resolvedReceipt}.ledger`;
  const entries = (await fs.readdir(ledgerDirectory))
    .filter((entry) => /^\d{6}\.json$/u.test(entry))
    .sort();
  let previousEntrySha256 = null;
  let lastReceipt = null;
  for (const [sequence, entry] of entries.entries()) {
    const receipt = JSON.parse(await fs.readFile(path.join(ledgerDirectory, entry), 'utf8'));
    assertNoSensitiveMaterial(receipt, `migration receipt ledger ${entry}`);
    const integrity = receipt.ledgerIntegrity;
    const claimedEntrySha256 = integrity?.entrySha256;
    if (
      integrity?.sequence !== sequence
      || integrity.previousEntrySha256 !== previousEntrySha256
      || !/^[0-9a-f]{64}$/u.test(claimedEntrySha256 ?? '')
    ) {
      throw new Error(`Migration receipt ledger integrity metadata is invalid at ${entry}.`);
    }
    const unhashed = structuredClone(receipt);
    delete unhashed.ledgerIntegrity.entrySha256;
    if (migrationSha256(stableMigrationJson(unhashed)) !== claimedEntrySha256) {
      throw new Error(`Migration receipt ledger hash mismatch at ${entry}.`);
    }
    previousEntrySha256 = claimedEntrySha256;
    lastReceipt = receipt;
  }
  let terminalReceipt;
  try {
    terminalReceipt = JSON.parse(await fs.readFile(resolvedReceipt, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (terminalReceipt) {
    assertNoSensitiveMaterial(terminalReceipt, 'migration terminal receipt');
    const integrity = terminalReceipt.ledgerIntegrity;
    const claimedEntrySha256 = integrity?.entrySha256;
    if (
      terminalReceipt.final !== true
      || !['APPLIED', 'PARTIAL', 'ROLLED_BACK'].includes(terminalReceipt.status)
      || integrity?.terminal !== true
      || integrity.sequence !== entries.length
      || integrity.previousEntrySha256 !== previousEntrySha256
      || terminalReceipt.operationId !== lastReceipt?.operationId
      || terminalReceipt.requestSha256 !== lastReceipt?.requestSha256
      || !/^[0-9a-f]{64}$/u.test(claimedEntrySha256 ?? '')
    ) {
      throw new Error('Migration terminal receipt does not validly seal its immutable ledger.');
    }
    const unhashed = structuredClone(terminalReceipt);
    delete unhashed.ledgerIntegrity.entrySha256;
    if (migrationSha256(stableMigrationJson(unhashed)) !== claimedEntrySha256) {
      throw new Error('Migration terminal receipt hash does not validly seal its immutable ledger.');
    }
    if (terminalReceipt.operation === 'IMPORT') {
      VERIFIED_ORIGINATING_IMPORT_RECEIPTS.set(terminalReceipt, claimedEntrySha256);
    }
    return {
      status: terminalReceipt.status,
      entries: entries.length,
      lastReceipt: terminalReceipt,
    };
  }
  return {
    status: 'RECOVERY_REQUIRED',
    entries: entries.length,
    lastReceipt,
  };
}

export function createImmutableSnapshotWriter(outputDirectory) {
  if (!outputDirectory?.trim()) throw new Error('A non-empty immutable snapshot output directory is required.');
  const resolved = path.resolve(outputDirectory);
  const writeSnapshot = async (snapshot) => writeMigrationBundle(resolved, snapshot);
  IMMUTABLE_SNAPSHOT_WRITERS.add(writeSnapshot);
  return writeSnapshot;
}

async function writeReceipt(receiptPath, receipt) {
  if (!receiptPath) return;
  assertNoSensitiveMaterial(receipt, 'migration receipt');
  await fs.writeFile(path.resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o400 });
}

export function parseAzureStateImportArguments(argv) {
  const options = { apply: false, rollback: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--bundle') options.bundle = argv[++index];
    else if (argument === '--snapshot-output') options.snapshotOutput = argv[++index];
    else if (argument === '--receipt') options.receipt = argv[++index];
    else if (argument === '--import-receipt') options.importReceipt = argv[++index];
    else if (argument === '--resume-import-receipt') options.resumeImportReceipt = argv[++index];
    else if (argument === '--resume-snapshot') options.resumeSnapshot = argv[++index];
    else if (argument === '--apply') options.apply = true;
    else if (argument === '--rollback-snapshot') {
      options.rollback = true;
      options.bundle = argv[++index];
    } else throw new Error(`Unknown import argument: ${argument}`);
  }
  if (!options.bundle) {
    throw new Error('Usage: node scripts/azure-state-import.mjs --bundle <directory> [--apply --snapshot-output <directory> --receipt <path>] [--resume-import-receipt <path> --resume-snapshot <directory>] or --rollback-snapshot <directory> --import-receipt <path> [--apply --receipt <path>]');
  }
  const resumeRequested = options.resumeImportReceipt !== undefined || options.resumeSnapshot !== undefined;
  if (resumeRequested && (!options.resumeImportReceipt || !options.resumeSnapshot)) {
    throw new Error('--resume-import-receipt and --resume-snapshot must be supplied together.');
  }
  if (resumeRequested && (options.rollback || !options.apply)) {
    throw new Error('Import resume flags require an import --apply operation.');
  }
  if (resumeRequested && options.snapshotOutput) {
    throw new Error('Import resume reuses --resume-snapshot and must not write a new --snapshot-output.');
  }
  if (options.apply && !options.rollback && !resumeRequested && !options.snapshotOutput) {
    throw new Error('--apply requires --snapshot-output so the pre-import Azure state is preserved.');
  }
  if (options.apply && !options.receipt) {
    throw new Error('--apply requires --receipt for an immutable per-record operation ledger.');
  }
  if (options.rollback && !options.importReceipt) {
    throw new Error('--rollback-snapshot requires --import-receipt from the exact originating import operation.');
  }
  return options;
}

async function main() {
  const options = parseAzureStateImportArguments(process.argv.slice(2));
  const bundle = await readMigrationBundle(options.bundle);
  const originatingImportReceipt = options.rollback
    ? (await inspectImmutableReceiptLedger(options.importReceipt)).lastReceipt
    : undefined;
  const resumeImportReceipt = options.resumeImportReceipt
    ? (await inspectImmutableReceiptLedger(options.resumeImportReceipt)).lastReceipt
    : undefined;
  const resumeSnapshot = options.resumeSnapshot
    ? await readMigrationBundle(options.resumeSnapshot)
    : undefined;
  const target = options.apply || process.env.AZURE_COSMOS_ENDPOINT ? await createAzureMigrationTarget() : undefined;
  const persistReceipt = options.apply ? await createImmutableReceiptLedger(options.receipt) : undefined;
  const writeSnapshot = options.apply && !options.rollback && !resumeSnapshot
    ? createImmutableSnapshotWriter(options.snapshotOutput)
    : undefined;
  const result = options.rollback
    ? await rollbackMigrationSnapshot({
      snapshot: bundle,
      target,
      originatingImportReceipt,
      apply: options.apply,
      persistReceipt,
    })
    : await importMigrationBundle({
      bundle,
      target,
      apply: options.apply,
      resumeImportReceipt,
      resumeSnapshot,
      persistReceipt,
      writeSnapshot,
    });
  if (!options.apply) await writeReceipt(options.receipt, result);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'PARTIAL') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: error?.recoveryRequired ? 'RECOVERY_REQUIRED' : 'BLOCKED',
      code: error?.code,
      operationId: error?.operationId,
      requestSha256: error?.requestSha256,
      blocker: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}
