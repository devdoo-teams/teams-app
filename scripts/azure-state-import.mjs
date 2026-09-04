import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_JOB_LEDGER_SCOPE,
  AGENT_JOB_LEDGER_PARTITION_KEY,
  assertNoSensitiveMaterial,
  createRuntimeSnapshotBundle,
  readMigrationBundle,
  stableMigrationJson,
  validateMigrationBundle,
  writeMigrationBundle,
} from './azure-state-export.mjs';

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [100, 200];
const AUTHENTICATED_AZURE_TARGET = Symbol('authenticated-azure-migration-target');
const DURABLE_RECEIPT_WRITER = Symbol('durable-immutable-receipt-writer');

export function classifyMigrationTarget(target) {
  const targetBinding = target?.[AUTHENTICATED_AZURE_TARGET];
  return targetBinding
    ? {
      evidenceClass: 'local-contract',
      targetObservation: 'AZURE_DEFAULT_CREDENTIAL_CLIENT_UNATTESTED',
      targetBinding: structuredClone(targetBinding),
    }
    : { evidenceClass: 'local-contract', targetObservation: target ? 'LOCAL_FIXTURE' : 'UNVERIFIED' };
}

function recordById(bundle) {
  return new Map(bundle.records.map((record) => [record.document.id, record]));
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
      if (!TRANSIENT_STATUS_CODES.has(error?.statusCode) || attempt === maxAttempts) throw error;
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

async function persistMutationProgress(persistReceipt, receipt) {
  if (typeof persistReceipt !== 'function' || persistReceipt[DURABLE_RECEIPT_WRITER] !== true) {
    throw new Error('A durable immutable receipt ledger writer is required for every mutating invocation.');
  }
  await persistReceipt(structuredClone(receipt));
}

function mutationFailureCode(error) {
  return Number.isInteger(error?.statusCode) ? `HTTP_${error.statusCode}` : 'MUTATION_FAILED';
}

export async function importMigrationBundle({
  bundle,
  target,
  apply = false,
  maxAttempts = 3,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  writeSnapshot,
  persistReceipt,
}) {
  validateMigrationBundle(bundle);
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
  if (typeof writeSnapshot !== 'function') {
    throw new Error('Apply requires an immutable pre-import Azure snapshot writer.');
  }
  if (typeof persistReceipt !== 'function' || persistReceipt[DURABLE_RECEIPT_WRITER] !== true) {
    throw new Error('Apply requires a durable immutable receipt ledger writer.');
  }

  const snapshot = createRuntimeSnapshotBundle({
    documents: currentDocuments,
    sourceCommit: bundle.manifest.source.commit,
  });
  await writeSnapshot(snapshot);

  const receipt = {
    schemaVersion: 1,
    operation: 'IMPORT',
    status: 'IN_PROGRESS',
    ...provenance,
    sourceCommit: bundle.manifest.source.commit,
    bundleSha256: bundle.manifest.bundleSha256,
    snapshotBundleSha256: snapshot.manifest.bundleSha256,
    planned: { creates: plan.creates.length, unchanged: plan.unchanged.length },
    completedIds: [],
    failedIds: [],
    progress: [],
    inFlight: null,
    reconciliationRequired: true,
  };
  await persistMutationProgress(persistReceipt, receipt);
  for (const record of plan.creates) {
    const stableId = recordStableId(record);
    receipt.inFlight = { action: 'create', stableId };
    await persistMutationProgress(persistReceipt, receipt);
    try {
      await retry(() => target.create(structuredClone(record.document)), { maxAttempts, delay });
      receipt.completedIds.push(stableId);
      receipt.progress.push({ action: 'create', stableId, status: 'COMPLETED' });
    } catch (error) {
      receipt.failedIds.push(stableId);
      receipt.progress.push({ action: 'create', stableId, status: 'FAILED', failureCode: mutationFailureCode(error) });
      receipt.status = 'PARTIAL';
    }
    receipt.inFlight = null;
    await persistMutationProgress(persistReceipt, receipt);
  }
  receipt.status = receipt.failedIds.length === 0 ? 'APPLIED' : 'PARTIAL';
  receipt.created = receipt.completedIds.length;
  receipt.unchanged = plan.unchanged.length;
  receipt.final = true;
  await persistMutationProgress(persistReceipt, receipt);
  return structuredClone(receipt);
}

export async function rollbackMigrationSnapshot({
  snapshot,
  target,
  apply = false,
  maxAttempts = 3,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  persistReceipt,
}) {
  validateMigrationBundle(snapshot);
  if (!target) throw new Error('Rollback requires an Azure migration target.');
  const provenance = classifyMigrationTarget(target);
  const partitionKey = snapshot.records[0]?.document.partitionKey ?? expectedPartitionKey(snapshot);
  const currentDocuments = await target.list(partitionKey);
  const current = new Map(currentDocuments.map((document) => {
    assertTargetDocument(document);
    return [document.id, document];
  }));
  const wanted = recordById(snapshot);
  const deletes = [...current.keys()].filter((id) => !wanted.has(id)).sort();
  const creates = [...wanted.values()].filter((record) => !current.has(record.document.id));
  const replaces = [...wanted.values()].filter((record) => {
    const existing = current.get(record.document.id);
    return existing && !documentsExactlyEqual(existing, record.document);
  });
  if (!apply) {
    return {
      schemaVersion: 1,
      status: 'DRY_RUN',
      ...provenance,
      sourceCommit: snapshot.manifest.source.commit,
      snapshotBundleSha256: snapshot.manifest.bundleSha256,
      plannedDeletes: deletes.length,
      plannedCreates: creates.length,
      plannedReplaces: replaces.length,
    };
  }
  if (typeof persistReceipt !== 'function' || persistReceipt[DURABLE_RECEIPT_WRITER] !== true) {
    throw new Error('Rollback apply requires a durable immutable receipt ledger writer.');
  }

  const receipt = {
    schemaVersion: 1,
    operation: 'ROLLBACK',
    status: 'IN_PROGRESS',
    ...provenance,
    sourceCommit: snapshot.manifest.source.commit,
    snapshotBundleSha256: snapshot.manifest.bundleSha256,
    planned: { deletes: deletes.length, creates: creates.length, replaces: replaces.length },
    completedIds: [],
    failedIds: [],
    progress: [],
    inFlight: null,
    reconciliationRequired: true,
  };
  await persistMutationProgress(persistReceipt, receipt);
  const operations = [
    ...deletes.map((id) => ({ action: 'delete', stableId: targetStableId(id), run: () => target.delete(id, partitionKey) })),
    ...creates.map((record) => ({
      action: 'create',
      stableId: recordStableId(record),
      run: () => target.create(structuredClone(record.document)),
    })),
    ...replaces.map((record) => ({
      action: 'replace',
      stableId: recordStableId(record),
      run: () => target.replace(structuredClone(record.document)),
    })),
  ];
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
    await persistMutationProgress(persistReceipt, receipt);
  }
  receipt.status = receipt.failedIds.length === 0 ? 'ROLLED_BACK' : 'PARTIAL';
  receipt.deleted = receipt.progress.filter(({ action, status }) => action === 'delete' && status === 'COMPLETED').length;
  receipt.created = receipt.progress.filter(({ action, status }) => action === 'create' && status === 'COMPLETED').length;
  receipt.replaced = receipt.progress.filter(({ action, status }) => action === 'replace' && status === 'COMPLETED').length;
  receipt.final = true;
  await persistMutationProgress(persistReceipt, receipt);
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
      await container.items.create(document, { disableAutomaticIdGeneration: true });
    },
    async replace(document) {
      const current = await container.item(document.id, document.partitionKey).read();
      if (!current.resource || !current.etag) throw Object.assign(new Error('Rollback target record is missing.'), { statusCode: 404 });
      await container.item(document.id, document.partitionKey).replace(document, {
        accessCondition: { type: 'IfMatch', condition: current.etag },
      });
    },
    async delete(id, partitionKey) {
      const current = await container.item(id, partitionKey).read();
      if (!current.resource || !current.etag) return;
      await container.item(id, partitionKey).delete({
        accessCondition: { type: 'IfMatch', condition: current.etag },
      });
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
  await fs.mkdir(ledgerDirectory, { recursive: false, mode: 0o700 });
  let sequence = 0;
  let sealed = false;
  const persistReceipt = async (receipt) => {
    if (sealed) throw new Error(`Immutable receipt ledger is already sealed: ${ledgerDirectory}.`);
    assertNoSensitiveMaterial(receipt, 'migration receipt');
    const entry = `${String(sequence).padStart(6, '0')}.json`;
    await writeAtomicImmutableJson(path.join(ledgerDirectory, entry), receipt);
    sequence += 1;
    if (receipt?.final === true && ['APPLIED', 'PARTIAL', 'ROLLED_BACK'].includes(receipt?.status)) {
      await writeAtomicImmutableJson(resolvedReceipt, receipt);
      sealed = true;
      await fs.chmod(ledgerDirectory, 0o500);
    }
  };
  Object.defineProperty(persistReceipt, DURABLE_RECEIPT_WRITER, { value: true });
  return persistReceipt;
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
    else if (argument === '--apply') options.apply = true;
    else if (argument === '--rollback-snapshot') {
      options.rollback = true;
      options.bundle = argv[++index];
    } else throw new Error(`Unknown import argument: ${argument}`);
  }
  if (!options.bundle) {
    throw new Error('Usage: node scripts/azure-state-import.mjs --bundle <directory> [--apply --snapshot-output <directory> --receipt <path>] or --rollback-snapshot <directory> [--apply --receipt <path>]');
  }
  if (options.apply && !options.rollback && !options.snapshotOutput) {
    throw new Error('--apply requires --snapshot-output so the pre-import Azure state is preserved.');
  }
  if (options.apply && !options.receipt) {
    throw new Error('--apply requires --receipt for an immutable per-record operation ledger.');
  }
  return options;
}

async function main() {
  const options = parseAzureStateImportArguments(process.argv.slice(2));
  const bundle = await readMigrationBundle(options.bundle);
  const target = options.apply || process.env.AZURE_COSMOS_ENDPOINT ? await createAzureMigrationTarget() : undefined;
  const persistReceipt = options.apply ? await createImmutableReceiptLedger(options.receipt) : undefined;
  const result = options.rollback
    ? await rollbackMigrationSnapshot({ snapshot: bundle, target, apply: options.apply, persistReceipt })
    : await importMigrationBundle({
      bundle,
      target,
      apply: options.apply,
      persistReceipt,
      writeSnapshot: options.apply
        ? (snapshot) => writeMigrationBundle(options.snapshotOutput, snapshot)
        : undefined,
    });
  if (!options.apply) await writeReceipt(options.receipt, result);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'PARTIAL') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'BLOCKED', blocker: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
