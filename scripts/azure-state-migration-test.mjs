import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_JOB_LEDGER_SCOPE,
  createAgentJobExportBundle,
  createRuntimeSnapshotBundle,
  readMigrationBundle,
  stableMigrationJson,
  validateMigrationBundle,
  writeMigrationBundle,
} from './azure-state-export.mjs';
import {
  classifyMigrationTarget,
  createAzureMigrationTarget,
  createImmutableReceiptLedger,
  createImmutableSnapshotWriter,
  importMigrationBundle,
  inspectImmutableReceiptLedger,
  parseAzureStateImportArguments,
  rollbackMigrationSnapshot,
} from './azure-state-import.mjs';
import { reconcileMigration } from './azure-state-reconcile.mjs';
import {
  createLocalDurableAzureChallengeStore,
  createLocalProtectedAzureOperationalVerifier,
  createLocalSignedAzureEvidenceVerifier,
  createPreflightCommands,
  createProtectedAzureOperationalEvidenceVerifier,
  resolveReleaseTarget,
  validateAzureIntegratedEvidence,
} from './release-gate.mjs';

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const exportedAt = '2026-09-03T01:02:03.000Z';
const azureAccountKeyFixture = 'o0DPYVAbjXPGDUBFay7YLycJB7NdF+SMFn5E6tdRSnFP0d7Ioknw1cC6Yh9PDHg0EzIotFsejgUEQg1jvFwAPg==';
const azureAccountKeyClassOmissionFixtures = [
  {
    label: 'without digits',
    value: 'khsTuNMFGrCVUfofSBePgVcpWTcPSbcrkjotqPUxcdiVybebIJYbCdu/YbuVajaJwhsTMxYfEDgZEjkXknWFiA==',
  },
  {
    label: 'without lowercase letters',
    value: 'ZMHM3ED0/2HULYZADY7OVEFUDUXKP8LWFMHYTS98JMLUN23+ROLOVSHID6P676TKR+DSF8JQNU3AXKHYZM/QHA==',
  },
  {
    label: 'without uppercase letters',
    value: '+zm92h6bm7+1gtu7y3kxorcb+1cn8fal2f8ru9o7axkbqnw/cx4lg3yxktolerebg50x+vs9mbyhejwlkn63mg==',
  },
];
const jobs = [
  {
    id: 'task-one',
    prompt: 'preserve the first accepted job',
    provider: 'codex',
    mode: 'read-only',
    status: 'completed',
    conversationId: 'conversation-a',
    requesterId: 'requester-a',
    tenantId: 'tenant-a',
    result: 'first durable result',
    progress: ['accepted', 'completed'],
    createdAt: '2026-09-01T00:00:00.000Z',
    finishedAt: '2026-09-01T00:01:00.000Z',
  },
  {
    id: 'task-two',
    prompt: 'preserve another tenant independently',
    provider: 'codex',
    mode: 'read-only',
    status: 'queued',
    conversationId: 'conversation-b',
    requesterId: 'requester-b',
    tenantId: 'tenant-b',
    progress: [],
    createdAt: '2026-09-02T00:00:00.000Z',
  },
];

class MemoryMigrationTarget {
  constructor(documents = [], { targetId = crypto.randomUUID() } = {}) {
    this.documents = new Map(documents.map((document) => [document.id, structuredClone(document)]));
    this.migrationTargetBinding = Object.freeze({
      kind: 'memory-migration-target',
      targetId,
    });
    this.calls = [];
    this.failures = new Map();
    this.etags = new Map();
    this.nextEtag = 1;
    this.beforeDelete = undefined;
    for (const document of documents) this.etags.set(document.id, this.createEtag());
  }

  fail(id, count, statusCode = 503) {
    this.failures.set(id, { count, statusCode });
  }

  async list(partitionKey) {
    this.calls.push({ operation: 'list', partitionKey });
    return [...this.documents.values()]
      .filter((document) => document.partitionKey === partitionKey)
      .map((document) => structuredClone(document));
  }

  async create(document) {
    this.calls.push({ operation: 'create', id: document.id });
    this.maybeFail(document.id);
    if (this.documents.has(document.id)) throw Object.assign(new Error('conflict'), { statusCode: 409 });
    this.documents.set(document.id, structuredClone(document));
    const etag = this.createEtag();
    this.etags.set(document.id, etag);
    return { document: structuredClone(document), etag };
  }

  async read(id, partitionKey) {
    this.calls.push({ operation: 'read', id, partitionKey });
    const document = this.documents.get(id);
    if (!document || document.partitionKey !== partitionKey) return undefined;
    return {
      document: structuredClone(document),
      etag: this.etags.get(id),
    };
  }

  async delete(id, partitionKey, { ifMatch } = {}) {
    this.calls.push({ operation: 'delete', id, partitionKey, ifMatch });
    this.maybeFail(id);
    await this.beforeDelete?.({ id, partitionKey, ifMatch, target: this });
    if (!this.documents.has(id)) return { absent: true };
    if (ifMatch !== undefined && ifMatch !== this.etags.get(id)) {
      throw Object.assign(new Error('precondition failed'), { code: 412 });
    }
    this.documents.delete(id);
    this.etags.delete(id);
    return { deleted: true };
  }

  externalCreate(document) {
    if (this.documents.has(document.id)) throw new Error(`fixture document already exists: ${document.id}`);
    this.documents.set(document.id, structuredClone(document));
    this.etags.set(document.id, this.createEtag());
  }

  externalUpdate(id, update) {
    const current = this.documents.get(id);
    if (!current) throw new Error(`fixture document is missing: ${id}`);
    const next = update(structuredClone(current));
    this.documents.set(id, structuredClone(next));
    this.etags.set(id, this.createEtag());
  }

  createEtag() {
    const etag = `fixture-etag-${String(this.nextEtag).padStart(6, '0')}`;
    this.nextEtag += 1;
    return etag;
  }

  maybeFail(id) {
    const failure = this.failures.get(id);
    if (!failure || failure.count < 1) return;
    failure.count -= 1;
    throw Object.assign(new Error(`fixture failure for ${id}`), { statusCode: failure.statusCode });
  }
}

