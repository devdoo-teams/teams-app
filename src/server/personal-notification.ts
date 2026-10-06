import crypto from 'node:crypto';
import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import type { AgentNotification } from './agent-service.js';
import { deriveServerOwnedRestConversationId, type RestPrincipal } from './rest-scope.js';

export type PersonalNotificationState = 'waiting-personal-chat' | 'pending' | 'sending' | 'accepted' | 'rejected' | 'ambiguous';
export type PersonalNotificationReceipt = { state: PersonalNotificationState; observedAt: string; activityId?: string };
type Reference = RestPrincipal & { conversationId: string; serviceUrl: string; observedAt: string };
type Entry = RestPrincipal & { key: string; jobId: string; notification: AgentNotification; receipt: PersonalNotificationReceipt };
type Snapshot = { schemaVersion: 1; references: Reference[]; outbox: Entry[] };
type Send = (conversationId: string, notification: AgentNotification) => Promise<{ state: 'accepted' | 'rejected' | 'ambiguous'; activityId?: string }>;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(['waiting-personal-chat', 'pending', 'sending', 'accepted', 'rejected', 'ambiguous']);
const sameOwner = (a: RestPrincipal, b: { tenantId?: string; requesterId?: string }) => a.tenantId === b.tenantId && a.requesterId === b.requesterId;
const stamp = () => new Date().toISOString();
function validText(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function validReference(value: Reference): boolean {
  if (!value || !GUID.test(value.tenantId) || !GUID.test(value.requesterId) || !validText(value.conversationId)
    || value.conversationId.startsWith('rest-') || !Number.isFinite(Date.parse(value.observedAt))) return false;
  try { const url = new URL(value.serviceUrl); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}

/** Only SDK-authenticated personal activities may bind a destination. The REST
 * scope is never an outbound address. Single-process private atomic store. */
export class PersonalNotificationBroker {
  private snapshot: Snapshot = { schemaVersion: 1, references: [], outbox: [] };
  private tail: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | undefined;
  constructor(private readonly file: string, private readonly botId: string, private readonly send: Send) {}
  async initialize(): Promise<void> {
    let parsed: Snapshot;
    try { parsed = JSON.parse(await readAtomicJsonStore(this.file)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.references) || !Array.isArray(parsed.outbox)
      || parsed.references.length > 2048 || parsed.outbox.length > 4096
      || parsed.references.some(ref => !validReference(ref))
      || parsed.outbox.some(entry => !entry || !validText(entry.key) || !validText(entry.jobId, 200)
        || !GUID.test(entry.tenantId) || !GUID.test(entry.requesterId) || !STATES.has(entry.receipt?.state)
        || !Number.isFinite(Date.parse(entry.receipt.observedAt)) || !entry.notification?.job
        || !sameOwner(entry, entry.notification.job) || entry.notification.job.id !== entry.jobId
        || entry.notification.conversationId !== deriveServerOwnedRestConversationId(entry)
        || entry.notification.job.conversationId !== entry.notification.conversationId)) {
      throw new Error('PERSONAL_NOTIFICATION_STORE_INVALID');
    }
    // A crash after platform acceptance but before persistence cannot be retried safely.
    for (const entry of parsed.outbox) if (entry.receipt.state === 'sending') entry.receipt = { state: 'ambiguous', observedAt: stamp() };
    this.snapshot = parsed;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation); this.tail = next.catch(() => undefined); return next;
  }
  private async persist(): Promise<void> { await atomicWriteJson(this.file, this.snapshot); }
  async observeAuthenticatedActivity(activity: any): Promise<boolean> {
    if (activity?.channelId !== 'msteams' || activity?.conversation?.conversationType !== 'personal'
      || activity?.recipient?.id !== `28:${this.botId}` || !GUID.test(activity?.from?.aadObjectId ?? '')) return false;
    const reference: Reference = { tenantId: activity.conversation.tenantId ?? activity.channelData?.tenant?.id,
      requesterId: activity.from.aadObjectId, conversationId: activity.conversation.id,
      serviceUrl: activity.serviceUrl, observedAt: stamp() };
    if (!validReference(reference)) return false;
    return this.serial(async () => {
      const references = this.snapshot.references.filter(ref => !sameOwner(ref, reference));
      if (references.length >= 2048) return false;
      const previous = this.snapshot;
      this.snapshot = { ...previous, references: [...references, reference] };
      try { await this.persist(); } catch (error) { this.snapshot = previous; throw error; }
      return true;
    });
  }
  status(jobId: string, principal: RestPrincipal): PersonalNotificationReceipt | undefined {
    const entry = this.snapshot.outbox.filter(row => row.jobId === jobId && sameOwner(row, principal)).at(-1);
    return entry ? { ...entry.receipt } : undefined;
  }
  async deliver(notification: AgentNotification): Promise<void> {
    const job = notification.job;
    if (job.durableNotifications?.enabled !== true) return;
    if (!job.tenantId || !job.requesterId || !GUID.test(job.tenantId) || !GUID.test(job.requesterId)) return;
    const expectedScope = deriveServerOwnedRestConversationId({ tenantId: job.tenantId, requesterId: job.requesterId });
    if (notification.conversationId !== expectedScope || job.conversationId !== expectedScope) return;
    await this.serial(async () => {
      const key = crypto.createHash('sha256').update(JSON.stringify([job.tenantId, job.requesterId, job.id, notification.kind, notification.phase, notification.message])).digest('hex');
      if (this.snapshot.outbox.some(entry => entry.key === key)) return;
      if (this.snapshot.outbox.length >= 4096) throw new Error('PERSONAL_NOTIFICATION_OUTBOX_FULL');
      const entry: Entry = { tenantId: job.tenantId!, requesterId: job.requesterId!, key, jobId: job.id,
        notification: structuredClone(notification), receipt: { state: 'pending', observedAt: stamp() } };
      this.snapshot.outbox.push(entry);
      try { await this.persist(); } catch (error) { this.snapshot.outbox.pop(); throw error; }
      await this.dispatch(entry);
    });
  }
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.serial(async () => {
      const pending = this.snapshot.outbox.filter(entry => ['pending', 'waiting-personal-chat'].includes(entry.receipt.state)
        && this.snapshot.references.some(ref => sameOwner(ref, entry)));
      for (const entry of pending.slice(0, 10)) await this.dispatch(entry);
    }).finally(() => { this.flushing = undefined; });
    return this.flushing;
  }
  private async dispatch(entry: Entry): Promise<void> {
    const reference = this.snapshot.references.find(ref => sameOwner(ref, entry));
    if (!reference) {
      if (entry.receipt.state !== 'waiting-personal-chat') { entry.receipt = { state: 'waiting-personal-chat', observedAt: stamp() }; await this.persist(); }
      return;
    }
    entry.receipt = { state: 'sending', observedAt: stamp() };
    await this.persist();
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PERSONAL_NOTIFICATION_SEND_TIMEOUT')), 10_000); });
      let receipt: Awaited<ReturnType<Send>>;
      try { receipt = await Promise.race([this.send(reference.conversationId, entry.notification), timeout]); }
      finally { if (timer) clearTimeout(timer); }
      entry.receipt = { state: receipt.state, observedAt: stamp(), ...(receipt.activityId ? { activityId: receipt.activityId } : {}) };
    } catch { entry.receipt = { state: 'ambiguous', observedAt: stamp() }; }
    await this.persist();
  }
}
