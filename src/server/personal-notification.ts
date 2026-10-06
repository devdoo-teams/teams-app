import crypto from 'node:crypto';
import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import type { AgentNotification } from './agent-service.js';
import type { AgentJob } from './agent-job-store.js';
import { deriveServerOwnedRestConversationId, type RestPrincipal } from './rest-scope.js';

export type PersonalNotificationState = 'waiting-personal-chat' | 'pending' | 'sending' | 'accepted' | 'rejected' | 'ambiguous';
export type PersonalNotificationReceipt = { state: PersonalNotificationState; observedAt: string; activityId?: string };
export type PersonalReference = RestPrincipal & { conversationId: string; serviceUrl: string; observedAt: string };
export type PersonalNotificationPayload = Pick<AgentNotification, 'kind' | 'phase' | 'message'> & { enabled: true };
type Entry = RestPrincipal & { key: string; jobId: string; notification: PersonalNotificationPayload; receipt: PersonalNotificationReceipt };
type Snapshot = { schemaVersion: 2; references: PersonalReference[]; outbox: Entry[] };
type Send = (reference: PersonalReference, notification: PersonalNotificationPayload & { jobId: string }) => Promise<{ state: 'accepted' | 'rejected' | 'ambiguous'; activityId?: string }>;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(['waiting-personal-chat', 'pending', 'sending', 'accepted', 'rejected', 'ambiguous']);
const sameOwner = (a: RestPrincipal, b: { tenantId?: string; requesterId?: string }) => a.tenantId === b.tenantId && a.requesterId === b.requesterId;
const stamp = () => new Date().toISOString();
function validText(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function validReference(value: PersonalReference): boolean {
  if (!value || !GUID.test(value.tenantId) || !GUID.test(value.requesterId) || !validText(value.conversationId)
    || value.conversationId.startsWith('rest-') || !Number.isFinite(Date.parse(value.observedAt))) return false;
  try { const url = new URL(value.serviceUrl); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && ['smba.trafficmanager.net', 'smba.infra.gcc.teams.microsoft.com', 'smba.infra.gov.teams.microsoft.us', 'smba.infra.dod.teams.microsoft.us'].includes(url.hostname); }
  catch { return false; }
}

/** Only SDK-authenticated personal activities may bind a destination. The REST
 * scope is never an outbound address. Single-process private atomic store. */
export class PersonalNotificationBroker {
  private snapshot: Snapshot = { schemaVersion: 2, references: [], outbox: [] };
  private tail: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | undefined;
  private outstandingSend: Promise<unknown> | undefined;
  constructor(private readonly file: string, private readonly botId: string, private readonly send: Send) {}
  async initialize(): Promise<void> {
    let parsed: Snapshot;
    try { parsed = JSON.parse(await readAtomicJsonStore(this.file)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.references) || !Array.isArray(parsed.outbox)
      || parsed.references.length > 2048 || parsed.outbox.length > 4096
      || parsed.references.some(ref => !validReference(ref))
      || parsed.outbox.some(entry => !entry || !validText(entry.key) || !validText(entry.jobId, 200)
        || !GUID.test(entry.tenantId) || !GUID.test(entry.requesterId) || !STATES.has(entry.receipt?.state)
        || !Number.isFinite(Date.parse(entry.receipt.observedAt)) || entry.notification?.enabled !== true
        || Object.keys(entry.notification).some(key => !['enabled', 'kind', 'phase', 'message'].includes(key))
        || !['progress', 'result', 'error', 'cancelled'].includes(entry.notification.kind)
        || !['analysis', 'tools', 'agent-update', 'completed', 'blocked', 'failed', 'cancelled', 'commit'].includes(entry.notification.phase)
        || typeof entry.notification.message !== 'string' || !entry.notification.message.trim() || entry.notification.message.length > 4000)) {
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
    const reference: PersonalReference = { tenantId: activity.conversation.tenantId ?? activity.channelData?.tenant?.id,
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
    if (!['progress', 'result', 'error', 'cancelled'].includes(notification.kind)
      || !['analysis', 'tools', 'agent-update', 'completed', 'blocked', 'failed', 'cancelled', 'commit'].includes(notification.phase)
      || typeof notification.message !== 'string' || !notification.message.trim()) return;
    if (job.durableNotifications?.enabled !== true) return;
    if (!job.tenantId || !job.requesterId || !GUID.test(job.tenantId) || !GUID.test(job.requesterId)) return;
    const expectedScope = deriveServerOwnedRestConversationId({ tenantId: job.tenantId, requesterId: job.requesterId });
    if (notification.conversationId !== expectedScope || job.conversationId !== expectedScope) return;
    await this.serial(async () => {
      const key = crypto.createHash('sha256').update(JSON.stringify([job.tenantId, job.requesterId, job.id, notification.kind, notification.phase, notification.message])).digest('hex');
      if (this.snapshot.outbox.some(entry => entry.key === key)) return;
      if (this.snapshot.outbox.length >= 4096) throw new Error('PERSONAL_NOTIFICATION_OUTBOX_FULL');
      const entry: Entry = { tenantId: job.tenantId!, requesterId: job.requesterId!, key, jobId: job.id,
        notification: { enabled: true, kind: notification.kind, phase: notification.phase, message: notification.message.slice(0, 4000) }, receipt: { state: 'pending', observedAt: stamp() } };
      this.snapshot.outbox.push(entry);
      try { await this.persist(); } catch (error) { this.snapshot.outbox.pop(); throw error; }
      await this.dispatch(entry);
    });
  }
  async flush(): Promise<void> {
    if (this.outstandingSend) return;
    if (this.flushing) return this.flushing;
    this.flushing = this.serial(async () => {
      const pending = this.snapshot.outbox.filter(entry => ['pending', 'waiting-personal-chat'].includes(entry.receipt.state)
        && this.snapshot.references.some(ref => sameOwner(ref, entry)));
      for (const entry of pending.slice(0, 10)) await this.dispatch(entry);
    }).finally(() => { this.flushing = undefined; });
    return this.flushing;
  }
  private async dispatch(entry: Entry): Promise<void> {
    if (this.outstandingSend) return;
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
      const transport = this.send(reference, { ...entry.notification, jobId: entry.jobId });
      this.outstandingSend = transport;
      void transport.then(() => { if (this.outstandingSend === transport) this.outstandingSend = undefined; },
        () => { if (this.outstandingSend === transport) this.outstandingSend = undefined; });
      try { receipt = await Promise.race([transport, timeout]); }
      finally { if (timer) clearTimeout(timer); }
      entry.receipt = { state: receipt.state, observedAt: stamp(), ...(receipt.activityId ? { activityId: receipt.activityId } : {}) };
    } catch { entry.receipt = { state: 'ambiguous', observedAt: stamp() }; }
    await this.persist();
  }

  async recoverTerminalJobs(jobs: readonly AgentJob[]): Promise<void> {
    for (const job of jobs) {
      if (job.durableNotifications?.enabled !== true || !job.tenantId || !GUID.test(job.tenantId) || !GUID.test(job.requesterId)
        || !['completed', 'failed'].includes(job.status)
        || job.conversationId !== deriveServerOwnedRestConversationId({ tenantId: job.tenantId, requesterId: job.requesterId })) continue;
      const phase = job.status === 'completed' ? 'completed' : 'failed';
      if (this.snapshot.outbox.some(entry => entry.jobId === job.id && sameOwner(entry, job) && entry.notification.phase === phase)) continue;
      await this.deliver({ job, conversationId: job.conversationId, kind: job.status === 'completed' ? 'result' : 'error', phase,
        message: job.status === 'completed' ? `작업 ${job.id} 완료.\n${job.result ?? '결과가 저장되지 않았습니다.'}`
          : `작업 ${job.id} 실패.\n${job.error ?? '실패 이유가 저장되지 않았습니다.'}` });
    }
  }
}
