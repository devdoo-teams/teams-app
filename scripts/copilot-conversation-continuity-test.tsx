import assert from 'node:assert/strict';
import React from 'react';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { API_PRINCIPAL_SCOPE_HEADER, API_EXPECTED_PRINCIPAL_SCOPE_HEADER } from '../src/shared/api-principal-scope.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

// Execute the production Workspace -> JobView -> connected controller chain.
// Only Teams/browser and SDK display slots are synthetic; no external request.
const fixture = globalThis as typeof globalThis & { __continuityRequest?: (input: string, init?: RequestInit) => Promise<Response> };
const hooks = registerHooks({ resolve(specifier, context, next) {
  let code: string | undefined;
  if (specifier === '@microsoft/teams-js') code = `export const app={initialize:async()=>{},getContext:async()=>({page:{frameContext:'personal'}})}; export const dialog={url:{isSupported:()=>false}};`;
  if (specifier === '@copilotkit/react-core/v2') code = `export function CopilotKit({children}){return children} export function CopilotChatConfigurationProvider({children}){return children} export function CopilotChatView(){return null} export function CopilotChatUserMessage(){return null} export function CopilotChatAssistantMessage(){return null} export function useRenderTool(){} export function useRenderToolCall(){return ()=>null} export function useAgent(){return {isReady:false}}`;
  if (specifier.endsWith('.css')) code = 'export default {}';
  return code ? { format: 'module', shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(code)}` } : next(specifier, context);
} });
function host() {
  const cells: any[] = []; let cursor = 0;
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const i = cursor++, old = cells[i];
    if (!old || deps.length !== old.deps?.length || deps.some((v, n) => !Object.is(v, old.deps[n]))) cells[i] = { value: factory(), deps };
    return cells[i].value;
  };
  const dispatcher = {
    useRef: (value: unknown) => { const i = cursor++; return (cells[i] ??= { value: { current: value } }).value; },
    useState: (value: unknown) => { const i = cursor++; cells[i] ??= { value: typeof value === 'function' ? value() : value };
      cells[i].setter ??= (next: any) => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next; };
      return [cells[i].value, cells[i].setter]; },
    useMemo: memo, useCallback: (value: unknown, deps: unknown[]) => memo(() => value, deps),
    useEffect: (effect: Function, deps: unknown[]) => { const i = cursor++, old = cells[i];
      if (!old || deps.length !== old.deps?.length || deps.some((v, n) => !Object.is(v, old.deps[n]))) cells[i] = { deps, effect, cleanup: old?.cleanup, pending: true }; },
  };
  return {
    render(component: Function, props: unknown) { cursor = 0; const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const old = internals.H; internals.H = dispatcher; try { return component(props); } finally { internals.H = old; } },
    flush() { for (const cell of cells) if (cell.pending) { cell.pending = false; cell.cleanup?.(); cell.cleanup = cell.effect(); } },
    dispose() { for (const cell of cells) cell.cleanup?.(); },
  };
}
function find(node: any, name: string): any {
  if (Array.isArray(node)) return node.map(value => find(value, name)).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  if (typeof node.type === 'function' && node.type.name === name) return node;
  return find((node.props as any).children, name);
}
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://synthetic.invalid', search: '', hash: '' }, addEventListener() {}, removeEventListener() {} } });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } });
const workspace = host(), shell = host(), connected = host();
const previousFetch = globalThis.fetch;
const scope = createHash('sha256').update(JSON.stringify(['synthetic-tenant', 'synthetic-owner', 'synthetic-personal'])).digest('hex');
globalThis.fetch = async (input, init = {}) => {
  assert.ok(String(input).startsWith('/api/core-orchestration/jobs'), 'REAL_NETWORK_FORBIDDEN');
  const headers = new Headers(init.headers);
  assert.equal(headers.get('authorization'), 'Bearer synthetic-continuity-token');
  if (headers.has(API_EXPECTED_PRINCIPAL_SCOPE_HEADER)) assert.equal(headers.get(API_EXPECTED_PRINCIPAL_SCOPE_HEADER), scope);
  assert.ok(fixture.__continuityRequest);
  return fixture.__continuityRequest(String(input), init);
};
let resetAuthentication: (() => void) | undefined;
try {
  const { createCoreOrchestrationClient } = await import('../src/client/core-orchestration-client.js');
  const actualAuth = await import('../src/client/auth.js');
  actualAuth.resetAuthStateForTest(); actualAuth.markTeamsHostReady(); actualAuth.setAuthRequired(true);
  actualAuth.setAuthTokenProviderForTest(async () => 'synthetic-continuity-token');
  resetAuthentication = actualAuth.resetAuthStateForTest;
  const malformedClient = createCoreOrchestrationClient(async () => Response.json({}, { status: 201 }));
  await assert.rejects(malformedClient.submitJob({ idempotencyKey: 'synthetic-continuity-invalid',
    prompt: 'synthetic invalid receipt', provider: 'codex', mode: 'read-only', notify: false }), error => {
    assert.ok(error instanceof actualAuth.ApiMutationUncertainError);
    assert.equal(actualAuth.isApiMutationUncertainError(error), true);
    return true;
  });
  const { CopilotConversationWorkspace } = await import('../src/client/CopilotConversationWorkspace.js');
  const rows: CoreOrchestrationJob[] = Array.from({ length: 60 }, (_, i) => ({ id: `continuity-${i}`, provider: 'codex', mode: 'read-only', status: 'completed',
    prompt: `합성 요청 ${i}`, result: `합성 응답 ${i}`, progress: [], createdAt: '2026-10-14T00:00:00Z', ...(i ? { parentJobId: `continuity-${i - 1}` } : {}) }));
  const originalId = rows.at(-1)!.id; let sends = 0;
  const response = (body: unknown) => Response.json(body, { headers: { [API_PRINCIPAL_SCOPE_HEADER]: scope } });
  fixture.__continuityRequest = async (input, init = {}) => {
    const url = String(input);
    if (init.method === 'POST') { sends++; const child = { ...rows.at(-1)!, id: 'continuity-child', parentJobId: originalId }; rows.push(child); return response({ job: child }); }
    if (url.endsWith('/jobs')) return response({ jobs: rows, providers: [] });
    return response({ job: rows.find(row => url.endsWith('/' + row.id)) });
  };
  const client = createCoreOrchestrationClient();
  const workspaceProps = { initialJobId: originalId, client };
  const until = async <T,>(read: () => T | undefined, label: string): Promise<T> => {
    const deadline = Date.now() + 2000;
    for (let observations = 0; observations < 1000; observations++) {
      const value = read(); if (value !== undefined) return value;
      assert.ok(Date.now() < deadline, `${label} did not settle within2000ms`);
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    throw new Error(`${label} exceeded1000 observations`);
  };
  let tree: any;
  const initialView = await until(() => { tree = workspace.render(CopilotConversationWorkspace, workspaceProps); workspace.flush();
    return find(tree, 'CopilotJobView'); }, 'workspace owner jobs');
  assert.ok(initialView);
  let view = shell.render(initialView.type, initialView.props); shell.flush();
  const initialSdk = find(view, 'CopilotKit'), initialConnected = find(view, 'ConnectedCoreConversation');
  let detail = connected.render(initialConnected.type, initialConnected.props); connected.flush();
  const rerender = () => { tree = workspace.render(CopilotConversationWorkspace, workspaceProps); workspace.flush();
    const nextView = find(tree, 'CopilotJobView'); view = shell.render(nextView.type, nextView.props); shell.flush();
    const next = find(view, 'ConnectedCoreConversation'); detail = connected.render(next.type, next.props); connected.flush(); return nextView; };
  const waitForTurns = (turns: number) => until(() => {
    rerender(); const state = find(detail, 'CopilotConversationTranscript').props.state;
    assert.notEqual(state.phase, 'blocked', JSON.stringify(state));
    return state.phase === 'ready' && !state.stale && !state.loadingEarlier && state.conversation?.turns.length === turns ? true : undefined;
  }, `${turns} owner-visible turns`);
  await waitForTurns(20);
  for (let i = 0; i < 2; i++) { rerender(); find(detail, 'CopilotConversationTranscript').props.loadEarlier(); await waitForTurns((i + 2) * 20); }
  rerender();
  assert.ok(find(detail, 'CopilotConversationTranscript').props.state.conversation,
    JSON.stringify(find(detail, 'CopilotConversationTranscript').props.state));
  assert.equal(find(detail, 'CopilotConversationTranscript').props.state.conversation.turns.length, 60);
  find(detail, 'CopilotConversationTranscript').props.send('합성 후속 요청'); await waitForTurns(61);
  const nextView = rerender();
  assert.equal(nextView.key, initialView.key, 'child continuation retains the logical Workspace component identity');
  assert.equal(find(view, 'CopilotKit').key, initialSdk.key, 'child continuation cannot remount the SDK subtree');
  assert.equal(find(view, 'ConnectedCoreConversation').props.jobId, initialConnected.props.jobId, 'controller lifetime stays attached to the logical conversation');
  rerender();
  let transcript = find(detail, 'CopilotConversationTranscript');
  assert.equal(transcript.props.state.conversation.turns.length, 61, 'successful continuation retains every expanded turn');
  transcript.props.setInput('합성 새 초안'); rerender();
  const refreshButton = (detail.props.children as any[])[0]; refreshButton.props.onClick();
  await until(() => { rerender(); const state = find(detail, 'CopilotConversationTranscript').props.state;
    return state.phase === 'ready' && !state.stale ? true : undefined; }, 'child refresh');
  transcript = find(detail, 'CopilotConversationTranscript');
  assert.equal(transcript.props.state.conversation.turns.length, 61);
  assert.equal(transcript.props.input, '합성 새 초안', 'poll/refresh of the child never clears a new draft');
  assert.equal(sends, 1, 'display and refresh do not duplicate the continuation');
  assert.equal(actualAuth.getApiPrincipalScopeKey(), scope);
  console.log('PASS: connected Workspace/SDK/controller preserve 60→61 turns, draft and one mutation across child refresh');
} finally {
  connected.dispose(); shell.dispose(); workspace.dispose(); hooks.deregister(); delete fixture.__continuityRequest;
  resetAuthentication?.();
  globalThis.fetch = previousFetch;
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else Reflect.deleteProperty(globalThis, 'document');
}
