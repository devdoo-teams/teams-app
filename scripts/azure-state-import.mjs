import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_JOB_LEDGER_SCOPE,
  AGENT_JOB_LEDGER_PARTITION_KEY,
  createRuntimeSnapshotBundle,
  readMigrationBundle,
  stableMigrationJson,
  validateMigrationBundle,
  writeMigrationBundle,
} from './azure-state-export.mjs';

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [100, 200];

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

export async function importMigrationBundle({
  bundle,
  target,
  apply = false,
  evidenceClass = 'local-contract',
  maxAttempts = 3,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  writeSnapshot,
}) {
  validateMigrationBundle(bundle);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error('Migration maxAttempts must be an integer from 1 through 5.');
  }
  if (!target) {
    if (apply) throw new Error('An Azure migration target is required for --apply.');
    return {
      schemaVersion: 1,
      status: 'DRY_RUN',
      evidenceClass: 'local-contract',
      targetObservation: 'UNVERIFIED',
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
      evidenceClass,
      targetObservation: evidenceClass === 'live-azure' ? 'READ_ONLY_LIVE_AZURE' : 'LOCAL_FIXTURE',
      bundleSha256: bundle.manifest.bundleSha256,
      plannedCreates: plan.creates.length,
      unchanged: plan.unchanged.length,
      conflicts: [],
    };
  }
  if (typeof writeSnapshot !== 'function') {
    throw new Error('Apply requires an immutable pre-import Azure snapshot writer.');
  }

  const snapshot = createRuntimeSnapshotBundle({
    documents: currentDocuments,
    sourceCommit: bundle.manifest.source.commit,
  });
  await writeSnapshot(snapshot);

  let created = 0;
  const failedIds = [];
  for (const record of plan.creates) {
    try {
      await retry(() => target.create(structuredClone(record.document)), { maxAttempts, delay });
      created += 1;
    } catch {
      failedIds.push(recordStableId(record));
    }
  }

  return {
    schemaVersion: 1,
    status: failedIds.length === 0 ? 'APPLIED' : 'PARTIAL',
    evidenceClass,
    bundleSha256: bundle.manifest.bundleSha256,
    snapshotBundleSha256: snapshot.manifest.bundleSha256,
    created,
    unchanged: plan.unchanged.length,
    failedIds,
    reconciliationRequired: true,
  };
}

export async function rollbackMigrationSnapshot({
  snapshot,
  target,
  apply = false,
  evidenceClass = 'local-contract',
  maxAttempts = 3,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  validateMigrationBundle(snapshot);
  if (!target) throw new Error('Rollback requires an Azure migration target.');
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
      evidenceClass,
      snapshotBundleSha256: snapshot.manifest.bundleSha256,
      plannedDeletes: deletes.length,
      plannedCreates: creates.length,
      plannedReplaces: replaces.length,
    };
  }

  for (const id of deletes) await retry(() => target.delete(id, partitionKey), { maxAttempts, delay });
  for (const record of creates) {
    await retry(() => target.create(structuredClone(record.document)), { maxAttempts, delay });
  }
  for (const record of replaces) {
    await retry(() => target.replace(structuredClone(record.document)), { maxAttempts, delay });
  }
  return {
    schemaVersion: 1,
    status: 'ROLLED_BACK',
    evidenceClass,
    snapshotBundleSha256: snapshot.manifest.bundleSha256,
    deleted: deletes.length,
    created: creates.length,
    replaced: replaces.length,
  };
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
  return {
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
}

function stripCosmosSystemFields(document) {
  const { _rid, _self, _etag, _attachments, _ts, ...applicationDocument } = document;
  return applicationDocument;
}

async function writeReceipt(receiptPath, receipt) {
  if (!receiptPath) return;
  await fs.writeFile(path.resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o400 });
}

function parseArguments(argv) {
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
  if (!options.bundle) throw new Error('Usage: node scripts/azure-state-import.mjs --bundle <directory> [--apply --snapshot-output <directory>] [--receipt <path>]');
  if (options.apply && !options.rollback && !options.snapshotOutput) {
    throw new Error('--apply requires --snapshot-output so the pre-import Azure state is preserved.');
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const bundle = await readMigrationBundle(options.bundle);
  const target = options.apply || process.env.AZURE_COSMOS_ENDPOINT ? await createAzureMigrationTarget() : undefined;
  const result = options.rollback
    ? await rollbackMigrationSnapshot({ snapshot: bundle, target, apply: options.apply, evidenceClass: target ? 'live-azure' : 'local-contract' })
    : await importMigrationBundle({
      bundle,
      target,
      apply: options.apply,
      evidenceClass: target ? 'live-azure' : 'local-contract',
      writeSnapshot: options.apply
        ? (snapshot) => writeMigrationBundle(options.snapshotOutput, snapshot)
        : undefined,
    });
  await writeReceipt(options.receipt, result);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'PARTIAL') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'BLOCKED', blocker: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
