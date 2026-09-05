import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_JOB_LEDGER_PARTITION_KEY,
  assertNoSensitiveMaterial,
  migrationSha256,
  readMigrationBundle,
  stableMigrationJson,
  validateMigrationBundle,
} from './azure-state-export.mjs';
import { classifyMigrationTarget, createAzureMigrationTarget } from './azure-state-import.mjs';

function stableId(document) {
  return `agent-job/${document.id}`;
}

export async function reconcileMigration({
  bundle,
  target,
  checkedAt = new Date().toISOString(),
}) {
  validateMigrationBundle(bundle);
  if (!target) throw new Error('Migration reconciliation requires an observed target.');
  const provenance = classifyMigrationTarget(target);
  const partitionKey = bundle.records[0]?.document.partitionKey ?? AGENT_JOB_LEDGER_PARTITION_KEY;
  const documents = await target.list(partitionKey);
  const byId = new Map();
  for (const document of documents) {
    assertNoSensitiveMaterial(document, 'migration reconciliation target document');
    if (!document || typeof document !== 'object' || typeof document.id !== 'string') {
      throw new Error('Migration target returned a malformed record during reconciliation.');
    }
    if (byId.has(document.id)) throw new Error(`Migration target returned duplicate ID ${document.id}.`);
    byId.set(document.id, document);
  }

  const expectedIds = bundle.manifest.stableIds;
  const actualIds = [...byId.values()].map(stableId).sort();
  if (documents.length !== bundle.manifest.recordCounts.total) {
    throw new Error(`Migration reconciliation count mismatch: expected ${bundle.manifest.recordCounts.total}, observed ${documents.length}.`);
  }
  if (stableMigrationJson(actualIds) !== stableMigrationJson(expectedIds)) {
    throw new Error('Migration reconciliation stable ID mismatch.');
  }

  const contentHashes = [];
  for (const record of bundle.records) {
    const actual = byId.get(record.document.id);
    if (!actual) throw new Error(`Migration reconciliation is missing stable ID ${recordStableId(record)}.`);
    const actualValueHash = migrationSha256(stableMigrationJson(actual.value));
    if (actual.contentHash !== record.contentHash || actualValueHash !== record.contentHash) {
      throw new Error(`Migration reconciliation content hash mismatch for ${recordStableId(record)}.`);
    }
    if (
      actual.tenantId !== record.document.tenantId
      || actual.requesterId !== record.document.requesterId
      || actual.conversationId !== record.document.conversationId
      || actual.partitionKey !== record.document.partitionKey
    ) {
      throw new Error(`Migration reconciliation tenant scope mismatch for ${recordStableId(record)}.`);
    }
    contentHashes.push(actual.contentHash);
  }

  const contentHashesSha256 = migrationSha256(stableMigrationJson(contentHashes));
  if (contentHashesSha256 !== bundle.manifest.contentHashesSha256) {
    throw new Error('Migration reconciliation aggregate content hash mismatch.');
  }
  const receipt = {
    schemaVersion: 1,
    status: 'PASS',
    ...provenance,
    checkedAt,
    bundleSha256: bundle.manifest.bundleSha256,
    sourceCommit: bundle.manifest.source.commit,
    recordCounts: structuredClone(bundle.manifest.recordCounts),
    stableIds: [...expectedIds],
    stableIdsSha256: bundle.manifest.stableIdsSha256,
    contentHashesSha256,
  };
  assertNoSensitiveMaterial(receipt, 'migration reconciliation receipt');
  return receipt;
}

function recordStableId(record) {
  return `${record.kind}/${record.document.id}`;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--bundle') options.bundle = argv[++index];
    else if (argument === '--receipt') options.receipt = argv[++index];
    else throw new Error(`Unknown reconcile argument: ${argument}`);
  }
  if (!options.bundle || !options.receipt) {
    throw new Error('Usage: node scripts/azure-state-reconcile.mjs --bundle <directory> --receipt <immutable-receipt.json>');
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const bundle = await readMigrationBundle(options.bundle);
  const target = await createAzureMigrationTarget();
  const receipt = await reconcileMigration({ bundle, target });
  assertNoSensitiveMaterial(receipt, 'migration reconciliation receipt');
  await fs.writeFile(path.resolve(options.receipt), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o400 });
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'BLOCKED', blocker: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
