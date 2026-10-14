import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkOutputPtyObservation } from '../src/client/WorkOutputPtyObservation.js';
import { PtyOutputView } from '../src/client/PtyOutputView.js';
import { createPtyOutputAccessGroup } from '../src/client/pty-output-access.js';
import type { WorkOutputPtyCapability } from '../src/client/work-output-pty.js';
import type { PtyReadSnapshot } from '../src/shared/pty-read.js';

type Props = React.ComponentProps<typeof WorkOutputPtyObservation>;
type Element = React.ReactElement<Record<string, unknown>>;
const identity = { jobId: 'same-core-job', sessionId: 'retained-session', generation: 1 };
const denied = () => {};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function context(label: string) {
  let generation = 0;
  const calls = { describe: 0, read: 0, signals: [] as AbortSignal[] };
  let pendingMetadata: ReturnType<typeof deferred<unknown>> | undefined;
  let pendingRead: ReturnType<typeof deferred<unknown>> | undefined;
  const snapshot = (): PtyReadSnapshot => ({ ...identity, source: 'pty', outputMode: 'redacted-lines', state: 'running',
    frames: [{ sequence: 1, text: label + '\n' }], firstAvailableSequence: 1, nextCursor: 1,
    truncated: false, pendingOutput: false, outputClipped: false, outputSuppressed: false });
  const group = createPtyOutputAccessGroup({ getAccessGeneration: () => generation, onAccessDenied: denied });
  const capability: WorkOutputPtyCapability = { getAccessGeneration: () => generation, getAccessGroup: () => group, client: {
    async describe(_job, signal) { calls.describe++; calls.signals.push(signal); return pendingMetadata ? pendingMetadata.promise : identity; },
    async read(_identity, _after, signal) { calls.read++; calls.signals.push(signal); return pendingRead ? pendingRead.promise : snapshot(); },
  } };
  return { capability, calls, snapshot, dispose: () => group.dispose(), advanceGeneration: () => { generation++; },
    delayMetadata() { pendingMetadata = deferred(); return pendingMetadata; },
    delayRead() { pendingRead = deferred(); return pendingRead; } };
}

// Like the existing panel hook fixture, hold passive effects while rendering the
// actual component. This inspects its produced element tree before cleanup.
function host() {
  type Cell = { value: unknown; dependencies?: readonly unknown[]; effect?: () => void | (() => void); pending?: boolean };
  const cells: Cell[] = []; let cursor = 0; let updates = 0;
  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [cells[index]!.value, (value: unknown) => {
        updates++; cells[index]!.value = typeof value === 'function' ? value(cells[index]!.value) : value;
      }];
    },
    useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
      const index = cursor++; const previous = cells[index];
      if (!previous || dependencies.length !== previous.dependencies?.length
        || dependencies.some((value, n) => !Object.is(value, previous.dependencies?.[n]))) {
        cells[index] = { value: previous?.value, dependencies, effect, pending: true };
      }
    },
  };
  return {
    render(props: Props) {
      cursor = 0;
      const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown } }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H; internals.H = dispatcher;
      try { return WorkOutputPtyObservation(props); } finally { internals.H = previous; }
    },
    flushEffects() {
      for (const cell of cells) if (cell?.pending) {
        cell.pending = false; if (typeof cell.value === 'function') cell.value(); cell.value = cell.effect?.();
      }
    },
    get updates() { return updates; },
    dispose() { for (const cell of cells) if (cell?.effect && typeof cell.value === 'function') cell.value(); },
  };
}
function find(tree: React.ReactNode, predicate: (node: Element) => boolean): Element | undefined {
  for (const node of React.Children.toArray(tree)) if (React.isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) return node;
    const found = find(node.props.children as React.ReactNode, predicate); if (found) return found;
  }
  return undefined;
}
function openButton(tree: React.ReactNode) {
  const button = find(tree, node => node.type === 'button' && node.props.children === '기존 PTY 관찰 보기');
  assert(button, 'the current context needs an explicit observation control');
  return button;
}
function hiddenBeforeEffects(tree: React.ReactNode, oldText: string) {
  assert.doesNotMatch(renderToStaticMarkup(tree), new RegExp(oldText), 'a new context must hide old text during render, before effect cleanup');
  assert.equal(find(tree, node => node.type === PtyOutputView), undefined, 'old observer controls must not be rendered');
  const button = openButton(tree); assert.equal(button.props.disabled, true, 'observation stays disabled until its matching observer is installed');
  (button.props.onClick as () => void)();
}
async function opened(h: ReturnType<typeof host>, props: Props) {
  h.render(props); h.flushEffects(); const tree = h.render(props);
  (openButton(tree).props.onClick as () => void)(); await tick(); return h.render(props);
}
let checks = 0; const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  try { await run(); checks++; console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name, error); }
}

