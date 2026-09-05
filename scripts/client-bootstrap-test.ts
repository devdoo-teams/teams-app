import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const teamsJsTestModule = `
export const app = {
  initialize: async () => undefined,
  isInitialized: () => true,
  getContext: async () => ({ app: { host: { clientType: 'web', name: 'Teams' } } }),
};
export const authentication = { getAuthToken: async () => 'test-token' };
`;

const appTestModule = 'export function App() { return null; }';
const authTestModule = 'export function markTeamsHostReady() {}';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const isBootstrapModule = context.parentURL?.includes('/src/client/main.tsx');
    if (specifier === '@microsoft/teams-js') {
      return {
        format: 'module',
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(teamsJsTestModule)}`,
      };
    }
    if (isBootstrapModule && specifier === './App.js') {
      return {
        format: 'module',
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(appTestModule)}`,
      };
    }
    if (isBootstrapModule && specifier === './auth.js') {
      return {
        format: 'module',
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(authTestModule)}`,
      };
    }
    if (isBootstrapModule && specifier === './styles.css') {
      return {
        format: 'module',
        shortCircuit: true,
        url: 'data:text/javascript,export default {}',
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

const {
  DEFAULT_TEAMS_BOOTSTRAP_TIMEOUT_MS,
  createTeamsBootstrapController,
  isExplicitBrowserPreview,
  mountTeamsApplication,
} = await import('../src/client/main.js');

class FakeBootstrapView {
  state: 'idle' | 'loading' | 'recovery' | 'app' = 'idle';
  retry: (() => void) | null = null;

  renderLoading(): void {
    this.state = 'loading';
    this.retry = null;
  }

  renderRecovery(retry: () => void): void {
    this.state = 'recovery';
    this.retry = retry;
  }

  renderApp(): void {
    this.state = 'app';
    this.retry = null;
  }

  clickRetry(): void {
    assert.ok(this.retry, 'bootstrap recovery exposes a retry action');
    this.retry();
  }
}

function createControllerOptions(view: FakeBootstrapView) {
  return {
    renderLoading: () => view.renderLoading(),
    renderRecovery: (retry: () => void) => view.renderRecovery(retry),
    renderApp: () => view.renderApp(),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason?: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushBootstrapTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function containsNodeReference(node: unknown, target: object): boolean {
  if (node === target) return true;
  if (Array.isArray(node)) return node.some((child) => containsNodeReference(child, target));
  if (!node || typeof node !== 'object') return false;

  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return false;
  return Object.values(props).some((value) => containsNodeReference(value, target));
}

function assertNarrowRecoveryLayoutContract(markup: string, viewportWidth: number): void {
  assert.ok(viewportWidth >= 44, `${viewportWidth}px can contain the required 44px touch target`);
  assert.match(markup, /box-sizing:border-box/, `${viewportWidth}px recovery uses border-box sizing`);
  assert.match(markup, /width:100%/, `${viewportWidth}px recovery fills only the available inline width`);
  assert.match(markup, /min-width:0/, `${viewportWidth}px recovery can shrink below inherited minimum widths`);
  assert.match(markup, /max-width:42rem/, `${viewportWidth}px recovery caps its readable wide layout without forcing overflow`);
  assert.match(markup, /overflow-wrap:anywhere/, `${viewportWidth}px recovery wraps long localized content safely`);
  assert.match(markup, /min-width:44px/, `${viewportWidth}px retry control meets the minimum touch width`);
  assert.match(markup, /min-height:44px/, `${viewportWidth}px retry control meets the minimum touch height`);
  assert.match(markup, /max-width:100%/, `${viewportWidth}px retry control cannot exceed its container`);
  assert.match(markup, /white-space:normal/, `${viewportWidth}px retry label may wrap instead of clipping`);
}

class BootstrapTestDomNode extends EventTarget {
  nodeType: number;
  nodeName: string;
  ownerDocument: BootstrapTestDocument;
  parentNode: BootstrapTestDomNode | null = null;
  childNodes: BootstrapTestDomNode[] = [];

  constructor(nodeType: number, nodeName: string, ownerDocument: BootstrapTestDocument) {
    super();
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  appendChild(child: BootstrapTestDomNode): BootstrapTestDomNode {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: BootstrapTestDomNode, before: BootstrapTestDomNode | null): BootstrapTestDomNode {
    if (before === null) return this.appendChild(child);
    const index = this.childNodes.indexOf(before);
    if (index < 0) throw new Error('insertBefore target is not a child');
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child: BootstrapTestDomNode): BootstrapTestDomNode {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error('removeChild target is not a child');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  get firstChild(): BootstrapTestDomNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): BootstrapTestDomNode | null {
    return this.childNodes.at(-1) ?? null;
  }

  get nextSibling(): BootstrapTestDomNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  get previousSibling(): BootstrapTestDomNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index - 1] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value !== '') this.appendChild(this.ownerDocument.createTextNode(value));
  }

  get isConnected(): boolean {
    return this === this.ownerDocument || this.parentNode?.isConnected === true;
  }

  contains(node: BootstrapTestDomNode): boolean {
    return node === this || this.childNodes.some((child) => child.contains(node));
  }

  getRootNode(): BootstrapTestDomNode {
    return this.parentNode ? this.parentNode.getRootNode() : this;
  }
}

class BootstrapTestDomElement extends BootstrapTestDomNode {
  tagName: string;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  style: Record<string, unknown> = {};
  attributes = new Map<string, string>();

  constructor(tagName: string, ownerDocument: BootstrapTestDocument) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setAttributeNS(_namespace: string | null, name: string, value: unknown): void {
    this.setAttribute(name, value);
  }

  removeAttributeNS(_namespace: string | null, name: string): void {
    this.removeAttribute(name);
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }
}

class BootstrapTestDomIFrameElement extends BootstrapTestDomElement {}

class BootstrapTestDomText extends BootstrapTestDomNode {
  data: string;

  constructor(data: string, ownerDocument: BootstrapTestDocument) {
    super(3, '#text', ownerDocument);
    this.data = data;
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = String(value);
  }

  get nodeValue(): string {
    return this.data;
  }

  set nodeValue(value: string) {
    this.data = String(value);
  }
}

class BootstrapTestDocument extends BootstrapTestDomNode {
  defaultView: Record<string, unknown> = {};
  documentElement: BootstrapTestDomElement;
  body: BootstrapTestDomElement;
  activeElement: BootstrapTestDomElement;

  constructor() {
    super(9, '#document', undefined as never);
    this.ownerDocument = this;
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tagName: string): BootstrapTestDomElement {
    return new BootstrapTestDomElement(tagName, this);
  }

  createElementNS(_namespace: string | null, tagName: string): BootstrapTestDomElement {
    return this.createElement(tagName);
  }

  createTextNode(data: string): BootstrapTestDomText {
    return new BootstrapTestDomText(String(data), this);
  }

  createEvent(): Event {
    return new Event('event');
  }
}

function findBootstrapTestElementByAttribute(
  node: BootstrapTestDomNode,
  attribute: string,
): BootstrapTestDomElement | null {
  if (node instanceof BootstrapTestDomElement && node.attributes.has(attribute)) return node;
  for (const child of node.childNodes) {
    const match = findBootstrapTestElementByAttribute(child, attribute);
    if (match) return match;
  }
  return null;
}

async function withBootstrapTestDocument<T>(callback: (document: BootstrapTestDocument) => Promise<T>): Promise<T> {
  const document = new BootstrapTestDocument();
  const window = document.defaultView;
  Object.assign(window, {
    document,
    window,
    self: window,
    top: window,
    HTMLElement: BootstrapTestDomElement,
    HTMLIFrameElement: BootstrapTestDomIFrameElement,
    SVGElement: BootstrapTestDomElement,
    Node: BootstrapTestDomNode,
    Element: BootstrapTestDomElement,
    Event,
    getSelection: () => null,
  });

  const globals: Record<string, unknown> = {
    document,
    window,
    self: window,
    HTMLElement: BootstrapTestDomElement,
    HTMLIFrameElement: BootstrapTestDomIFrameElement,
    SVGElement: BootstrapTestDomElement,
    Node: BootstrapTestDomNode,
    Element: BootstrapTestDomElement,
    navigator: { userAgent: 'bootstrap-test' },
  };
  const previousDescriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(globals)) {
    previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  try {
    return await callback(document);
  } finally {
    for (const [name, descriptor] of previousDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

async function testConcurrentControllersShareOneInitializationForTheDocumentLifetime(): Promise<void> {
  const documentLifetime = {};
  const initialization = deferred<void>();
  let initializeCalls = 0;
  const createController = (view: FakeBootstrapView) => createTeamsBootstrapController({
    mode: 'teams',
    initialize: () => {
      initializeCalls += 1;
      return initialization.promise;
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    ...createControllerOptions(view),
    documentLifetime,
  } as Parameters<typeof createTeamsBootstrapController>[0]);

  const first = createController(new FakeBootstrapView());
  const second = createController(new FakeBootstrapView());
  const firstStart = first.start();
  const secondStart = second.start();

  assert.equal(
    initializeCalls,
    1,
    'concurrent controllers in one document lifetime invoke Teams SDK initialize exactly once',
  );

  initialization.resolve(undefined);
  assert.deepEqual(
    await Promise.all([firstStart, secondStart]),
    ['ready', 'ready'],
    'every concurrent controller can continue from the shared initialization result',
  );
}

async function testConcurrentControllersUseTheAmbientDocumentAsTheirDefaultLifetime(): Promise<void> {
  await withBootstrapTestDocument(async () => {
    const initialization = deferred<void>();
    let initializeCalls = 0;
    const createController = () => createTeamsBootstrapController({
      mode: 'teams',
      initialize: () => {
        initializeCalls += 1;
        return initialization.promise;
      },
      markHostReady: () => undefined,
      setHost: () => undefined,
      renderLoading: () => undefined,
      renderRecovery: () => undefined,
      renderApp: () => undefined,
    });

    const firstStart = createController().start();
    const secondStart = createController().start();
    assert.equal(
      initializeCalls,
      1,
      'controllers without an explicit key share the browser document initialization latch',
    );
    initialization.resolve(undefined);
    assert.deepEqual(await Promise.all([firstStart, secondStart]), ['ready', 'ready'], 'ambient-document controllers share the resolved initialization');
  });
}

async function testSynchronousInitializeThrowIsSharedAndFailClosedForTheDocumentLifetime(): Promise<void> {
  const documentLifetime = {};
  const firstView = new FakeBootstrapView();
  const secondView = new FakeBootstrapView();
  let initializeCalls = 0;

  const createController = (view: FakeBootstrapView) => createTeamsBootstrapController({
    mode: 'teams',
    documentLifetime,
    initialize: () => {
      initializeCalls += 1;
      throw new Error('synchronous Teams SDK initialization failure');
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    ...createControllerOptions(view),
  });

  const [firstResult, secondResult] = await Promise.all([
    createController(firstView).start(),
    createController(secondView).start(),
  ]);

  assert.deepEqual([firstResult, secondResult], ['recovery', 'recovery'], 'a synchronous SDK throw is a shared terminal failure');
  assert.equal(initializeCalls, 1, 'a synchronous SDK throw cannot allow a second initialize invocation');
  assert.equal(firstView.state, 'recovery', 'the first controller visibly fails closed after a synchronous throw');
  assert.equal(secondView.state, 'recovery', 'the concurrent controller visibly shares the synchronous failure');
}

async function testAsynchronousInitializeRejectionIsSharedAndFailClosedForTheDocumentLifetime(): Promise<void> {
  const documentLifetime = {};
  const initialization = deferred<void>();
  const firstView = new FakeBootstrapView();
  const secondView = new FakeBootstrapView();
  let initializeCalls = 0;

  const createController = (view: FakeBootstrapView) => createTeamsBootstrapController({
    mode: 'teams',
    documentLifetime,
    initialize: () => {
      initializeCalls += 1;
      return initialization.promise;
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    ...createControllerOptions(view),
  });

  const firstStart = createController(firstView).start();
  const secondStart = createController(secondView).start();
  initialization.reject(new Error('asynchronous Teams SDK initialization failure'));

  assert.deepEqual(
    await Promise.all([firstStart, secondStart]),
    ['recovery', 'recovery'],
    'an asynchronous SDK rejection is shared by concurrent controllers',
  );
  assert.equal(initializeCalls, 1, 'an asynchronous SDK rejection cannot allow a second initialize invocation');
  assert.equal(firstView.state, 'recovery', 'the first controller visibly fails closed after async rejection');
  assert.equal(secondView.state, 'recovery', 'the concurrent controller visibly shares async rejection');
}

async function testPreviewInitializationFailureSharesTheDocumentLatchWithoutReinitializing(): Promise<void> {
  const documentLifetime = {};
  const initialization = deferred<void>();
  let initializeCalls = 0;
  let renderedPreviewApps = 0;

  const createController = () => createTeamsBootstrapController({
    mode: 'preview',
    documentLifetime,
    initialize: () => {
      initializeCalls += 1;
      return initialization.promise;
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderLoading: () => undefined,
    renderRecovery: () => undefined,
    renderApp: () => {
      renderedPreviewApps += 1;
    },
  });

  const firstStart = createController().start();
  const secondStart = createController().start();
  initialization.reject(new Error('preview host unavailable'));

  assert.deepEqual(
    await Promise.all([firstStart, secondStart]),
    ['preview', 'preview'],
    'preview controllers render their safe browser fallback after the shared initialization failure',
  );
  assert.equal(initializeCalls, 1, 'preview fallback never retries Teams SDK initialization in the same document');
  assert.equal(renderedPreviewApps, 2, 'each preview controller can render its own browser fallback without retrying Teams SDK');
}

async function testConcurrentMountsShareOneDocumentInitializationPromise(): Promise<void> {
  const documentLifetime = {};
  const initialization = deferred<void>();
  const firstRoot = { ownerDocument: documentLifetime } as unknown as HTMLElement;
  const secondRoot = { ownerDocument: documentLifetime } as unknown as HTMLElement;
  let initializeCalls = 0;
  const teamsApp = {
    initialize: () => {
      initializeCalls += 1;
      return initialization.promise;
    },
    isInitialized: () => false,
    notifySuccess: async () => undefined,
  };
  const createTestRoot = () => ({ render: () => undefined, unmount: () => undefined });

  const first = mountTeamsApplication({
    root: firstRoot,
    mode: 'teams',
    teamsApp,
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => 'first app',
    createRoot: createTestRoot,
  });
  const second = mountTeamsApplication({
    root: secondRoot,
    mode: 'teams',
    teamsApp,
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => 'second app',
    createRoot: createTestRoot,
  });

  const firstStart = first.start();
  const secondStart = second.start();
  assert.equal(initializeCalls, 1, 'concurrent mounts in one document share exactly one Teams SDK initialize invocation');
  initialization.resolve(undefined);

  assert.deepEqual(await Promise.all([firstStart, secondStart]), ['ready', 'ready'], 'both mounts continue after the shared initialization promise resolves');
  first.dispose();
  second.dispose();
}

async function testHmrLikeRemountUsesTheExistingDocumentInitializationLatch(): Promise<void> {
  const documentLifetime = {};
  const root = { ownerDocument: documentLifetime } as unknown as HTMLElement;
  let initializeCalls = 0;
  let unmountCalls = 0;
  const teamsApp = {
    initialize: async () => {
      initializeCalls += 1;
    },
    isInitialized: () => false,
    notifySuccess: async () => undefined,
  };
  const createTestRoot = () => ({
    render: () => undefined,
    unmount: () => {
      unmountCalls += 1;
    },
  });

  const first = mountTeamsApplication({
    root,
    mode: 'teams',
    teamsApp,
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => 'first app',
    createRoot: createTestRoot,
  });
  assert.equal(await first.start(), 'ready', 'the original mount initializes successfully');
  first.dispose();

  const remount = mountTeamsApplication({
    root,
    mode: 'teams',
    teamsApp,
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => 'remounted app',
    createRoot: createTestRoot,
  });
  assert.equal(await remount.start(), 'ready', 'a remount can reuse the completed document initialization latch');
  assert.equal(initializeCalls, 1, 'an HMR-like remount never invokes Teams SDK initialize a second time');
  assert.equal(unmountCalls, 1, 'disposing the original mount unmounts exactly its original root');
  remount.dispose();
}

async function testHmrModuleReloadSharesTheDocumentInitializationLatch(): Promise<void> {
  const documentLifetime = {};
  const initialization = deferred<void>();
  let initializeCalls = 0;
  const createOptions = () => ({
    mode: 'teams' as const,
    documentLifetime,
    initialize: () => {
      initializeCalls += 1;
      return initialization.promise;
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderLoading: () => undefined,
    renderRecovery: () => undefined,
    renderApp: () => undefined,
  });

  const firstModule = await import('../src/client/main.js?bootstrap-hmr=first');
  const firstStart = firstModule.createTeamsBootstrapController(createOptions()).start();
  assert.equal(initializeCalls, 1, 'the first module instance starts the one document initialization');
  initialization.resolve(undefined);
  assert.equal(await firstStart, 'ready', 'the first module instance completes initialization');

  const reloadedModule = await import('../src/client/main.js?bootstrap-hmr=second');
  assert.equal(
    await reloadedModule.createTeamsBootstrapController(createOptions()).start(),
    'ready',
    'an HMR module reload reuses the completed document initialization latch',
  );
  assert.equal(initializeCalls, 1, 'an HMR module reload cannot invoke Teams SDK initialize a second time');
}

async function testInitializationCanFinishAfterLegacyTwoSecondWindow(): Promise<void> {
  const view = new FakeBootstrapView();
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
      view.renderApp();
    },
    renderLoading: () => view.renderLoading(),
    renderRecovery: (retry) => view.renderRecovery(retry),
  });

  assert.equal(
    await controller.start(),
    'ready',
    'a Teams host that needs slightly more than two seconds still reaches the app instead of entering recovery',
  );
  assert.equal(hostReadyCalls, 1, 'a slow but successful initialization marks the host ready once');
  assert.equal(renderCalls, 1, 'a slow but successful initialization mounts the app once');
}

async function testSuccessfulInitializationNotifiesTeamsHostLoaded(): Promise<void> {
  const view = new FakeBootstrapView();
  let notifySuccessCalls = 0;

  const controller = createTeamsBootstrapController({
    mode: 'teams',
    initialize: async () => undefined,
    markHostReady: () => undefined,
    setHost: () => undefined,
    ...createControllerOptions(view),
    notifySuccess: async () => {
      notifySuccessCalls += 1;
    },
  });

  assert.equal(await controller.start(), 'ready', 'successful Teams initialization reaches the app');
  assert.equal(
    notifySuccessCalls,
    1,
    'successful Teams initialization notifies the host so an existing updated tab is released from its loading state',
  );
}

async function testDefaultTimeoutAllowsTeamsJsInitializationToSettle(): Promise<void> {
  assert.ok(
    DEFAULT_TEAMS_BOOTSTRAP_TIMEOUT_MS >= 60_000,
    'the production bootstrap timeout must not race TeamsJS\' internal 60-second initialization timeout',
  );
}

async function testExplicitPreviewWorksInsideAnEmbeddedBrowserFrame(): Promise<void> {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    parent: {},
    location: { search: '?preview=1' },
  };
  try {
    assert.equal(isExplicitBrowserPreview(), true, 'explicit preview mode works when the in-app browser embeds the page in an iframe');
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previousWindow;
  }
}

async function testInitializationFailureRetriesWithoutPrivateTeamsJsReset(): Promise<void> {
  const view = new FakeBootstrapView();
  let initializeCalls = 0;
  let hostReadyCalls = 0;
  let renderCalls = 0;
  let documentRecoveryCalls = 0;

  const controller = createTeamsBootstrapController({
    mode: 'teams',
    initialize: async () => {
      initializeCalls += 1;
      if (initializeCalls === 1) throw new Error('Teams SDK rejected initialization');
    },
    markHostReady: () => {
      hostReadyCalls += 1;
    },
    setHost: () => undefined,
    renderApp: () => {
      renderCalls += 1;
      view.renderApp();
    },
    renderLoading: () => view.renderLoading(),
    renderRecovery: (retry) => view.renderRecovery(retry),
    recoverFromTimedOutInitialization: () => {
      documentRecoveryCalls += 1;
    },
    timeoutMs: 10,
  });

  assert.equal(await controller.start(), 'recovery', 'an initialization error enters recovery mode');
  assert.equal(view.state, 'recovery', 'an initialization error renders recovery through the bootstrap view');
  view.clickRetry();
  await flushBootstrapTasks();

  assert.equal(documentRecoveryCalls, 1, 'retry requests recovery in a fresh document after initialize rejects');
  assert.equal(initializeCalls, 1, 'recovery never invokes TeamsJS initialize twice in one document lifetime');
  assert.equal(hostReadyCalls, 0, 'a rejected initialization never marks the host ready');
  assert.equal(renderCalls, 0, 'fail-closed recovery never mounts the app after initialization rejection');
  assert.equal(await controller.start(), 'recovery', 'programmatic restart remains fail closed until document recovery');
  assert.equal(initializeCalls, 1, 'programmatic restart cannot bypass the one-initialize document latch');
}

async function testImmediateInitializationRejectionMountsTeamsRecovery(): Promise<void> {
  const view = new FakeBootstrapView();
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
      view.renderApp();
    },
    renderLoading: () => view.renderLoading(),
    renderRecovery: (retry) => view.renderRecovery(retry),
  });

  const result = await controller.start();

  assert.equal(result, 'recovery', 'an immediate Teams initialization rejection enters recovery mode');
  assert.equal(initializeCalls, 1, 'an immediate rejection makes one Teams initialization attempt');
  assert.equal(renderCalls, 0, 'a Teams initialization rejection never mounts browser preview UI');
  assert.equal(view.state, 'recovery', 'immediate rejection visibly enters the retryable Teams recovery view');
  assert.ok(view.retry, 'immediate rejection exposes a recovery action');
}

async function testRecoveryUsesOneAssertiveNonmodalAnnouncementChannel(): Promise<void> {
  const renderedTrees: unknown[] = [];
  const controller = mountTeamsApplication({
    root: {} as HTMLElement,
    mode: 'teams',
    teamsApp: {
      initialize: async () => {
        throw new Error('Teams SDK rejected initialization');
      },
      isInitialized: () => false,
      notifySuccess: async () => undefined,
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => 'application',
    createRoot: () => ({
      render: (children) => renderedTrees.push(children),
      unmount: () => undefined,
    }),
  });

  assert.equal(await controller.start(), 'recovery', 'initialization failure renders recovery');
  const recoveryMarkup = renderToStaticMarkup(renderedTrees.at(-1) as never);
  assert.equal((recoveryMarkup.match(/role="alert"/g) ?? []).length, 1, 'recovery has one assertive announcement channel');
  assert.doesNotMatch(
    recoveryMarkup,
    /aria-live=/,
    'assertive recovery does not also register a conflicting explicit live region',
  );
  assert.doesNotMatch(recoveryMarkup, /aria-modal|\sinert/, 'recovery is not announced as a modal that would disable background content');
  assert.doesNotMatch(recoveryMarkup, /position:fixed|inset:0|z-index:/, 'recovery does not cover the tab with a fixed overlay');
  assert.match(recoveryMarkup, /data-teams-bootstrap-recovery/, 'recovery exposes its nonmodal DOM contract');
  assert.match(recoveryMarkup, /autofocus/, 'the recovery retry control receives deterministic initial focus');
  assertNarrowRecoveryLayoutContract(recoveryMarkup, 320);
  assertNarrowRecoveryLayoutContract(recoveryMarkup, 375);
}

async function testNotifyFailureKeepsTheApplicationVisibleBehindANonmodalRecoveryStatus(): Promise<void> {
  const renderedTrees: unknown[] = [];
  const controller = mountTeamsApplication({
    root: {} as HTMLElement,
    mode: 'teams',
    teamsApp: {
      initialize: async () => undefined,
      isInitialized: () => false,
      notifySuccess: async () => {
        throw new Error('host acknowledgement failed');
      },
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => createElement('main', { 'data-stateful-application': true }, 'Application remains available'),
    createRoot: () => ({
      render: (children) => renderedTrees.push(children),
      unmount: () => undefined,
    }),
  });

  assert.equal(await controller.start(), 'recovery', 'notifySuccess failure enters retryable recovery');
  const recoveryMarkup = renderToStaticMarkup(renderedTrees.at(-1) as never);
  assert.match(recoveryMarkup, /data-stateful-application/, 'notify recovery keeps the application subtree rendered');
  assert.match(recoveryMarkup, /Application remains available/, 'notify recovery leaves application content available to the user');
  assert.match(recoveryMarkup, /role="alert"/, 'notify recovery announces the supported retry path');
  assert.doesNotMatch(recoveryMarkup, /aria-modal|\sinert|position:fixed|inset:0|z-index:/, 'notify recovery neither disables nor visually covers the application');
}

async function testNotifyRetryPreservesActualStatefulReactSubtreeAndRetryFocus(): Promise<void> {
  await withBootstrapTestDocument(async (document) => {
    const { createRoot: createNativeRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const root = document.createElement('div');
    document.body.appendChild(root);
    let initialized = false;
    let initializeCalls = 0;
    let notifySuccessCalls = 0;
    let incrementState: (() => void) | null = null;

    function StatefulApplication() {
      const [count, setCount] = useState(0);
      incrementState = () => setCount((value) => value + 1);
      return createElement('button', { 'data-stateful-application': true, type: 'button' }, String(count));
    }

    const controller = mountTeamsApplication({
      root: root as unknown as HTMLElement,
      mode: 'teams',
      teamsApp: {
        initialize: async () => {
          initializeCalls += 1;
          initialized = true;
        },
        isInitialized: () => initialized,
        notifySuccess: async () => {
          notifySuccessCalls += 1;
          if (notifySuccessCalls === 1) throw new Error('host acknowledgement failed');
        },
      },
      markHostReady: () => undefined,
      setHost: () => undefined,
      renderApplication: () => createElement(StatefulApplication),
      createRoot: (container) => {
        const nativeRoot = createNativeRoot(container);
        return {
          render: (children) => {
            flushSync(() => nativeRoot.render(children));
          },
          unmount: () => {
            flushSync(() => nativeRoot.unmount());
          },
        };
      },
    });

    assert.equal(await controller.start(), 'recovery', 'the first notifySuccess failure enters recovery after mounting the app');
    const initialApplication = findBootstrapTestElementByAttribute(root, 'data-stateful-application');
    const retryButton = findBootstrapTestElementByAttribute(root, 'data-teams-bootstrap-retry');
    assert.ok(initialApplication, 'a mounted stateful application is present during notify recovery');
    assert.ok(retryButton, 'notify recovery exposes the retry button in the actual DOM');
    assert.equal(initialApplication.textContent, '0', 'the stateful application starts with its initial state');
    assert.equal(document.activeElement, retryButton, 'recovery deterministically moves focus to its retry control');

    assert.ok(incrementState, 'the real mounted application exposes its state transition');
    flushSync(() => incrementState?.());
    assert.equal(initialApplication.textContent, '1', 'the mounted application state changes before retry');
    assert.equal(document.activeElement, retryButton, 'the retry control retains focus while the background app updates');

    assert.equal(await controller.start(), 'ready', 'retry completes by repeating notifySuccess');
    const retriedApplication = findBootstrapTestElementByAttribute(root, 'data-stateful-application');
    assert.equal(retriedApplication, initialApplication, 'the actual React DOM subtree is reused across notify recovery and retry');
    assert.equal(retriedApplication?.textContent, '1', 'the actual React state survives notify recovery and retry');
    assert.equal(initializeCalls, 1, 'notify retry does not call initialize again');
    assert.equal(notifySuccessCalls, 2, 'notify retry calls notifySuccess exactly once more');

    controller.dispose();
    await flushBootstrapTasks();
  });
}

async function testTimedOutInitializationNeverOverlapsAndRequiresReloadRecovery(): Promise<void> {
  const view = new FakeBootstrapView();
  const firstInitialization = deferred<void>();
  let initializeCalls = 0;
  let reloadCalls = 0;
  let hostReadyCalls = 0;
  let renderCalls = 0;

  const controller = createTeamsBootstrapController({
    mode: 'teams',
    initialize: () => {
      initializeCalls += 1;
      return firstInitialization.promise;
    },
    markHostReady: () => {
      hostReadyCalls += 1;
    },
    setHost: () => undefined,
    renderApp: () => {
      renderCalls += 1;
      view.renderApp();
    },
    renderLoading: () => view.renderLoading(),
    renderRecovery: (retry) => view.renderRecovery(retry),
    recoverFromTimedOutInitialization: () => {
      reloadCalls += 1;
    },
    timeoutMs: 10,
  });

  const firstResult = await controller.start();

  assert.equal(firstResult, 'recovery', 'hung Teams initialization resolves into recovery mode');
  assert.equal(initializeCalls, 1, 'bootstrap starts one Teams initialization attempt');
  assert.equal(view.state, 'recovery', 'recovery UI visibly identifies the Teams connection problem');
  assert.ok(view.retry, 'recovery UI exposes a retry action');
  assert.equal(renderCalls, 0, 'the app is not mounted while Teams bootstrap is unresolved');

  const retry = view.retry;
  retry?.();
  await flushBootstrapTasks();

  assert.equal(reloadCalls, 1, 'a genuinely stuck TeamsJS initialization requests a clean document reload');
  assert.equal(initializeCalls, 1, 'timeout recovery never overlaps the unresolved TeamsJS initialize promise');
  assert.equal(await controller.start(), 'recovery', 'the timed-out controller remains fail closed until reload');
  assert.equal(initializeCalls, 1, 'programmatic restart cannot bypass the single-initialize timeout guard');

  firstInitialization.resolve(undefined);
  await flushBootstrapTasks();

  assert.equal(hostReadyCalls, 0, 'a late result from the timed-out initialization cannot mark the host ready');
  assert.equal(renderCalls, 0, 'a late result from the timed-out initialization cannot mount the app');
}

async function testLateSettlementAfterTimeoutCannotReviveTheDocumentInitializationLatch(): Promise<void> {
  const documentLifetime = {};
  const initialization = deferred<void>();
  const firstView = new FakeBootstrapView();
  const secondView = new FakeBootstrapView();
  let initializeCalls = 0;
  let secondHostReadyCalls = 0;
  let secondAppRenderCalls = 0;

  const first = createTeamsBootstrapController({
    mode: 'teams',
    documentLifetime,
    initialize: () => {
      initializeCalls += 1;
      return initialization.promise;
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    ...createControllerOptions(firstView),
    timeoutMs: 10,
  });

  assert.equal(await first.start(), 'recovery', 'the first controller enters recovery after its shared initialization times out');
  initialization.resolve(undefined);
  await flushBootstrapTasks();

  const second = createTeamsBootstrapController({
    mode: 'teams',
    documentLifetime,
    initialize: () => {
      initializeCalls += 1;
      return Promise.resolve();
    },
    markHostReady: () => {
      secondHostReadyCalls += 1;
    },
    setHost: () => undefined,
    renderApp: () => {
      secondAppRenderCalls += 1;
      secondView.renderApp();
    },
    renderLoading: () => secondView.renderLoading(),
    renderRecovery: (retry) => secondView.renderRecovery(retry),
    timeoutMs: 10,
  });

  assert.equal(
    await second.start(),
    'recovery',
    'a late settlement cannot revive a document initialization that already timed out',
  );
  assert.equal(initializeCalls, 1, 'a remount after timeout cannot invoke Teams SDK initialize again');
  assert.equal(secondHostReadyCalls, 0, 'a late initialization cannot mark a later controller host-ready');
  assert.equal(secondAppRenderCalls, 0, 'a late initialization cannot mount an app for a later controller');
  assert.equal(secondView.state, 'recovery', 'the later controller remains visibly fail-closed');
}

async function testNotifySuccessFailureKeepsStableApplicationMount(): Promise<void> {
  let initialized = false;
  let initializeCalls = 0;
  let notifySuccessCalls = 0;
  let createRootCalls = 0;
  let renderApplicationCalls = 0;
  let directDomWrites = 0;
  const renderedTrees: unknown[] = [];
  const applicationNode = { kind: 'stable-application-node' };

  const root = {
    set innerHTML(_value: string) {
      directDomWrites += 1;
      throw new Error('bootstrap must never overwrite the React root DOM directly');
    },
  } as unknown as HTMLElement;

  const controller = mountTeamsApplication({
    root,
    mode: 'teams',
    teamsApp: {
      initialize: async () => {
        initializeCalls += 1;
        initialized = true;
      },
      isInitialized: () => initialized,
      notifySuccess: async () => {
        notifySuccessCalls += 1;
        if (notifySuccessCalls === 1) throw new Error('host acknowledgement failed');
        return { hasFinishedSuccessfully: true };
      },
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => {
      renderApplicationCalls += 1;
      return applicationNode as never;
    },
    createRoot: (container) => {
      assert.equal(container, root, 'the single React root owns the supplied bootstrap container');
      createRootCalls += 1;
      return {
        render: (children) => renderedTrees.push(children),
        unmount: () => undefined,
      };
    },
  });

  assert.equal(await controller.start(), 'recovery', 'a rejected notifySuccess enters retryable recovery');
  assert.equal(
    containsNodeReference(renderedTrees.at(-1), applicationNode),
    true,
    'notifySuccess recovery is a nonmodal status that keeps the mounted application subtree present',
  );
  const firstApplicationRender = renderedTrees.findIndex((tree) => containsNodeReference(tree, applicationNode));
  assert.equal(await controller.start(), 'ready', 'retry repeats host notification and reaches the application');
  assert.equal(initializeCalls, 1, 'retry does not reinitialize an SDK that is already initialized');
  assert.equal(notifySuccessCalls, 2, 'retry repeats the supported notifySuccess call exactly once');
  assert.equal(renderApplicationCalls, 1, 'notify retry reuses the exact application node instead of rebuilding its subtree');
  assert.equal(createRootCalls, 1, 'loading, recovery, and application share exactly one React root');
  assert.equal(directDomWrites, 0, 'bootstrap never overwrites React-owned DOM with innerHTML');
  assert.ok(firstApplicationRender >= 0, 'the application is mounted after Teams initialization');
  assert.ok(
    renderedTrees.slice(firstApplicationRender).every((tree) => containsNodeReference(tree, applicationNode)),
    'every notify recovery and retry render preserves the original application subtree identity',
  );
}

async function testNotifyRecoveryRetryActionOnlyRepeatsNotifySuccess(): Promise<void> {
  const view = new FakeBootstrapView();
  let initializeCalls = 0;
  let notifySuccessCalls = 0;
  let renderApplicationCalls = 0;
  let clearNotifyRecoveryCalls = 0;
  const controller = createTeamsBootstrapController({
    mode: 'teams',
    initialize: async () => {
      initializeCalls += 1;
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderLoading: () => view.renderLoading(),
    renderRecovery: (retry) => view.renderRecovery(retry),
    renderNotifyRecovery: (retry) => view.renderRecovery(retry),
    renderApp: () => {
      renderApplicationCalls += 1;
      view.renderApp();
    },
    clearNotifyRecovery: () => {
      clearNotifyRecoveryCalls += 1;
    },
    notifySuccess: async () => {
      notifySuccessCalls += 1;
      if (notifySuccessCalls === 1) throw new Error('first host acknowledgement failed');
    },
  });

  assert.equal(await controller.start(), 'recovery', 'the first host acknowledgement failure renders retry recovery');
  view.clickRetry();
  assert.equal(await controller.start(), 'ready', 'the rendered retry callback repeats only the host acknowledgement');
  assert.equal(initializeCalls, 1, 'the rendered retry callback never reinitializes Teams SDK');
  assert.equal(notifySuccessCalls, 2, 'the rendered retry callback invokes notifySuccess exactly once more');
  assert.equal(renderApplicationCalls, 1, 'the rendered retry callback does not rebuild the application subtree');
  assert.equal(clearNotifyRecoveryCalls, 1, 'the rendered retry callback clears only the recovery status after notifySuccess succeeds');
}

async function testDisposeUnmountsReactRootExactlyOnce(): Promise<void> {
  let unmountCalls = 0;
  const controller = mountTeamsApplication({
    root: {} as HTMLElement,
    mode: 'teams',
    teamsApp: {
      initialize: async () => undefined,
      isInitialized: () => false,
      notifySuccess: async () => undefined,
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => 'application',
    createRoot: () => ({
      render: () => undefined,
      unmount: () => {
        unmountCalls += 1;
      },
    }),
  });

  controller.dispose();
  controller.dispose();

  assert.equal(unmountCalls, 1, 'dispose unmounts the React root exactly once');
  assert.equal(await controller.start(), 'stale', 'a disposed mount cannot be restarted');
}

async function testDisposeSuppressesLateInitializationPromise(): Promise<void> {
  const initialization = deferred<void>();
  let hostReadyCalls = 0;
  let setHostCalls = 0;
  let renderApplicationCalls = 0;
  let notifySuccessCalls = 0;
  let unmountCalls = 0;

  const controller = mountTeamsApplication({
    root: {} as HTMLElement,
    mode: 'teams',
    teamsApp: {
      initialize: () => initialization.promise,
      isInitialized: () => false,
      notifySuccess: async () => {
        notifySuccessCalls += 1;
      },
    },
    markHostReady: () => {
      hostReadyCalls += 1;
    },
    setHost: () => {
      setHostCalls += 1;
    },
    renderApplication: () => {
      renderApplicationCalls += 1;
      return 'application';
    },
    createRoot: () => ({
      render: () => undefined,
      unmount: () => {
        unmountCalls += 1;
      },
    }),
    timeoutMs: 1_000,
  });

  const pendingStart = controller.start();
  await flushBootstrapTasks();
  controller.dispose();
  initialization.resolve(undefined);

  assert.equal(await pendingStart, 'stale', 'a promise that settles after dispose is classified as stale');
  assert.equal(hostReadyCalls, 0, 'late initialization cannot mark a disposed host ready');
  assert.equal(setHostCalls, 0, 'late initialization cannot mutate host state after dispose');
  assert.equal(renderApplicationCalls, 0, 'late initialization cannot create or mount the application after dispose');
  assert.equal(notifySuccessCalls, 0, 'late initialization cannot notify Teams after dispose');
  assert.equal(unmountCalls, 1, 'dispose still unmounts once while initialization is pending');
}

async function testDisposeSuppressesLateNotifySuccessRejection(): Promise<void> {
  const notification = deferred<void>();
  let renderCalls = 0;
  let unmountCalls = 0;
  const controller = mountTeamsApplication({
    root: {} as HTMLElement,
    mode: 'teams',
    teamsApp: {
      initialize: async () => undefined,
      isInitialized: () => false,
      notifySuccess: () => notification.promise,
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => 'application',
    createRoot: () => ({
      render: () => {
        renderCalls += 1;
      },
      unmount: () => {
        unmountCalls += 1;
      },
    }),
  });

  const pendingStart = controller.start();
  await flushBootstrapTasks();
  const rendersBeforeDispose = renderCalls;
  controller.dispose();
  notification.reject(new Error('late host acknowledgement failure'));

  assert.equal(await pendingStart, 'stale', 'late notifySuccess rejection after dispose is stale');
  assert.equal(renderCalls, rendersBeforeDispose, 'late notifySuccess rejection cannot render recovery after dispose');
  assert.equal(unmountCalls, 1, 'dispose still unmounts the React root exactly once while notifySuccess is pending');
}

async function testProductInitializationRetryUsesOnlyPublicTeamsJsLifecycle(): Promise<void> {
  let initializeCalls = 0;
  let createRootCalls = 0;
  let reloadCalls = 0;

  const controller = mountTeamsApplication({
    root: {} as HTMLElement,
    mode: 'teams',
    teamsApp: {
      initialize: async () => {
        initializeCalls += 1;
        throw new Error('initial handshake failed');
      },
      isInitialized: () => false,
      notifySuccess: async () => ({ hasFinishedSuccessfully: true }),
    },
    markHostReady: () => undefined,
    setHost: () => undefined,
    renderApplication: () => 'application',
    createRoot: () => {
      createRootCalls += 1;
      return { render: () => undefined, unmount: () => undefined };
    },
    reloadPage: () => {
      reloadCalls += 1;
    },
  });

  assert.equal(await controller.start(), 'recovery', 'a failed public initialize call enters recovery');
  assert.equal(await controller.start(), 'recovery', 'programmatic retry stays fail closed in the same document');
  assert.equal(initializeCalls, 1, 'the product mount invokes the public initialize API at most once per document');
  assert.equal(reloadCalls, 0, 'document recovery remains an explicit user action');
  assert.equal(createRootCalls, 1, 'fail-closed recovery does not create another React root');
}

const bootstrapTests: ReadonlyArray<readonly [string, () => Promise<void>]> = [
  ['timeout', testTimedOutInitializationNeverOverlapsAndRequiresReloadRecovery],
  ['late-timeout', testLateSettlementAfterTimeoutCannotReviveTheDocumentInitializationLatch],
  ['concurrent-controllers', testConcurrentControllersShareOneInitializationForTheDocumentLifetime],
  ['ambient-document', testConcurrentControllersUseTheAmbientDocumentAsTheirDefaultLifetime],
  ['sync-throw', testSynchronousInitializeThrowIsSharedAndFailClosedForTheDocumentLifetime],
  ['async-rejection', testAsynchronousInitializeRejectionIsSharedAndFailClosedForTheDocumentLifetime],
  ['preview-failure', testPreviewInitializationFailureSharesTheDocumentLatchWithoutReinitializing],
  ['concurrent-mounts', testConcurrentMountsShareOneDocumentInitializationPromise],
  ['hmr-remount', testHmrLikeRemountUsesTheExistingDocumentInitializationLatch],
  ['hmr-module-reload', testHmrModuleReloadSharesTheDocumentInitializationLatch],
  ['immediate-rejection', testImmediateInitializationRejectionMountsTeamsRecovery],
  ['recovery-nonmodal', testRecoveryUsesOneAssertiveNonmodalAnnouncementChannel],
  ['notify-nonmodal', testNotifyFailureKeepsTheApplicationVisibleBehindANonmodalRecoveryStatus],
  ['notify-retry-stateful', testNotifyRetryPreservesActualStatefulReactSubtreeAndRetryFocus],
  ['slow-initialization', testInitializationCanFinishAfterLegacyTwoSecondWindow],
  ['notify-success', testSuccessfulInitializationNotifiesTeamsHostLoaded],
  ['default-timeout', testDefaultTimeoutAllowsTeamsJsInitializationToSettle],
  ['initialization-retry', testInitializationFailureRetriesWithoutPrivateTeamsJsReset],
  ['explicit-preview', testExplicitPreviewWorksInsideAnEmbeddedBrowserFrame],
  ['notify-retry-state', testNotifySuccessFailureKeepsStableApplicationMount],
  ['notify-retry-action', testNotifyRecoveryRetryActionOnlyRepeatsNotifySuccess],
  ['double-dispose', testDisposeUnmountsReactRootExactlyOnce],
  ['late-dispose', testDisposeSuppressesLateInitializationPromise],
  ['late-notify-dispose', testDisposeSuppressesLateNotifySuccessRejection],
  ['product-retry', testProductInitializationRetryUsesOnlyPublicTeamsJsLifecycle],
];

const selectedBootstrapTest = process.env.CLIENT_BOOTSTRAP_TEST;
const selectedTests = selectedBootstrapTest
  ? bootstrapTests.filter(([name]) => name === selectedBootstrapTest)
  : bootstrapTests;

assert.ok(selectedTests.length > 0, `unknown CLIENT_BOOTSTRAP_TEST: ${selectedBootstrapTest}`);
for (const [, test] of selectedTests) {
  await test();
}

hooks.deregister();
console.log('PASS: bounded Teams bootstrap recovery and retry guards');
