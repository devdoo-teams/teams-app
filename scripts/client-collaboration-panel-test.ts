import { strict as assert } from 'node:assert';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { markTeamsHostReady, resetAuthStateForTest, setAuthRequired, setAuthTokenProviderForTest } from '../src/client/auth.js';
import {
  bindCollaborationChannel,
  CollaborationPanel,
  createLatestCollaborationLoadController,
  createCollaborationRetryStore,
} from '../src/client/CollaborationPanel.js';

class TestDomNode extends EventTarget {
  nodeType: number;
  nodeName: string;
  ownerDocument: TestDomDocument;
  parentNode: TestDomNode | null = null;
  childNodes: TestDomNode[] = [];

  constructor(nodeType: number, nodeName: string, ownerDocument: TestDomDocument) {
    super();
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  override dispatchEvent(event: Event): boolean {
    if (!Object.prototype.hasOwnProperty.call(event, 'target')) {
      Object.defineProperty(event, 'target', { configurable: true, value: this });
    }
    const result = super.dispatchEvent(event);
    if (event.bubbles && !event.cancelBubble && this.parentNode) this.parentNode.dispatchEvent(event);
    return result;
  }

  appendChild(child: TestDomNode): TestDomNode {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: TestDomNode, before: TestDomNode | null): TestDomNode {
    if (!before) return this.appendChild(child);
    const index = this.childNodes.indexOf(before);
    if (index < 0) throw new Error('insertBefore target is not a child');
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child: TestDomNode): TestDomNode {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error('removeChild target is not a child');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  get firstChild(): TestDomNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): TestDomNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument.createTextNode(value));
  }

  contains(node: TestDomNode): boolean {
    return node === this || this.childNodes.some((child) => child.contains(node));
  }

  getRootNode(): TestDomNode {
    return this.parentNode ? this.parentNode.getRootNode() : this;
  }

  get isConnected(): boolean {
    return (this as unknown as TestDomDocument) === this.ownerDocument || this.parentNode?.isConnected === true;
  }
}

class TestDomElement extends TestDomNode {
  tagName: string;
  oninput: ((event: Event) => void) | null = null;
  onchange: ((event: Event) => void) | null = null;
  onclick: ((event: Event) => void) | null = null;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  style: Record<string, unknown> = {};
  attributes = new Map<string, string>();
  private currentValue = '';
  disabled = false;

  get options(): TestDomElement[] {
    return this.childNodes.filter((child): child is TestDomElement => child instanceof TestDomElement);
  }

  get value(): string {
    return this.currentValue;
  }

  set value(value: string) {
    this.currentValue = String(value);
  }

  constructor(tagName: string, ownerDocument: TestDomDocument) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  get type(): string {
    return this.getAttribute('type') ?? (this.tagName === 'INPUT' ? 'text' : '');
  }

  set type(value: string) {
    this.setAttribute('type', value);
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
    if (name === 'disabled') this.disabled = true;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'disabled') this.disabled = false;
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

class TestDomText extends TestDomNode {
  data: string;

  constructor(data: string, ownerDocument: TestDomDocument) {
    super(3, '#text', ownerDocument);
    this.data = data;
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = String(value);
  }
}

class TestDomDocument extends TestDomNode {
  defaultView: Record<string, unknown> = {};
  oninput: ((event: Event) => void) | null = null;
  onchange: ((event: Event) => void) | null = null;
  onselectionchange: ((event: Event) => void) | null = null;
  documentElement: TestDomElement;
  body: TestDomElement;
  activeElement: TestDomElement;

  constructor() {
    super(9, '#document', undefined as never);
    this.ownerDocument = this;
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tagName: string): TestDomElement {
    return new TestDomElement(tagName, this);
  }

  createElementNS(_namespace: string | null, tagName: string): TestDomElement {
    return this.createElement(tagName);
  }

  createTextNode(data: string): TestDomText {
    return new TestDomText(String(data), this);
  }

