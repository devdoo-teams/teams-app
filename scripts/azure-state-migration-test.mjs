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
  importMigrationBundle,
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
    evidenceClass: 'local-fixture',
  });
  assert.equal(dryRun.status, 'DRY_RUN');
  assert.equal(dryRun.plannedCreates, 2);
  assert.equal(dryRunTarget.calls.some(({ operation }) => operation !== 'list'), false);

  const retryTarget = new MemoryMigrationTarget();
  retryTarget.fail('task-one', 2, 503);
  const delays = [];
  let snapshot;
  const applied = await importMigrationBundle({
    bundle: diskBundle,
    target: retryTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    maxAttempts: 3,
    delay: async (milliseconds) => delays.push(milliseconds),
    writeSnapshot: async (nextSnapshot) => { snapshot = nextSnapshot; },
  });
  assert.equal(applied.status, 'APPLIED');
  assert.equal(applied.created, 2);
  assert.deepEqual(delays, [100, 200], 'transient writes must use bounded retries');
  assert.equal(snapshot.manifest.recordCounts.total, 0, 'the pre-import target snapshot must precede all writes');

  const repeat = await importMigrationBundle({
    bundle: diskBundle,
    target: retryTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    writeSnapshot: async () => {},
  });
  assert.equal(repeat.status, 'APPLIED');
  assert.equal(repeat.created, 0);
  assert.equal(repeat.unchanged, 2, 'repeated import must be idempotent');

  const partialTarget = new MemoryMigrationTarget();
  partialTarget.fail('task-two', 3, 503);
  const partial = await importMigrationBundle({
    bundle: diskBundle,
    target: partialTarget,
    apply: true,
    evidenceClass: 'local-fixture',
    maxAttempts: 3,
    delay: async () => {},
    writeSnapshot: async () => {},
  });
  assert.equal(partial.status, 'PARTIAL');
  assert.deepEqual(partial.failedIds, ['agent-job/task-two']);
  assert.equal(partialTarget.documents.has('task-one'), true);
  assert.equal(partialTarget.documents.has('task-two'), false);

  const reconciled = await reconcileMigration({
    bundle: diskBundle,
    target: retryTarget,
    evidenceClass: 'local-fixture',
    checkedAt: '2026-09-03T02:00:00.000Z',
  });
  assert.equal(reconciled.status, 'PASS');
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
  const rollback = await rollbackMigrationSnapshot({
    snapshot: rollbackSnapshot,
    target: rollbackTarget,
    apply: true,
    evidenceClass: 'local-fixture',
  });
  assert.equal(rollback.status, 'ROLLED_BACK');
  assert.deepEqual([...rollbackTarget.documents.keys()], ['task-one']);
  assert.equal(rollbackTarget.documents.get('task-one').value.result, 'pre-import value');
  assert.equal(rollbackTarget.documents.get('task-one').idempotencyKey, 'pre-import-envelope-key');
  assert.equal(rollbackTarget.documents.get('task-one').updatedAt, '2026-09-01T00:00:30.000Z');

  assert.equal(resolveReleaseTarget({}), 'local');
  assert.equal(resolveReleaseTarget({ TEAMS_RELEASE_TARGET: 'azure' }), 'azure');
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

  const integrated = validateAzureIntegratedEvidence({
    env: {
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
    },
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
  });
  assert.equal(integrated.status, 'READY');
  assert.equal(integrated.evidence.every(({ evidenceClass }) => evidenceClass !== 'local-fixture'), true);

  assert.throws(
    () => validateAzureIntegratedEvidence({
      env: integrated.configuration,
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
      env: integrated.configuration,
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
      env: integrated.configuration,
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
      env: integrated.configuration,
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
  await fs.rm(tempRoot, { recursive: true, force: true });
}
