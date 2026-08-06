import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';

export type Item = {
  id: number;
  title: string;
  status: 'open' | 'done';
};

export const MAX_ITEM_TITLE_LENGTH = 400;

const seedItems: Item[] = [
  { id: 1, title: 'Teams SDK 연결 확인', status: 'done' },
  { id: 2, title: '첫 번째 업무 항목 만들기', status: 'open' },
];

export class ItemStore {
  private items: Item[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataFile: string) {}

  async initialize(): Promise<void> {
    try {
      const contents = await readAtomicJsonStore(this.dataFile);
      const parsed = JSON.parse(contents) as unknown;

      if (!Array.isArray(parsed) || !parsed.every(isItem)) {
        throw new Error(`Invalid item store format: ${this.dataFile}`);
      }

      this.items = parsed;
    } catch (error) {
      if (!isFileNotFound(error)) throw error;

      this.items = seedItems.map((item) => ({ ...item }));
      await this.persist();
    }
  }

  list(): Item[] {
    return this.items.map((item) => ({ ...item }));
  }

  async add(title: string): Promise<Item> {
    const normalizedTitle = assertItemTitle(title);
    const nextId = this.items.reduce((largest, item) => Math.max(largest, item.id), 0) + 1;
    const item: Item = { id: nextId, title: normalizedTitle, status: 'open' };
    this.items.unshift(item);
    await this.persist();
    return { ...item };
  }

  async update(id: number, title: string): Promise<Item | null> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return null;

    item.title = assertItemTitle(title);
    await this.persist();
    return { ...item };
  }

  async toggle(id: number): Promise<Item | null> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return null;

    item.status = item.status === 'done' ? 'open' : 'done';
    await this.persist();
    return { ...item };
  }

  async remove(id: number): Promise<Item | null> {
    const index = this.items.findIndex((candidate) => candidate.id === id);
    if (index === -1) return null;

    const [removed] = this.items.splice(index, 1);
    await this.persist();
    return { ...removed };
  }

  countOpen(): number {
    return this.items.filter((item) => item.status === 'open').length;
  }

  summary(): { total: number; open: number; done: number } {
    const open = this.countOpen();
    return { total: this.items.length, open, done: this.items.length - open };
  }

  private async persist(): Promise<void> {
    const nextWrite = this.writeQueue.then(() => atomicWriteJson(this.dataFile, this.items));
    this.writeQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }
}

function isItem(value: unknown): value is Item {
  if (!value || typeof value !== 'object') return false;

  const item = value as Partial<Item>;
  return (
    typeof item.id === 'number' &&
    typeof item.title === 'string' &&
    (item.status === 'open' || item.status === 'done')
  );
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
