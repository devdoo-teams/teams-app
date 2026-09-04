import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  importMigrationBundle,
  parseAzureStateImportArguments,
  rollbackMigrationSnapshot,
} from './azure-state-import.mjs';
import { reconcileMigration } from './azure-state-reconcile.mjs';
import {
  createPreflightCommands,
  resolveReleaseTarget,
  validateAzureIntegratedEvidence,
} from './release-gate.mjs';

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const exportedAt = '2026-09-03T01:02:03.000Z';
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
  constructor(documents = []) {
    this.documents = new Map(documents.map((document) => [document.id, structuredClone(document)]));
    this.calls = [];
    this.failures = new Map();
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
  }

  async replace(document) {
    this.calls.push({ operation: 'replace', id: document.id });
    this.maybeFail(document.id);
    if (!this.documents.has(document.id)) throw Object.assign(new Error('missing'), { statusCode: 404 });
    this.documents.set(document.id, structuredClone(document));
  }

  async delete(id, partitionKey) {
    this.calls.push({ operation: 'delete', id, partitionKey });
    this.maybeFail(id);
    this.documents.delete(id);
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
assert.doesNotThrow(
  () => createAgentJobExportBundle({
    jobs: [{
      ...jobs[0],
      metadata: {
        tokenCount: 42,
        secretReference: 'key-vault://teamsapp/provider-token',
        authorizationStatus: 'required',
        connectionStatus: 'healthy',
        passwordPolicy: 'minimum-length-16',
        tokenBudget: 4096,
        secretRotationPolicy: 'quarterly',
        authorizationScheme: 'managed-identity',
        secretaryName: 'ordinary-domain-value',
      },
    }],
    sourceCommit,
    exportedAt,
  }),
  'ordinary non-secret metadata and credential references must remain exportable',
);

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
  const importReceiptPath = path.join(tempRoot, 'import-receipt.json');
  const persistImportReceipt = await createImmutableReceiptLedger(importReceiptPath);
  const applied = await importMigrationBundle({
    bundle: diskBundle,
    target: retryTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    maxAttempts: 3,
    delay: async (milliseconds) => delays.push(milliseconds),
    writeSnapshot: async (nextSnapshot) => { snapshot = nextSnapshot; },
    persistReceipt: persistImportReceipt,
  });
  assert.equal(applied.status, 'APPLIED');
  assert.equal(applied.created, 2);
  assert.deepEqual(delays, [100, 200], 'transient writes must use bounded retries');
  assert.equal(snapshot.manifest.recordCounts.total, 0, 'the pre-import target snapshot must precede all writes');

  const repeatReceiptPath = path.join(tempRoot, 'repeat-import-receipt.json');
  const repeat = await importMigrationBundle({
    bundle: diskBundle,
    target: retryTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    writeSnapshot: async () => {},
    persistReceipt: await createImmutableReceiptLedger(repeatReceiptPath),
  });
  assert.equal(repeat.status, 'APPLIED');
  assert.equal(repeat.created, 0);
  assert.equal(repeat.unchanged, 2, 'repeated import must be idempotent');

  const partialTarget = new MemoryMigrationTarget();
  partialTarget.fail('task-two', 3, 503);
  const partialReceiptPath = path.join(tempRoot, 'partial-import-receipt.json');
  const partialPersistReceipt = await createImmutableReceiptLedger(partialReceiptPath);
  const partial = await importMigrationBundle({
    bundle: diskBundle,
    target: partialTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    maxAttempts: 3,
    delay: async () => {},
    writeSnapshot: async () => {},
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

  const mismatchTarget = new MemoryMigrationTarget([...retryTarget.documents.values()]);
  mismatchTarget.documents.get('task-one').contentHash = 'f'.repeat(64);
  await assert.rejects(
    reconcileMigration({ bundle: diskBundle, target: mismatchTarget, evidenceClass: 'local-fixture' }),
    /hash|content/i,
    'reconciliation must fail on a target content hash mismatch',
  );

  const priorValue = { ...jobs[0], result: 'pre-import value' };
  const priorDocument = {
    ...bundle.records[0].document,
    idempotencyKey: 'pre-import-envelope-key',
    contentHash: sha256(stableMigrationJson(priorValue)),
    value: priorValue,
    etag: 'pre-import-domain-etag',
    updatedAt: '2026-09-01T00:00:30.000Z',
  };
  const rollbackTarget = new MemoryMigrationTarget([...retryTarget.documents.values()]);
  const rollbackSnapshot = createRuntimeSnapshotBundle({
    documents: [priorDocument],
    sourceCommit,
    exportedAt,
  });
  await assert.rejects(
    rollbackMigrationSnapshot({ snapshot: rollbackSnapshot, target: rollbackTarget, apply: true }),
    /durable|receipt|ledger/i,
    'rollback must refuse to mutate without durable evidence',
  );
  assert.deepEqual([...rollbackTarget.documents.keys()], ['task-one', 'task-two']);
  const rollbackReceiptPath = path.join(tempRoot, 'rollback-receipt.json');
  const rollback = await rollbackMigrationSnapshot({
    snapshot: rollbackSnapshot,
    target: rollbackTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    persistReceipt: await createImmutableReceiptLedger(rollbackReceiptPath),
  });
  assert.equal(rollback.status, 'ROLLED_BACK');
  assert.deepEqual([...rollbackTarget.documents.keys()], ['task-one']);
  assert.equal(rollbackTarget.documents.get('task-one').value.result, 'pre-import value');
  assert.equal(rollbackTarget.documents.get('task-one').idempotencyKey, 'pre-import-envelope-key');
  assert.equal(rollbackTarget.documents.get('task-one').updatedAt, '2026-09-01T00:00:30.000Z');
  assert.equal(JSON.parse(await fs.readFile(rollbackReceiptPath, 'utf8')).status, 'ROLLED_BACK');

  const partialRollbackTarget = new MemoryMigrationTarget([...retryTarget.documents.values()]);
  partialRollbackTarget.fail('task-two', 3, 503);
  const partialRollbackReceiptPath = path.join(tempRoot, 'partial-rollback-receipt.json');
  const partialRollback = await rollbackMigrationSnapshot({
    snapshot: rollbackSnapshot,
    target: partialRollbackTarget,
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
    devicePermissions: ['geolocation'],
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

  assert.throws(
    () => validateAzureIntegratedEvidence(integratedEvidence),
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
    if (entry.isDirectory() && entry.name.endsWith('.ledger')) {
      await fs.chmod(path.join(tempRoot, entry.name), 0o700).catch(() => {});
    }
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}
