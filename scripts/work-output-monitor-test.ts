import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
import { maskAgentToolOutput } from '../src/server/agent-tool-execution.js';

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@microsoft/teams-js') return { format: 'module', shortCircuit: true,
    url: 'data:text/javascript,export const app={isInitialized:()=>false}; export const authentication={};' };
  return nextResolve(specifier, context);
} });
const monitor = await import('../src/client/work-output-monitor.js').catch(() => ({} as Record<string, any>));
assert.equal(typeof monitor.createOutputMonitorReader, 'function', 'the monitor reads existing authorized jobs without any execution method');
assert.equal(typeof monitor.normalizeOutputMonitorSlots, 'function', 'four stable slots preserve selection across layouts');
const { createCoreOrchestrationClient, CoreOrchestrationClientError } = await import('../src/client/core-orchestration-client.js');
hooks.deregister();

function job(id: string, status: CoreOrchestrationJob['status'] = 'running'): CoreOrchestrationJob {
  return { id, status, prompt: '합성 작업', mode: 'read-only', provider: 'codex', progress: ['저장된 진행 기록'],
    createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:01Z' };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let latest: any;
const changes: any[] = [];
const publish = (value: any) => { latest = value; changes.push(value); };
const slots = monitor.normalizeOutputMonitorSlots(['task-a', 'task-b', 'task-c', 'task-d', 'task-e']);
assert.deepEqual(slots, ['task-a', 'task-b', 'task-c', 'task-d']);
assert.deepEqual(monitor.normalizeOutputMonitorSlots(['task-a', 'task-a', '../private', undefined]), ['task-a', undefined, undefined, undefined]);
assert.deepEqual(monitor.normalizeOutputMonitorSlots(slots), slots, 'layout changes do not discard slots 3 and 4');

{
  const pending = deferred<CoreOrchestrationJob>(); const calls: string[] = [];
  const reader = monitor.createOutputMonitorReader({ client: { getJob(id: string) { calls.push(id); return pending.promise; } }, onChange: publish });
  const first = reader.read(['task-a', 'task-a']);
  const second = reader.read(['task-a']);
  assert.deepEqual(calls, ['task-a'], 'repeated refreshes and duplicate slots share one in-flight read');
  pending.resolve(job('task-a', 'completed')); await Promise.all([first, second]);
  assert.equal(latest.entries['task-a'].presentation.status, 'completed');
  assert.equal(latest.entries['task-a'].presentation.jobId, 'task-a');
  assert.equal(latest.entries['task-a'].presentation.requesterId, undefined, 'the projection does not copy private ownership fields');
  reader.dispose();
}
{
  let generation = 0;
  const reader = monitor.createOutputMonitorReader({ client: { async getJob(id: string) {
    if (generation === 1 && id === 'task-a') throw new CoreOrchestrationClientError('private payload must not be shown', { code: 'Missing', status: 404, retryable: false });
    if (generation === 2 && id === 'task-a') throw new Error('private raw failure');
    return { ...job(id), result: 'last successful output' };
  } }, onChange: publish });
  await reader.read(['task-a', 'task-b']); generation = 1; await reader.read(['task-a', 'task-b']);
  assert.equal(latest.entries['task-a'].status, 'missing');
  assert.equal(latest.entries['task-a'].presentation, undefined, 'missing jobs cannot keep stale output');
  assert.equal(latest.entries['task-b'].status, 'ready');
  generation = 2; await reader.read(['task-a', 'task-b']);
  assert.equal(latest.entries['task-a'].status, 'error');
  assert.equal(JSON.stringify(latest).includes('private raw'), false, 'raw request diagnostics are not rendered');
  generation = 0; await reader.read(['task-a', 'task-b']);
  assert.equal(latest.entries['task-a'].status, 'ready', 'a later authorized read recovers a transient failure'); reader.dispose();
}
for (const status of [401, 403]) {
  let denies = 0; const late = deferred<CoreOrchestrationJob>(); let signal: AbortSignal | undefined;
  const reader = monitor.createOutputMonitorReader({ client: { getJob(id: string, abort?: AbortSignal) {
    signal = abort;
    return id === 'task-a' ? Promise.reject(new CoreOrchestrationClientError('denied', { code: 'Denied', status, retryable: false })) : late.promise;
  } }, onChange: publish, onAccessDenied: () => { denies++; } });
  await reader.read(['task-a', 'task-b']);
  assert.equal(denies, 1); assert.equal(signal?.aborted, true);
  assert.deepEqual(latest.entries, {}, 'any access denial clears every monitored private job');
  const count = changes.length; late.resolve({ ...job('task-b'), result: 'late private output' });
  await new Promise(resolve => setImmediate(resolve));
  await reader.read(['task-b']); assert.equal(changes.length, count, 'denied readers remain blocked and late responses cannot restore private state'); reader.dispose();
}
{
  const pending = deferred<CoreOrchestrationJob>(); let aborted = false;
  const reader = monitor.createOutputMonitorReader({ client: { getJob(_id: string, signal: AbortSignal) {
    signal.addEventListener('abort', () => { aborted = true; }); return pending.promise;
  } }, onChange: publish });
  const first = reader.read(['task-a']); reader.dispose(); const count = changes.length;
  pending.resolve(job('task-a')); await first;
  assert.equal(aborted, true); assert.equal(changes.length, count, 'unmount cancels the read and suppresses every later update');
}
{
  const reader = monitor.createOutputMonitorReader({ client: { async getJob() { return job('foreign-job'); } }, onChange: publish });
  await reader.read(['task-a']); assert.equal(latest.entries['task-a'].status, 'error');
  assert.equal(JSON.stringify(latest).includes('foreign-job'), false, 'response identity must match the requested owner-scoped job'); reader.dispose();
}
{
  const calls: string[] = [];
  const client = createCoreOrchestrationClient(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return Response.json({ job: job('task-a') });
  });
  const reader = monitor.createOutputMonitorReader({ client, onChange: publish });
  await reader.read(['task-a']); reader.dispose();
  assert.deepEqual(calls, ['GET /api/core-orchestration/jobs/task-a'], 'the monitor invokes the existing authenticated read endpoint only');
}
{
  const fakeSecret = 'sk-proj-' + 'x'.repeat(50);
  const safe = maskAgentToolOutput(`합성 출력 ${fakeSecret}\n` + '긴 줄\n'.repeat(100));
  const reader = monitor.createOutputMonitorReader({ client: { async getJob() {
    return { ...job('task-a'), tools: [{ category: 'cli', name: 'CLI 실행', observedAt: '2026-10-14T00:00:00Z',
      execution: { source: 'codex.exec.jsonl.command_execution', itemId: 'item_1', status: 'completed', exitCode: 0, ...safe } }] };
  } }, onChange: publish });
  await reader.read(['task-a']); reader.dispose();
  assert.equal(JSON.stringify(latest).includes(fakeSecret), false, 'the existing server masking boundary is preserved through the monitor projection');
  assert.ok(latest.entries['task-a'].presentation.tools[0].outcome.includes('일부 생략'));
}
{
  const late = deferred<CoreOrchestrationJob>();
  const reader = monitor.createOutputMonitorReader({ client: { getJob(id: string) { return id === 'task-a' ? late.promise : Promise.resolve(job(id)); } }, onChange: publish });
  const old = reader.read(['task-a']); await reader.read(['task-b']);
  late.resolve(job('task-a')); await old;
  assert.deepEqual(Object.keys(latest.entries), ['task-b'], 'changing slots invalidates the previous generation'); reader.dispose();
}
{
  const reader = monitor.createOutputMonitorReader({ client: { getJob() { return new Promise(() => {}); } }, onChange: publish, timeoutMs: 5 });
  await reader.read(['task-a']); assert.equal(latest.entries['task-a'].status, 'error', 'uncooperative reads have a bounded timeout'); reader.dispose();
}

{
  assert.equal(typeof monitor.projectOutputMonitorCommands, 'function', 'the monitor projects the existing masked command observations without a new transport');
  const safe = maskAgentToolOutput('한글 관측\n' + 'saved-output '.repeat(100));
  const input = { ...job('task-a'), status: 'running', tools: [
    { category: 'cli', name: 'cat', observedAt: '2026-10-14T00:00:00Z', execution: {
      source: 'codex.exec.jsonl.command_execution', itemId: 'item_1', status: 'completed', exitCode: 0, ...safe,
    } },
    { category: 'cli', name: 'sleep', observedAt: '2026-10-14T00:00:01Z', execution: {
      source: 'codex.exec.jsonl.command_execution', itemId: 'item_2', status: 'in_progress',
    } },
    { category: 'mcp', name: 'fixture/tool', observedAt: '2026-10-14T00:00:02Z' },
  ] };
  const observed = monitor.projectOutputMonitorCommands(input);
  assert.equal(observed.length, 2);
  assert.equal(observed[0].output, safe.output, 'the monitor retains the already masked1024-character excerpt instead of the128-character summary');
  assert.equal(observed[0].output.length, 1024);
  assert.equal(observed[0].outputTruncated, true);
  assert.equal(observed[1].status, 'in_progress');
  assert.equal(observed[1].exitCode, undefined, 'an active CLI observation cannot invent an exit');
  assert.equal(input.status, 'running', 'a completed command does not complete its Core job');
  assert.deepEqual(monitor.projectOutputMonitorCommands({ ...job('task-a'), tools: [{
    category: 'cli', name: 'legacy', observedAt: '2026-10-14T00:00:00Z',
  }] }), [], 'legacy CLI names do not become structured output observations');
  const capped = monitor.projectOutputMonitorCommands({ ...job('task-a'), tools: Array.from({ length: 32 }, (_, i) => ({
    ...input.tools[0], execution: { ...input.tools[0].execution, itemId: `item_${i}` },
  })) });
  assert.equal(capped.length, 16); assert.equal(capped[0].itemId, 'item_16'); assert.equal(capped.at(-1).itemId, 'item_31');
  const reader = monitor.createOutputMonitorReader({ client: { async getJob() { return input; } }, onChange: publish });
  await reader.read(['task-a']); reader.dispose();
  assert.deepEqual(latest.entries['task-a'].commands, observed, 'the existing authenticated GET publishes its bounded command projection');
}

{
  assert.equal(typeof monitor.createOutputMonitorSession, 'function', 'automatic GET observation has an owned pause/reconnect lifecycle');
  const pending = deferred<CoreOrchestrationJob>(); const calls: string[] = [];
  let tick!: () => Promise<void>; let starts = 0; let stops = 0; let aborted = false;
  const session = monitor.createOutputMonitorSession({ slots: ['task-a'], onChange: publish,
    client: { getJob(id: string, signal: AbortSignal) { calls.push(id); signal.addEventListener('abort', () => { aborted = true; });
      return calls.length === 1 ? pending.promise : Promise.resolve(job(id));
    } },
    createPolling(options: { refresh: () => Promise<void> }) { tick = options.refresh; return { start() { starts++; }, stop() { stops++; } }; },
  });
  const starting = session.start(); session.pause(); session.pause();
  assert.equal(aborted, true, 'pausing cancels only the pending GET');
  assert.equal(latest.connection, 'paused');
  const count = changes.length; pending.resolve({ ...job('task-a'), result: 'late old snapshot' }); await starting;
  assert.equal(changes.length, count, 'a response arriving after pause cannot restore live output');
  assert.equal(starts, 0, 'an initial read that was paused cannot later start the poller');
  await session.refresh(); await tick(); assert.deepEqual(calls, ['task-a'], 'paused manual and scheduled refreshes do not issue GETs');
  await Promise.all([session.resume(), session.resume()]);
  assert.deepEqual(calls, ['task-a', 'task-a'], 'repeated reconnects share one owner-scoped GET');
  assert.equal(latest.connection, 'connected'); assert.equal(starts, 1);
  await tick(); assert.equal(calls.length, 3, 'automatic observation resumes after its fresh read');
  const saved = latest.entries['task-a']; session.pause();
  assert.equal(latest.entries['task-a'], saved, 'pause preserves the last observed snapshot, explicitly marked paused');
  assert.equal(latest.connection, 'paused'); session.dispose();
  const afterDispose = calls.length; await session.resume(); await session.refresh(); await tick();
  assert.equal(calls.length, afterDispose, 'a disposed observer never reads, executes, resumes or cancels a job');
  assert.ok(stops > 0);
}
{
  let calls = 0; let starts = 0;
  const session = monitor.createOutputMonitorSession({ slots: ['task-b'], initiallyPaused: true, onChange: publish,
    client: { async getJob(id: string) { calls++; return job(id); } },
    createPolling() { return { start() { starts++; }, stop() {} }; },
  });
  await session.start(); assert.equal(calls, 0); assert.equal(starts, 0);
  assert.equal(latest.connection, 'paused', 'a replacement slot retains the paused observation preference');
  await session.resume(); assert.equal(calls, 1); assert.equal(latest.entries['task-b'].presentation.jobId, 'task-b');
  session.dispose();
}

for (const status of [401, 403]) {
  let tick!: () => Promise<void>; let starts = 0; let stops = 0; let calls = 0; let denies = 0;
  const session = monitor.createOutputMonitorSession({ slots: ['task-a'], onChange: publish, onAccessDenied() { denies++; },
    client: { async getJob(id: string) { calls++; if (calls > 1) throw new CoreOrchestrationClientError('private failure', { code: 'Denied', status, retryable: false });
      return { ...job(id), result: 'last private output' }; } },
    createPolling(options: { refresh: () => Promise<void> }) { tick = options.refresh; return { start() { starts++; }, stop() { stops++; } }; },
  });
  await session.start(); assert.equal(starts, 1); await tick();
  assert.equal(latest.phase, 'blocked'); assert.deepEqual(latest.entries, {}); assert.equal(denies, 1);
  assert.equal(stops, 1, 'an access denial stops the owned poller even when a host leaves the component mounted');
  await session.resume(); await tick(); assert.equal(calls, 2, 'a blocked observer cannot reconnect or restore output');
  assert.equal(starts, 1); session.dispose();
}

{
  let calls = 0; let starts = 0; let pausedOnce = false;
  const session = monitor.createOutputMonitorSession({ slots: ['task-a'],
    onChange(value: any) { publish(value); if (value.phase === 'loading' && !pausedOnce) { pausedOnce = true; session.pause(); } },
    client: { async getJob(id: string) { calls++; return job(id); } },
    createPolling() { return { start() { starts++; }, stop() {} }; },
  });
  await session.start(); assert.equal(calls, 0, 'a pause requested while loading is published cannot start a later GET');
  assert.equal(starts, 0); assert.equal(latest.connection, 'paused'); session.dispose();
}
console.log('Work output monitor reader: PASS (read-only, identity, access denial, refresh, missing/error, selection, cleanup)');
