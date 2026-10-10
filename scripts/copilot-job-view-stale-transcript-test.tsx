import assert from 'node:assert/strict';
import React, { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HttpAgent } from '@ag-ui/client';
import { registerHooks } from 'node:module';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

// MP-375: removing the refresh-start/error reset or the view's hidden-state
// transition must fail this test. Only host hooks and display slots are shimmed;
// the production component/controller and installed AG-UI transport run intact.
const fixtureGlobal = globalThis as typeof globalThis & { __copilotStaleViewFixture?: any };
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (/\/src\/client\/CopilotJobView\.(?:tsx|js)$/.test(context.parentURL ?? '')) {
    const code = specifier === '@copilotkit/react-core/v2' ? `
      export function CopilotKit({children}) { return children; }
      export function CopilotChat() { return globalThis.__copilotStaleViewFixture.renderTranscript(); }
      export function useAgent() { return {agent:globalThis.__copilotStaleViewFixture.agent,isReady:true}; }
      export function useRenderTool() {}
    ` : specifier === './auth.js' ? `
      export function apiFetch(input,init) { return globalThis.__copilotStaleViewFixture.request(input,init); }
      export function getCachedAuthHeaders() { return {}; }
      export function isApiAuthError() { return false; }
    ` : undefined;
    if (code) return { format: 'module', shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(code)}` };
  }
  if (specifier.endsWith('.css')) return { format: 'module', shortCircuit: true, url: 'data:text/javascript,export default {}' };
  return nextResolve(specifier, context);
} });
const previousFetch = globalThis.fetch;
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
globalThis.fetch = async () => { throw new Error('REAL_NETWORK_FORBIDDEN'); };
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://synthetic.invalid' } } });
const deadline = setTimeout(() => { console.error('MP375_FIXTURE_DEADLINE_30000_MS'); process.exit(124); }, 30_000);

type Element = ReactElement<any>;
function find(node: unknown, predicate: (value: Element) => boolean): Element | undefined {
  if (!React.isValidElement(node)) return undefined;
  const element = node as Element;
  if (predicate(element)) return element;
  for (const child of [element.props.children].flat(Infinity)) {
    const found = find(child, predicate); if (found) return found;
  }
}
function scheduler() {
  const states: any[] = [], effects: Array<{ dependencies: unknown[]; effect: () => unknown; pending: boolean }> = [], cleanups: Function[] = [];
  let cursor = 0;
  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (value: any) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(effect: () => unknown, dependencies: unknown[]) {
      const index = cursor++, old = effects[index];
      if (!old || dependencies.some((value, n) => !Object.is(value, old.dependencies[n]))) effects[index] = { effect, dependencies, pending: true };
    },
  };
  return { states, render(fn: Function, props: unknown): Element {
    cursor = 0;
    const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const previous = internals.H; internals.H = dispatcher;
    try { return fn(props); } finally { internals.H = previous; }
  }, flush() {
    for (const effect of effects) if (effect?.pending) {
      effect.pending = false; const cleanup = effect.effect(); if (typeof cleanup === 'function') cleanups.push(cleanup);
    }
  }, dispose() { for (const cleanup of cleanups.splice(0)) cleanup(); } };
}

const disposers: Function[] = [];
try {
  const view = await import('../src/client/CopilotJobView.js');
  const { createExecutionPresentation } = await import('../src/shared/execution-presentation.js');
  const origin = 'https://synthetic.invalid';
  const job: CoreOrchestrationJob = { id: 'synthetic-stale-view-job', provider: 'codex', status: 'completed', mode: 'read-only',
    prompt: 'Read the synthetic fixture.', result: 'SYNTHETIC_INITIAL_RESULT', progress: [], tools: [], createdAt: '2026-10-10T00:00:00.000Z' };
  const agent = new HttpAgent({ agentId: 'execution-projection', url: `${origin}/api/copilot-ui/agent/execution-projection/run` });
  const requests: Array<{ method: string; url: string; body?: any }> = [];
  let failure: 'none' | 'owner403' | 'owner401' | 'owner-network' | 'sdk503' | 'sdk-partial' | 'pending-owner' = 'none';
  let releaseOwner!: (response: Response) => void;
  let run = 0;
  fixtureGlobal.__copilotStaleViewFixture = { agent, request: async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET', url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, url, body });
    if (method === 'GET') {
      assert.equal(url, `/api/core-orchestration/jobs/${job.id}`, 'Lookup stays pinned to the same approved job');
      if (failure === 'owner403' || failure === 'owner401') return Response.json({}, { status: failure === 'owner403' ? 403 : 401 });
      if (failure === 'owner-network') throw new TypeError('SYNTHETIC_OWNER_NETWORK_FAILURE');
      if (failure === 'pending-owner') return new Promise<Response>(resolve => { releaseOwner = resolve; });
      return Response.json({ job });
    }
    assert.equal(method, 'POST'); assert.equal(url, `${origin}/api/copilot-ui/agent/execution-projection/run`);
    assert.deepEqual(body.forwardedProps, { jobId: job.id });
    for (const key of ['messages', 'tools', 'context']) assert.deepEqual(body[key], []);
    assert.deepEqual(body.state, {}, 'Stale SDK state is never forwarded');
    if (failure === 'sdk503') return Response.json({}, { status: 503 });
    const presentation = createExecutionPresentation(job), id = `projection-${++run}`;
    const events: any[] = [
      { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
      { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: failure === 'sdk-partial' ? 'SYNTHETIC_PARTIAL_DATA' : presentation.text },
      { type: 'TEXT_MESSAGE_END', messageId: id },
    ];
    if (failure === 'sdk-partial') events.push({ type: 'STATE_SNAPSHOT', snapshot: { partial: 'SYNTHETIC_PARTIAL_STATE' } });
    else events.push(
      { type: 'TOOL_CALL_START', toolCallId: `${id}-tool`, toolCallName: 'showExecutionPresentation', parentMessageId: id },
      { type: 'TOOL_CALL_ARGS', toolCallId: `${id}-tool`, delta: JSON.stringify({ presentation }) },
      { type: 'TOOL_CALL_END', toolCallId: `${id}-tool` },
      { type: 'TOOL_CALL_RESULT', toolCallId: `${id}-tool`, messageId: `${id}-result`, role: 'tool', content: JSON.stringify(presentation) },
    );
    events.push({ type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId });
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  }, renderTranscript: () => {
    const assistant = agent.messages.find(row => row.role === 'assistant' && row.toolCalls?.length);
    const call = assistant?.role === 'assistant' ? assistant.toolCalls?.find(row => row.function.name === 'showExecutionPresentation') : undefined;
    if (!call) return null;
    const result = agent.messages.find(row => row.role === 'tool' && row.toolCallId === call.id);
    return view.renderExecutionPresentationTool({ status: 'complete', parameters: JSON.parse(call.function.arguments), result: result?.role === 'tool' ? result.content : undefined }, job.id);
  } };
  const outer = scheduler();
  let shell = outer.render(view.CopilotJobView, { jobId: job.id });
  const inner = find(shell, node => typeof node.type === 'function' && node.type.name === 'ConnectedProjectionView'); assert.ok(inner);
  const state = scheduler(); disposers.push(() => state.dispose());
  let tree = state.render(inner.type as Function, inner.props); state.flush(); tree = state.render(inner.type as Function, inner.props);
  const renderView = () => { tree = state.render(inner.type as Function, inner.props); return tree; };
  const transcript = () => find(tree, node => node.props.className === 'copilot-projection-transcript')!;
  const startRefresh = () => { find(tree, node => node.type === 'button')!.props.onClick(); renderView(); };
  async function finishRefresh() {
    for (let turn = 0; turn < 200 && state.states[1]; turn++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(state.states[1], false, 'The display refresh must finish in the bounded scheduler'); renderView();
  }
  async function succeed(result: string) {
    failure = 'none'; job.result = result; startRefresh(); await finishRefresh();
    assert.equal(transcript().props.hidden, false); assert.match(renderToStaticMarkup(tree), new RegExp(result));
    assert.ok(JSON.stringify(agent.messages).includes(result));
  }
  await succeed('SYNTHETIC_INITIAL_RESULT');
  const expectedSdkErrors: string[] = [];
  for (const scenario of ['owner403', 'owner401', 'owner-network', 'sdk503', 'sdk-partial'] as const) {
    const previousResult = job.result!; failure = scenario; agent.setState({ stale: previousResult });
    const before = requests.length, previousConsoleError = console.error;
    if (scenario === 'sdk503') console.error = (...args) => { expectedSdkErrors.push(args.map(String).join(' ')); };
    try {
      startRefresh();
      assert.equal(transcript().props.hidden, true, `${scenario}: hide the prior result before owner revalidation`);
      assert.deepEqual(agent.messages, [], `${scenario}: clear messages before owner revalidation`);
      assert.deepEqual(agent.state, {}, `${scenario}: clear state before owner revalidation`);
      await finishRefresh();
    } finally { console.error = previousConsoleError; }
    assert.equal(transcript().props.hidden, true, `${scenario}: a failed refresh cannot reveal a previous or partial transcript`);
    assert.deepEqual(agent.messages, [], `${scenario}: failure clears saved SDK messages`);
    assert.deepEqual(agent.state, {}, `${scenario}: failure clears saved SDK state`);
    assert.ok(find(tree, node => node.props.role === 'alert'), `${scenario}: show a retryable error`);
    assert.doesNotMatch(renderToStaticMarkup(tree), new RegExp(`${previousResult}|SYNTHETIC_PARTIAL_DATA`));
    assert.deepEqual(requests.slice(before).map(row => row.method), scenario.startsWith('owner') ? ['GET'] : ['GET', 'POST']);
    await succeed(`SYNTHETIC_FRESH_${scenario.replaceAll('-', '_')}`);
    assert.equal(JSON.stringify(agent.messages).includes(previousResult), false, 'Retry contains only the new same-job projection');
  }
  assert.ok(expectedSdkErrors.some(line => line.includes('Agent execution failed:')), 'The real AG-UI SDK failure path was exercised');

  // A renderer-level SDK error is also fail-closed without any execution call.
  agent.setState({ stale: 'display-error' }); const beforeDisplayError = requests.length;
  find(tree, node => (node.type as Function)?.name === 'CopilotChat')!.props.onError(); renderView();
  assert.equal(transcript().props.hidden, true); assert.deepEqual(agent.messages, []); assert.deepEqual(agent.state, {});
  assert.equal(requests.length, beforeDisplayError); await succeed('SYNTHETIC_DISPLAY_RETRY');

  // Duplicate refreshes preserve the active owner read and never start two runs.
  failure = 'pending-owner'; const beforePending = requests.length; startRefresh();
  assert.equal(transcript().props.hidden, true); assert.deepEqual(agent.messages, []);
  assert.equal((await state.states[0].refresh()).status, 'busy'); assert.equal(requests.length, beforePending + 1);
  failure = 'none'; job.result = 'SYNTHETIC_PENDING_FRESH'; releaseOwner(Response.json({ job })); await finishRefresh();
  assert.equal(transcript().props.hidden, false); assert.match(renderToStaticMarkup(tree), /SYNTHETIC_PENDING_FRESH/);

  // Connection errors remove the view; normal unmount cleanup clears the agent.
  find(shell, node => node.props.runtimeUrl === '/api/copilot-ui')!.props.onError();
  shell = outer.render(view.CopilotJobView, { jobId: job.id });
  assert.equal(find(shell, node => typeof node.type === 'function' && node.type.name === 'ConnectedProjectionView'), undefined);
  state.dispose(); assert.deepEqual(agent.messages, []); assert.deepEqual(agent.state, {});
  find(shell, node => node.type === 'button')!.props.onClick(); shell = outer.render(view.CopilotJobView, { jobId: job.id });
  const reconnected = find(shell, node => typeof node.type === 'function' && node.type.name === 'ConnectedProjectionView');
  assert.ok(reconnected, 'Explicit reconnect permits a fresh same-job view');
  const retryState = scheduler(); disposers.push(() => retryState.dispose());
  let retryTree = retryState.render(reconnected.type as Function, reconnected.props); retryState.flush();
  retryTree = retryState.render(reconnected.type as Function, reconnected.props);
  assert.equal(find(retryTree, node => node.props.className === 'copilot-projection-transcript')!.props.hidden, true);
  job.result = 'SYNTHETIC_CONNECTION_RETRY_FRESH';
  find(retryTree, node => node.type === 'button')!.props.onClick();
  for (let turn = 0; turn < 200 && retryState.states[1]; turn++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(retryState.states[1], false);
  retryTree = retryState.render(reconnected.type as Function, reconnected.props);
  assert.equal(find(retryTree, node => node.props.className === 'copilot-projection-transcript')!.props.hidden, false);
  assert.match(renderToStaticMarkup(retryTree), /SYNTHETIC_CONNECTION_RETRY_FRESH/);
  assert.doesNotMatch(renderToStaticMarkup(retryTree), /SYNTHETIC_PENDING_FRESH/);

  // Teardown aborts display I/O through the base SDK method, never /stop or a job mutation.
  let stopCalls = 0;
  class StopAwareHttpAgent extends HttpAgent { override abortRun(): void { stopCalls++; super.abortRun(); } }
  const disposedAgent = new StopAwareHttpAgent({ agentId: 'execution-projection', url: `${origin}/api/copilot-ui/agent/execution-projection/run` });
  disposedAgent.setMessages([{ id: 'old', role: 'assistant', content: 'SYNTHETIC_OLD' }]); disposedAgent.setState({ stale: true });
  const disposed = view.createCopilotProjectionController({ agent: disposedAgent, jobId: job.id, origin,
    request: (_input, init) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('synthetic abort', 'AbortError')), { once: true }); }) });
  const pending = disposed.refresh(); disposed.dispose(); assert.equal((await pending).status, 'disposed');
  assert.deepEqual(disposedAgent.messages, []); assert.deepEqual(disposedAgent.state, {}); assert.equal(stopCalls, 0);
  // A disposed lookup may finish late after the host reconnects the same agent.
  // Its old catch must not erase a newly authorized replacement view.
  let releaseOldOwner!: (response: Response) => void;
  const oldController = view.createCopilotProjectionController({ agent, jobId: job.id, origin,
    request: () => new Promise<Response>(resolve => { releaseOldOwner = resolve; }) });
  const oldRefresh = oldController.refresh(); oldController.dispose();
  const replacement = view.createCopilotProjectionController({ agent, jobId: job.id, origin,
    request: fixtureGlobal.__copilotStaleViewFixture.request });
  disposers.push(() => replacement.dispose());
  job.result = 'SYNTHETIC_REPLACEMENT_VIEW_FRESH';
  assert.equal((await replacement.refresh()).status, 'succeeded');
  releaseOldOwner(Response.json({ job }));
  assert.equal((await oldRefresh).status, 'disposed');
  assert.ok(JSON.stringify(agent.messages).includes(job.result), 'a disposed late lookup cannot erase the replacement view');
  console.log('PASS: MP-375 owner403/401/network, SDK503/partial/display/connection errors clear and hide stale messages/state; same-job retries, duplicate lookup and no-stop disposal remain read-only');
} finally {
  for (const dispose of disposers) dispose();
  clearTimeout(deadline); hooks.deregister(); globalThis.fetch = previousFetch;
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete (globalThis as any).window;
  delete fixtureGlobal.__copilotStaleViewFixture;
}
