import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
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

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/server/index.ts'), 'utf8');

assert.match(
  source,
  /import \{ RuntimeStoreAgentJobLedger \} from '\.\/storage\/agent-job-durable-ledger\.js';/u,
  'the production composition root must import the durable AgentJob ledger',
);
const runtimeStoreCreation = source.indexOf('const runtimeStore = await createRuntimeStore(');
const agentJobStoreCreation = source.indexOf('agentJobStore = new AgentJobStore(');
assert.ok(runtimeStoreCreation >= 0, 'the production composition must create the shared RuntimeStore');
assert.ok(
  agentJobStoreCreation > runtimeStoreCreation,
  'AgentJobStore must be composed after RuntimeStore so Azure mode can use the durable ledger',
);
assert.match(
  source,
  /azureQueueDispatch\s*\?\s*new RuntimeStoreAgentJobLedger\(runtimeStore\)\s*:\s*undefined/u,
  'Azure Queue mode must select RuntimeStoreAgentJobLedger while local mode keeps the file backend',
);
assert.match(
  source,
  /durableLedger:\s*agentJobDurableLedger/u,
  'the selected durable ledger must be passed to AgentJobStore',
);
assert.match(
  source,
  /agentJobs:\s*\{[\s\S]*backend:[\s\S]*migration:[\s\S]*readiness:/u,
  'health must identify AgentJob ledger backend, migration state, and unverified readiness separately',
);

const temporaryRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'teams-agent-job-composition-'));
try {
  const runtimeStore = new MemoryRuntimeStore();
  const scope: AgentJobScope = {
    tenantId: 'tenant-composition',
    requesterId: 'requester-composition',
    conversationId: 'conversation-composition',
  };
  const firstFile = path.join(temporaryRoot, 'aca-instance-one.json');
  const first = new AgentJobStore(firstFile, {
    legacyProvider: 'codex',
    durableLedger: new RuntimeStoreAgentJobLedger(runtimeStore),
  });
  await first.initialize();
  const created = await first.create({
    prompt: 'survive an ACA recycle',
    provider: 'codex',
    mode: 'read-only',
    scope,
  });

  const second = new AgentJobStore(path.join(temporaryRoot, 'aca-instance-two.json'), {
    legacyProvider: 'codex',
    durableLedger: new RuntimeStoreAgentJobLedger(runtimeStore),
  });
  await second.initialize();
  assert.equal(second.get(created.id, scope)?.prompt, 'survive an ACA recycle');
  await assert.rejects(
    fsPromises.access(firstFile),
    'Azure durable composition must not write the ephemeral AgentJob JSON file',
  );

  const localFile = path.join(temporaryRoot, 'local-agent-jobs.json');
  const local = new AgentJobStore(localFile, { legacyProvider: 'codex' });
  await local.initialize();
  await local.create({ prompt: 'retain local file mode', provider: 'codex', mode: 'read-only', scope });
  assert.ok((await fsPromises.stat(localFile)).isFile(), 'non-Azure composition must retain file-json persistence');

  console.log('azure-agent-job-ledger-composition-test: PASS');
} finally {
  await fsPromises.rm(temporaryRoot, { recursive: true, force: true });
}