await check('same job client replacement hides frames and disables old observer before passive effects', async () => {
  const a = context('OLD_CLIENT_OUTPUT'); const b = context('NEW_CLIENT_OUTPUT'); const h = host();
  const props = { jobId: identity.jobId, capability: a.capability, onAccessDenied: denied };
  try {
    assert.match(renderToStaticMarkup(await opened(h, props)), /OLD_CLIENT_OUTPUT/);
    const next = { ...props, capability: b.capability }; hiddenBeforeEffects(h.render(next), 'OLD_CLIENT_OUTPUT');
    assert.equal(a.calls.describe, 1); assert.equal(a.calls.read, 1); assert.equal(b.calls.describe, 0);
    h.flushEffects(); assert.match(renderToStaticMarkup(await opened(h, next)), /NEW_CLIENT_OUTPUT/);
    assert.doesNotMatch(renderToStaticMarkup(h.render(next)), /OLD_CLIENT_OUTPUT/);
  } finally { h.dispose(); a.dispose(); b.dispose(); }
});
await check('same capability with a changed auth generation hides private text before cleanup', async () => {
  const a = context('OLD_AUTH_GENERATION'); const h = host(); const props = { jobId: identity.jobId, capability: a.capability, onAccessDenied: denied };
  try { await opened(h, props); a.advanceGeneration(); hiddenBeforeEffects(h.render(props), 'OLD_AUTH_GENERATION');
    assert.equal(a.calls.describe, 1); assert.equal(a.calls.read, 1);
  } finally { h.dispose(); a.dispose(); }
});
await check('old pending read resolving before cleanup cannot paint into the replacement context', async () => {
  const a = context('LATE_OLD_READ'); const b = context('CURRENT_READ'); const h = host();
  const pending = a.delayRead(); const props = { jobId: identity.jobId, capability: a.capability, onAccessDenied: denied };
  try {
    await opened(h, props); const next = { ...props, capability: b.capability }; h.render(next);
    pending.resolve(a.snapshot()); await tick(); hiddenBeforeEffects(h.render(next), 'LATE_OLD_READ');
    h.flushEffects(); await opened(h, next); assert.match(renderToStaticMarkup(h.render(next)), /CURRENT_READ/);
  } finally { h.dispose(); a.dispose(); b.dispose(); }
});
await check('late metadata after replacement cleanup cannot read or revive the old context', async () => {
  const a = context('OLD_METADATA_OUTPUT'); const b = context('CURRENT_METADATA_OUTPUT'); const h = host();
  const pending = a.delayMetadata(); const props = { jobId: identity.jobId, capability: a.capability, onAccessDenied: denied };
  try {
    await opened(h, props); const next = { ...props, capability: b.capability }; h.render(next); h.flushEffects();
    await opened(h, next); const updates = h.updates; pending.resolve(identity); await tick();
    assert.equal(a.calls.read, 0); assert.equal(a.calls.signals[0]?.aborted, true); assert.equal(h.updates, updates);
    assert.match(renderToStaticMarkup(h.render(next)), /CURRENT_METADATA_OUTPUT/);
    assert.doesNotMatch(renderToStaticMarkup(h.render(next)), /OLD_METADATA_OUTPUT/);
  } finally { h.dispose(); a.dispose(); b.dispose(); }
});
await check('late read after replacement cleanup cannot overwrite the current observer', async () => {
  const a = context('OLD_READ_AFTER_CLEANUP'); const b = context('CURRENT_AFTER_CLEANUP'); const h = host();
  const pending = a.delayRead(); const props = { jobId: identity.jobId, capability: a.capability, onAccessDenied: denied };
  try {
    await opened(h, props); const next = { ...props, capability: b.capability }; h.render(next); h.flushEffects();
    await opened(h, next); const updates = h.updates; pending.resolve(a.snapshot()); await tick();
    assert.equal(a.calls.signals.at(-1)?.aborted, true); assert.equal(h.updates, updates);
    assert.match(renderToStaticMarkup(h.render(next)), /CURRENT_AFTER_CLEANUP/);
    assert.doesNotMatch(renderToStaticMarkup(h.render(next)), /OLD_READ_AFTER_CLEANUP/);
  } finally { h.dispose(); a.dispose(); b.dispose(); }
});
await check('component close and dispose clear frames and suppress pending output', async () => {
  const a = context('CLOSE_PENDING_OUTPUT'); const h = host(); const pending = a.delayRead();
  const props = { jobId: identity.jobId, capability: a.capability, onAccessDenied: denied };
  try {
    const tree = await opened(h, props); const view = find(tree, node => node.type === PtyOutputView); assert(view);
    (view.props.onClose as () => void)(); pending.resolve(a.snapshot()); await tick();
    assert.doesNotMatch(renderToStaticMarkup(h.render(props)), /CLOSE_PENDING_OUTPUT/);
    assert.match(renderToStaticMarkup(h.render(props)), /관찰 보기를 닫았습니다/);
    h.dispose(); const updates = h.updates; await tick(); assert.equal(h.updates, updates);
  } finally { h.dispose(); a.dispose(); }
});
assert.deepEqual(failures, [], 'context-binding regression failures');
console.log(JSON.stringify({ result: 'PASS', checks, actualCodexOrNativeSpawns: 0 }));
