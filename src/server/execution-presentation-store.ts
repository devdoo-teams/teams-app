import { z } from 'zod';
import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import {
  DEFAULT_EXECUTION_PRESENTATION_MODE, ExecutionPresentationModeSchema, ExecutionPresentationScopeSchema,
  ExecutionPresentationSelectionSchema, executionPresentationPreferences,
  type ExecutionPresentationSelection, type ExecutionPresentationPreferences,
  type ExecutionPresentationMode, type ExecutionPresentationScope,
} from '../shared/execution-presentation.js';

const MAX_ENTRIES = 1_000;
const MAX_STORE_BYTES = 1_048_576;
const recordSchema = ExecutionPresentationScopeSchema.extend({
  mode: ExecutionPresentationModeSchema,
  details: ExecutionPresentationSelectionSchema.shape.details,
  richSurface: ExecutionPresentationSelectionSchema.shape.richSurface,
  updatedAt: z.string().max(30).refine(value => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
  }),
}).strict();
type Preference = z.infer<typeof recordSchema>;

/** Single-process private preferences. The API must derive scope from auth.
 * This store has no execution or provider configuration dependency.
 */
export class ExecutionPresentationStore {
  private preferences: Preference[] = [];
  private loaded = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly defaultMode: ExecutionPresentationMode;
  private readonly maxEntries: number;

  constructor(private readonly dataFile: string, options: {
    defaultMode?: ExecutionPresentationMode;
    maxEntries?: number;
  } = {}) {
    this.defaultMode = parseMode(options.defaultMode ?? DEFAULT_EXECUTION_PRESENTATION_MODE);
    this.maxEntries = options.maxEntries ?? MAX_ENTRIES;
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1 || this.maxEntries > MAX_ENTRIES) {
      throw new RangeError('Invalid execution presentation store capacity: entries must be between 1 and 1000');
    }
  }

  async initialize(): Promise<void> {
    await this.enqueue(async () => {
      if (!await this.loadIfNeeded()) return;
      try { await atomicWriteJson(this.dataFile, []); }
      catch (error) { this.loaded = false; throw error; }
    });
  }

  async get(scope: ExecutionPresentationScope): Promise<ExecutionPresentationMode> {
    return (await this.getSelection(scope)).mode;
  }

  async getSelection(scope: ExecutionPresentationScope): Promise<ExecutionPresentationPreferences> {
    const valid = parseScope(scope);
    return this.enqueue(async () => {
      await this.loadIfNeeded();
      return executionPresentationPreferences(this.preferences.find(item => sameScope(item, valid)) ?? { mode: this.defaultMode });
    });
  }

  async set(scope: ExecutionPresentationScope, mode: ExecutionPresentationMode): Promise<void> {
    await this.setSelection(scope, { mode: parseMode(mode) });
  }

  async setSelection(scope: ExecutionPresentationScope, selection: ExecutionPresentationSelection): Promise<void> {
    const valid = parseScope(scope);
    const selected = ExecutionPresentationSelectionSchema.parse(selection);
    await this.enqueue(async () => {
      await this.loadIfNeeded();
      const next = this.preferences.filter(item => !sameScope(item, valid));
      const previous = this.preferences.find(item => sameScope(item, valid));
      next.push({ ...previous, ...valid, ...selected, updatedAt: new Date().toISOString() });
      if (next.length > this.maxEntries) throw new RangeError('Execution presentation store capacity exceeded');
      await atomicWriteJson(this.dataFile, next);
      this.preferences = next;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async loadIfNeeded(): Promise<boolean> {
    if (this.loaded) return false;
    let contents: string;
    try { contents = await readAtomicJsonStore(this.dataFile); }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
      this.preferences = [];
      this.loaded = true;
      return true;
    }
    if (Buffer.byteLength(contents, 'utf8') > MAX_STORE_BYTES) throw invalidStore();
    let parsed: unknown;
    try { parsed = JSON.parse(contents); }
    catch { throw invalidStore(); }
    const result = z.array(recordSchema).max(this.maxEntries).safeParse(parsed);
    if (!result.success) throw invalidStore();
    const keys = result.data.map(item => `${item.tenantId}\u0000${item.requesterId}`);
    if (new Set(keys).size !== keys.length) throw invalidStore();
    this.preferences = result.data;
    this.loaded = true;
    return false;
  }
}

function parseScope(value: unknown): ExecutionPresentationScope {
  const result = ExecutionPresentationScopeSchema.safeParse(value);
  if (!result.success) throw new RangeError('Invalid execution presentation scope');
  return result.data;
}
function parseMode(value: unknown): ExecutionPresentationMode {
  const result = ExecutionPresentationModeSchema.safeParse(value);
  if (!result.success) throw new RangeError('Invalid execution presentation mode');
  return result.data;
}
function sameScope(left: ExecutionPresentationScope, right: ExecutionPresentationScope): boolean {
  return left.tenantId === right.tenantId && left.requesterId === right.requesterId;
}
function invalidStore(): Error { return new Error('Invalid execution presentation store'); }
