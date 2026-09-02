import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import { RuntimeStoreAgentJobLedger } from '../src/server/storage/agent-job-durable-ledger.js';
import {
  RuntimeStoreConflictError,
  type RuntimeRecord,
  type RuntimeScope,
  type RuntimeStore,
  type RuntimeWrite,
} from '../src/server/storage/runtime-store.js';

class MemoryRuntimeStore implements RuntimeStore {
  private readonly records = new Map<string, RuntimeRecord>();
  private revision = 0;

  async read<T>(scope: RuntimeScope, id: string): Promise<RuntimeRecord<T> | null> {
    const record = this.records.get(this.key(scope, id));
    return record ? structuredClone(record) as RuntimeRecord<T> : null;
  }

  async list<T>(scope: RuntimeScope): Promise<Array<RuntimeRecord<T>>> {
    const prefix = `${JSON.stringify(scope)}\u0000`;
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, record]) => structuredClone(record) as RuntimeRecord<T>);
  }

  async write<T>(scope: RuntimeScope, input: RuntimeWrite<T>): Promise<RuntimeRecord<T>> {
    const key = this.key(scope, input.id);
    const current = this.records.get(key);
    if (current && input.expectedEtag !== current.etag) throw new RuntimeStoreConflictError('stale ETag');
    if (!current && input.expectedEtag) throw new RuntimeStoreConflictError('missing record');
    const now = new Date().toISOString();
    const record: RuntimeRecord<T> = {
      id: input.id,
      value: structuredClone(input.value),
      etag: `etag-${++this.revision}`,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(key, structuredClone(record));
    return structuredClone(record);
  }

  private key(scope: RuntimeScope, id: string): string {
    return `${JSON.stringify(scope)}\u0000${id}`;
  }
}

const scope: AgentJobScope = {
  tenantId: 'tenant-ledger',
  requesterId: 'requester-ledger',
  conversationId: 'conversation-ledger',
};
const otherScope: AgentJobScope = { ...scope, requesterId: 'other-requester' };
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-job-ledger-'));
try {
  const runtimeStore = new MemoryRuntimeStore();
  const first = new AgentJobStore(path.join(root, 'ephemeral-first.json'), {
    durableLedger: new RuntimeStoreAgentJobLedger(runtimeStore),
  });
  await first.initialize();
  const created = await first.create({
    prompt: 'persist scoped identity across an ACA recycle',
    provider: 'codex',
    mode: 'read-only',
    scope,
    idempotencyKey: 'ledger-submit-1',
    requestHash: 'a'.repeat(64),
  });
  await first.update(created.id, scope, {
    status: 'running',
    startedAt: '2026-09-03T00:00:00.000Z',
  });

  const second = new AgentJobStore(path.join(root, 'ephemeral-second.json'), {
    durableLedger: new RuntimeStoreAgentJobLedger(runtimeStore),
  });
  await second.initialize();
  const recovered = second.get(created.id, scope);
  assert.equal(recovered?.id, created.id, 'a new ACA instance must recover the same user-visible job ID');
  assert.equal(recovered?.tenantId, scope.tenantId);
  assert.equal(recovered?.requesterId, scope.requesterId);
  assert.equal(recovered?.conversationId, scope.conversationId);
  assert.equal(recovered?.status, 'running');
  assert.equal(second.get(created.id, otherScope), undefined, 'durable recovery must preserve scope isolation');
  await assert.rejects(
    fs.access(path.join(root, 'ephemeral-first.json')),
    'durable mode must not depend on an ephemeral local ledger file',
  );

  await second.update(created.id, scope, {
    status: 'completed',
    result: 'durable ledger result',
    finishedAt: '2026-09-03T00:01:00.000Z',
  });
  const third = new AgentJobStore(path.join(root, 'ephemeral-third.json'), {
    durableLedger: new RuntimeStoreAgentJobLedger(runtimeStore),
  });
  await third.initialize();
  assert.equal(third.get(created.id, scope)?.result, 'durable ledger result');

  const migrationRuntimeStore = new MemoryRuntimeStore();
  const ledgerScope: RuntimeScope = {
    tenantId: 'teams-core-system',
    requesterId: 'agent-job-ledger',
    conversationId: 'global',
  };
  for (const [index, id] of ['legacy-job-a', 'legacy-job-b'].entries()) {
    await migrationRuntimeStore.write(ledgerScope, {
      id,
      idempotencyKey: `legacy-seed-${index}`,
      value: {
        id,
        prompt: `legacy prompt ${index}`,
        mode: 'read-only',
        status: 'failed',
        ...scope,
        error: 'legacy failure',
        progress: [],
        createdAt: `2026-09-03T00:0${index}:00.000Z`,
        finishedAt: `2026-09-03T00:0${index}:30.000Z`,
      },
    });
  }
  const migrated = new AgentJobStore(path.join(root, 'unused-migration.json'), {
    legacyProvider: 'codex',
    durableLedger: new RuntimeStoreAgentJobLedger(migrationRuntimeStore),
  });
  await migrated.initialize();
  assert.deepEqual(
    migrated.list(scope, 10).map((job) => job.provider),
    ['codex', 'codex'],
    'durable startup must migrate every legacy record without dropping the ledger',
  );

  console.log('agent-job-durable-ledger-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