  createComment(data: string): TestDomText {
    return new TestDomText(data, this);
  }
}

function findTestElements(node: TestDomNode, predicate: (element: TestDomElement) => boolean): TestDomElement[] {
  const matches: TestDomElement[] = [];
  if (node instanceof TestDomElement && predicate(node)) matches.push(node);
  for (const child of node.childNodes) matches.push(...findTestElements(child, predicate));
  return matches;
}

function findTestElement(node: TestDomNode, predicate: (element: TestDomElement) => boolean): TestDomElement {
  const element = findTestElements(node, predicate)[0];
  assert.ok(element, 'expected rendered element was not found');
  return element;
}

async function flushReact(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

async function withTestDom<T>(callback: (document: TestDomDocument) => Promise<T>): Promise<T> {
  const document = new TestDomDocument();
  const sessionStorage = { getItem: (key: string) => key === 'teams.localAccessToken' ? 'test-token' : null };
  const window = document.defaultView;
  Object.assign(window, {
    document,
    window,
    self: window,
    top: window,
    HTMLElement: TestDomElement,
    HTMLIFrameElement: TestDomElement,
    SVGElement: TestDomElement,
    Node: TestDomNode,
    Element: TestDomElement,
    Event,
    getSelection: () => null,
    location: { href: 'https://teams.test/tabs/home/', origin: 'https://teams.test', pathname: '/tabs/home/', search: '' },
    sessionStorage,
  });
  const globals: Record<string, unknown> = {
    document,
    window,
    self: window,
    HTMLElement: TestDomElement,
    HTMLIFrameElement: TestDomElement,
    SVGElement: TestDomElement,
    Node: TestDomNode,
    Element: TestDomElement,
    navigator: { userAgent: 'collaboration-panel-test' },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  try {
    return await callback(document);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

{
  await withTestDom(async (document) => {
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const renderedBindBodies: Array<Record<string, unknown>> = [];
    const renderedBindAuthHeaders: string[] = [];
    let bindAttempts = 0;
    let resolveFirstBind!: (response: Response) => void;
    const firstBindResponse = new Promise<Response>((resolve) => {
      resolveFirstBind = resolve;
    });
    let resolveSecondRetry!: (response: Response) => void;
    const secondRetryResponse = new Promise<Response>((resolve) => {
      resolveSecondRetry = resolve;
    });
    let subscriptionReads = 0;
    let failNextSubscriptionRead = false;
    const emptyActivity = new Map<string, unknown>([
      ['/api/collaboration/subscriptions', { subscriptions: [] }],
      ['/api/collaboration/digest?period=weekly', { digest: { period: 'weekly', totalCount: 0, entries: [] } }],
      ['/api/collaboration/notifications?limit=10', { notifications: [] }],
      ['/api/collaboration/bindings', { bindings: [] }],
      ['/api/collaboration/preferences', { preferences: [] }],
    ]);
    const testFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'https://teams.test');
      if (init?.method === 'POST' && url.pathname === '/api/collaboration/bindings') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        renderedBindBodies.push(body);
        renderedBindAuthHeaders.push(new Headers(init.headers).get('authorization') ?? '');
        bindAttempts += 1;
        if (bindAttempts === 1) return firstBindResponse;
        if (bindAttempts === 3) {
          return new Response(JSON.stringify({ error: '세션이 다시 만료되었습니다.' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (bindAttempts === 4) return secondRetryResponse;
        if (bindAttempts === 5) {
          return new Response(JSON.stringify({ error: '세션이 또 만료되었습니다.' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/collaboration/subscriptions') {
        subscriptionReads += 1;
        if (failNextSubscriptionRead) {
          failNextSubscriptionRead = false;
          return new Response(JSON.stringify({ error: '협업 읽기 실패' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify(emptyActivity.get(url.pathname + url.search)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: testFetch });
    (document.defaultView as { fetch?: typeof testFetch }).fetch = testFetch;
    setAuthTokenProviderForTest(async () => renderedBindAuthHeaders.length === 0 ? 'expired-token' : 'fresh-token');
    markTeamsHostReady();
    setAuthRequired(true);

    const rootElement = document.createElement('div');
    document.body.appendChild(rootElement);
    const root = createRoot(rootElement as unknown as HTMLElement);
    await act(async () => {
      root.render(React.createElement(CollaborationPanel));
      await Promise.resolve();
    });
    await flushReact();
    flushSync(() => undefined);
    let inputEventBubbled = false;
    rootElement.addEventListener('input', () => {
      inputEventBubbled = true;
    });

    const findChannelInput = () => findTestElement(rootElement, (element) => element.getAttribute('aria-label') === '채널 ID');
    const findBindButton = () => findTestElement(rootElement, (element) => element.tagName === 'BUTTON' && element.textContent === '채널에 연결');
    const setChannelInput = async (value: string): Promise<void> => {
      const input = findChannelInput();
      const nativeValueSetter = Object.getOwnPropertyDescriptor(TestDomElement.prototype, 'value')?.set;
      assert.ok(nativeValueSetter, 'the test input exposes a native value setter');
      await act(async () => {
        nativeValueSetter.call(input, value);
        const inputEvent = new Event('input', { bubbles: true });
        input.dispatchEvent(inputEvent);
        await Promise.resolve();
      });
    };
    const clickBind = async (): Promise<void> => {
      const button = findBindButton();
      const clickEvent = new Event('click', { bubbles: true });
      await act(async () => {
        button.dispatchEvent(clickEvent);
        await Promise.resolve();
      });
    };
    const findAlerts = () => findTestElements(rootElement, (element) => element.getAttribute('role') === 'alert');

    for (const invalidChannelId of ['', '   ']) {
      await setChannelInput(invalidChannelId);
      assert.equal(inputEventBubbled, true, 'the test DOM bubbles the real input event to the mounted React root');
      await clickBind();
      await flushReact();
      assert.equal(findChannelInput().value, invalidChannelId, `the rendered controlled input preserves ${JSON.stringify(invalidChannelId)}`);
      assert.equal(findAlerts().some((alert) => alert.textContent === '채널 ID를 입력하세요.'), true, `the rendered UI alerts for ${JSON.stringify(invalidChannelId)}`);
      assert.equal(bindAttempts, 0, `the rendered invalid branch does not issue a bind mutation for ${JSON.stringify(invalidChannelId)}`);
    }

    await setChannelInput('valid-channel');
    await flushReact();
    assert.equal(findChannelInput().value, 'valid-channel', 'the native input event reaches the mounted React change handler');
    assert.equal(findAlerts().some((alert) => alert.textContent === '채널 ID를 입력하세요.'), false, 'editing to a valid channel clears the inline alert');
    await clickBind();
    await flushReact();
    assert.equal(bindAttempts, 1, 'the rendered valid branch issues one bind mutation');
    assert.equal(findBindButton().disabled, true, 'the rendered bind button is disabled while the POST promise is pending');
    assert.equal(renderedBindBodies.length, 1, 'the pending rendered bind captured exactly one POST body');
    assert.deepEqual(renderedBindBodies[0], {
      target: { type: 'project', id: 'demo-project' },
      channelId: 'valid-channel',
      metadata: { source: 'teams-tab' },
      mutationKey: renderedBindBodies[0]?.mutationKey,
    }, 'the rendered POST body contains the edited valid channel and expected target');
    assert.equal(typeof renderedBindBodies[0]?.mutationKey, 'string', 'the rendered POST body contains a mutation key');
    assert.ok(String(renderedBindBodies[0]?.mutationKey).length > 0, 'the rendered mutation key is non-empty');

    await act(async () => {
      resolveFirstBind(new Response(JSON.stringify({ error: '세션이 만료되었습니다.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }));
      await Promise.resolve();
    });
    await flushReact();
    assert.equal(findBindButton().disabled, false, 'a failed bind returns the actual button to an enabled state');
    assert.ok(
      findAlerts().some((alert) => alert.textContent.includes('Teams 인증이 만료되었습니다.')),
      `an expired bind renders the auth recovery error: ${JSON.stringify(findAlerts().map((alert) => alert.textContent))}`,
    );

    const findErrorRetryButton = () => findTestElement(rootElement, (element) => element.tagName === 'BUTTON' && element.textContent === '다시 시도');
    await act(async () => {
      findErrorRetryButton().dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushReact();
    assert.equal(bindAttempts, 2, 'auth recovery retries the same rendered valid bind mutation');
    assert.equal(renderedBindBodies.length, 2, 'retry captured the actual second rendered POST body');
    assert.deepEqual(renderedBindBodies[1], {
      target: { type: 'project', id: 'demo-project' },
      channelId: 'valid-channel',
      metadata: { source: 'teams-tab' },
      mutationKey: renderedBindBodies[0]?.mutationKey,
    }, 'retry preserves the edited rendered payload and reuses the same mutation key');
    assert.equal(renderedBindBodies[1]?.mutationKey, renderedBindBodies[0]?.mutationKey, 'retry reuses the rendered mutation key');
    assert.equal(findBindButton().disabled, false, 'a successful retry leaves the actual button enabled');
    assert.equal(findAlerts().some((alert) => alert.textContent.includes('Teams 인증이 만료되었습니다.')), false, 'a successful auth retry clears the mutation error');

    assert.deepEqual(renderedBindAuthHeaders.slice(0, 2), [
      'Bearer expired-token',
      'Bearer fresh-token',
    ], 'auth recovery acquires a fresh Teams token for the second mutation request');
    assert.equal(renderedBindBodies.some((body) => JSON.stringify(body).includes('token')), false, 'mutation bodies never retain an authentication token');

    await act(async () => {
      findBindButton().dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushReact();
    assert.equal(bindAttempts, 3, 'a later bind can reproduce a second expired mutation');
    assert.ok(findErrorRetryButton(), 'a second expired mutation exposes the recovery control again');

    await act(async () => {
      findErrorRetryButton().dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushReact();
    assert.equal(bindAttempts, 4, 'the second auth recovery starts exactly one retry');
    const retryingButton = findTestElements(rootElement, (element) => element.tagName === 'BUTTON' && element.textContent === '다시 시도 중…')[0];
    assert.ok(retryingButton, `the auth recovery control exposes its loading state: ${rootElement.textContent}`);
    assert.equal(retryingButton.disabled, true, 'the auth recovery control is disabled while the retry request is pending');
    retryingButton.dispatchEvent(new Event('click', { bubbles: true }));
    retryingButton.dispatchEvent(new Event('click', { bubbles: true }));
    assert.equal(bindAttempts, 4, 'double-clicking an auth recovery control cannot create another mutation');
    await act(async () => {
      resolveSecondRetry(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      await Promise.resolve();
    });
    await flushReact();
    assert.equal(bindAttempts, 4, 'the second auth retry completes without duplication');

    failNextSubscriptionRead = true;
    await act(async () => {
      findBindButton().dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushReact();
    assert.equal(bindAttempts, 5, 'a failed mutation leaves a retry candidate before an explicit refresh');
    const readsBeforeRefresh = subscriptionReads;
    const refreshButton = findTestElement(rootElement, (element) => element.tagName === 'BUTTON' && element.textContent === '새로고침');
    await act(async () => {
      refreshButton.dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushReact();
    assert.equal(bindAttempts, 5, 'refreshing activity does not replay the previous failed mutation');
    assert.match(findAlerts().map((alert) => alert.textContent).join('\n'), /협업 읽기 실패/);
    await act(async () => {
      findErrorRetryButton().dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushReact();
    assert.equal(bindAttempts, 5, 'an activity read retry does not invoke the stale mutation operation');
    assert.ok(subscriptionReads > readsBeforeRefresh, 'the activity retry re-issues the GET requests');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    resetAuthStateForTest();
    if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    else Reflect.deleteProperty(globalThis, 'fetch');
  });
}

const collaborationModule = await import('../src/client/CollaborationPanel.js') as Record<string, unknown>;
assert.equal(
  typeof collaborationModule.loadCollaborationActivity,
  'function',
  'Activity exposes one loader for subscriptions, digest, and notifications',
);
assert.equal(
  typeof collaborationModule.CollaborationActivityState,
  'function',
  'Activity exposes deterministic loading, error, empty, and success rendering',
);

{
  const target = { type: 'project' as const, id: 'project-1' };
  const mutationCalls: Array<{ path: string; body: Record<string, unknown>; slot: string }> = [];
  const validationMessages: string[] = [];
  const mutate = async (path: string, body: Record<string, unknown>, slot: string) => {
    mutationCalls.push({ path, body, slot });
  };

  for (const channelId of ['', '   ']) {
    let inputValue = channelId;
    await bindCollaborationChannel(inputValue, target, mutate, (message) => validationMessages.push(message));
    assert.equal(inputValue, channelId, `invalid channel input remains recoverable: ${JSON.stringify(channelId)}`);
    assert.equal(mutationCalls.length, 0, `invalid channel input does not issue a mutation: ${JSON.stringify(channelId)}`);
    assert.equal(validationMessages.at(-1), '채널 ID를 입력하세요.');
  }

  let inputValue = 'valid-channel';
  await bindCollaborationChannel(inputValue, target, mutate, (message) => validationMessages.push(message));
  assert.equal(inputValue, 'valid-channel', 'valid channel input is not cleared by submission');
  assert.deepEqual(mutationCalls, [{
    path: '/api/collaboration/bindings',
    body: { target, channelId: 'valid-channel', metadata: { source: 'teams-tab' } },
    slot: 'bind',
  }]);
  assert.equal(validationMessages.at(-1), '', 'valid channel input clears the inline validation message');
}

{
  const controller = createLatestCollaborationLoadController();
  const first = controller.begin();
  const second = controller.begin();

  assert.equal(first.signal.aborted, true, 'starting a newer collaboration load aborts the older request');
  assert.equal(
    first.commit(() => undefined),
    false,
    'a stale collaboration response cannot commit state',
  );
  assert.equal(
    second.commit(() => undefined),
    true,
    'the latest collaboration response can commit state',
  );

  const currentState = { error: '현재 요청 오류', subscriptions: ['latest'] };
  first.commit(() => {
    currentState.error = '';
    currentState.subscriptions = ['stale'];
  });
  assert.deepEqual(
    currentState,
    { error: '현재 요청 오류', subscriptions: ['latest'] },
    'a stale success or error cannot clear the latest collaboration state',
  );
}

{
  const retryStore = createCollaborationRetryStore();
  const operation = async () => undefined;
  retryStore.set('bind', operation);
  assert.equal(retryStore.get('bind'), operation, 'a mounted retry store retains the operation by slot');
  retryStore.dispose();
  retryStore.set('bind', async () => undefined);
  assert.equal(retryStore.get('bind'), undefined, 'an unmounted retry store rejects callbacks registered after disposal');
}

{
  const markup = renderToStaticMarkup(React.createElement(CollaborationPanel));
  assert.match(markup, /불러오는 중/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /협업 설정을 불러오는 중입니다/);
  assert.match(markup, /협업 대상 ID/);
  assert.match(markup, /<button class="primary" disabled="" type="button">팔로우<\/button>/, 'follow is unavailable until the initial activity state is known');
  assert.match(markup, /<button class="secondary" disabled="" type="button">팔로우 해제<\/button>/, 'unfollow is unavailable until the initial activity state is known');
  assert.match(markup, /<button class="secondary" disabled="" type="button">채널에 연결<\/button>/, 'channel binding is unavailable while activity is loading');
  assert.match(markup, /<button class="secondary" disabled="" type="button">알림 저장<\/button>/, 'notification preferences are unavailable while activity is loading');
}

if (
  typeof collaborationModule.loadCollaborationActivity === 'function'
  && typeof collaborationModule.CollaborationActivityState === 'function'
) {
  type Notification = {
    id: string;
    target: { type: 'work-item'; id: string };
    title: string;
    body: string;
    occurredAt: string;
    deepLink: { href: string };
  };
  type ActivityData = {
    subscriptions: unknown[];
    bindings: unknown[];
    preferences: unknown[];
    digest: { period: string; totalCount: number; entries: unknown[] };
    notifications: Notification[];
  };
  type Loader = (
    fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    signal: AbortSignal,
  ) => Promise<ActivityData>;
  type StateComponent = React.ComponentType<{
    data: ActivityData;
    error: string;
    loading: boolean;
    onRetry: () => void;
  }>;

  const loadCollaborationActivity = collaborationModule.loadCollaborationActivity as Loader;
  const CollaborationActivityState = collaborationModule.CollaborationActivityState as StateComponent;
  const requested: string[] = [];
  const notification: Notification = {
    id: 'notification-1',
    target: { type: 'work-item', id: 'work-1' },
    title: '업무 업데이트',
    body: '상태: done',
    occurredAt: '2026-08-10T01:00:00.000Z',
    deepLink: { href: '/tabs/home/?collaborationType=work-item&collaborationId=work-1' },
  };
  const payloads = new Map<string, unknown>([
    ['/api/collaboration/subscriptions', { subscriptions: [] }],
    ['/api/collaboration/digest?period=weekly', { digest: { period: 'weekly', totalCount: 0, entries: [] } }],
    ['/api/collaboration/notifications?limit=10', { notifications: [notification] }],
    ['/api/collaboration/bindings', { bindings: [] }],
    ['/api/collaboration/preferences', { preferences: [] }],
  ]);
  const data = await loadCollaborationActivity(async (input) => {
    const url = String(input);
    requested.push(url);
    return new Response(JSON.stringify(payloads.get(url)), {
      status: payloads.has(url) ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    });
  }, new AbortController().signal);

  assert.deepEqual(requested, [
    '/api/collaboration/subscriptions',
    '/api/collaboration/digest?period=weekly',
    '/api/collaboration/notifications?limit=10',
    '/api/collaboration/bindings',
    '/api/collaboration/preferences',
  ]);
  assert.equal(data.notifications[0]?.deepLink.href, notification.deepLink.href);

  const emptyData: ActivityData = {
    subscriptions: [],
    bindings: [],
    preferences: [],
    digest: { period: 'weekly', totalCount: 0, entries: [] },
    notifications: [],
  };
  const renderState = (props: Omit<React.ComponentProps<StateComponent>, 'onRetry'>) => renderToStaticMarkup(
    React.createElement(CollaborationActivityState, { ...props, onRetry: () => undefined }),
  );
  const loadingMarkup = renderState({ data: emptyData, error: '', loading: true });
  assert.match(loadingMarkup, /class="collaboration-activity-status"/);
  assert.match(loadingMarkup, /aria-busy="true"/);
  assert.match(loadingMarkup, /aria-live="polite"/);
  assert.match(loadingMarkup, /aria-atomic="true"/);
  assert.match(loadingMarkup, /role="status"/);
  assert.equal((loadingMarkup.match(/role="status"/g) ?? []).length, 1, 'loading has one status role without nested status roles');
  assert.match(loadingMarkup, /협업 설정을 불러오는 중입니다/);
  const errorMarkup = renderState({ data: emptyData, error: '알림을 불러오지 못했습니다.', loading: false });
  assert.match(errorMarkup, /role="alert"/);
  assert.match(errorMarkup, /다시 시도/);
  const emptyMarkup = renderState({ data: emptyData, error: '', loading: false });
  assert.equal((emptyMarkup.match(/class="collaboration-activity-status"/g) ?? []).length, 2, 'notification and digest empties each have a dedicated status region');
  assert.equal((emptyMarkup.match(/aria-live="polite"/g) ?? []).length, 2, 'notification and digest empties are polite live regions');
  assert.equal((emptyMarkup.match(/aria-atomic="true"/g) ?? []).length, 2, 'notification and digest empties announce complete messages');
  assert.equal((emptyMarkup.match(/role="status"/g) ?? []).length, 2, 'notification and digest empties expose status semantics');
  assert.equal((emptyMarkup.match(/aria-busy="false"/g) ?? []).length, 2, 'settled empty regions are marked not busy');
  assert.match(emptyMarkup, /최근 알림이 없습니다/);
  assert.match(emptyMarkup, /아직 업데이트 digest가 없습니다/);
  const populatedMarkup = renderState({ data, error: '', loading: false });
  assert.match(populatedMarkup, /업무 업데이트/);
  assert.match(populatedMarkup, /collaborationType=work-item&amp;collaborationId=work-1/);

  await assert.rejects(
    () => loadCollaborationActivity(async (input) => {
      const url = String(input);
      const notificationsOk = url !== '/api/collaboration/notifications?limit=10';
      return new Response(JSON.stringify(notificationsOk
        ? payloads.get(url)
        : { error: '알림 저장소를 읽지 못했습니다.' }), {
        status: notificationsOk ? 200 : 503,
        headers: { 'content-type': 'application/json' },
      });
    }, new AbortController().signal),
    /알림 저장소를 읽지 못했습니다/,
  );
}

console.log('Client collaboration panel tests passed');
