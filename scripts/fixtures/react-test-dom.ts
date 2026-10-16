import assert from 'node:assert/strict';
import { act } from 'react';

export class TestDomNode extends EventTarget {
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

export class TestDomElement extends TestDomNode {
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

export class TestDomDocument extends TestDomNode {
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

export function findTestElements(node: TestDomNode, predicate: (element: TestDomElement) => boolean): TestDomElement[] {
  const matches: TestDomElement[] = [];
  if (node instanceof TestDomElement && predicate(node)) matches.push(node);
  for (const child of node.childNodes) matches.push(...findTestElements(child, predicate));
  return matches;
}

export function findTestElement(node: TestDomNode, predicate: (element: TestDomElement) => boolean): TestDomElement {
  const element = findTestElements(node, predicate)[0];
  assert.ok(element, 'expected rendered element was not found');
  return element;
}

export async function flushReact(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

export async function withTestDom<T>(callback: (document: TestDomDocument) => Promise<T>): Promise<T> {
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
