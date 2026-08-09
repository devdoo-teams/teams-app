import { AsyncLocalStorage } from 'node:async_hooks';

import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';

export type Item = {
  id: number;
  title: string;
  status: 'open' | 'done';
};

export type ItemScope = {
  requesterId: string;
  tenantId: string;
};

export const MAX_ITEM_TITLE_LENGTH = 400;

const ITEM_TITLE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const LEGACY_EMPTY_ITEM_TITLE = '(제목 없음)';
const LEGACY_OWNER_SCOPE: ItemScope = {
  requesterId: '__legacy__',
  tenantId: '__legacy__',
};
const OWNER_FIELD_MAX_LENGTH = 256;

const seedItems: Item[] = [
  { id: 1, title: 'Teams SDK 연결 확인', status: 'done' },
  { id: 2, title: '첫 번째 업무 항목 만들기', status: 'open' },
];

type PersistedItem = Item & Partial<ItemScope>;

export class ItemStore {
  private items: PersistedItem[] = [];
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly scopeContext = new AsyncLocalStorage<ItemScope>();
  private readonly seededScopes = new Map<string, Promise<void>>();

  constructor(private readonly dataFile: string) {}

  async initialize(): Promise<void> {
    try {
      const contents = await readAtomicJsonStore(this.dataFile);
      const parsed = JSON.parse(contents) as unknown;

      if (!Array.isArray(parsed)) {
        throw new Error(`Invalid item store format: ${this.dataFile}`);
      }

      const ids = new Set<string>();
      let migrated = false;
      const loadedItems = parsed.map((value, index) => {
        const loaded = loadItem(value, index, ids);
        migrated ||= loaded.migrated;
        return loaded.item;
      });

      this.items = loadedItems;
      if (migrated) await this.persist();
    } catch (error) {
      if (!isFileNotFound(error)) throw error;

      // Existing installs created a single unowned seed list. Preserve that
      // data by migrating it into a deterministic reserved owner instead of
      // guessing a live user. Authenticated users receive their own private
      // seeded list on first scoped access through ensureScope().
      this.items = seedItems.map((item) => ({ ...item, ...LEGACY_OWNER_SCOPE }));
      await this.persist();
    }
  }

  runWithScope<T>(scope: ItemScope, callback: () => Promise<T>): Promise<T>;
  runWithScope<T>(scope: ItemScope, callback: () => T): T;
  runWithScope<T>(scope: ItemScope, callback: () => Promise<T> | T): Promise<T> | T {
    return this.scopeContext.run(scope, callback);
  }

  async ensureScope(scope = this.scopeContext.getStore()): Promise<void> {
    if (!scope) return;

    const key = scopeKey(scope);
    if (this.hasOwnedItems(scope)) return;

    let pending = this.seededScopes.get(key);
    if (!pending) {
      pending = this.writeQueue.then(async () => {
        if (this.hasOwnedItems(scope)) return;
        const ownedSeedItems = seedItems.map((item) => ({ ...item, ...scope }));
        this.items.push(...ownedSeedItems);
        try {
          await atomicWriteJson(this.dataFile, this.items);
        } catch (error) {
          const failedSeeds = new Set<PersistedItem>(ownedSeedItems);
          this.items = this.items.filter((item) => !failedSeeds.has(item));
          throw error;
        }
      });
      this.writeQueue = pending.catch(() => undefined);
      this.seededScopes.set(key, pending);
      const cleanup = (): void => {
        if (this.seededScopes.get(key) === pending) this.seededScopes.delete(key);
      };
      void pending.then(cleanup, cleanup);
    }

    await pending;
  }

  list(scope = this.scopeContext.getStore()): Item[] {
    return this.selectItems(scope).map(stripOwner);
  }

  async add(title: string): Promise<Item> {
    const normalizedTitle = assertItemTitle(title);
    const scope = this.scopeContext.getStore() ?? LEGACY_OWNER_SCOPE;
    return this.enqueueMutation(() => {
      const largestId = this.selectItems(scope).reduce((largest, item) => Math.max(largest, item.id), 0);
      if (largestId >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError('no safe item id is available');
      }
      const nextId = largestId + 1;
      const item: PersistedItem = { id: nextId, title: normalizedTitle, status: 'open', ...scope };
      this.items = [item, ...this.items];
      return stripOwner(item);
    });
  }

  async update(id: number, title: string): Promise<Item | null> {
    const normalizedTitle = assertItemTitle(title);
    const scope = this.scopeContext.getStore();
    return this.enqueueMutation(() => {
      const index = this.findItemIndex(id, scope);
      if (index === -1) return null;
      const updated = { ...this.items[index], title: normalizedTitle };
      this.items = this.items.map((item, itemIndex) => itemIndex === index ? updated : item);
      return stripOwner(updated);
    });
  }

  async toggle(id: number): Promise<Item | null> {
    const scope = this.scopeContext.getStore();
    return this.enqueueMutation(() => {
      const index = this.findItemIndex(id, scope);
      if (index === -1) return null;
      const item = this.items[index];
      const toggled = { ...item, status: item.status === 'done' ? 'open' as const : 'done' as const };
      this.items = this.items.map((candidate, itemIndex) => itemIndex === index ? toggled : candidate);
      return stripOwner(toggled);
    });
  }

