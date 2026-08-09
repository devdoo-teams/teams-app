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

async function testHungInitializationMountsRetryableRecoveryAndGuardsLateResult(): Promise<void> {
  const root = new FakeRoot();
  const firstInitialization = deferred<void>();
  const secondInitialization = deferred<void>();
  let initializeCalls = 0;
  let hostReadyCalls = 0;
  let renderCalls = 0;

  const controller = createTeamsBootstrapController({
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
  assert.equal(initializeCalls, 2, 'duplicate retry clicks do not create overlapping initialization attempts');

  secondInitialization.resolve(undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(hostReadyCalls, 1, 'successful retry marks the Teams host ready once');
  assert.equal(renderCalls, 1, 'successful retry mounts the app once');

  firstInitialization.resolve(undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(hostReadyCalls, 1, 'a stale late initialization result cannot mark the host ready again');
  assert.equal(renderCalls, 1, 'a stale late initialization result cannot remount the app');
}

await testHungInitializationMountsRetryableRecoveryAndGuardsLateResult();

hooks.deregister();
console.log('PASS: bounded Teams bootstrap recovery and retry guards');
