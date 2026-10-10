import assert from 'node:assert/strict';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
import { loadJobConversation } from '../src/client/job-conversation.js';
const module = await import('../src/client/copilot-conversation-controller.js').catch(() => null);
assert.ok(module, 'Actual SDK conversation must have an authenticated continuation controller');
const { createCoreConversationController } = module;
const base: CoreOrchestrationJob = { id: 'synthetic-conversation', provider: 'codex', mode: 'read-only',
  prompt: 'Synthetic first request', result: 'Synthetic first response', status: 'completed', progress: [],
  createdAt: '2026-10-10T00:00:00.000Z', threadId: 'synthetic-thread' };
let requests: Array<{ action: string; id: string; prompt?: string }> = [];
let failure: 'none' | 'owner' | 'ambiguous' = 'none';
let release!: (value: { job: CoreOrchestrationJob }) => void;
let pending = false;
const client = {
  async getJob(id: string) {
    requests.push({ action: 'GET', id });
    if (failure === 'owner') throw Object.assign(new Error('Synthetic forbidden'), { status: 403 });
    return { ...base, id };
  },
  async continueJob(id: string, prompt: string) {
    requests.push({ action: 'CONTINUE', id, prompt });
    if (failure === 'ambiguous') throw new TypeError('Synthetic transport failure');
    const response = { job: { ...base, id: 'synthetic-child', parentJobId: id, prompt, status: 'queued' as const, result: undefined } };
    if (pending) return new Promise<typeof response>(resolve => { release = resolve; });
    return response;
  },
};
const states: any[] = [];
const controller = createCoreConversationController({ client, jobId: base.id, onChange: value => states.push(value), timeoutMs: 1000 });
assert.equal(await controller.load(), 'succeeded');
assert.equal(states.at(-1).conversation.turns[0].request, base.prompt);
assert.equal(states.at(-1).conversation.turns[0].response, base.result);
assert.ok(requests.every(row => row.action === 'GET'), 'opening or refreshing conversation never starts execution');
for (const prompt of ['', ' ', 'x'.repeat(2001)]) assert.equal(await controller.send(prompt), 'invalid');
assert.equal(requests.filter(row => row.action === 'CONTINUE').length, 0);
pending = true;
const first = controller.send('Synthetic next request');
assert.equal(await controller.send('duplicate'), 'busy');
assert.equal(await controller.load(), 'busy');
assert.equal(requests.filter(row => row.action === 'CONTINUE').length, 1);
release({ job: { ...base, id: 'synthetic-child', parentJobId: base.id, status: 'queued' } });
assert.equal(await first, 'succeeded');
assert.equal(states.at(-1).jobId, 'synthetic-child');
assert.equal(await controller.send('while queued'), 'invalid');
failure = 'owner';
assert.equal(await controller.load(), 'failed');
assert.equal(states.at(-1).conversation, undefined, 'owner failure clears previous transcript');
assert.equal(states.at(-1).job, undefined);
controller.dispose();
assert.equal(await controller.load(), 'disposed');
assert.equal(await controller.send('after disposal'), 'disposed');

failure = 'none'; pending = false;
const uncertain = createCoreConversationController({ client, jobId: base.id, onChange: value => states.push(value), timeoutMs: 1000 });
await uncertain.load(); failure = 'ambiguous';
const count = requests.filter(row => row.action === 'CONTINUE').length;
assert.equal(await uncertain.send('Synthetic ambiguous send'), 'failed');
assert.equal(states.at(-1).uncertain, true);
await uncertain.load();
assert.equal(await uncertain.send('no automatic replay'), 'invalid');
assert.equal(requests.filter(row => row.action === 'CONTINUE').length, count + 1);
uncertain.dispose();
// Deadlines and disposal reject late successful replies without publishing old data.
for (const dispose of [false, true]) {
  let finish!: (value: ReturnType<typeof loadJobConversation> extends Promise<infer T> ? T : never) => void;
  const seen: any[] = [];
  const late = createCoreConversationController({ client: { ...client,
    getJobConversation: () => new Promise(resolve => { finish = resolve; }),
  }, jobId: base.id, onChange: value => seen.push(value), timeoutMs: 15 });
  const started = late.load();
  if (dispose) late.dispose();
  assert.equal(await started, dispose ? 'disposed' : 'failed');
  const before = seen.length;
  finish(await loadJobConversation(base.id, client.getJob));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(seen.length, before, 'late owner reads cannot publish after timeout/disposal');
  assert.equal(seen.at(-1).conversation, undefined);
  late.dispose();
}
for (const status of ['queued', 'running', 'awaiting_approval', 'input_required'] as const) {
  let calls = 0;
  const inactive = createCoreConversationController({ client: { ...client,
    getJob: async () => ({ ...base, status }), continueJob: async () => { calls++; throw new Error('Must not execute'); },
  }, jobId: base.id, onChange: () => {} });
  await inactive.load(); assert.equal(await inactive.send('Synthetic'), 'invalid'); assert.equal(calls, 0); inactive.dispose();
}
const malformedStates: any[] = [];
const malformed = createCoreConversationController({ client: { ...client,
  continueJob: async () => ({ job: { ...base, id: 'synthetic-wrong-parent', parentJobId: 'other-parent' } }),
}, jobId: base.id, onChange: value => malformedStates.push(value) });
await malformed.load(); assert.equal(await malformed.send('Synthetic'), 'failed');
assert.equal(malformedStates.at(-1).uncertain, true); assert.equal(malformedStates.at(-1).conversation, undefined);
malformed.dispose();
failure='none';
const ephemeral = createCoreConversationController({ client: { ...client,
 continueJob: async (id:string,prompt:string) => ({job:{...base,id:'synthetic-ephemeral-child',parentJobId:id,prompt,threadId:'synthetic-fresh-cli-thread'}}),
}, jobId:base.id,onChange:()=>{} });
await ephemeral.load();
assert.equal(await ephemeral.send('Synthetic next request'),'succeeded','read-only Codex continuation inherits ancestry while using a fresh ephemeral CLI thread');
ephemeral.dispose();
for (const changed of [{ mode:'workspace-write' as const },{ provider:'copilot' as const }]) {
 const wrong = createCoreConversationController({client:{...client,
  continueJob:async(id:string)=>({job:{...base,id:'synthetic-changed-boundary',parentJobId:id,...changed}}),
 },jobId:base.id,onChange:()=>{}});
 await wrong.load();assert.equal(await wrong.send('Synthetic'),'failed','continuation cannot change provider or execution mode');wrong.dispose();
}
const persistent = createCoreConversationController({client:{...client,
 getJob:async()=>({...base,mode:'workspace-write' as const}),
 continueJob:async(id:string)=>({job:{...base,mode:'workspace-write' as const,id:'synthetic-persistent-child',parentJobId:id,threadId:'foreign-thread'}}),
},jobId:base.id,onChange:()=>{}});
await persistent.load();assert.equal(await persistent.send('Synthetic'),'failed','persistent write continuation retains the existing CLI thread');persistent.dispose();
// Existing conversation loader remains owner scoped; no caller-supplied owner/thread override.
assert.equal((await loadJobConversation(base.id, client.getJob)).conversation.selectedJobId, base.id);
console.log('PASS: real conversation reads owner API; explicit continuation is bounded, single-send, terminal-only, and stale/ambiguous failures fail closed');
