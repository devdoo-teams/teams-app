import assert from 'node:assert/strict';
import { AbstractAgent } from '@ag-ui/client';
import { EventSchemas, EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

const { CopilotJobProjectionAgent, EXECUTION_PRESENTATION_AGENT_ID, EXECUTION_PRESENTATION_TOOL_NAME } =
  await import('../src/server/copilot-job-projection-agent.js').catch(error => {
    assert.fail(`The real read-only CopilotKit job projection agent is missing: ${error.message}`);
  });
const { createExecutionPresentation } = await import('../src/shared/execution-presentation.js');
const job: CoreOrchestrationJob = {
  id: 'synthetic-job-1', prompt: 'Read a synthetic fixture.', provider: 'codex', mode: 'read-only',
  status: 'completed', result: '17 + 25 = 42', progress: [], createdAt: '2026-10-09T09:00:00.000Z',
  model: 'selected-model', reasoningEffort: 'xhigh',
  executionReceipt: { source: 'worker-observation', observedAt: '2026-10-09T09:00:01.000Z', platform: 'darwin' },
};
const input = (forwardedProps: unknown = { jobId: job.id }): RunAgentInput => ({
  threadId: 'synthetic-ui-thread', runId: 'synthetic-ui-run', state: {}, messages: [], tools: [], context: [], forwardedProps,
});
const collect = (agent: InstanceType<typeof CopilotJobProjectionAgent>, value = input()) =>
  lastValueFrom(agent.run(value).pipe(toArray()));
const lookupIds: string[] = [];
const before = structuredClone(job);
const agent = new CopilotJobProjectionAgent({ getJob: id => {
  lookupIds.push(id);
  return id === job.id ? job : undefined;
} });
assert.equal(agent instanceof AbstractAgent, true, 'the adapter must use the actual installed AG-UI SDK');
assert.equal(agent.agentId, EXECUTION_PRESENTATION_AGENT_ID);
const events = await collect(agent);
for (const event of events) {
  assert.equal(EventSchemas.safeParse(event).success, true, `actual AG-UI schema must accept ${event.type}`);
}
assert.deepEqual(lookupIds, [job.id]);
assert.equal(events[0].type, EventType.RUN_STARTED);
assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
const expected = createExecutionPresentation(job);
const text = events.filter(event => event.type === EventType.TEXT_MESSAGE_CONTENT).map(event => (event as any).delta).join('');
assert.equal(text, expected.text, 'the actual text stream and rich tool consume the same stored job projection');
const tool = events.find(event => event.type === EventType.TOOL_CALL_START) as any;
assert.equal(tool.toolCallName, EXECUTION_PRESENTATION_TOOL_NAME);
assert.deepEqual(JSON.parse((events.find(event => event.type === EventType.TOOL_CALL_ARGS) as any).delta), { presentation: expected });
assert.deepEqual(JSON.parse((events.find(event => event.type === EventType.TOOL_CALL_RESULT) as any).content), expected);
assert.equal(JSON.stringify(events).includes('확인되지 않음 (worker 관측 없음)'), true);
assert.deepEqual(job, before, 'presentation never changes execution, result or selection');
const cloned = agent.clone();
assert.equal(cloned instanceof CopilotJobProjectionAgent, true);
assert.equal((await collect(cloned)).at(-1)?.type, EventType.RUN_FINISHED, 'request-scoped clone keeps its authenticated getter');
let middlewareRuns = 0;
agent.use((value, next) => { middlewareRuns += 1; return next.run(value); });
await agent.clone().runAgent({ runId: 'synthetic-middleware-run', forwardedProps: { jobId: job.id } });
assert.equal(middlewareRuns, 1, 'clone must preserve real SDK middleware as well as the authenticated getter');

for (const props of [{ jobId: job.id, requesterId: 'foreign-user' }, { jobId: job.id, tenantId: 'foreign-tenant' },
  { jobId: job.id, prompt: 'Execute a different job' }, { jobId: '../foreign-job' }, {}, null]) {
  const count = lookupIds.length;
  const rejected = await collect(agent, input(props));
  assert.equal(lookupIds.length, count, 'client identity, extra commands and invalid IDs must not reach the owner getter');
  assert.equal(rejected.at(-1)?.type, EventType.RUN_ERROR);
  assert.doesNotMatch(JSON.stringify(rejected), /foreign-user|foreign-tenant|Execute a different job/);
}
const missing = await collect(agent, input({ jobId: 'not-owned-job' }));
assert.equal(missing.at(-1)?.type, EventType.RUN_ERROR);
assert.doesNotMatch(JSON.stringify(missing), /17 \+ 25/);
const mismatched = await collect(new CopilotJobProjectionAgent({ getJob: () => ({ ...job, id: 'foreign-job', result: 'PRIVATE-FOREIGN-RESULT' }) }));
assert.equal(mismatched.at(-1)?.type, EventType.RUN_ERROR);
assert.doesNotMatch(JSON.stringify(mismatched), /PRIVATE-FOREIGN/);
const failed = await collect(new CopilotJobProjectionAgent({ getJob: () => { throw new Error('SECRET-LOOKUP-FAILURE'); } }));
assert.equal(failed.at(-1)?.type, EventType.RUN_ERROR);
assert.doesNotMatch(JSON.stringify(failed), /SECRET-LOOKUP-FAILURE/);

let resolve!: (value: CoreOrchestrationJob) => void;
const pending = new CopilotJobProjectionAgent({ getJob: () => new Promise<CoreOrchestrationJob>(yes => { resolve = yes; }) });
const observed: BaseEvent[] = [];
const subscription = pending.run(input()).subscribe(event => observed.push(event));
subscription.unsubscribe();
resolve(job);
await new Promise(yes => setTimeout(yes, 0));
assert.deepEqual(observed.map(event => event.type), [EventType.RUN_STARTED], 'teardown suppresses late display data without cancelling the stored job');
assert.deepEqual(job, before);
assert.throws(() => new CopilotJobProjectionAgent({ getJob: null } as any), /getter|getJob/i);
console.log('PASS: real AG-UI text/tool events project one owned stored job; identity injection, foreign jobs and lookup secrets fail closed; no execution mutation');
