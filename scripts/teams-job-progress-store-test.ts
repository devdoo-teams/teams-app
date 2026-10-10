import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson } from '../src/server/atomic-file.js';
import { TeamsJobProgressJsonStore } from '../src/server/teams-job-progress-store.js';
import { TeamsJobProgressTransport, type TeamsJobProgressLedger } from '../src/server/teams-job-progress.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-progress-store-synthetic-'));
const watchdog = setTimeout(() => { console.error('progress-store test timeout (20s)'); process.exit(1); }, 20_000);
watchdog.unref();
let index = 0;
const newPath = () => path.join(root, `private-${index++}`, 'progress.json');
const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8')) as TeamsJobProgressLedger;
const tests: Array<[string, () => Promise<void>]> = [
  ['initialize persists private schema and explicitly limits consistency to one process', async () => {
    const file = newPath(); const store = new TeamsJobProgressJsonStore(file); await store.initialize();
    assert.equal(await fs.access(file).then(() => true, () => false), true, 'initial ledger must exist durably');
    assert.equal((await read(file)).schema, 1); assert.equal(store.consistency, 'single-process-local-json');
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
  }],
  ['queued transactions reload disk and preserve each concurrent mutation', async () => {
    const file = newPath(); const store = new TeamsJobProgressJsonStore(file); await store.initialize();
    await Promise.all(Array.from({ length: 20 }, (_, n) => store.transact(ledger => {
      ledger.chats.push({ tenantId: 'synthetic-tenant', conversationId: `chat-${n}` }); return ledger.chats.length;
    })));
    assert.equal((await read(file)).chats.length, 20);
    const external = await read(file); external.chats.push({ tenantId: 'synthetic-tenant', conversationId: 'observed-disk-update' });
    await atomicWriteJson(file, external);
    assert.equal(await store.transact(ledger => ledger.chats.length), 21, 'each callback must observe latest disk, not cached state');
  }],
  ['callback and result aliases cannot mutate durable state after transaction', async () => {
    const file = newPath(); const store = new TeamsJobProgressJsonStore(file); let alias: TeamsJobProgressLedger | undefined;
    const returned = await store.transact(ledger => {
      ledger.chats.push({ tenantId: 'tenant', conversationId: 'saved' }); alias = ledger; return ledger.chats[0];
    });
    returned.conversationId = 'changed-return'; alias!.chats[0].conversationId = 'changed-callback';
    assert.equal((await read(file)).chats[0].conversationId, 'saved');
    assert.equal(await store.transact(ledger => ledger.chats[0].conversationId), 'saved');
  }],
  ['transaction does not resolve until atomic persistence completes', async () => {
    const file = newPath(); let block = false; let release!: () => void; let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const store = new TeamsJobProgressJsonStore(file, async (target, value) => {
      if (block) { enter(); await gate; } await atomicWriteJson(target, value);
    });
    await store.initialize(); block = true; let resolved = false;
    const transaction = store.transact(ledger => { ledger.chats.push({ tenantId: 't', conversationId: 'durable' }); return 1; })
      .then(value => { resolved = true; return value; });
    await entered; assert.equal(resolved, false); assert.equal((await read(file)).chats.length, 0);
    release(); assert.equal(await transaction, 1); assert.equal((await read(file)).chats.length, 1);
  }],
  ['failed write rolls back candidate and the queue accepts the next transaction', async () => {
    const file = newPath(); let fail = false;
    const store = new TeamsJobProgressJsonStore(file, async (target, value) => {
      if (fail) { fail = false; throw Object.assign(new Error('synthetic write failure'), { code: 'EIO' }); }
      await atomicWriteJson(target, value);
    });
    await store.initialize(); fail = true;
    await assert.rejects(store.transact(ledger => { ledger.chats.push({ tenantId: 't', conversationId: 'must-not-persist' }); }), /synthetic write failure/);
    assert.equal((await read(file)).chats.length, 0);
    await store.transact(ledger => { ledger.chats.push({ tenantId: 't', conversationId: 'next' }); });
    assert.deepEqual((await read(file)).chats.map(chat => chat.conversationId), ['next']);
  }],
  ['throwing and async callbacks cannot publish partial state', async () => {
    const file = newPath(); const store = new TeamsJobProgressJsonStore(file); await store.initialize();
    await assert.rejects(store.transact(ledger => { ledger.chats.push({ tenantId: 't', conversationId: 'partial' }); throw new Error('synthetic callback failure'); }), /synthetic callback failure/);
    await assert.rejects(store.transact(async ledger => { ledger.chats.push({ tenantId: 't', conversationId: 'async' }); }), /SYNCHRONOUS/);
    assert.equal((await read(file)).chats.length, 0);
  }],
  ['pending send intent remains ambiguous across actual JSON store restart', async () => {
    const file = newPath(); const binding = { jobId: 'synthetic-job', tenantId: 't', requesterId: 'r', conversationId: 'c',
      conversationType: 'personal' as const, originActivityId: 'origin', originThreadId: 'thread', serviceUrl: 'https://smba.trafficmanager.net/amer/' };
    let calls = 0;
    const adapter = { send: async () => { calls++; return { state: 'ambiguous' as const }; } };
    const first = new TeamsJobProgressTransport({ state: new TeamsJobProgressJsonStore(file), adapter, now: () => 0 });
    const result = await first.publish(binding, { revision: 1, status: 'running', text: 'synthetic progress' });
    const pendingId = (await read(file)).records[0].pending!.request.operationId;
    assert.equal(result.operationId, pendingId);
    const restarted = new TeamsJobProgressTransport({ state: new TeamsJobProgressJsonStore(file), adapter, now: () => 1000 });
    const recovered = await restarted.recover();
    assert.equal(recovered[0].state, 'ambiguous'); assert.equal(recovered[0].operationId, pendingId); assert.equal(calls, 1);
  }],
  ['malformed, symlink and missing previously initialized state fail closed', async () => {
    const malformed = newPath(); await atomicWriteJson(malformed, { schema: 99, records: [], chats: [] });
    await assert.rejects(new TeamsJobProgressJsonStore(malformed).initialize(), /STATE_INVALID/);
    const target = newPath(); await atomicWriteJson(target, { schema: 1, records: [], chats: [] });
    const linked = path.join(path.dirname(target), 'linked.json'); await fs.symlink(target, linked);
    await assert.rejects(new TeamsJobProgressJsonStore(linked).initialize(), /symbolic link/);
    const file = newPath(); const initialized = new TeamsJobProgressJsonStore(file); await initialized.initialize(); await fs.rm(file);
    await assert.rejects(initialized.transact(ledger => ledger.chats.length), /ENOENT|STATE_MISSING/);
    assert.equal(await fs.access(file).then(() => true, () => false), false, 'state loss must not silently create a fresh ledger');
  }],
];
try {
  const failures: string[] = [];
  const selected = process.argv.includes('--first-case') ? tests.slice(0, 1) : tests;
  for (const [name, test] of selected) { try { await test(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); } }
  assert.equal(failures.length, 0, failures.join(', '));
  console.log(`teams-job-progress-store: ${selected.length} synthetic cases passed`);
} finally { clearTimeout(watchdog); await fs.rm(root, { recursive: true, force: true }); }
