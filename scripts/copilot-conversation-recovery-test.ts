import assert from 'node:assert/strict';
import { ApiAuthError } from '../src/client/auth.js';
import { createCoreConversationController, submitCoreConversation } from '../src/client/copilot-conversation-controller.js';
import { loadJobConversation } from '../src/client/job-conversation.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

const base: CoreOrchestrationJob = { id: 'synthetic-recovery-parent', provider: 'codex', mode: 'read-only',
  prompt: 'Synthetic saved request', result: 'Synthetic saved response', status: 'completed', progress: [],
  createdAt: '2026-10-10T00:00:00.000Z', threadId: 'synthetic-thread' };
const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL: ${name}`, error); }
}
const make = (job: CoreOrchestrationJob = base, overrides: Record<string, unknown> = {}, timeoutMs = 1000) => {
  const events: any[] = [];
  const calls: string[] = [];
  const client = { getJob: async () => { calls.push('GET'); return job; },
    continueJob: async (id: string, prompt: string) => { calls.push('CONTINUE');
      return { job: { ...base, id: 'synthetic-recovery-child', parentJobId: id, prompt, status: 'queued' as const, result: undefined } }; },
    cancelJob: async (id: string) => { calls.push('CANCEL'); return { job: { ...job, id, status: 'cancelled' as const } }; },
    ...overrides };
  const controller = createCoreConversationController({ client, jobId: job.id, timeoutMs, onChange: value => events.push(value) });
  return { controller, events, calls };
};

await check('queued/running Stop reaches owner cancel once and replays cancelled turn', async () => {
  for (const status of ['queued', 'running'] as const) {
    let finish!: (value: { job: CoreOrchestrationJob }) => void;
    const { controller, calls } = make({ ...base, status }, { cancelJob: async () => {
      calls.push('CANCEL'); return new Promise(resolve => { finish = resolve; });
    } });
    try {
      await controller.load();
      assert.equal(typeof (controller as any).stop, 'function', 'real execution needs an explicit Stop operation');
      const stopped = (controller as any).stop();
      assert.equal(controller.getState().phase, 'stopping');
      assert.equal(await (controller as any).stop(), 'busy');
      assert.equal(await controller.send('duplicate during Stop'), 'busy');
      finish({ job: { ...base, status: 'cancelled' } });
      assert.equal(await stopped, 'succeeded');
      assert.equal(controller.getState().job?.status, 'cancelled');
      assert.equal(controller.getState().conversation?.turns.at(-1)?.status, 'cancelled');
      assert.equal(await (controller as any).stop(), 'invalid');
      assert.equal(calls.filter(value => value === 'CANCEL').length, 1);
    } finally { controller.dispose(); }
  }
});
await check('transient read failure preserves labelled last confirmed history and GET-only recovery', async () => {
  let disconnected = false;
  const { controller, calls } = make(base, { getJob: async () => {
    calls.push('GET'); if (disconnected) throw new TypeError('Synthetic offline'); return base;
  } });
  try {
    await controller.load(); disconnected = true;
    assert.equal(await controller.load(), 'failed');
    assert.equal(controller.getState().conversation?.turns[0]?.response, base.result);
    assert.equal((controller.getState() as any).stale, true);
    assert.equal(await controller.send('no mutation during outage'), 'invalid');
    disconnected = false; assert.equal(await controller.load(), 'succeeded');
    assert.equal((controller.getState() as any).stale, false);
    assert.deepEqual(new Set(calls), new Set(['GET']));
  } finally { controller.dispose(); }
});
await check('auth expiry and forbidden remain distinct and clear private history', async () => {
  for (const kind of ['auth-expired', 'forbidden'] as const) {
    let rejected = false;
    const { controller } = make(base, { getJob: async () => { if (rejected) throw new ApiAuthError(kind); return base; } });
    try {
      await controller.load(); rejected = true; await controller.load();
      assert.equal(controller.getState().job, undefined);
      assert.equal(controller.getState().conversation, undefined);
      assert.equal((controller.getState() as any).recovery, kind);
      assert.match(controller.getState().error ?? '', kind === 'forbidden' ? /권한/ : /인증.*만료/);
    } finally { controller.dispose(); }
  }
});
await check('acknowledged followup retains parent/child transcript before refresh', async () => {
  const { controller } = make();
  try {
    await controller.load(); assert.equal(await controller.send('Synthetic followup'), 'succeeded');
    assert.deepEqual(controller.getState().conversation?.turns.map(turn => turn.jobId), [base.id, 'synthetic-recovery-child']);
    assert.equal(controller.getState().conversation?.selectedJobId, 'synthetic-recovery-child');
    assert.equal(controller.getState().conversation?.turns.at(-1)?.request, 'Synthetic followup');
  } finally { controller.dispose(); }
});
await check('uncertain Stop allows status readback without an automatic second cancel', async () => {
  let latest = { ...base, status: 'running' as const } as CoreOrchestrationJob;
  const { controller, calls } = make(latest, { getJob: async () => { calls.push('GET'); return latest; },
    cancelJob: async () => { calls.push('CANCEL'); throw new TypeError('Synthetic lost Stop response'); } });
  try {
    await controller.load(); assert.equal(typeof (controller as any).stop, 'function');
    assert.equal(await (controller as any).stop(), 'failed');
    assert.equal(controller.getState().job?.status, 'running');
    assert.equal((controller.getState() as any).stopUncertain, true);
    assert.equal(controller.getState().uncertain, false, 'Stop uncertainty does not invent a continuation');
    await controller.load(); assert.equal(await (controller as any).stop(), 'invalid', 'unresolved Stop is never resent');
    latest = { ...latest, status: 'cancelled' }; await controller.load();
    assert.equal((controller.getState() as any).stopUncertain, false);
    assert.equal(controller.getState().job?.status, 'cancelled');
    assert.equal(calls.filter(value => value === 'CANCEL').length, 1);
    assert.equal(calls.filter(value => value === 'CONTINUE').length, 0);
  } finally { controller.dispose(); }
});
await check('Stop deadline/disposal rejects late cancellation readback', async () => {
  for (const disposed of [false, true]) {
    let finish!: (value: { job: CoreOrchestrationJob }) => void;
    const { controller, events } = make({ ...base, status: 'running' }, { cancelJob: () => new Promise(resolve => { finish = resolve; }) }, 15);
    try {
      await controller.load(); assert.equal(typeof (controller as any).stop, 'function');
      const operation = (controller as any).stop(); if (disposed) controller.dispose();
      assert.equal(await operation, disposed ? 'disposed' : 'failed');
      const count = events.length; finish({ job: { ...base, status: 'cancelled' } });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(events.length, count);
      if (!disposed) assert.equal((controller.getState() as any).stopUncertain, true);
    } finally { controller.dispose(); }
  }
});
await check('busy SDK submission preserves unsent draft after immediate SDK clear', async () => {
  let finish!: (value: Awaited<ReturnType<typeof loadJobConversation>>) => void;
  const { controller } = make(base, { getJobConversation: () => new Promise(resolve => { finish = resolve; }) });
  let input = 'Synthetic unsent draft'; let validation = '';
  try {
    const loading = controller.load();
    const rejected = submitCoreConversation(controller, input, { setInput: value => { input = value; },
      setValidation: value => { validation = value; }, isCurrent: () => true });
    input = ''; await rejected;
    assert.equal(input, 'Synthetic unsent draft'); assert.match(validation, /처리 중/);
    finish(await loadJobConversation(base.id, async () => base)); await loading;
  } finally { controller.dispose(); }
});
await check('terminal failure/cancellation permits a new explicit followup without retrying old execution', async () => {
  for (const status of ['failed', 'cancelled'] as const) {
    const { controller, calls } = make({ ...base, status });
    try {
      await controller.load(); assert.equal(await controller.send('Synthetic changed followup'), 'succeeded');
      assert.equal(calls.filter(value => value === 'CONTINUE').length, 1);
      assert.equal(calls.filter(value => value === 'CANCEL').length, 0);
    } finally { controller.dispose(); }
  }
});
await check('Stop observes a completion race without inventing a cancelled status', async () => {
  const { controller } = make({ ...base, status: 'running' }, { cancelJob: async () => ({ job: base }) });
  try {
    await controller.load(); assert.equal(await (controller as any).stop(), 'succeeded');
    assert.equal(controller.getState().job?.status, 'completed');
  } finally { controller.dispose(); }
});
await check('forbidden Stop clears saved history and does not resend cancellation', async () => {
  const { controller, calls } = make({ ...base, status: 'running' }, { cancelJob: async () => {
    calls.push('CANCEL'); throw new ApiAuthError('forbidden');
  } });
  try {
    await controller.load(); assert.equal(await (controller as any).stop(), 'failed');
    assert.equal(controller.getState().conversation, undefined);
    assert.equal(controller.getState().job, undefined);
    assert.equal((controller.getState() as any).recovery, 'forbidden');
    assert.equal((controller.getState() as any).stopUncertain, false);
    assert.equal(await (controller as any).stop(), 'invalid');
    assert.equal(calls.filter(value => value === 'CANCEL').length, 1);
  } finally { controller.dispose(); }
});
await check('disposal from a loading notification cannot strand a pending read', async () => {
  let controller: ReturnType<typeof createCoreConversationController>;
  controller = createCoreConversationController({ client: { getJob: async () => base, getJobConversation: async () => new Promise<never>(() => {}),
    continueJob: async () => { throw new Error('No mutation'); } }, jobId: base.id, timeoutMs: 15,
    onChange: () => controller.dispose() });
  const settled = await Promise.race([controller.load(), new Promise(resolve => setTimeout(() => resolve('stranded'), 50))]);
  assert.equal(settled, 'disposed');
});
await check('foreign persistent thread Stop reply cannot be displayed as confirmed cancellation', async () => {
  const { controller } = make({ ...base, status: 'running', mode: 'workspace-write' }, { cancelJob: async () => ({
    job: { ...base, status: 'cancelled', mode: 'workspace-write', threadId: 'foreign-thread' } }) });
  try {
    await controller.load(); assert.equal(await (controller as any).stop(), 'failed');
    assert.equal((controller.getState() as any).stopUncertain, true);
    assert.equal(controller.getState().job?.status, 'running');
  } finally { controller.dispose(); }
});
await check('explicit earlier pages survive status replay and use owner reads only', async () => {
  const jobs = Array.from({ length: 45 }, (_, index) => ({ ...base, id: `synthetic-recovery-page-${index}`,
    ...(index ? { parentJobId: `synthetic-recovery-page-${index - 1}` } : {}), threadId: `synthetic-ephemeral-${index}`,
    prompt: `Synthetic page request ${index}` }));
  const reads: string[] = [];
  const controller = createCoreConversationController({ jobId: jobs.at(-1)!.id, onChange: () => {}, client: {
    getJob: async id => { reads.push(id); const job = jobs.find(row => row.id === id); assert.ok(job); return job; },
    continueJob: async () => { throw new Error('Pagination must never execute'); },
  } });
  try {
    await controller.load(); assert.equal(controller.getState().conversation?.turns.length, 20);
    assert.equal(typeof (controller as any).loadEarlier, 'function', 'the actual SDK conversation exposes deliberate earlier-page reads');
    assert.equal(await (controller as any).loadEarlier(), 'succeeded');
    assert.equal(controller.getState().conversation?.turns.length, 40);
    await controller.load(); assert.equal(controller.getState().conversation?.turns.length, 40, 'poll replay retains loaded earlier turns');
    assert.equal(await (controller as any).loadEarlier(), 'succeeded');
    assert.equal(controller.getState().conversation?.turns.length, 45);
    assert.equal(controller.getState().conversation?.complete, true);
    const before = reads.length; assert.equal(await (controller as any).loadEarlier(), 'invalid');
    assert.equal(reads.length, before, 'complete history has no redundant reads');
  } finally { controller.dispose(); }
});
await check('owner-hidden selected or boundary 404 clears paged history as forbidden', async () => {
  for (const boundary of [false, true]) {
    const jobs = Array.from({ length: 21 }, (_, index) => ({ ...base, id: `synthetic-owner-revalidation-${index}`,
      ...(index ? { parentJobId: `synthetic-owner-revalidation-${index - 1}` } : {}) }));
    let hiddenId: string | undefined;
    const controller = createCoreConversationController({ jobId: jobs.at(-1)!.id, onChange: () => {}, client: {
      getJob: async id => {
        if (id === hiddenId) throw Object.assign(new Error('Synthetic owner-hidden job'), { status: 404 });
        const job = jobs.find(row => row.id === id); assert.ok(job); return job;
      }, continueJob: async () => { throw new Error('Owner revalidation must never execute'); },
    } });
    try {
      await controller.load();
      hiddenId = boundary ? controller.getState().conversation!.turns[0].jobId : jobs.at(-1)!.id;
      assert.equal(await controller.loadEarlier(), 'failed');
      assert.equal(controller.getState().conversation, undefined);
      assert.equal(controller.getState().job, undefined);
      assert.equal(controller.getState().recovery, 'forbidden');
    } finally { controller.dispose(); }
  }
});
assert.deepEqual(failures, [], 'conversation recovery regressions');
