import assert from 'node:assert/strict';
import React from 'react';
import { registerHooks } from 'node:module';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

// Execute the production Workspace -> JobView -> connected controller chain.
// Only Teams/browser and SDK display slots are synthetic; no external request.
const fixture = globalThis as typeof globalThis & { __continuityRequest?: (input: string, init?: RequestInit) => Promise<Response> };
const hooks = registerHooks({ resolve(specifier, context, next) {
  let code: string | undefined;
  if (specifier === '@microsoft/teams-js') code = `export const app={initialize:async()=>{},getContext:async()=>({page:{frameContext:'personal'}})}; export const dialog={url:{isSupported:()=>false}};`;
  if (specifier === '@copilotkit/react-core/v2') code = `export function CopilotKit({children}){return children} export function CopilotChatConfigurationProvider({children}){return children} export function CopilotChatView(){return null} export function CopilotChatUserMessage(){return null} export function CopilotChatAssistantMessage(){return null} export function useRenderTool(){} export function useRenderToolCall(){return ()=>null} export function useAgent(){return {isReady:false}}`;
  if (specifier === './auth.js' && context.parentURL?.includes('/src/client/')) code = `export function apiFetch(input,init){return globalThis.__continuityRequest(input,init)} export function getCachedAuthHeaders(){return {}} export function isApiAuthError(){return false}`;
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
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://synthetic.invalid', search: '' }, addEventListener() {}, removeEventListener() {} } });
Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } });
const workspace = host(), shell = host(), connected = host();
try {
  const { createCoreOrchestrationClient } = await import('../src/client/core-orchestration-client.js');
  const { CopilotConversationWorkspace } = await import('../src/client/CopilotConversationWorkspace.js');
  const rows: CoreOrchestrationJob[] = Array.from({ length: 60 }, (_, i) => ({ id: `continuity-${i}`, provider: 'codex', mode: 'read-only', status: 'completed',
    prompt: `합성 요청 ${i}`, result: `합성 응답 ${i}`, progress: [], createdAt: '2026-10-14T00:00:00Z', ...(i ? { parentJobId: `continuity-${i - 1}` } : {}) }));
  const originalId = rows.at(-1)!.id; let sends = 0;
  fixture.__continuityRequest = async (input, init = {}) => {
    const url = String(input);
    if (init.method === 'POST') { sends++; const child = { ...rows.at(-1)!, id: 'continuity-child', parentJobId: originalId }; rows.push(child); return Response.json({ job: child }); }
    if (url.endsWith('/jobs')) return Response.json({ jobs: rows, providers: [] });
    return Response.json({ job: rows.find(row => url.endsWith('/' + row.id)) });
  };
  const client = createCoreOrchestrationClient(fixture.__continuityRequest);
  const workspaceProps = { initialJobId: originalId, client };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  let tree = workspace.render(CopilotConversationWorkspace, workspaceProps); workspace.flush(); await tick();
  tree = workspace.render(CopilotConversationWorkspace, workspaceProps); workspace.flush();
  const initialView = find(tree, 'CopilotJobView'); assert.ok(initialView);
  let view = shell.render(initialView.type, initialView.props); shell.flush();
  const initialSdk = find(view, 'CopilotKit'), initialConnected = find(view, 'ConnectedCoreConversation');
  let detail = connected.render(initialConnected.type, initialConnected.props); connected.flush(); await tick();
  const rerender = () => { tree = workspace.render(CopilotConversationWorkspace, workspaceProps); workspace.flush();
    const nextView = find(tree, 'CopilotJobView'); view = shell.render(nextView.type, nextView.props); shell.flush();
    const next = find(view, 'ConnectedCoreConversation'); detail = connected.render(next.type, next.props); connected.flush(); return nextView; };
  for (let i = 0; i < 2; i++) { rerender(); find(detail, 'CopilotConversationTranscript').props.loadEarlier(); await tick(); }
  rerender(); assert.equal(find(detail, 'CopilotConversationTranscript').props.state.conversation.turns.length, 60);
  find(detail, 'CopilotConversationTranscript').props.send('합성 후속 요청'); await tick();
  const nextView = rerender();
  assert.equal(nextView.key, initialView.key, 'child continuation retains the logical Workspace component identity');
  assert.equal(find(view, 'CopilotKit').key, initialSdk.key, 'child continuation cannot remount the SDK subtree');
  assert.equal(find(view, 'ConnectedCoreConversation').props.jobId, initialConnected.props.jobId, 'controller lifetime stays attached to the logical conversation');
  await tick(); rerender();
  let transcript = find(detail, 'CopilotConversationTranscript');
  assert.equal(transcript.props.state.conversation.turns.length, 61, 'successful continuation retains every expanded turn');
  transcript.props.setInput('합성 새 초안'); rerender();
  const refreshButton = (detail.props.children as any[])[0]; refreshButton.props.onClick(); await tick(); rerender();
  transcript = find(detail, 'CopilotConversationTranscript');
  assert.equal(transcript.props.state.conversation.turns.length, 61);
  assert.equal(transcript.props.input, '합성 새 초안', 'poll/refresh of the child never clears a new draft');
  assert.equal(sends, 1, 'display and refresh do not duplicate the continuation');
  console.log('PASS: connected Workspace/SDK/controller preserve 60→61 turns, draft and one mutation across child refresh');
} finally {
  connected.dispose(); shell.dispose(); workspace.dispose(); hooks.deregister(); delete fixture.__continuityRequest;
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else Reflect.deleteProperty(globalThis, 'document');
}
