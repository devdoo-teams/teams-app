import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import { RuntimeStoreAgentJobLedger, AGENT_JOB_LEDGER_SCOPE } from '../src/server/storage/agent-job-durable-ledger.js';
import { RuntimeStoreConflictError, type RuntimeStore, type RuntimeRecord, type RuntimeScope, type RuntimeWrite } from '../src/server/storage/runtime-store.js';

const scope: AgentJobScope = { tenantId: 'migration-tenant', requesterId: 'migration-user', conversationId: 'migration-chat' };
class Store implements RuntimeStore {
  record?: RuntimeRecord<any>;
  mutateBeforeRead = false;
  writes = 0;
  async read<T>(_scope: RuntimeScope, _id: string): Promise<RuntimeRecord<T> | null> {
    if (this.mutateBeforeRead && this.record) {
      this.mutateBeforeRead = false;
      this.record.value.prompt = 'concurrently changed prompt';
      this.record.etag = 'concurrent-revision';
    }
    return this.record ? structuredClone(this.record) : null;
  }
  async list<T>(): Promise<Array<RuntimeRecord<T>>> { return this.record ? [structuredClone(this.record)] : []; }
  async write<T>(_scope: RuntimeScope, input: RuntimeWrite<T>): Promise<RuntimeRecord<T>> {
    if (this.record && input.expectedEtag !== this.record.etag) throw new RuntimeStoreConflictError('stale ETag');
    this.writes++;
    this.record = { id: input.id, value: structuredClone(input.value), etag: `revision-${this.writes}`, createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:01:00.000Z' };
    return structuredClone(this.record);
  }
}
function legacyRecord(provider?: 'codex') {
  return { id: 'migration-job', prompt: 'migration fixture', mode: 'read-only', status: 'failed', ...scope,
    ...(provider ? { provider } : {}), error: 'fixture failure', progress: [],
    createdAt: '2026-09-03T00:00:00.000Z', finishedAt: '2026-09-03T00:00:30.000Z' };
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-ledger-migration-'));
let failures = 0;
try {
  for (const provider of [undefined, 'codex'] as const) {
    const backing = new Store(); await backing.write(AGENT_JOB_LEDGER_SCOPE, { id: 'migration-job', idempotencyKey: 'fixture-seed', value: legacyRecord(provider) });
    const ledger = new RuntimeStoreAgentJobLedger(backing);
    const store = new AgentJobStore(path.join(directory, `unused-${provider}.json`), { durableLedger: ledger, legacyProvider: 'codex' });
    try {
      await store.initialize();
      const migrated = store.get('migration-job', scope)!;
      assert.equal(migrated.provider, 'codex'); assert.equal(migrated.updatedAt, migrated.finishedAt);
      assert.deepEqual(migrated.tools, []); assert.equal(migrated.durableNotifications, undefined);
      assert.equal(backing.writes, 2, 'canonical schema migration must persist exactly once');
      const restarted = new AgentJobStore(path.join(directory, `unused-restart-${provider}.json`), { durableLedger: ledger });
      await restarted.initialize(); assert.equal(backing.writes, 2, 'canonical restart must not remigrate');
      assert.equal(restarted.get('migration-job', { ...scope, requesterId: 'foreign' }), undefined);
      await restarted.update('migration-job', scope, { status: 'completed', result: 'recovered fixture result' });
      assert.equal(backing.record?.value.result, 'recovered fixture result');
      console.log('PASS: migration and restart, original provider:', provider ?? 'missing');
    } catch (error) { failures++; console.error('FAIL: migration, original provider:', provider ?? 'missing', error); }
  }
  const backing = new Store(); await backing.write(AGENT_JOB_LEDGER_SCOPE, { id: 'migration-job', idempotencyKey: 'fixture-concurrent', value: legacyRecord() });
  backing.mutateBeforeRead = true;
  const store = new AgentJobStore(path.join(directory, 'unused-concurrent.json'), { durableLedger: new RuntimeStoreAgentJobLedger(backing), legacyProvider: 'codex' });
  await assert.rejects(store.initialize(), RuntimeStoreConflictError);
  assert.equal(store.list(scope).length, 0, 'failed migration cannot publish a partial snapshot');
  assert.equal(backing.record?.value.prompt, 'concurrently changed prompt', 'concurrent durable data must not be overwritten');
  assert.equal(backing.writes, 1);
  console.log('PASS: concurrent mutation remains blocked and unmodified');
} finally { await fs.rm(directory, { recursive: true, force: true }); }
assert.equal(failures, 0, `${failures} migration cases failed`);