  async remove(id: number): Promise<Item | null> {
    const scope = this.scopeContext.getStore();
    return this.enqueueMutation(() => {
      const index = this.findItemIndex(id, scope);
      if (index === -1) return null;
      const [removed] = this.items.slice(index, index + 1);
      this.items = this.items.filter((_item, itemIndex) => itemIndex !== index);
      return stripOwner(removed);
    });
  }

  countOpen(scope = this.scopeContext.getStore()): number {
    return this.selectItems(scope).filter((item) => item.status === 'open').length;
  }

  summary(scope = this.scopeContext.getStore()): { total: number; open: number; done: number } {
    const items = this.selectItems(scope);
    const open = items.filter((item) => item.status === 'open').length;
    return { total: items.length, open, done: items.length - open };
  }

  private async persist(): Promise<void> {
    const snapshot = this.items.map((item) => ({ ...item }));
    const nextWrite = this.writeQueue.then(() => atomicWriteJson(this.dataFile, snapshot));
    this.writeQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }

  private enqueueMutation<T>(mutate: () => T): Promise<T> {
    const operation = this.writeQueue.then(async () => {
      const previousItems = this.items;
      try {
        const result = mutate();
        await atomicWriteJson(this.dataFile, this.items);
        return result;
      } catch (error) {
        this.items = previousItems;
        throw error;
      }
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private selectItems(scope?: ItemScope): PersistedItem[] {
    if (!scope) return this.items;
    return this.items.filter((item) => matchesScope(item, scope));
  }

  private hasOwnedItems(scope: ItemScope): boolean {
    return this.items.some((item) => matchesScope(item, scope));
  }

  private findItem(id: number, scope = this.scopeContext.getStore()): PersistedItem | undefined {
    return scope
      ? this.items.find((candidate) => candidate.id === id && matchesScope(candidate, scope))
      : this.items.find((candidate) => candidate.id === id);
  }

  private findItemIndex(id: number, scope = this.scopeContext.getStore()): number {
    return scope
      ? this.items.findIndex((candidate) => candidate.id === id && matchesScope(candidate, scope))
      : this.items.findIndex((candidate) => candidate.id === id);
  }

}

function loadItem(value: unknown, index: number, ids: Set<string>): { item: PersistedItem; migrated: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidItem(index, 'record must be an object');
  }

  const item = value as Partial<PersistedItem>;
  if (
    typeof item.id !== 'number' ||
    !Number.isFinite(item.id) ||
    !Number.isSafeInteger(item.id) ||
    item.id <= 0
  ) {
    throw invalidItem(index, 'id must be a unique positive safe integer');
  }
  if (typeof item.title !== 'string') throw invalidItem(index, 'title must be a string');
  if (item.status !== 'open' && item.status !== 'done') {
    throw invalidItem(index, 'status must be open or done');
  }

  const owner = readOwner(item, index);
  const key = `${scopeKey(owner)}#${item.id}`;
  if (ids.has(key)) throw invalidItem(index, 'id must be unique within an owner scope');
  ids.add(key);
  const title = normalizeLegacyTitle(item.title);
  return {
    item: { id: item.id, title, status: item.status, ...owner },
    migrated: title !== item.title || item.requesterId !== owner.requesterId || item.tenantId !== owner.tenantId,
  };
}

function readOwner(item: Partial<PersistedItem>, index: number): ItemScope {
  const hasRequesterId = Object.prototype.hasOwnProperty.call(item, 'requesterId');
  const hasTenantId = Object.prototype.hasOwnProperty.call(item, 'tenantId');
  if (!hasRequesterId && !hasTenantId) return LEGACY_OWNER_SCOPE;
  if (!hasRequesterId || !hasTenantId) {
    throw invalidItem(index, 'requesterId and tenantId must be provided together');
  }

  const requesterId = readOwnerField(item.requesterId);
  const tenantId = readOwnerField(item.tenantId);
  if (!requesterId || !tenantId) throw invalidItem(index, 'requesterId and tenantId must be valid owner fields');
  return { requesterId, tenantId };
}

function readOwnerField(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > OWNER_FIELD_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function invalidItem(index: number, reason: string): Error {
  return new Error(`Invalid item store format: record ${index}: ${reason}`);
}

function normalizeLegacyTitle(title: string): string {
  const normalized = title
    .replace(ITEM_TITLE_CONTROL_CHARACTERS, '')
    .trim()
    .slice(0, MAX_ITEM_TITLE_LENGTH);
  return normalized || LEGACY_EMPTY_ITEM_TITLE;
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function assertItemTitle(title: string): string {
  const normalized = typeof title === 'string' ? title.trim() : '';
  if (!normalized) throw new RangeError('title is required');
  if (normalized.length > MAX_ITEM_TITLE_LENGTH) {
    throw new RangeError(`title must be ${MAX_ITEM_TITLE_LENGTH} characters or fewer`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new RangeError('title contains unsupported control characters');
  }
  return normalized;
}

function scopeKey(scope: ItemScope): string {
  return `${scope.tenantId}/${scope.requesterId}`;
}

function matchesScope(item: PersistedItem, scope: ItemScope): boolean {
  return item.requesterId === scope.requesterId && item.tenantId === scope.tenantId;
}

function stripOwner(item: PersistedItem): Item {
  return { id: item.id, title: item.title, status: item.status };
}
