import assert from 'node:assert/strict';
import React, { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerHooks } from 'node:module';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@microsoft/teams-js') return { format: 'module', shortCircuit: true,
    url: 'data:text/javascript,export const app={initialize:async()=>{throw Error("fixture-host-unavailable")},getContext:async()=>({page:{frameContext:"content"}})};export const dialog={url:{isSupported:()=>false,submit:()=>{}}};export const authentication={};' };
  if (specifier.endsWith('/CopilotJobView.js') || specifier === './CopilotJobView.js') return { format: 'module', shortCircuit: true,
    url: 'data:text/javascript,export function CopilotJobView(){return null;}' };
  return nextResolve(specifier, context);
} });
const reviewModule = await import('../src/client/CoreResultReview.js').catch(() => undefined);
assert.equal(typeof reviewModule?.CoreResultReview, 'function', 'completed Core jobs need private preview before an explicit original-conversation confirmation');
const { CoreResultReview } = reviewModule!;
type Element = ReactElement<any>;
function find(node: unknown, predicate: (value: Element) => boolean): Element | undefined {
  if (!React.isValidElement(node)) return undefined;
  const element = node as Element;
  if (predicate(element)) return element;
  for (const child of [element.props.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
}
function scheduler(component: Function = CoreResultReview) {
  const values: any[] = [], effects: Array<{ deps: unknown[]; run: () => unknown; pending: boolean }> = [], cleanups: Function[] = [];
  let cursor = 0;
  const dispatcher = {
    useRef(value: unknown) { const index = cursor++; return values[index] ??= { current: value }; },
    useMemo(factory: Function, deps: unknown[]) { const index = cursor++, old = values[index]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) values[index] = { value: factory(), deps }; return values[index].value; },
    useState(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next: any) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useEffect(run: () => unknown, deps: unknown[]) { const index = cursor++, old = effects[index];
      if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects[index] = { run, deps, pending: true }; },
  };
  return { render(props: unknown): Element { cursor = 0; const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const old = internals.H; internals.H = dispatcher; try { return component(props as never); } finally { internals.H = old; } },
    flush() { for (const effect of effects) if (effect?.pending) { effect.pending = false; const cleanup = effect.run(); if (typeof cleanup === 'function') cleanups.push(cleanup); } },
    dispose() { for (const cleanup of cleanups) cleanup(); } };
}
const job: CoreOrchestrationJob = { id: 'result-ui-fixture', status: 'completed', mode: 'read-only', prompt: '개인 검토', result: '민감한 개인 결과', progress: [], createdAt: '2026-10-11T00:00:00Z',
  resources: { sources: [{ url: 'https://example.com/source', host: 'example.com', evidence: 'result-text', retrieval: 'unverified', action: 'explicit-open' }],
    file: { name: 'result.txt', state: 'unsupported', reason: 'manifest-supports-files-false', alternative: 'authenticated-result-download' } } };
const publication = { operationId: 'publication-00000000-0000-4000-8000-000000000000', jobId: job.id, resultRevision: 'a'.repeat(64), state: 'preview' as const, origin: { conversationType: 'groupChat' as const } };
const actions: string[] = [];
let state: string = 'preview', failConfirm = false, denyStatus = false;
const client = {
  async getStatus() { actions.push('GET'); if (denyStatus) throw Object.assign(new Error('forbidden'), { status: 403 });
    return { canPreview: state === 'preview', publication: { ...publication, state } }; },
  async preview() { actions.push('PREVIEW'); return { publication, text: '<script>개인 미리보기</script>' }; },
  async confirm(_jobId: string, identity: unknown) { actions.push('CONFIRM'); assert.deepEqual(identity, { operationId: publication.operationId, resultRevision: publication.resultRevision });
    if (failConfirm) throw new Error('transport outcome unknown'); state = 'connector-accepted'; return { publication: { ...publication, state } }; },
  async download() { actions.push('DOWNLOAD'); return new Blob(['fixture']); },
};
const fixture = scheduler();
const props = { job, client: client as never };
let tree = fixture.render(props); fixture.flush(); await new Promise(resolve => setImmediate(resolve)); tree = fixture.render(props);
assert.deepEqual(actions, ['GET'], 'mount is read-only and never previews/publishes automatically');
let html = renderToStaticMarkup(tree);
assert.match(html, /출처.*확인되지|조회 여부.*확인되지/);
assert.match(html, /Teams 파일.*지원하지|Teams 파일.*지원되지/);
assert.doesNotMatch(html, /iframe|src="https:\/\/example.com|민감한 개인 결과/);
const preview = find(tree, item => item.type === 'button' && String(item.props.children).includes('미리보기'))!;
await preview.props.onClick(); tree = fixture.render(props); html = renderToStaticMarkup(tree);
assert.match(html, /&lt;script&gt;개인 미리보기&lt;\/script&gt;/);
assert.match(html, /원래 그룹 대화/);
assert.deepEqual(actions, ['GET', 'PREVIEW']);
const confirm = find(tree, item => item.type === 'button' && String(item.props.children).includes('확인하고 전송'))!;
await Promise.all([confirm.props.onClick(), confirm.props.onClick()]); tree = fixture.render(props);
assert.equal(actions.filter(value => value === 'CONFIRM').length, 1, 'duplicate clicks cannot publish twice');
assert.match(renderToStaticMarkup(tree), /커넥터.*수락/);
assert.doesNotMatch(renderToStaticMarkup(tree), /전달 완료|사용자가 읽/);
fixture.dispose();
state = 'preview'; failConfirm = true;
const uncertain = scheduler(); uncertain.render(props); uncertain.flush(); await new Promise(resolve => setImmediate(resolve)); tree = uncertain.render(props);
await find(tree, item => item.type === 'button' && String(item.props.children).includes('미리보기'))!.props.onClick(); tree = uncertain.render(props);
await find(tree, item => item.type === 'button' && String(item.props.children).includes('확인하고 전송'))!.props.onClick(); tree = uncertain.render(props);
html = renderToStaticMarkup(tree); assert.match(html, /불확실|확인할 수 없/); assert.doesNotMatch(html, /확인하고 전송/);
await find(tree, item => item.type === 'button' && String(item.props.children).includes('상태'))!.props.onClick(); tree = uncertain.render(props);
assert.doesNotMatch(renderToStaticMarkup(tree), /확인하고 전송/, 'unknown outcome cannot be resent even when a later read returns preview');
state = 'connector-accepted';
await find(tree, item => item.type === 'button' && String(item.props.children).includes('상태'))!.props.onClick(); tree = uncertain.render(props);
assert.match(renderToStaticMarkup(tree), /커넥터.*수락/, 'a later authoritative read resolves uncertainty while retaining the no-resend guard');
assert.doesNotMatch(renderToStaticMarkup(tree), /확인하고 전송/);
denyStatus = true;
await find(tree, item => item.type === 'button' && String(item.props.children).includes('상태'))!.props.onClick(); tree = uncertain.render(props);
assert.doesNotMatch(renderToStaticMarkup(tree), /https:\/\/example.com\/source/, 'denied result status hides retained private source links');
assert.equal(find(tree, item => item.type === 'button' && String(item.props.children).includes('결과 파일 다운로드'))!.props.disabled, true);
uncertain.dispose();
const workspace = await import('../src/client/CopilotConversationWorkspace.js');
let submitted: unknown, recipients: unknown;
type HostContext = { page: { frameContext: string }; app?: { appId?: { toString(): string } | string } };
const sdk = { app: { async initialize() {}, async getContext(): Promise<HostContext> { return { page: { frameContext: 'content' } }; } },
  dialog: { url: { isSupported: () => true, submit(value: unknown, appIds?: unknown) { submitted = value; recipients = appIds; } } } };
assert.equal(await workspace.closeConversationDialog(job.id, sdk as never), false); assert.equal(submitted, undefined);
sdk.app.getContext = async () => ({ page: { frameContext: 'task' } });
assert.equal(await workspace.closeConversationDialog(job.id, sdk as never), false, 'task context without an observed receiving app ID must not close');
assert.equal(submitted, undefined);
sdk.app.getContext = async () => ({ page: { frameContext: 'task' }, app: { appId: ' ' } });
assert.equal(await workspace.closeConversationDialog(job.id, sdk as never), false, 'blank app ID is not an authorized receiver');
assert.equal(submitted, undefined);
const observedAppId = '00000000-0000-4000-8000-000000000009';
sdk.app.getContext = async () => ({ page: { frameContext: 'content' }, app: { appId: { toString: () => observedAppId } } });
assert.equal(await workspace.closeConversationDialog(job.id, sdk as never), false); assert.equal(submitted, undefined);
sdk.app.getContext = async () => ({ page: { frameContext: 'task' }, app: { appId: { toString: () => observedAppId } } });
assert.equal(await workspace.closeConversationDialog(job.id, sdk as never), true); assert.deepEqual(submitted, { jobId: job.id });
assert.deepEqual(recipients, [observedAppId], 'data submission authorizes only the app ID observed in Teams context');
let denyOwner = false;
const ownerClient = { async listJobs() { return { jobs: [job], providers: [] }; }, async getJob() {
  if (denyOwner) throw Object.assign(new Error('owner denied'), { status: 403 }); return job;
} };
const ownedWorkspace = scheduler(workspace.CopilotConversationWorkspace);
const workspaceProps = { initialJobId: job.id, client: ownerClient as never };
ownedWorkspace.render(workspaceProps); ownedWorkspace.flush(); await new Promise(resolve => setImmediate(resolve)); tree = ownedWorkspace.render(workspaceProps);
assert.ok(find(tree, item => item.type === CoreResultReview && item.props.job.id === job.id), 'review mounts only after matching authenticated selected-job read');
denyOwner = true;
find(tree, item => item.type === 'button' && String(item.props.children).includes('작업 목록 새로고침'))!.props.onClick();
ownedWorkspace.render(workspaceProps); ownedWorkspace.flush(); await new Promise(resolve => setImmediate(resolve)); tree = ownedWorkspace.render(workspaceProps);
assert.equal(find(tree, item => item.type === CoreResultReview), undefined, 'owner refresh failure clears the retained review');
assert.ok(find(tree, item => item.props.role === 'alert' && String(item.props.children).includes('접근 권한')));
ownedWorkspace.dispose();
hooks.deregister();
console.log('PASS: read-only result mount, source/file boundaries, escaped preview, explicit single confirm, unknown-outcome no resend, actual-task-only close');
