import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HttpAgent } from '@ag-ui/client';
import { registerHooks } from 'node:module';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

const cssHook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) return { format: 'module', shortCircuit: true, url: 'data:text/javascript,export default {}' };
  return nextResolve(specifier, context);
} });

// These assertions are about the approved view's behavior; missing modules are
// reported as a missing feature rather than an unrelated loader stack trace.
const cardModule = await import('../src/client/ExecutionPresentationCard.js').catch(error => {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
assert.equal(typeof cardModule?.ExecutionPresentationCard, 'function', 'the shared execution summary card is not implemented');
const view = await import('../src/client/CopilotJobView.js');
const { createExecutionPresentation } = await import('../src/shared/execution-presentation.js');

const job: CoreOrchestrationJob = {
  id: 'synthetic-view-job', mode: 'read-only', provider: 'codex', status: 'completed',
  prompt: 'Read the synthetic fixture.', result: '17 + 25 = 42', progress: ['Synthetic read completed.'],
  createdAt: '2026-10-09T09:00:00.000Z', model: 'selected-model', reasoningEffort: 'xhigh',
  executionEnvironment: 'local-macos',
  executionReceipt: { source: 'worker-observation', observedAt: '2026-10-09T09:00:01.000Z', platform: 'darwin' },
  tools: [{ category: 'cli', name: 'cat', observedAt: '2026-10-09T09:00:00.500Z', execution: {
    source: 'codex.exec.jsonl.command_execution', itemId: 'item-1', status: 'completed',
    exitCode: 0, output: 'values:17,25\nexpected sum:42', outputTruncated: false,
  } }],
};
const presentation = createExecutionPresentation(job);
const render = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const ExecutionPresentationCard = cardModule!.ExecutionPresentationCard;
const summary = render(<ExecutionPresentationCard presentation={presentation} />);
assert.match(summary, /17 \+ 25 = 42/);
assert.match(summary, /worker-observation/);
assert.match(summary, /darwin/);
assert.match(summary, /선택 모델/);
assert.match(summary, /실제 모델/);
assert.match(summary, /확인되지 않음/);
assert.match(summary, /expected sum:42/);
assert.doesNotMatch(summary, /<button|<form|<input/, 'summary projection has no execution or approval controls');
const escaped = render(<ExecutionPresentationCard presentation={{ ...presentation, result: '<script>fixture()</script>' }} />);
assert.doesNotMatch(escaped, /<script>/);
assert.match(escaped, /&lt;script&gt;/);

const completed = view.renderExecutionPresentationTool({
  status: 'complete', parameters: { presentation }, result: JSON.stringify(presentation),
}, job.id);
assert.match(render(completed), /17 \+ 25 = 42/);
const loading = render(view.renderExecutionPresentationTool({ status: 'inProgress', parameters: {} }, job.id));
assert.match(loading, /불러오/);
assert.match(loading, /role="status"/);
assert.doesNotMatch(loading, /17 \+ 25/, 'a partial SDK stream cannot display a previous completed payload');
for (const invalid of [
  { ...presentation, jobId: 'foreign-job' },
  { ...presentation, unexpectedToken: 'fixture-private-token' },
  { schemaVersion: '1', jobId: job.id },
]) {
  const markup = render(view.renderExecutionPresentationTool({ status: 'complete', parameters: { presentation: invalid } }, job.id));
  assert.match(markup, /role="alert"/);
  assert.doesNotMatch(markup, /foreign-job|fixture-private-token|17 \+ 25/);
}

const origin = 'https://synthetic.invalid';
const runtimePath = '/api/copilot-ui/agent/execution-projection/run';
const requests: Array<{ url: string; method: string; body?: unknown }> = [];
const request = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const url = String(input);
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ url, method, body });
  if (method === 'GET') {
    assert.equal(url, `/api/core-orchestration/jobs/${job.id}`);
    return Response.json({ job });
  }
  assert.equal(url, `${origin}${runtimePath}`);
  assert.equal(method, 'POST');
  const events = [
    { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
    { type: 'TEXT_MESSAGE_START', messageId: 'projection-text', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'projection-text', delta: presentation.text },
    { type: 'TEXT_MESSAGE_END', messageId: 'projection-text' },
    { type: 'TOOL_CALL_START', toolCallId: 'projection-tool', toolCallName: 'showExecutionPresentation', parentMessageId: 'projection-text' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'projection-tool', delta: JSON.stringify({ presentation }) },
    { type: 'TOOL_CALL_END', toolCallId: 'projection-tool' },
    { type: 'TOOL_CALL_RESULT', toolCallId: 'projection-tool', messageId: 'projection-result', role: 'tool', content: JSON.stringify(presentation) },
    { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
};
const agent = new HttpAgent({ agentId: 'execution-projection', url: `${origin}${runtimePath}` });
const controller = view.createCopilotProjectionController({ agent, jobId: job.id, origin, request });
const result = await controller.refresh();
assert.equal(result.status, 'succeeded');
assert.equal(result.presentation?.jobId, job.id);
assert.deepEqual(requests.map(row => row.method), ['GET', 'POST']);
const runInput = requests[1]!.body as Record<string, unknown>;
assert.deepEqual(runInput.forwardedProps, { jobId: job.id });
assert.deepEqual(runInput.tools, []);
assert.deepEqual(runInput.context, []);
assert.deepEqual(runInput.messages, []);
assert.deepEqual(runInput.state, {});
assert.doesNotMatch(JSON.stringify(runInput), /owner|tenant|fixture-private-token/);
const assistant = agent.messages.find(message => message.role === 'assistant');
assert(assistant && assistant.role === 'assistant');
assert.match(String(assistant.content), /17 \+ 25 = 42/, 'installed AG-UI SDK must consume the actual SSE text event');
const call = assistant.toolCalls?.find(tool => tool.function.name === 'showExecutionPresentation');
assert(call, 'installed AG-UI SDK must consume the actual tool events');
const toolMarkup = render(view.renderExecutionPresentationTool({
  status: 'complete', parameters: JSON.parse(call.function.arguments),
  result: String(agent.messages.find(message => message.role === 'tool')?.content),
}, job.id));
assert.match(toolMarkup, /expected sum:42/);
controller.dispose();

let guardedRequests = 0;
const guarded = view.createCopilotProjectionRequest({ jobId: job.id, origin,
  request: async () => { guardedRequests += 1; return Response.json({}); },
});
const safeInput = JSON.stringify({ threadId: 'synthetic-thread', runId: 'synthetic-run',
  messages: [], state: {}, tools: [], context: [], forwardedProps: { jobId: job.id } });
for (const [url, method, body] of [
  ['https://foreign.invalid/api/copilot-ui/agent/execution-projection/run', 'POST', safeInput],
  [`${origin}/api/core-orchestration/jobs`, 'POST', safeInput],
  [`${origin}${runtimePath}`, 'GET', safeInput],
  [`${origin}${runtimePath}?redirect=foreign`, 'POST', safeInput],
  [`${origin}${runtimePath}`, 'POST', safeInput.replace('"jobId":"synthetic-view-job"', '"jobId":"foreign-job"')],
  [`${origin}${runtimePath}`, 'POST', safeInput.replace('"forwardedProps":{"jobId":"synthetic-view-job"}', '"forwardedProps":{"jobId":"synthetic-view-job","ownerId":"fixture-private-token"}')],
  [`${origin}${runtimePath}`, 'POST', safeInput.replace('"messages":[]', '"messages":[{"role":"user","content":"execute arbitrary task"}]')],
] as const) await assert.rejects(() => guarded(url, { method, body }), /읽기 전용|표시 요청/);
assert.equal(guardedRequests, 0, 'unsafe SDK transport must fail before auth or network access');

let releaseOwnerRead!: (value: Response) => void;
let ownerReadCount = 0;
const pendingAgent = new HttpAgent({ agentId: 'execution-projection', url: `${origin}${runtimePath}` });
const pending = view.createCopilotProjectionController({ agent: pendingAgent, jobId: job.id, origin,
  request: async (input, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      ownerReadCount += 1;
      return new Promise<Response>(resolve => { releaseOwnerRead = resolve; });
    }
    return request(input, init);
  },
});
const first = pending.refresh();
assert.equal((await pending.refresh()).status, 'busy');
assert.equal(ownerReadCount, 1, 'duplicate clicks may not overlap owner reads or SDK runs');
releaseOwnerRead(Response.json({ job }));
assert.equal((await first).status, 'succeeded');
pending.dispose();

const deniedAgent = new HttpAgent({ agentId: 'execution-projection', url: `${origin}${runtimePath}` });
let deniedNetworkCalls = 0;
const denied = view.createCopilotProjectionController({ agent: deniedAgent, jobId: job.id, origin,
  request: async () => { deniedNetworkCalls += 1; return Response.json({ error: 'fixture-private-token' }, { status: 403 }); },
});
const deniedResult = await denied.refresh();
assert.equal(deniedResult.status, 'failed');
assert.match(deniedResult.message ?? '', /권한/);
assert.doesNotMatch(deniedResult.message ?? '', /fixture-private-token/);
assert.equal(deniedNetworkCalls, 1, 'failed owner read cannot trigger an SDK run');
denied.dispose();

// The installed CopilotRuntime proxy overrides abortRun with an HTTP stop
// request. Teardown must use only the SDK's base HTTP cancellation contract.
let unsupportedStopCalls = 0;
class StopAwareHttpAgent extends HttpAgent {
  override abortRun(): void { unsupportedStopCalls += 1; super.abortRun(); }
}
const stoppingAgent = new StopAwareHttpAgent({ agentId: 'execution-projection', url: `${origin}${runtimePath}` });
const stopping = view.createCopilotProjectionController({ agent: stoppingAgent, jobId: job.id, origin,
  request: (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('synthetic view aborted', 'AbortError')), { once: true });
  }),
});
const stoppingRun = stopping.refresh();
stopping.dispose();
assert.equal((await stoppingRun).status, 'disposed');
assert.equal(unsupportedStopCalls, 0, 'view teardown cannot invoke the runtime proxy stop override');

cssHook.deregister();
console.log('PASS: shared summary and real AG-UI SDK tool rendering are same-job, bounded, accessible and read-only; auth errors and duplicate clicks fail safely');