function cloneBundle(bundle) {
  return structuredClone(bundle);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function signAggregateAttestation(payload, privateKey) {
  return {
    ...payload,
    signature: crypto.sign(null, Buffer.from(stableMigrationJson(payload)), privateKey).toString('base64url'),
  };
}

const bundle = createAgentJobExportBundle({ jobs, sourceCommit, exportedAt });
assert.equal(bundle.manifest.schemaVersion, 'teamsapp.azure-state-export.v1');
assert.equal(bundle.manifest.source.commit, sourceCommit);
assert.deepEqual(bundle.manifest.schemaVersions, {
  agentJob: 'agent-job.v1',
  runtimeRecord: 'runtime-record.v1',
});
assert.deepEqual(bundle.manifest.recordCounts, {
  agentJobs: 2,
  byTenant: { 'tenant-a': 1, 'tenant-b': 1 },
  total: 2,
});
assert.deepEqual(bundle.manifest.stableIds, ['agent-job/task-one', 'agent-job/task-two']);
assert.equal(bundle.records.length, 2);
assert.ok(bundle.records.every((record) => record.scope.tenantId === AGENT_JOB_LEDGER_SCOPE.tenantId));
assert.ok(bundle.records.every((record) => record.contentHash === sha256(record.canonicalValue)));
assert.doesNotThrow(() => validateMigrationBundle(bundle));

assert.throws(
  () => createAgentJobExportBundle({ jobs: [{ id: 'malformed' }], sourceCommit, exportedAt }),
  /malformed|tenantId|requesterId|conversationId/i,
  'malformed local records must fail before an export is created',
);
assert.doesNotThrow(
  () => createAgentJobExportBundle({
    jobs: [{ ...jobs[1], id: 'task-long-prompt', prompt: `${'p'.repeat(300)}\nsecond line` }],
    sourceCommit,
    exportedAt,
  }),
  'an AgentJob prompt accepted by the 2,000-character store contract must be preserved verbatim',
);
assert.throws(
  () => createAgentJobExportBundle({ jobs: [jobs[0], { ...jobs[1], id: jobs[0].id }], sourceCommit, exportedAt }),
  /duplicate|unique/i,
  'duplicate durable IDs must be rejected',
);
assert.throws(
  () => createAgentJobExportBundle({
    jobs: [{ ...jobs[0], accessToken: 'fixture-sensitive-value' }],
    sourceCommit,
    exportedAt,
  }),
  /sensitive|secret|credential/i,
  'sensitive fields must fail closed instead of being copied or redacted',
);
for (const [field, value] of [
  ['azureCosmosConnectionString', 'DefaultEndpointsProtocol=https;AccountName=fixture;AccountKey=ZmFrZS1hY2NvdW50LWtleQ==;EndpointSuffix=core.windows.net'],
  ['storage_sas_token', 'sv=2024-11-04&ss=b&srt=sco&sp=rwdlac&se=2030-01-01T00:00:00Z&sig=ZmFrZS1zaWduYXR1cmU'],
  ['account-key', 'ZmFrZS1hY2NvdW50LWtleS1tYXRlcmlhbA=='],
  ['refresh_token', 'opaque-refresh-material'],
  ['sessionToken', 'opaque-session-material'],
  ['databasePassword', 'opaque-password-material'],
  ['proxyAuthorization', 'Basic Zml4dHVyZTpjcmVkZW50aWFs'],
  ['signingPrivateKey', '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----'],
]) {
  assert.throws(
    () => createAgentJobExportBundle({ jobs: [{ ...jobs[0], metadata: { [field]: value } }], sourceCommit, exportedAt }),
    /sensitive|secret|credential/i,
    `normalized recursive secret detection must reject ${field}`,
  );
}
for (const field of ['tokens', 'credentials', 'passwords', 'sessionTokens', 'apiKeys', 'accountKeys']) {
  assert.throws(
    () => createAgentJobExportBundle({ jobs: [{ ...jobs[0], metadata: { [field]: ['opaque-sensitive-material'] } }], sourceCommit, exportedAt }),
    /sensitive|secret|credential/i,
    `plural credential key morphology must reject ${field}`,
  );
}
assert.throws(
  () => createAgentJobExportBundle({
    jobs: [{ ...jobs[0], metadata: { observations: [{ state: 'ok' }, { credentials: 'opaque-sensitive-material' }] } }],
    sourceCommit,
    exportedAt,
  }),
  /sensitive|secret|credential/i,
  'secret scanning must descend through nested arrays and objects',
);
for (const value of [
  'DefaultEndpointsProtocol=https;AccountName=fixture;AccountKey=ZmFrZS1hY2NvdW50LWtleQ==;EndpointSuffix=core.windows.net',
  'https://fixture.blob.core.windows.net/c?sv=2024-11-04&sp=rw&se=2030-01-01T00:00:00Z&sig=ZmFrZS1zaWduYXR1cmU',
  'Server=tcp:fixture.database.windows.net;User ID=app;Password=fixture-db-password;Encrypt=true',
  '{"access_token":"fixture-access-token-material"}',
  'client_secret=fixture-client-secret-material',
  'PuTTY-User-Key-File-3: ssh-rsa',
]) {
  assert.throws(
    () => createAgentJobExportBundle({ jobs: [{ ...jobs[0], metadata: { note: value } }], sourceCommit, exportedAt }),
    /sensitive|secret|credential/i,
    'credential-shaped values must be rejected even under an ordinary field name',
  );
}
assert.throws(
  () => createAgentJobExportBundle({
    jobs: [{ ...jobs[0], metadata: { observations: [{ payload: azureAccountKeyFixture }] } }],
    sourceCommit,
    exportedAt,
  }),
  /sensitive|secret|credential|account.?key/i,
  'an Azure account-key-shaped value under a neutral nested key must not enter a full export envelope',
);
assert.doesNotThrow(
  () => createAgentJobExportBundle({
    jobs: [{
      ...jobs[0],
      metadata: {
        tokenCount: 42,
        tokenReference: 'key-vault://teamsapp/provider-token',
        tokenExpiresAt: '2026-09-04T12:00:00.000Z',
        tokenExpiry: '2026-09-04T12:00:00.000Z',
        tokenExpiryTime: '2026-09-04T12:00:00.000Z',
        secretReference: 'key-vault://teamsapp/provider-token',
        secretUri: 'key-vault://teamsapp/provider-token',
        secretHash: `sha256:${'a'.repeat(64)}`,
        secretDigest: `sha256:${'b'.repeat(64)}`,
        credentialPrincipal: 'managed-identity:teamsapp-canary',
        credentialId: 'managed-identity-client-id',
        credentialVersion: 'v2',
        credentialUri: 'https://login.microsoftonline.com/organizations/',
        authorizationStatus: 'required',
        authorizationUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
        connectionStatus: 'healthy',
        passwordPolicy: 'minimum-length-16',
        tokenBudget: 4096,
        secretRotationPolicy: 'quarterly',
        authorizationScheme: 'managed-identity',
        secretaryName: 'ordinary-domain-value',
        accountManagerName: 'Azure Platform Team',
        tokenizationModel: 'wordpiece-v2',
      },
    }],
    sourceCommit,
    exportedAt,
  }),
  'ordinary non-secret metadata and credential references must remain exportable',
);
assert.throws(
  () => createAgentJobExportBundle({
    jobs: [{ ...jobs[0], metadata: { secretDigest: azureAccountKeyFixture } }],
    sourceCommit,
    exportedAt,
  }),
  /sensitive|secret|credential|account.?key/i,
  'safe metadata names must not exempt credential-shaped values',
);
for (const { label, value } of azureAccountKeyClassOmissionFixtures) {
  assert.equal(Buffer.from(value, 'base64').byteLength, 64, `${label} fixture must decode to 64 bytes`);
  assert.equal(Buffer.from(value, 'base64').toString('base64'), value, `${label} fixture must be canonical Base64`);
  assert.throws(
    () => createAgentJobExportBundle({
      jobs: [{ ...jobs[0], metadata: { observations: [{ payload: value }] } }],
      sourceCommit,
      exportedAt,
    }),
    /sensitive|secret|credential|account.?key/i,
    `a canonical Azure account-key-shaped value ${label} must be rejected under a neutral nested key`,
  );
}
for (const { label, value } of azureAccountKeyClassOmissionFixtures) {
  const snapshotDocument = structuredClone(bundle.records[0].document);
  snapshotDocument.value.metadata = { observations: [{ payload: value }] };
  snapshotDocument.contentHash = sha256(stableMigrationJson(snapshotDocument.value));
  assert.throws(
    () => createRuntimeSnapshotBundle({
      documents: [snapshotDocument],
      sourceCommit,
      exportedAt,
    }),
    /sensitive|secret|credential|account.?key/i,
    `Azure snapshot export must reject a canonical account-key-shaped value ${label} under a neutral key`,
  );
}

const constructedAzureTarget = await createAzureMigrationTarget({
  AZURE_COSMOS_ENDPOINT: 'https://fixture.documents.azure.com:443/',
  AZURE_COSMOS_DATABASE: 'teamsapp',
  AZURE_COSMOS_CONTAINER: 'runtime-state',
});
assert.deepEqual(
  classifyMigrationTarget(constructedAzureTarget),
  {
    evidenceClass: 'local-contract',
    targetObservation: 'AZURE_DEFAULT_CREDENTIAL_CLIENT_UNATTESTED',
    targetBinding: {
      endpoint: 'https://fixture.documents.azure.com:443/',
      database: 'teamsapp',
      container: 'runtime-state',
    },
  },
  'an Azure client without producer attestation must remain local-contract and bind its exact target',
);

const crossTenantParent = [
  jobs[0],
  { ...jobs[1], parentJobId: jobs[0].id },
];
assert.throws(
  () => createAgentJobExportBundle({ jobs: crossTenantParent, sourceCommit, exportedAt }),
  /tenant|scope|parent/i,
  'cross-tenant parent references must not enter a migration bundle',
);

const tampered = cloneBundle(bundle);
tampered.records[0].document.value.result = 'tampered result';
assert.throws(
  () => validateMigrationBundle(tampered),
  /hash|digest|canonical/i,
  'record content hash mismatches must be rejected',
);

const recordEnvelopeSecret = cloneBundle(bundle);
recordEnvelopeSecret.records[0].audit = { credentials: 'opaque-record-envelope-secret' };
assert.throws(
  () => validateMigrationBundle(recordEnvelopeSecret),
  /sensitive|secret|credential/i,
  'credential material in an accepted record envelope must be scanned before digest validation',
);
const documentEnvelopeSecret = cloneBundle(bundle);
documentEnvelopeSecret.records[0].document.importMetadata = { apiKeys: ['opaque-document-envelope-secret'] };
assert.throws(
  () => validateMigrationBundle(documentEnvelopeSecret),
  /sensitive|secret|credential/i,
  'credential material in an accepted runtime document envelope must be scanned before import',
);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teamsapp-azure-migration-test-'));
try {
  const bundlePath = path.join(tempRoot, 'immutable-export');
  await writeMigrationBundle(bundlePath, bundle);
  const diskBundle = await readMigrationBundle(bundlePath);
  assert.deepEqual(diskBundle, bundle, 'an immutable disk bundle must round-trip exactly');
  const occupiedReceiptPath = path.join(tempRoot, 'occupied-receipt.json');
  await fs.writeFile(occupiedReceiptPath, '{}\n', { flag: 'wx', mode: 0o400 });
  await assert.rejects(
    createImmutableReceiptLedger(occupiedReceiptPath),
    /exist|immutable|receipt/i,
    'a mutating operation must reject an occupied terminal receipt path before creating its ledger',
  );
  await assert.rejects(
    fs.stat(`${occupiedReceiptPath}.ledger`),
    { code: 'ENOENT' },
    'receipt preflight failure must not leave an orphan operation ledger',
  );
  const secretReceiptPath = path.join(tempRoot, 'secret-receipt.json');
  const persistSecretReceipt = await createImmutableReceiptLedger(secretReceiptPath);
  await assert.rejects(
    persistSecretReceipt({ status: 'PARTIAL', final: true, nested: { bearer_token: 'opaque-secret-material' } }),
    /sensitive|secret|credential/i,
    'durable receipt ledgers must reject recursively nested secret material',
  );
  await assert.rejects(
    persistSecretReceipt({ status: 'IN_PROGRESS', operationId: crypto.randomUUID(), requestSha256: 'a'.repeat(64), credentials: ['opaque-secret-material'] }),
    /sensitive|secret|credential/i,
    'mutation receipts must reject plural credential fields before persistence',
  );
  await assert.rejects(
    persistSecretReceipt({
      status: 'IN_PROGRESS',
      operationId: crypto.randomUUID(),
      requestSha256: 'a'.repeat(64),
      checkpoints: [{ observations: [{ payload: azureAccountKeyFixture }] }],
    }),
    /sensitive|secret|credential|account.?key/i,
    'a full receipt envelope must reject a neutral-key Azure account-key shape nested in arrays',
  );
  for (const { label, value } of azureAccountKeyClassOmissionFixtures) {
    await assert.rejects(
      persistSecretReceipt({
        status: 'IN_PROGRESS',
        operationId: crypto.randomUUID(),
        requestSha256: 'a'.repeat(64),
        checkpoints: [{ observations: [{ payload: value }] }],
      }),
      /sensitive|secret|credential|account.?key/i,
      `mutation receipts must reject a canonical account-key-shaped value ${label}`,
    );
  }
  await fs.chmod(`${secretReceiptPath}.ledger`, 0o500);
  await assert.rejects(
    writeMigrationBundle(bundlePath, bundle),
    /exist|immutable|non-empty/i,
    'an existing export directory must never be overwritten',
  );

  const dryRunTarget = new MemoryMigrationTarget();
  const dryRun = await importMigrationBundle({
    bundle: diskBundle,
    target: dryRunTarget,
    apply: false,
    evidenceClass: 'live-azure',
  });
  assert.equal(dryRun.status, 'DRY_RUN');
  assert.equal(dryRun.evidenceClass, 'local-contract', 'a caller cannot relabel an in-memory target as live Azure');
  assert.equal(dryRun.targetObservation, 'LOCAL_FIXTURE');
  assert.equal(dryRun.sourceCommit, sourceCommit);
  assert.equal(dryRun.plannedCreates, 2);
  assert.equal(dryRunTarget.calls.some(({ operation }) => operation !== 'list'), false);

  const retryTarget = new MemoryMigrationTarget();
  retryTarget.fail('task-one', 2, 503);
  const delays = [];
  let snapshot;
  await assert.rejects(
    importMigrationBundle({
      bundle: diskBundle,
      target: retryTarget,
      apply: true,
      writeSnapshot: async () => {},
    }),
    /durable|receipt|ledger/i,
    'mutating import must refuse to start without a durable receipt writer',
  );
  assert.equal(retryTarget.calls.some(({ operation }) => operation === 'create'), false);
  const fakeWriterTarget = new MemoryMigrationTarget();
  await assert.rejects(
    importMigrationBundle({
      bundle: diskBundle,
      target: fakeWriterTarget,
      apply: true,
      writeSnapshot: async () => {},
      persistReceipt: async () => {},
    }),
    /durable|immutable|receipt.*writer/i,
    'an arbitrary callback must not impersonate the immutable receipt ledger writer',
  );
  assert.equal(fakeWriterTarget.calls.some(({ operation }) => operation === 'create'), false);
  const copiedBrandSourcePath = path.join(tempRoot, 'copied-brand-source.json');
  const copiedBrandSource = await createImmutableReceiptLedger(copiedBrandSourcePath);
  const copiedBrandWriter = async () => {};
  for (const symbol of Object.getOwnPropertySymbols(copiedBrandSource)) {
    Object.defineProperty(copiedBrandWriter, symbol, {
      value: copiedBrandSource[symbol],
    });
  }
  const copiedBrandTarget = new MemoryMigrationTarget();
  await assert.rejects(
    importMigrationBundle({
      bundle: diskBundle,
      target: copiedBrandTarget,
      apply: true,
      writeSnapshot: async () => {},
      persistReceipt: copiedBrandWriter,
    }),
    /durable|immutable|receipt.*writer/i,
    'copying discoverable writer symbols must not forge a durable receipt capability',
  );
  assert.equal(copiedBrandTarget.calls.some(({ operation }) => operation === 'create'), false);

  const noOpSnapshotReceiptPath = path.join(tempRoot, 'no-op-snapshot-receipt.json');
  const noOpSnapshotTarget = new MemoryMigrationTarget();
  await assert.rejects(
    importMigrationBundle({
      bundle: diskBundle,
      target: noOpSnapshotTarget,
      apply: true,
      writeSnapshot: async () => {},
      persistReceipt: await createImmutableReceiptLedger(noOpSnapshotReceiptPath),
    }),
    /immutable|snapshot.*writer/i,
    'a no-op snapshot callback must fail before any target mutation',
  );
  assert.equal(noOpSnapshotTarget.calls.some(({ operation }) => operation === 'create'), false);
  const importReceiptPath = path.join(tempRoot, 'import-receipt.json');
  const importSnapshotPath = path.join(tempRoot, 'import-snapshot');
  const persistImportReceipt = await createImmutableReceiptLedger(importReceiptPath);
  const applied = await importMigrationBundle({
    bundle: diskBundle,
    target: retryTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    maxAttempts: 3,
    delay: async (milliseconds) => delays.push(milliseconds),
    writeSnapshot: createImmutableSnapshotWriter(importSnapshotPath),
    persistReceipt: persistImportReceipt,
  });
  snapshot = await readMigrationBundle(importSnapshotPath);
  assert.equal(applied.status, 'APPLIED');
  assert.equal(applied.created, 2);
  assert.deepEqual(delays, [100, 200], 'transient writes must use bounded retries');
  assert.equal(snapshot.manifest.recordCounts.total, 0, 'the pre-import target snapshot must precede all writes');

  const repeatReceiptPath = path.join(tempRoot, 'repeat-import-receipt.json');
  const repeatSnapshotPath = path.join(tempRoot, 'repeat-import-snapshot');
  const repeat = await importMigrationBundle({
    bundle: diskBundle,
    target: retryTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    writeSnapshot: createImmutableSnapshotWriter(repeatSnapshotPath),
    persistReceipt: await createImmutableReceiptLedger(repeatReceiptPath),
  });
  assert.equal(repeat.status, 'APPLIED');
  assert.equal(repeat.created, 0);
  assert.equal(repeat.unchanged, 2, 'repeated import must be idempotent');

  const partialTarget = new MemoryMigrationTarget();
  partialTarget.fail('task-two', 1, 400);
  const partialReceiptPath = path.join(tempRoot, 'partial-import-receipt.json');
  const partialSnapshotPath = path.join(tempRoot, 'partial-import-snapshot');
  const partialPersistReceipt = await createImmutableReceiptLedger(partialReceiptPath);
  const partial = await importMigrationBundle({
    bundle: diskBundle,
    target: partialTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    maxAttempts: 3,
    delay: async () => {},
    writeSnapshot: createImmutableSnapshotWriter(partialSnapshotPath),
    persistReceipt: partialPersistReceipt,
  });
  assert.equal(partial.status, 'PARTIAL');
  assert.deepEqual(partial.failedIds, ['agent-job/task-two']);
  assert.equal(partialTarget.documents.has('task-one'), true);
  assert.equal(partialTarget.documents.has('task-two'), false);
  const partialDurableReceipt = JSON.parse(await fs.readFile(partialReceiptPath, 'utf8'));
  assert.equal(partialDurableReceipt.status, 'PARTIAL');
  assert.deepEqual(partialDurableReceipt.completedIds, ['agent-job/task-one']);
  assert.deepEqual(partialDurableReceipt.failedIds, ['agent-job/task-two']);
  const partialLedgerEntries = await fs.readdir(`${partialReceiptPath}.ledger`);
  assert.ok(partialLedgerEntries.length >= 6, 'each mutation intent and outcome must have an immutable checkpoint');
  const partialLedgerReceipts = await Promise.all(partialLedgerEntries.map(async (entry) => (
    JSON.parse(await fs.readFile(path.join(`${partialReceiptPath}.ledger`, entry), 'utf8'))
  )));
  assert.equal(
    partialLedgerReceipts.some((receipt) => receipt.inFlight?.stableId === 'agent-job/task-two'),
    true,
    'the durable ledger must record intent before each record mutation',
  );
  const sealedPartialInspection = await inspectImmutableReceiptLedger(partialReceiptPath);
  assert.equal(sealedPartialInspection.status, 'PARTIAL', 'a valid terminal receipt must seal the hash-chained ledger');
  assert.equal(sealedPartialInspection.lastReceipt.final, true);
  const tamperedLedgerEntryPath = path.join(`${partialReceiptPath}.ledger`, partialLedgerEntries[0]);
  const tamperedLedgerEntry = JSON.parse(await fs.readFile(tamperedLedgerEntryPath, 'utf8'));
  tamperedLedgerEntry.status = 'APPLIED';
  await fs.chmod(`${partialReceiptPath}.ledger`, 0o700);
  await fs.chmod(tamperedLedgerEntryPath, 0o600);
  await fs.writeFile(tamperedLedgerEntryPath, `${JSON.stringify(tamperedLedgerEntry, null, 2)}\n`);
  await assert.rejects(
    inspectImmutableReceiptLedger(partialReceiptPath),
    /integrity|hash|tamper/i,
    'receipt ledger hash-chain inspection must reject modified checkpoints',
  );

  const resumedImportTarget = new MemoryMigrationTarget([], { targetId: 'resumed-import-lineage' });
  resumedImportTarget.fail('task-two', 1, 400);
  const firstAttemptReceiptPath = path.join(tempRoot, 'resumed-import-first-receipt.json');
  const firstAttemptSnapshotPath = path.join(tempRoot, 'resumed-import-original-snapshot');
  const firstAttempt = await importMigrationBundle({
    bundle: diskBundle,
    target: resumedImportTarget,
    apply: true,
    writeSnapshot: createImmutableSnapshotWriter(firstAttemptSnapshotPath),
    persistReceipt: await createImmutableReceiptLedger(firstAttemptReceiptPath),
  });
  assert.equal(firstAttempt.status, 'PARTIAL');
  const firstAttemptReceipt = (await inspectImmutableReceiptLedger(firstAttemptReceiptPath)).lastReceipt;
  const firstAttemptSnapshot = await readMigrationBundle(firstAttemptSnapshotPath);
  const resumedAttemptReceiptPath = path.join(tempRoot, 'resumed-import-final-receipt.json');
  const resumedAttempt = await importMigrationBundle({
    bundle: diskBundle,
    target: resumedImportTarget,
    apply: true,
    resumeImportReceipt: firstAttemptReceipt,
    resumeSnapshot: firstAttemptSnapshot,
    persistReceipt: await createImmutableReceiptLedger(resumedAttemptReceiptPath),
  });
  assert.equal(resumedAttempt.status, 'APPLIED');
  assert.deepEqual(
    resumedAttempt.ownedMutations.map(({ stableId }) => stableId).sort(),
    ['agent-job/task-one', 'agent-job/task-two'],
    'an idempotent import retry must seal the verified ownership union from every attempt',
  );
  const resumedAttemptReceipt = (await inspectImmutableReceiptLedger(resumedAttemptReceiptPath)).lastReceipt;
  const noOpResumeReceiptPath = path.join(tempRoot, 'resumed-import-no-op-receipt.json');
  const noOpResume = await importMigrationBundle({
    bundle: diskBundle,
    target: resumedImportTarget,
    apply: true,
    resumeImportReceipt: resumedAttemptReceipt,
    resumeSnapshot: firstAttemptSnapshot,
    persistReceipt: await createImmutableReceiptLedger(noOpResumeReceiptPath),
  });
  assert.equal(noOpResume.status, 'APPLIED');
  assert.deepEqual(
    noOpResume.ownedMutations.map(({ stableId }) => stableId).sort(),
    ['agent-job/task-one', 'agent-job/task-two'],
    'a no-op retry must retain the complete verified ownership lineage',
  );
  const noOpResumeReceipt = (await inspectImmutableReceiptLedger(noOpResumeReceiptPath)).lastReceipt;
  const resumedRollback = await rollbackMigrationSnapshot({
    snapshot: firstAttemptSnapshot,
    target: resumedImportTarget,
    originatingImportReceipt: noOpResumeReceipt,
    apply: true,
    persistReceipt: await createImmutableReceiptLedger(path.join(tempRoot, 'resumed-import-rollback-receipt.json')),
  });
  assert.equal(resumedRollback.status, 'ROLLED_BACK');
  assert.equal(resumedRollback.deleted, 2);
  assert.equal(resumedImportTarget.documents.size, 0, 'retry rollback must restore the original pre-import snapshot');

  const ambiguousCreateReceiptPath = path.join(tempRoot, 'ambiguous-create-receipt.json');
  const ambiguousCreateTarget = new MemoryMigrationTarget();
  const originalAmbiguousCreate = ambiguousCreateTarget.create.bind(ambiguousCreateTarget);
  let droppedCreateResponse = false;
  ambiguousCreateTarget.create = async (document) => {
    const observation = await originalAmbiguousCreate(document);
    if (!droppedCreateResponse && document.id === 'task-one') {
      droppedCreateResponse = true;
      throw Object.assign(new Error('create committed but its response was lost'), { code: 503 });
    }
    return observation;
  };
  await assert.rejects(
    importMigrationBundle({
      bundle: diskBundle,
      target: ambiguousCreateTarget,
      apply: true,
      maxAttempts: 3,
      delay: async () => {},
      writeSnapshot: createImmutableSnapshotWriter(path.join(tempRoot, 'ambiguous-create-snapshot')),
      persistReceipt: await createImmutableReceiptLedger(ambiguousCreateReceiptPath),
    }),
    (error) => error?.code === 'MIGRATION_RECOVERY_REQUIRED' && /create|commit|reconcil|ownership/i.test(error.message),
    'a create that may have committed without an observed post-image and ETag must require reconciliation',
  );
  assert.equal(ambiguousCreateTarget.documents.has('task-one'), true);
  assert.equal(ambiguousCreateTarget.documents.has('task-two'), false, 'an ambiguous create must stop later mutations');
  const ambiguousCreateInspection = await inspectImmutableReceiptLedger(ambiguousCreateReceiptPath);
  assert.equal(ambiguousCreateInspection.status, 'RECOVERY_REQUIRED');
  assert.equal(ambiguousCreateInspection.lastReceipt.inFlight?.stableId, 'agent-job/task-one');

  const failedOutcomeReceiptPath = path.join(tempRoot, 'failed-outcome-receipt.json');
  const failedOutcomeLedgerPath = `${failedOutcomeReceiptPath}.ledger`;
  const failedOutcomeSnapshotPath = path.join(tempRoot, 'failed-outcome-snapshot');
  const failedOutcomeTarget = new MemoryMigrationTarget();
  const originalFailedOutcomeCreate = failedOutcomeTarget.create.bind(failedOutcomeTarget);
  failedOutcomeTarget.create = async (document) => {
    const observation = await originalFailedOutcomeCreate(document);
    await fs.chmod(failedOutcomeLedgerPath, 0o500);
    return observation;
  };
  let failedOutcomeError;
  try {
    await importMigrationBundle({
      bundle: diskBundle,
      target: failedOutcomeTarget,
      apply: true,
      writeSnapshot: createImmutableSnapshotWriter(failedOutcomeSnapshotPath),
      persistReceipt: await createImmutableReceiptLedger(failedOutcomeReceiptPath),
    });
  } catch (error) {
    failedOutcomeError = error;
  }
  assert.equal(
    failedOutcomeError?.code,
    'MIGRATION_RECOVERY_REQUIRED',
    'a receipt failure after a target mutation must report recovery-required, not terminal PARTIAL',
  );
  assert.equal(failedOutcomeTarget.documents.has('task-one'), true, 'the recovery contract must acknowledge the possibly committed mutation');
  await fs.chmod(failedOutcomeLedgerPath, 0o700);
  const failedOutcomeEntries = (await fs.readdir(failedOutcomeLedgerPath)).sort();
  const failedOutcomeIntent = JSON.parse(await fs.readFile(path.join(failedOutcomeLedgerPath, failedOutcomeEntries.at(-1)), 'utf8'));
  assert.equal(failedOutcomeIntent.status, 'IN_PROGRESS');
  assert.equal(failedOutcomeIntent.inFlight?.stableId, 'agent-job/task-one');
  assert.match(failedOutcomeIntent.operationId ?? '', /^[0-9a-f-]{36}$/u);
  assert.match(failedOutcomeIntent.requestSha256 ?? '', /^[0-9a-f]{64}$/u);
  assert.equal(failedOutcomeIntent.final, undefined, 'an unpersisted terminal state must never be claimed in the durable ledger');
  await assert.rejects(
    createImmutableReceiptLedger(failedOutcomeReceiptPath),
    (error) => error?.code === 'MIGRATION_RECOVERY_REQUIRED' && /incomplete|recovery|reconcile/i.test(error.message),
    'an existing incomplete ledger must fail closed with an explicit recovery-required classification',
  );

  const failedTerminalReceiptPath = path.join(tempRoot, 'failed-terminal-receipt.json');
  const failedTerminalLedgerPath = `${failedTerminalReceiptPath}.ledger`;
  const failedTerminalTarget = new MemoryMigrationTarget();
  const originalFailedTerminalCreate = failedTerminalTarget.create.bind(failedTerminalTarget);
  let failedTerminalAttempts = 0;
  failedTerminalTarget.create = async (document) => {
    if (document.id === 'task-two') {
      failedTerminalTarget.calls.push({ operation: 'create', id: document.id });
      failedTerminalAttempts += 1;
      if (failedTerminalAttempts === 1) {
        await fs.writeFile(failedTerminalReceiptPath, '{}\n', { flag: 'wx', mode: 0o400 });
      }
      throw Object.assign(new Error('fixture terminal failure'), { statusCode: 400 });
    }
    return originalFailedTerminalCreate(document);
  };
  let failedTerminalError;
  try {
    await importMigrationBundle({
      bundle: diskBundle,
      target: failedTerminalTarget,
      apply: true,
      maxAttempts: 3,
      delay: async () => {},
      writeSnapshot: createImmutableSnapshotWriter(path.join(tempRoot, 'failed-terminal-snapshot')),
      persistReceipt: await createImmutableReceiptLedger(failedTerminalReceiptPath),
    });
  } catch (error) {
    failedTerminalError = error;
  }
  assert.equal(failedTerminalError?.code, 'MIGRATION_RECOVERY_REQUIRED');
  const failedTerminalEntries = (await fs.readdir(failedTerminalLedgerPath)).sort();
  const failedTerminalLast = JSON.parse(await fs.readFile(path.join(failedTerminalLedgerPath, failedTerminalEntries.at(-1)), 'utf8'));
  assert.equal(failedTerminalLast.status, 'IN_PROGRESS', 'failed terminal persistence must leave a durable nonterminal recovery state');
  assert.notEqual(failedTerminalLast.final, true, 'the ledger must not claim terminal PARTIAL when the terminal receipt was not persisted');
  assert.equal(failedTerminalLast.terminalIntent?.status, 'PARTIAL');

  const reconciled = await reconcileMigration({
    bundle: diskBundle,
    target: retryTarget,
    evidenceClass: 'live-azure',
    checkedAt: '2026-09-03T02:00:00.000Z',
  });
  assert.equal(reconciled.status, 'PASS');
  assert.equal(reconciled.evidenceClass, 'local-contract', 'a caller cannot relabel fixture reconciliation as live Azure');
  assert.equal(reconciled.bundleSha256, bundle.manifest.bundleSha256);
  assert.equal(reconciled.recordCounts.total, 2);
  assert.deepEqual(reconciled.stableIds, bundle.manifest.stableIds);

  for (const { label, value } of azureAccountKeyClassOmissionFixtures) {
    const reconciliationSecretTarget = new MemoryMigrationTarget([...retryTarget.documents.values()]);
    const secretDocument = reconciliationSecretTarget.documents.get('task-one');
    secretDocument.value.metadata = { observations: [{ payload: value }] };
    secretDocument.contentHash = sha256(stableMigrationJson(secretDocument.value));
    await assert.rejects(
      reconcileMigration({ bundle: diskBundle, target: reconciliationSecretTarget }),
      /sensitive|secret|credential|account.?key/i,
      `reconciliation must scan target envelopes for a canonical account-key-shaped value ${label}`,
    );
  }

  const mismatchTarget = new MemoryMigrationTarget([...retryTarget.documents.values()]);
  mismatchTarget.documents.get('task-one').contentHash = 'f'.repeat(64);
  await assert.rejects(
    reconcileMigration({ bundle: diskBundle, target: mismatchTarget, evidenceClass: 'local-fixture' }),
    /hash|content/i,
    'reconciliation must fail on a target content hash mismatch',
  );

  const createAppliedRollbackFixture = async (label) => {
    const target = new MemoryMigrationTarget([], { targetId: `rollback-${label}` });
    const importReceiptPath = path.join(tempRoot, `${label}-origin-import-receipt.json`);
    const snapshotPath = path.join(tempRoot, `${label}-origin-snapshot`);
    await importMigrationBundle({
      bundle: diskBundle,
      target,
      apply: true,
      writeSnapshot: createImmutableSnapshotWriter(snapshotPath),
      persistReceipt: await createImmutableReceiptLedger(importReceiptPath),
    });
    const inspection = await inspectImmutableReceiptLedger(importReceiptPath);
    return {
      target,
      snapshot: await readMigrationBundle(snapshotPath),
      originatingImportReceipt: inspection.lastReceipt,
    };
  };
  const createPostCutoverDocument = (id, result) => {
    const value = { ...jobs[0], id, result };
    return {
      ...diskBundle.records[0].document,
      id,
      contentHash: sha256(stableMigrationJson(value)),
      value,
    };
  };
  const rollbackSafetyFailures = [];
  const rollbackSafetyCases = [
    ['post-cutover create is preserved and retry is idempotent', async () => {
      const fixture = await createAppliedRollbackFixture('post-cutover-create');
      fixture.target.externalCreate(createPostCutoverDocument('post-cutover-job', 'created by the live service'));
      const first = await rollbackMigrationSnapshot({
        snapshot: fixture.snapshot,
        target: fixture.target,
        originatingImportReceipt: fixture.originatingImportReceipt,
        apply: true,
        persistReceipt: await createImmutableReceiptLedger(path.join(tempRoot, 'post-cutover-create-rollback.json')),
      });
      assert.equal(first.status, 'ROLLED_BACK');
      assert.deepEqual([...fixture.target.documents.keys()], ['post-cutover-job']);
      assert.equal(first.deleted, 2, 'only the two import-owned records may be deleted');
      const retry = await rollbackMigrationSnapshot({
        snapshot: fixture.snapshot,
        target: fixture.target,
        originatingImportReceipt: fixture.originatingImportReceipt,
        apply: true,
        persistReceipt: await createImmutableReceiptLedger(path.join(tempRoot, 'post-cutover-create-rollback-retry.json')),
      });
      assert.equal(retry.status, 'ROLLED_BACK');
      assert.equal(retry.deleted, 0, 'a retry must treat already-absent import-owned records as rolled back');
      assert.deepEqual([...fixture.target.documents.keys()], ['post-cutover-job']);
    }],
    ['post-cutover update rejects rollback before any mutation', async () => {
      const fixture = await createAppliedRollbackFixture('post-cutover-update');
      fixture.target.externalUpdate('task-one', (document) => {
        const value = { ...document.value, result: 'updated by the live service after cutover' };
        return { ...document, value, contentHash: sha256(stableMigrationJson(value)) };
      });
      const mutationCallCount = fixture.target.calls.length;
      const rollbackReceiptPath = path.join(tempRoot, 'post-cutover-update-rollback.json');
      await assert.rejects(
        rollbackMigrationSnapshot({
          snapshot: fixture.snapshot,
          target: fixture.target,
          originatingImportReceipt: fixture.originatingImportReceipt,
          apply: true,
          persistReceipt: await createImmutableReceiptLedger(rollbackReceiptPath),
        }),
        (error) => error?.code === 'MIGRATION_OWNERSHIP_CONFLICT' && /post-image|etag|concurr|owned/i.test(error.message),
      );
      assert.equal(fixture.target.documents.get('task-one').value.result, 'updated by the live service after cutover');
      assert.equal(fixture.target.documents.has('task-two'), true);
      assert.equal(
        fixture.target.calls.slice(mutationCallCount).some(({ operation }) => ['delete', 'replace', 'create'].includes(operation)),
        false,
        'ownership preflight must reject all target mutations when one import-owned record drifted',
      );
      await assert.rejects(
        fs.stat(`${rollbackReceiptPath}.ledger`),
        { code: 'ENOENT' },
        'a rejected ownership preflight must not leave an empty rollback ledger that blocks idempotent retry',
      );
      await createImmutableReceiptLedger(rollbackReceiptPath);
    }],
    ['wrong originating receipt target is rejected', async () => {
      const fixture = await createAppliedRollbackFixture('correct-target');
      const wrongTarget = new MemoryMigrationTarget(
        [...fixture.target.documents.values()],
        { targetId: 'wrong-target' },
      );
      const mutationCallCount = wrongTarget.calls.length;
      await assert.rejects(
        rollbackMigrationSnapshot({
          snapshot: fixture.snapshot,
          target: wrongTarget,
          originatingImportReceipt: fixture.originatingImportReceipt,
          apply: true,
          persistReceipt: await createImmutableReceiptLedger(path.join(tempRoot, 'wrong-origin-receipt-rollback.json')),
        }),
        (error) => error?.code === 'MIGRATION_RECEIPT_TARGET_MISMATCH' && /receipt|target/i.test(error.message),
      );
      assert.equal(wrongTarget.documents.size, 2);
      assert.equal(
        wrongTarget.calls.slice(mutationCallCount).some(({ operation }) => ['delete', 'replace', 'create'].includes(operation)),
        false,
      );
    }],
    ['mutating a verified receipt after ledger inspection is rejected', async () => {
      const fixture = await createAppliedRollbackFixture('mutated-verified-receipt');
      fixture.target.externalUpdate('task-one', (document) => {
        const value = { ...document.value, result: 'updated after immutable ledger inspection' };
        return { ...document, value, contentHash: sha256(stableMigrationJson(value)) };
      });
      const current = await fixture.target.read('task-one', diskBundle.records[0].document.partitionKey);
      const forgedOwnership = fixture.originatingImportReceipt.ownedMutations.find(({ id }) => id === 'task-one');
      forgedOwnership.postImageSha256 = sha256(stableMigrationJson(current.document));
      forgedOwnership.etag = current.etag;
      await assert.rejects(
        rollbackMigrationSnapshot({
          snapshot: fixture.snapshot,
          target: fixture.target,
          originatingImportReceipt: fixture.originatingImportReceipt,
          apply: true,
          persistReceipt: await createImmutableReceiptLedger(path.join(tempRoot, 'mutated-verified-receipt-rollback.json')),
        }),
        (error) => error?.code === 'MIGRATION_IMPORT_RECEIPT_UNVERIFIED' && /immutable|integrity|ledger|modified/i.test(error.message),
      );
      assert.equal(fixture.target.documents.has('task-one'), true);
      assert.equal(fixture.target.documents.has('task-two'), true);
    }],
    ['concurrent update at delete is fenced by the recorded ETag', async () => {
      const fixture = await createAppliedRollbackFixture('concurrent-delete');
      let raced = false;
      fixture.target.beforeDelete = async ({ id, target }) => {
        if (raced || id !== 'task-one') return;
        raced = true;
        target.externalUpdate(id, (document) => {
          const value = { ...document.value, result: 'raced after ownership preflight' };
          return { ...document, value, contentHash: sha256(stableMigrationJson(value)) };
        });
      };
      const result = await rollbackMigrationSnapshot({
        snapshot: fixture.snapshot,
        target: fixture.target,
        originatingImportReceipt: fixture.originatingImportReceipt,
        apply: true,
        persistReceipt: await createImmutableReceiptLedger(path.join(tempRoot, 'concurrent-delete-rollback.json')),
      });
      assert.equal(result.status, 'PARTIAL');
      assert.deepEqual(result.failedIds, ['agent-job/task-one']);
      assert.equal(fixture.target.documents.get('task-one').value.result, 'raced after ownership preflight');
      assert.equal(fixture.target.documents.has('task-two'), true, 'a concurrency failure must stop later mutations');
      assert.equal(
        fixture.target.calls.filter(({ operation }) => operation === 'delete').length,
        1,
        'the recorded ETag must be passed directly to the first conditional delete',
      );
    }],
  ];
  for (const [name, run] of rollbackSafetyCases) {
    try {
      await run();
    } catch (error) {
      rollbackSafetyFailures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.deepEqual(
    rollbackSafetyFailures,
    [],
    `rollback ownership regressions:\n${rollbackSafetyFailures.join('\n')}`,
  );

  const unverifiedReceiptFixture = await createAppliedRollbackFixture('unverified-origin-receipt');
  await assert.rejects(
    rollbackMigrationSnapshot({
      snapshot: unverifiedReceiptFixture.snapshot,
      target: unverifiedReceiptFixture.target,
      originatingImportReceipt: structuredClone(unverifiedReceiptFixture.originatingImportReceipt),
      apply: true,
      persistReceipt: await createImmutableReceiptLedger(path.join(tempRoot, 'unverified-origin-rollback.json')),
    }),
    (error) => error?.code === 'MIGRATION_IMPORT_RECEIPT_UNVERIFIED' && /verified|immutable|ledger/i.test(error.message),
    'an unverified copy of an import receipt must not authorize rollback',
  );
  assert.deepEqual([...unverifiedReceiptFixture.target.documents.keys()], ['task-one', 'task-two']);

  const noReceiptFixture = await createAppliedRollbackFixture('missing-rollback-ledger');
  await assert.rejects(
    rollbackMigrationSnapshot({
      snapshot: noReceiptFixture.snapshot,
      target: noReceiptFixture.target,
      originatingImportReceipt: noReceiptFixture.originatingImportReceipt,
      apply: true,
    }),
    /durable|receipt|ledger/i,
    'rollback must refuse to mutate without durable evidence',
  );
  assert.deepEqual([...noReceiptFixture.target.documents.keys()], ['task-one', 'task-two']);

  const partialRollbackFixture = await createAppliedRollbackFixture('partial-rollback');
  partialRollbackFixture.target.fail('task-two', 3, 503);
  const partialRollbackReceiptPath = path.join(tempRoot, 'partial-rollback-receipt.json');
  const partialRollback = await rollbackMigrationSnapshot({
    snapshot: partialRollbackFixture.snapshot,
    target: partialRollbackFixture.target,
    originatingImportReceipt: partialRollbackFixture.originatingImportReceipt,
    apply: true,
    maxAttempts: 3,
    delay: async () => {},
    persistReceipt: await createImmutableReceiptLedger(partialRollbackReceiptPath),
  });
  assert.equal(partialRollback.status, 'PARTIAL');
  assert.deepEqual(partialRollback.failedIds, ['agent-job/task-two']);
  const partialRollbackDurableReceipt = JSON.parse(await fs.readFile(partialRollbackReceiptPath, 'utf8'));
  assert.deepEqual(partialRollbackDurableReceipt.failedIds, ['agent-job/task-two']);
  assert.equal(partialRollbackDurableReceipt.reconciliationRequired, true);
  assert.deepEqual([...partialRollbackFixture.target.documents.keys()], ['task-two']);
  const partialRetry = await rollbackMigrationSnapshot({
    snapshot: partialRollbackFixture.snapshot,
    target: partialRollbackFixture.target,
    originatingImportReceipt: partialRollbackFixture.originatingImportReceipt,
    apply: true,
    persistReceipt: await createImmutableReceiptLedger(path.join(tempRoot, 'partial-rollback-retry-receipt.json')),
  });
  assert.equal(partialRetry.status, 'ROLLED_BACK');
  assert.equal(partialRetry.deleted, 1);
  assert.equal(partialRetry.alreadyAbsent, 1);
  assert.equal(partialRollbackFixture.target.documents.size, 0, 'a partial rollback retry must finish idempotently');

  assert.equal(resolveReleaseTarget({}), 'local');
  assert.equal(resolveReleaseTarget({ TEAMS_RELEASE_TARGET: 'azure' }), 'azure');
  assert.throws(
    () => parseAzureStateImportArguments(['--bundle', bundlePath, '--apply', '--snapshot-output', `${bundlePath}-snapshot`]),
    /--receipt|immutable.*ledger/i,
    'the CLI must reject import apply without an immutable receipt ledger path before target creation',
  );
  assert.throws(
    () => parseAzureStateImportArguments(['--rollback-snapshot', bundlePath, '--apply']),
    /--receipt|immutable.*ledger/i,
    'the CLI must reject rollback apply without an immutable receipt ledger path before target creation',
  );
  assert.throws(
    () => parseAzureStateImportArguments(['--rollback-snapshot', bundlePath, '--apply', '--receipt', 'rollback.json']),
    /--import-receipt|originating import/i,
    'the CLI must require the exact originating import receipt for rollback',
  );
  assert.throws(
    () => parseAzureStateImportArguments([
      '--bundle', bundlePath,
      '--apply',
      '--receipt', 'retry.json',
      '--resume-import-receipt', 'partial.json',
    ]),
    /--resume-import-receipt.*--resume-snapshot|supplied together/i,
    'an import retry must bind both the verified prior receipt and its original snapshot',
  );
  const resumeArguments = parseAzureStateImportArguments([
    '--bundle', bundlePath,
    '--apply',
    '--receipt', 'retry.json',
    '--resume-import-receipt', 'partial.json',
    '--resume-snapshot', 'original-snapshot',
  ]);
  assert.equal(resumeArguments.resumeImportReceipt, 'partial.json');
  assert.equal(resumeArguments.resumeSnapshot, 'original-snapshot');
  assert.equal(resumeArguments.snapshotOutput, undefined);
  const localCommands = createPreflightCommands(undefined, 'core', 'local');
  const azureCommands = createPreflightCommands(undefined, 'core', 'azure');
  assert.equal(localCommands.some(([, script]) => script === 'test:azure-state-migration'), false);
  for (const required of [
    'test:azure-state-migration',
    'validate:manifest',
    'test:package-determinism',
  ]) {
    assert.equal(
      azureCommands.filter(([, script]) => script === required).length,
      1,
      `Azure integrated preflight must execute ${required} exactly once`,
    );
  }

  const releaseReceipt = {
    schemaVersion: 1,
    source: 'github-actions',
    commit: sourceCommit,
    version: '1.0.100',
    image: 'ghcr.io/devdoo-teams/teams-app',
    imageDigest: `sha256:${'a'.repeat(64)}`,
    teamsPackageSha256: 'b'.repeat(64),
    clientBundleSha256: 'c'.repeat(64),
    serverBundleSha256: 'd'.repeat(64),
  };
  const liveIdentity = {
    commit: sourceCommit,
    version: releaseReceipt.version,
    imageDigest: releaseReceipt.imageDigest,
    teamsPackageSha256: releaseReceipt.teamsPackageSha256,
    clientBundleSha256: releaseReceipt.clientBundleSha256,
    serverBundleSha256: releaseReceipt.serverBundleSha256,
  };
  const handoffProvenance = {
    schemaVersion: 1,
    repository: 'devdoo-teams/teams-app',
    workflow: 'devdoo-teams/teams-app/.github/workflows/publish-image.yml',
    commit: sourceCommit,
    artifactId: 42,
    artifactDigest: `sha256:${'f'.repeat(64)}`,
    attestationVerified: true,
    attestedSubjects: [
      'azure-release-receipt.json',
      'teams-sdk-mvp.zip',
      `${releaseReceipt.image}@${releaseReceipt.imageDigest}`,
    ],
  };
  const packageManifest = {
    version: releaseReceipt.version,
    id: '22222222-2222-4222-8222-222222222222',
    staticTabs: [{ contentUrl: 'https://teamsapp.example.azurecontainerapps.io/tabs/home/' }],
    validDomains: ['teamsapp.example.azurecontainerapps.io', 'token.botframework.com'],
    webApplicationInfo: {
      id: '33333333-3333-4333-8333-333333333333',
      resource: 'api://teamsapp.example.azurecontainerapps.io/botid-44444444-4444-4444-8444-444444444444',
    },
  };
  const migrationReceipt = { ...reconciled, evidenceClass: 'live-azure' };
  const approvalReceipt = {
    schemaVersion: 1,
    approvalConfigured: true,
    environmentId: '42',
    environmentName: 'teamsapp-canary',
    checkId: 7,
    approverCount: 1,
    releaseIdentity: liveIdentity,
  };
  const providerReceipt = {
    schemaVersion: 1,
    evidenceClass: 'live-azure',
    releaseIdentity: liveIdentity,
    providers: [
      {
        id: 'codex',
        enabled: true,
        state: 'ready',
        liveRoundTrip: 'PASS',
        cancellationRecovery: 'PASS',
        receiptId: 'provider-receipt-1',
        resultSha256: 'e'.repeat(64),
      },
      { id: 'grok', enabled: false, state: 'not-enabled' },
      { id: 'hermes', enabled: false, state: 'not-enabled' },
      { id: 'buzz', enabled: false, state: 'not-enabled' },
      { id: 'github-agent-tasks', enabled: false, state: 'not-enabled' },
    ],
  };
  const publicCanaryReceipt = {
    schemaVersion: 1,
    evidenceClass: 'live-azure',
    status: 'PASS',
    releaseIdentity: liveIdentity,
    revisionName: 'teamsapp--fixture',
    healthUrl: 'https://teamsapp.example.azurecontainerapps.io/api/health',
  };
  const jiraReceipt = {
    schemaVersion: 1,
    evidenceClass: 'live-jira',
    findings: [
      { kind: 'release-blocker', stableId: 'teams-core:platform:azure-canary', jiraKey: 'MP-220', status: 'In Progress' },
    ],
  };
  const packageBytes = Buffer.from('fixture Teams package bytes');
  releaseReceipt.teamsPackageSha256 = sha256(packageBytes);
  liveIdentity.teamsPackageSha256 = releaseReceipt.teamsPackageSha256;

  const azureConfiguration = {
    TEAMS_STORAGE_BACKEND: 'cosmos',
    TEAMS_AGENT_DISPATCH_MODE: 'azure-queue',
    AZURE_COSMOS_ENDPOINT: 'https://teamsapp.documents.azure.com:443/',
    AZURE_COSMOS_DATABASE: 'teamsapp',
    AZURE_COSMOS_CONTAINER: 'runtime-state',
    AZURE_STORAGE_QUEUE_ENDPOINT: 'https://teamsapp.queue.core.windows.net/agent-dispatch',
    AZURE_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
    TEAMS_APP_ID: '22222222-2222-4222-8222-222222222222',
    TAB_DOMAIN: 'teamsapp.example.azurecontainerapps.io',
    CLIENT_ID: '33333333-3333-4333-8333-333333333333',
    BOT_CLIENT_ID: '44444444-4444-4444-8444-444444444444',
    APPLICATION_ID_URI: 'api://teamsapp.example.azurecontainerapps.io/botid-44444444-4444-4444-8444-444444444444',
    AZURE_DEVOPS_ENVIRONMENT_ID: '42',
    AZURE_DEVOPS_ENVIRONMENT_NAME: 'teamsapp-canary',
  };
  const integratedEvidence = {
    env: azureConfiguration,
    releaseReceipt,
    handoffProvenance,
    sourceCommit,
    sourceManifest: { version: '1.0.100' },
    packageBytes,
    packageManifest,
    migrationBundle: diskBundle,
    migrationReceipt,
    approvalReceipt,
    providerReceipt,
    publicCanaryReceipt,
    jiraReceipt,
  };
  const producerMigrationReceipt = structuredClone(migrationReceipt);
  delete producerMigrationReceipt.evidenceClass;
  delete producerMigrationReceipt.targetObservation;
  delete producerMigrationReceipt.targetBinding;
  const producerProviderReceipt = structuredClone(providerReceipt);
  delete producerProviderReceipt.evidenceClass;
  const producerPublicCanaryReceipt = {
    ...publicCanaryReceipt,
    revisionName: 'teamsapp--canary-abc123',
  };
  delete producerPublicCanaryReceipt.evidenceClass;
  const producerJiraReceipt = structuredClone(jiraReceipt);
  delete producerJiraReceipt.evidenceClass;

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const attestationKeyId = 'ado-release-producer-2026-09';
  const attestationIssuer = 'https://dev.azure.com/devdoo';
  const attestationSubject = 'devdoo-teams/teams-app/azure-release';
  const attestationAudience = 'teamsapp-azure-release-gate';
  const expectedChallenge = {
    releaseRunId: 'release-run-20260904-0001',
    challengeId: 'challenge-20260904-0001',
    nonce: 'nonce-20260904-0001',
    attempt: 1,
  };
  const attestationPayload = {
    schemaVersion: 'teamsapp.azure-release-aggregate-attestation.v1',
    algorithm: 'Ed25519',
    keyId: attestationKeyId,
    producer: 'azure-devops-release-pipeline',
    issuer: attestationIssuer,
    subject: attestationSubject,
    audience: attestationAudience,
    environment: {
      id: azureConfiguration.AZURE_DEVOPS_ENVIRONMENT_ID,
      name: azureConfiguration.AZURE_DEVOPS_ENVIRONMENT_NAME,
    },
    resource: {
      cosmosEndpoint: azureConfiguration.AZURE_COSMOS_ENDPOINT,
      cosmosDatabase: azureConfiguration.AZURE_COSMOS_DATABASE,
      cosmosContainer: azureConfiguration.AZURE_COSMOS_CONTAINER,
      storageQueueEndpoint: azureConfiguration.AZURE_STORAGE_QUEUE_ENDPOINT,
      azureClientId: azureConfiguration.AZURE_CLIENT_ID,
      teamsAppId: azureConfiguration.TEAMS_APP_ID,
      tabDomain: azureConfiguration.TAB_DOMAIN,
    },
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    operation: {
      releaseRunId: expectedChallenge.releaseRunId,
      challengeId: expectedChallenge.challengeId,
      attempt: expectedChallenge.attempt,
    },
    nonce: expectedChallenge.nonce,
    releaseIdentity: {
      commit: releaseReceipt.commit,
      version: releaseReceipt.version,
      image: releaseReceipt.image,
      imageDigest: releaseReceipt.imageDigest,
      teamsPackageSha256: releaseReceipt.teamsPackageSha256,
      clientBundleSha256: releaseReceipt.clientBundleSha256,
      serverBundleSha256: releaseReceipt.serverBundleSha256,
    },
    evidenceHashes: {
      releaseReceipt: sha256(stableMigrationJson(releaseReceipt)),
      handoffProvenance: sha256(stableMigrationJson(handoffProvenance)),
      migrationBundle: sha256(stableMigrationJson(diskBundle)),
      migrationReceipt: sha256(stableMigrationJson(producerMigrationReceipt)),
      approvalReceipt: sha256(stableMigrationJson(approvalReceipt)),
      providerReceipt: sha256(stableMigrationJson(producerProviderReceipt)),
      publicCanaryReceipt: sha256(stableMigrationJson(producerPublicCanaryReceipt)),
      jiraReceipt: sha256(stableMigrationJson(producerJiraReceipt)),
    },
  };
  const trustedAttestationConfiguration = JSON.stringify({
    [attestationKeyId]: {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      issuer: attestationIssuer,
      subject: attestationSubject,
      audience: attestationAudience,
    },
  });
  const signedIntegratedEvidence = {
    ...integratedEvidence,
    env: {
      ...azureConfiguration,
      AZURE_RELEASE_ATTESTATION_TRUSTED_PUBLIC_KEYS: trustedAttestationConfiguration,
    },
    migrationReceipt: producerMigrationReceipt,
    providerReceipt: producerProviderReceipt,
    publicCanaryReceipt: producerPublicCanaryReceipt,
    jiraReceipt: producerJiraReceipt,
    aggregateAttestation: signAggregateAttestation(attestationPayload, privateKey),
  };

  const createLocalVerifier = () => createLocalSignedAzureEvidenceVerifier({
    expectedConfiguration: azureConfiguration,
    trustedPublicKeys: JSON.parse(trustedAttestationConfiguration),
    expectedChallenge,
  });

  assert.throws(
    () => validateAzureIntegratedEvidence(signedIntegratedEvidence),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' && /protected|operational|trust/i.test(error.message),
    'caller-controlled evidence configuration and signing keys must never produce operational READY',
  );
  const localContractResult = createLocalVerifier().verify(signedIntegratedEvidence);
  assert.equal(localContractResult.status, 'LOCAL_SIGNED_VERIFIER_CONTRACT_PASS');
  assert.equal(localContractResult.evidenceClass, 'local-signed-verifier-contract');
  assert.deepEqual(localContractResult.attestation.operation, attestationPayload.operation);
  for (const [healthUrl, description] of [
    ['https://wrong.example.azurecontainerapps.io/api/health', 'wrong origin'],
    ['https://user:password@teamsapp.example.azurecontainerapps.io/api/health', 'embedded credentials'],
    ['https://teamsapp.example.azurecontainerapps.io/api/health?release=forged', 'query'],
    ['https://teamsapp.example.azurecontainerapps.io/api/health#forged', 'fragment'],
  ]) {
    assert.throws(
      () => createLocalVerifier().verify({
        ...signedIntegratedEvidence,
        publicCanaryReceipt: { ...producerPublicCanaryReceipt, healthUrl },
      }),
      (error) => error?.code === 'AZURE_INTEGRATED_GATE_BLOCKED' && /canary|origin|target|unsafe/i.test(error.message),
      `a public canary health URL with a ${description} must fail before attestation verification`,
    );
  }

  const assertAttestationRejected = (aggregateAttestation, pattern, message) => assert.throws(
    () => createLocalVerifier().verify({ ...signedIntegratedEvidence, aggregateAttestation }),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' && pattern.test(error.message),
    message,
  );
  const resign = (changes) => signAggregateAttestation({ ...attestationPayload, ...changes }, privateKey);
  assertAttestationRejected(
    { ...attestationPayload },
    /unsigned|signature/i,
    'unsigned aggregate JSON must never satisfy the producer-attestation boundary',
  );
  assertAttestationRejected(
    signAggregateAttestation({ ...attestationPayload, keyId: 'unknown-producer-key' }, privateKey),
    /key|allowlist|trusted/i,
    'an attestation from a non-allowlisted key must be rejected',
  );
  assertAttestationRejected(resign({ issuer: 'https://dev.azure.com/forged' }), /issuer/i, 'a wrong issuer must be rejected');
  assertAttestationRejected(resign({ subject: 'another/release' }), /subject/i, 'a wrong subject must be rejected');
  assertAttestationRejected(resign({ audience: 'another-release-gate' }), /audience/i, 'a wrong audience must be rejected');
  assertAttestationRejected(
    resign({ nonce: 'nonce-20260904-wrong' }),
    /nonce|challenge/i,
    'a signed nonce must match the independently protected release challenge',
  );
  assertAttestationRejected(
    resign({ operation: { ...attestationPayload.operation, releaseRunId: 'release-run-20260904-wrong' } }),
    /release|operation|challenge/i,
    'a signed release run ID must match the independently protected release challenge',
  );
  assertAttestationRejected(
    resign({ operation: { ...attestationPayload.operation, challengeId: 'challenge-20260904-wrong' } }),
    /operation|challenge/i,
    'a signed challenge ID must match the independently protected release challenge',
  );
  assertAttestationRejected(
    resign({ operation: { ...attestationPayload.operation, attempt: 2 } }),
    /attempt|operation|challenge/i,
    'a signed attempt must match the independently protected release challenge',
  );
  assertAttestationRejected(
    resign({ environment: { ...attestationPayload.environment, id: '99' } }),
    /environment/i,
    'a wrong Azure DevOps environment binding must be rejected',
  );
  assertAttestationRejected(
    resign({ resource: { ...attestationPayload.resource, cosmosContainer: 'wrong-container' } }),
    /resource|target/i,
    'a wrong Azure target binding must be rejected',
  );
  assertAttestationRejected(
    resign({ releaseIdentity: { ...attestationPayload.releaseIdentity, version: '9.9.9' } }),
    /release|version|identity/i,
    'a wrong release identity must be rejected',
  );
  assertAttestationRejected(
    resign({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
    /expired|expiry/i,
    'an expired producer attestation must be rejected',
  );
  assertAttestationRejected(
    resign({ producer: 'fixture' }),
    /fixture|producer|provenance/i,
    'fixture provenance must remain fixture and never satisfy the live producer contract',
  );
  const localFixtureMigrationReceipt = {
    ...producerMigrationReceipt,
    evidenceClass: 'local-contract',
  };
  const localFixturePayload = {
    ...attestationPayload,
    evidenceHashes: {
      ...attestationPayload.evidenceHashes,
      migrationReceipt: sha256(stableMigrationJson(localFixtureMigrationReceipt)),
    },
  };
  assert.throws(
    () => createLocalVerifier().verify({
      ...signedIntegratedEvidence,
      migrationReceipt: localFixtureMigrationReceipt,
      aggregateAttestation: signAggregateAttestation(localFixturePayload, privateKey),
    }),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' && /fixture|local-contract|provenance/i.test(error.message),
    'a valid signature must not promote explicitly local fixture evidence',
  );
  assertAttestationRejected(
    {
      ...signedIntegratedEvidence.aggregateAttestation,
      signature: `${signedIntegratedEvidence.aggregateAttestation.signature.startsWith('A') ? 'B' : 'A'}${signedIntegratedEvidence.aggregateAttestation.signature.slice(1)}`,
    },
    /signature|verification/i,
    'a forged Ed25519 signature must be rejected',
  );
  assert.throws(
    () => createLocalVerifier().verify({
      ...signedIntegratedEvidence,
      providerReceipt: {
        ...producerProviderReceipt,
        providers: producerProviderReceipt.providers.map((provider) => (
          provider.id === 'codex' ? { ...provider, receiptId: 'tampered-receipt' } : provider
        )),
      },
    }),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' && /hash|provider|evidence/i.test(error.message),
    'tampering with signed provider evidence must invalidate the aggregate evidence binding',
  );
  const oneShotVerifier = createLocalVerifier();
  assert.equal(oneShotVerifier.verify(signedIntegratedEvidence).status, 'LOCAL_SIGNED_VERIFIER_CONTRACT_PASS');
  assert.throws(
    () => oneShotVerifier.verify(signedIntegratedEvidence),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' && /replay|consumed|challenge/i.test(error.message),
    'a consumed signed release challenge must not be replayed through the protected verifier interface',
  );
  const operationalChallengePath = path.join(tempRoot, 'operational-challenge-consumed');
  const createOperationalVerifier = () => createLocalProtectedAzureOperationalVerifier({
    expectedConfiguration: azureConfiguration,
    trustedPublicKeys: JSON.parse(trustedAttestationConfiguration),
    expectedChallenge,
    challengeStore: createLocalDurableAzureChallengeStore(operationalChallengePath),
  });
  const operationalResult = createOperationalVerifier().verify(signedIntegratedEvidence);
  assert.equal(operationalResult.status, 'PROTECTED_OPERATIONAL_VERIFIER_CONTRACT_PASS');
  assert.equal(operationalResult.evidenceClass, 'protected-operational-verifier-contract');
  assert.notEqual(operationalResult.status, 'READY', 'the local protected fixture must never masquerade as production readiness');
  assert.throws(
    () => createOperationalVerifier().verify(signedIntegratedEvidence),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' && /replay|consumed|challenge/i.test(error.message),
    'the durable protected challenge must reject the same release evidence after verifier recreation/restart',
  );
  assert.throws(
    () => createProtectedAzureOperationalEvidenceVerifier({
      kind: 'protected-operational-verifier',
      getPolicy: () => ({
        configuration: azureConfiguration,
        trustedPublicKeys: JSON.parse(trustedAttestationConfiguration),
        expectedChallenge,
      }),
      consumeChallenge: () => true,
    }),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' && /protected|caller|deployment/i.test(error.message),
    'a caller-created lookalike provider must not cross the operational verifier boundary',
  );
  const operationalReplayFixturePath = path.join(tempRoot, 'operational-replay-fixture.json');
  await fs.writeFile(
    operationalReplayFixturePath,
    `${JSON.stringify({
      expectedConfiguration: azureConfiguration,
      trustedPublicKeys: JSON.parse(trustedAttestationConfiguration),
      expectedChallenge,
      evidence: { ...signedIntegratedEvidence, packageBytes: [...packageBytes] },
    })}\n`,
    { flag: 'wx', mode: 0o400 },
  );
  const releaseGateModuleUrl = new URL('./release-gate.mjs', import.meta.url).href;
  const restartProbe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import fs from 'node:fs/promises';
import { createLocalDurableAzureChallengeStore, createLocalProtectedAzureOperationalVerifier } from ${JSON.stringify(releaseGateModuleUrl)};
const [fixturePath, markerPath] = process.argv.slice(1);
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const verifier = createLocalProtectedAzureOperationalVerifier({
  expectedConfiguration: fixture.expectedConfiguration,
  trustedPublicKeys: fixture.trustedPublicKeys,
  expectedChallenge: fixture.expectedChallenge,
  challengeStore: createLocalDurableAzureChallengeStore(markerPath),
});
const evidence = { ...fixture.evidence, packageBytes: Uint8Array.from(fixture.evidence.packageBytes) };
try {
  verifier.verify(evidence);
  console.error('same challenge was accepted after process restart');
  process.exitCode = 1;
} catch (error) {
  if (error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' && /replay|consumed|challenge/i.test(error.message)) {
    process.exit(0);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}`,
      operationalReplayFixturePath,
      operationalChallengePath,
    ],
    {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  assert.equal(
    restartProbe.error,
    undefined,
    `protected verifier restart probe failed to spawn: ${restartProbe.error?.message ?? 'unknown error'}`,
  );
  assert.equal(
    restartProbe.status,
    0,
    `same-challenge replay after process restart was not rejected: ${restartProbe.stdout}\n${restartProbe.stderr}`,
  );
  const mutableConfiguration = structuredClone(azureConfiguration);
  const mutableTrust = JSON.parse(trustedAttestationConfiguration);
  const mutableChallenge = structuredClone(expectedChallenge);
  const immutablePolicyVerifier = createLocalSignedAzureEvidenceVerifier({
    expectedConfiguration: mutableConfiguration,
    trustedPublicKeys: mutableTrust,
    expectedChallenge: mutableChallenge,
  });
  mutableConfiguration.TAB_DOMAIN = 'caller-mutated.example';
  mutableTrust[attestationKeyId].publicKeyPem = 'caller-mutated';
  mutableChallenge.nonce = 'caller-mutated-nonce';
  assert.equal(
    immutablePolicyVerifier.verify(signedIntegratedEvidence).status,
    'LOCAL_SIGNED_VERIFIER_CONTRACT_PASS',
    'the protected verifier must snapshot target, trust, and challenge policy before caller mutation',
  );

  assert.throws(
    () => createLocalVerifier().verify(integratedEvidence),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' && /unsigned|local|provenance/i.test(error.message),
    'unsigned local JSON must not self-declare live Azure, provider, canary, approval, or Jira evidence',
  );

  assert.throws(
    () => validateAzureIntegratedEvidence({
      ...integratedEvidence,
      providerReceipt: {
        ...providerReceipt,
        diagnostics: { nested: { refresh_token: 'must-not-enter-preflight-evidence' } },
      },
    }),
    /sensitive|secret|credential/i,
    'preflight receipts must use the same recursive secret guard as migration artifacts',
  );
  assert.throws(
    () => validateAzureIntegratedEvidence({
      ...integratedEvidence,
      providerReceipt: {
        ...providerReceipt,
        diagnostics: [{ observations: [{ payload: azureAccountKeyFixture }] }],
      },
    }),
    /sensitive|secret|credential|account.?key/i,
    'a full preflight envelope must reject a neutral-key Azure account-key shape nested in arrays',
  );
  for (const { label, value } of azureAccountKeyClassOmissionFixtures) {
    assert.throws(
      () => validateAzureIntegratedEvidence({
        ...integratedEvidence,
        providerReceipt: {
          ...providerReceipt,
          diagnostics: [{ observations: [{ payload: value }] }],
        },
      }),
      /sensitive|secret|credential|account.?key/i,
      `preflight must reject a canonical account-key-shaped value ${label}`,
    );
  }
  const preflightBundleSecret = cloneBundle(diskBundle);
  preflightBundleSecret.records[0].document.extra = { sessionTokens: ['opaque-preflight-secret'] };
  assert.throws(
    () => validateAzureIntegratedEvidence({ ...integratedEvidence, migrationBundle: preflightBundleSecret }),
    /sensitive|secret|credential/i,
    'preflight must scan the complete migration bundle envelope before structural validation',
  );

  const otherCommit = '89abcdef0123456789abcdef0123456789abcdef';
  const otherBundle = createAgentJobExportBundle({ jobs, sourceCommit: otherCommit, exportedAt });
  const otherTarget = new MemoryMigrationTarget(otherBundle.records.map((record) => record.document));
  const otherReconciliation = await reconcileMigration({
    bundle: otherBundle,
    target: otherTarget,
    evidenceClass: 'live-azure',
    checkedAt: '2026-09-03T02:30:00.000Z',
  });
  assert.throws(
    () => validateAzureIntegratedEvidence({
      ...integratedEvidence,
      migrationBundle: otherBundle,
      migrationReceipt: otherReconciliation,
    }),
    /migration.*source.*commit|source.*commit.*migration/i,
    'a valid migration bundle and receipt from another source commit must not satisfy this release handoff',
  );
  assert.throws(
    () => validateAzureIntegratedEvidence({
      ...integratedEvidence,
      migrationReceipt: { ...migrationReceipt, sourceCommit: otherCommit },
    }),
    /migration.*source.*commit|source.*commit.*migration/i,
    'a reconciliation receipt from another source commit must not satisfy this release handoff',
  );
  const bundleWithoutSourceCommit = cloneBundle(diskBundle);
  delete bundleWithoutSourceCommit.manifest.source.commit;
  assert.throws(
    () => validateAzureIntegratedEvidence({
      ...integratedEvidence,
      migrationBundle: bundleWithoutSourceCommit,
    }),
    /source commit|Git OID|commit/i,
    'a migration bundle without manifest.source.commit must fail closed',
  );
  assert.throws(
    () => validateAzureIntegratedEvidence({
      ...integratedEvidence,
      migrationReceipt: { ...migrationReceipt, sourceCommit: undefined },
    }),
    /migration.*source.*commit|source.*commit.*migration/i,
    'a reconciliation receipt without sourceCommit must fail closed',
  );
  assert.throws(
    () => validateAzureIntegratedEvidence({
      ...integratedEvidence,
      approvalReceipt: { ...approvalReceipt, environmentName: 'different-environment' },
    }),
    /approval.*environment|environment.*approval/i,
    'approval evidence must bind the exact configured Azure DevOps environment and release identity',
  );

  assert.throws(
    () => validateAzureIntegratedEvidence({
      env: azureConfiguration,
      releaseReceipt,
      handoffProvenance,
      sourceCommit,
      sourceManifest: { version: '1.0.100' },
      packageBytes,
      packageManifest: {
        ...packageManifest,
        staticTabs: [{ contentUrl: 'https://wrong.example/tabs/home/' }],
      },
      migrationBundle: diskBundle,
      migrationReceipt,
      approvalReceipt,
      providerReceipt,
      publicCanaryReceipt,
      jiraReceipt,
    }),
    /package|tab|origin|domain|identity/i,
    'the Teams package tab/SSO identity must match the Azure canary contract',
  );

  assert.throws(
    () => validateAzureIntegratedEvidence({
      env: azureConfiguration,
      releaseReceipt,
      handoffProvenance,
      sourceCommit,
      sourceManifest: { version: '1.0.100' },
      packageBytes,
      packageManifest,
      migrationBundle: diskBundle,
      migrationReceipt: reconciled,
      approvalReceipt,
      providerReceipt,
      publicCanaryReceipt,
      jiraReceipt,
    }),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    'local fixture reconciliation must never satisfy the live Azure migration gate',
  );

  assert.throws(
    () => validateAzureIntegratedEvidence({
      env: azureConfiguration,
      releaseReceipt,
      handoffProvenance,
      sourceCommit,
      sourceManifest: { version: '1.0.100' },
      packageBytes,
      packageManifest,
      migrationBundle: diskBundle,
      migrationReceipt,
      approvalReceipt,
      providerReceipt: {
        ...providerReceipt,
        providers: [{ ...providerReceipt.providers[0], resultSha256: undefined }],
      },
      publicCanaryReceipt,
      jiraReceipt,
    }),
    /provider|result|live/i,
    'an enabled provider without a nonempty live result digest must fail closed',
  );

  assert.throws(
    () => validateAzureIntegratedEvidence({
      env: azureConfiguration,
      releaseReceipt,
      handoffProvenance,
      sourceCommit,
      sourceManifest: { version: '1.0.100' },
      packageBytes,
      packageManifest,
      migrationBundle: diskBundle,
      migrationReceipt,
      approvalReceipt,
      providerReceipt,
      publicCanaryReceipt: { ...publicCanaryReceipt, evidenceClass: 'local-fixture' },
      jiraReceipt,
    }),
    (error) => error?.code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    'fixture-only canary identity must be classified as unverified live evidence',
  );

  console.log('azure-state-migration-test: PASS');
} finally {
  await fs.chmod(path.join(tempRoot, 'immutable-export'), 0o755).catch(() => {});
  const entries = await fs.readdir(tempRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await fs.chmod(path.join(tempRoot, entry.name), 0o700).catch(() => {});
    }
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}
