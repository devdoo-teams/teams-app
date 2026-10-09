import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Node has no stylesheet loader. The bootstrap and installed SDK remain real;
// only browser-only CSS imports are ignored for these lifecycle assertions.
const cssHook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) return { format: 'module', shortCircuit: true, url: 'data:text/javascript,export default {}' };
  return nextResolve(specifier, context);
} });

const implementation = await import('../src/optional-ui/main.js').catch(error => {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
assert.equal(typeof implementation?.createOptionalTeamsBootstrap, 'function', 'the independent authenticated Teams SDK entry is not implemented');
const create = implementation!.createOptionalTeamsBootstrap;

{
  let resolveInitialize!: () => void;
  let initializationCount = 0;
  let authenticationCount = 0;
  let readyMarks = 0;
  let notifyCount = 0;
  const states: string[] = [];
  const controller = create({
    initialize: () => { initializationCount += 1; return new Promise<void>(resolve => { resolveInitialize = resolve; }); },
    requireAuth: () => { authenticationCount += 1; },
    markHostReady: () => { readyMarks += 1; },
    notifySuccess: () => { notifyCount += 1; },
    renderState: state => { states.push(state.kind); },
    timeoutMs: 100,
  });
  const first = controller.start();
  const duplicate = controller.start();
  assert.equal(initializationCount, 1);
  assert.equal(readyMarks, 0, 'a pending host handshake cannot enable SSO requests');
  assert.equal(authenticationCount, 1, 'auth must be required before the handshake starts');
  resolveInitialize();
  assert.equal(await first, 'ready');
  assert.equal(await duplicate, 'ready');
  assert.equal(readyMarks, 1);
  assert.equal(notifyCount, 1);
  assert.deepEqual(states, ['loading', 'ready']);
  assert.equal(await controller.start(), 'ready');
  assert.equal(initializationCount, 1);
  controller.dispose();
}

{
  let initializationCount = 0;
  let readyMarks = 0;
  const states: Array<{ kind: string; message?: string }> = [];
  const controller = create({
    initialize: async () => { initializationCount += 1; throw new Error('fixture-private-host-details'); },
    requireAuth: () => {}, markHostReady: () => { readyMarks += 1; },
    notifySuccess: () => { assert.fail('a failed handshake cannot notify success'); },
    renderState: state => { states.push(state); }, timeoutMs: 100,
  });
  assert.equal(await controller.start(), 'blocked');
  assert.equal(await controller.start(), 'blocked');
  assert.equal(initializationCount, 1, 'a failed document handshake cannot start a new Teams session');
  assert.equal(readyMarks, 0);
  assert.match(states.at(-1)?.message ?? '', /Teams/);
  assert.doesNotMatch(JSON.stringify(states), /fixture-private-host-details/);
  controller.dispose();
}

{
  let resolveInitialize!: () => void;
  let readyMarks = 0;
  const controller = create({
    initialize: () => new Promise<void>(resolve => { resolveInitialize = resolve; }),
    requireAuth: () => {}, markHostReady: () => { readyMarks += 1; }, notifySuccess: () => {},
    renderState: () => {}, timeoutMs: 15,
  });
  assert.equal(await controller.start(), 'blocked');
  resolveInitialize();
  await Promise.resolve();
  assert.equal(readyMarks, 0, 'a timed-out or stale handshake cannot later authorize the optional view');
  assert.equal(await controller.start(), 'blocked');
  controller.dispose();
}

{
  let initializationCount = 0;
  let notifyCount = 0;
  const controller = create({
    initialize: async () => { initializationCount += 1; }, requireAuth: () => {}, markHostReady: () => {},
    notifySuccess: () => { notifyCount += 1; if (notifyCount === 1) throw new Error('fixture-private-notify-details'); },
    renderState: () => {}, timeoutMs: 100,
  });
  assert.equal(await controller.start(), 'blocked');
  assert.equal(await controller.start(), 'ready');
  assert.equal(initializationCount, 1, 'host acknowledgement retry does not restart app.initialize');
  assert.equal(notifyCount, 2);
  controller.dispose();
}

{
  let resolveInitialize!: () => void;
  let readyMarks = 0;
  const states: string[] = [];
  const controller = create({
    initialize: () => new Promise<void>(resolve => { resolveInitialize = resolve; }),
    requireAuth: () => {}, markHostReady: () => { readyMarks += 1; }, notifySuccess: () => {},
    renderState: state => { states.push(state.kind); }, timeoutMs: 100,
  });
  const start = controller.start();
  controller.dispose();
  resolveInitialize();
  assert.equal(await start, 'stale');
  assert.equal(readyMarks, 0);
  assert.deepEqual(states, ['loading']);
}

cssHook.deregister();
console.log('PASS: optional TeamsJS entry requires auth, performs one bounded handshake and preserves rejection/timeout/disposal boundaries');
