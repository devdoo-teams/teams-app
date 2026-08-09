import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const teamsJsTestModule = `
export const app = {
  initialize: async () => undefined,
  isInitialized: () => true,
  getContext: async () => ({ app: { host: { clientType: 'web', name: 'Teams' } } }),
};
export const authentication = { getAuthToken: async () => 'test-token' };
export const geoLocation = {
  getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
  hasPermission: async () => true,
  isSupported: () => false,
  requestPermission: async () => true,
};
export const location = {
  getLocation: () => undefined,
  isSupported: () => false,
};
`;

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@microsoft/teams-js') {
      return {
        format: 'module',
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(teamsJsTestModule)}`,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/styles.css')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default {};',
      };
    }
    return nextLoad(url, context);
  },
});

const { createTeamsBootstrapController } = await import('../src/client/main.js');

class FakeButton {
  private clickHandler: (() => void) | null = null;

  addEventListener(type: string, listener: () => void): void {
    assert.equal(type, 'click', 'bootstrap recovery wires the retry button click');
    this.clickHandler = listener;
  }

  click(): void {
    this.clickHandler?.();
  }
}

class FakeRoot {
  innerHTML = '';
  readonly retryButton = new FakeButton();

  querySelector(selector: string): FakeButton {
    assert.equal(selector, '[data-teams-bootstrap-retry]', 'bootstrap recovery queries its own retry action');
    return this.retryButton;
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushBootstrapTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function testInitializationCanFinishAfterLegacyTwoSecondWindow(): Promise<void> {
  const root = new FakeRoot();
  let hostReadyCalls = 0;
  let renderCalls = 0;

  const controller = createTeamsBootstrapController({
    mode: 'teams',
    initialize: () => new Promise<void>((resolve) => {
      setTimeout(resolve, 2_050);
    }),
    markHostReady: () => {
      hostReadyCalls += 1;
    },
    setHost: () => undefined,
    renderApp: () => {
      renderCalls += 1;
    },
    root: root as unknown as HTMLElement,
  });

  assert.equal(
    await controller.start(),
    'ready',
    'a Teams host that needs slightly more than two seconds still reaches the app instead of entering recovery',
  );
  assert.equal(hostReadyCalls, 1, 'a slow but successful initialization marks the host ready once');
  assert.equal(renderCalls, 1, 'a slow but successful initialization mounts the app once');
}

async function testRetryResetsTeamsInitializationBeforeStartingAgain(): Promise<void> {
  const root = new FakeRoot();
  let initializeCalls = 0;
  let resetCalls = 0;
  let hostReadyCalls = 0;
  let renderCalls = 0;

  const controller = createTeamsBootstrapController({
    mode: 'teams',
    initialize: async () => {
      initializeCalls += 1;
      if (initializeCalls === 1) throw new Error('Teams SDK rejected initialization');
    },
    resetInitialization: () => {
      resetCalls += 1;
    },
    markHostReady: () => {
      hostReadyCalls += 1;
    },
    setHost: () => undefined,
    renderApp: () => {
      renderCalls += 1;
    },
    root: root as unknown as HTMLElement,
    timeoutMs: 10,
  });

  assert.equal(await controller.start(), 'recovery', 'an initialization error enters recovery mode');
  root.retryButton.click();
  assert.match(root.innerHTML, /Teams 앱 연결을 확인하고 있습니다/, 'retry immediately restores the loading state');
  await flushBootstrapTasks();

  assert.equal(resetCalls, 1, 'retry resets the TeamsJS initialization state before a new attempt');
  assert.equal(initializeCalls, 2, 'retry starts one new initialization attempt');
  assert.equal(hostReadyCalls, 1, 'a successful retry marks the host ready once');
  assert.equal(renderCalls, 1, 'a successful retry mounts the app once');
}

async function testImmediateInitializationRejectionMountsTeamsRecovery(): Promise<void> {
  const root = new FakeRoot();
  let initializeCalls = 0;
  let renderCalls = 0;

  const controller = createTeamsBootstrapController({
    mode: 'teams',
    initialize: async () => {
      initializeCalls += 1;
      throw new Error('Teams SDK rejected initialization');
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApp: () => {
      renderCalls += 1;
    },
    root: root as unknown as HTMLElement,
  });

  const result = await controller.start();

  assert.equal(result, 'recovery', 'an immediate Teams initialization rejection enters recovery mode');
  assert.equal(initializeCalls, 1, 'an immediate rejection makes one Teams initialization attempt');
  assert.equal(renderCalls, 0, 'a Teams initialization rejection never mounts browser preview UI');
  assert.match(root.innerHTML, /Teams/, 'immediate rejection visibly identifies the Teams connection problem');
  assert.match(root.innerHTML, /다시 시도/, 'immediate rejection exposes a recovery action');
}

async function testHungInitializationMountsRetryableRecoveryAndGuardsLateResult(): Promise<void> {
  const root = new FakeRoot();
  const firstInitialization = deferred<void>();
  const secondInitialization = deferred<void>();
  let initializeCalls = 0;
  let hostReadyCalls = 0;
  let renderCalls = 0;

  const controller = createTeamsBootstrapController({
    mode: 'teams',
    initialize: () => {
      initializeCalls += 1;
      return initializeCalls === 1 ? firstInitialization.promise : secondInitialization.promise;
    },
    markHostReady: () => {
      hostReadyCalls += 1;
    },
    setHost: () => undefined,
    renderApp: () => {
      renderCalls += 1;
    },
    root: root as unknown as HTMLElement,
    timeoutMs: 10,
  });

  const firstResult = await controller.start();

  assert.equal(firstResult, 'recovery', 'hung Teams initialization resolves into recovery mode');
  assert.equal(initializeCalls, 1, 'bootstrap starts one Teams initialization attempt');
  assert.match(root.innerHTML, /Teams/, 'recovery UI visibly identifies the Teams connection problem');
  assert.match(root.innerHTML, /다시 시도/, 'recovery UI exposes a retry action');
  assert.equal(renderCalls, 0, 'the app is not mounted while Teams bootstrap is unresolved');

  root.retryButton.click();
  root.retryButton.click();
  assert.equal(initializeCalls, 1, 'retry does not overlap the still-pending Teams initialization attempt');

  firstInitialization.resolve(undefined);
  await flushBootstrapTasks();

  assert.equal(initializeCalls, 2, 'retry starts one fresh Teams attempt only after the prior attempt settles');
  assert.equal(hostReadyCalls, 0, 'the timed-out initialization result cannot mark the host ready before retry');
  assert.equal(renderCalls, 0, 'the timed-out initialization result cannot mount the app before retry');

  secondInitialization.resolve(undefined);
  await flushBootstrapTasks();

  assert.equal(hostReadyCalls, 1, 'successful retry marks the Teams host ready once');
  assert.equal(renderCalls, 1, 'successful retry mounts the app once');
}

await testHungInitializationMountsRetryableRecoveryAndGuardsLateResult();
await testImmediateInitializationRejectionMountsTeamsRecovery();
await testInitializationCanFinishAfterLegacyTwoSecondWindow();
await testRetryResetsTeamsInitializationBeforeStartingAgain();

hooks.deregister();
console.log('PASS: bounded Teams bootstrap recovery and retry guards');
