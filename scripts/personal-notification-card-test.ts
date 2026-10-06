import assert from 'node:assert/strict';
import { GenUiResponseFactory } from '../src/server/genui-response.js';
import { GenUiActionStore } from '../src/server/genui-action-store.js';
import { createPersonalNotificationCard, upgradePersonalNotificationCard, sendPersonalNotificationCard } from '../src/server/personal-notification-card.js';
const factory = new GenUiResponseFactory(new GenUiActionStore('/tmp/unused-synthetic-notification-card.json'), {
  openTabUrl: 'https://example.test/tabs/home/',
});
const job = { id: 'task-synthetic-card', conversationId: 'rest-synthetic', requesterId: 'owner', tenantId: 'tenant',
  status: 'completed', mode: 'read-only', prompt: '합성 요청', progress: [], result: '합성 결과',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any;
for (const [kind, phase] of [['progress', 'analysis'], ['result', 'completed'], ['error', 'failed'], ['cancelled', 'cancelled']] as const) {
  const activity = createPersonalNotificationCard(factory.notification({ job, conversationId: job.conversationId, kind, phase,
    message: '합성 결과 token=synthetic-secret' }));
  assert.equal('text' in activity, false, 'attachment response never duplicates top-level text');
  assert.equal(activity.attachments.length, 1);
  const inspect = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'AdaptiveCard') assert.equal(value.version, '1.6');
    if (typeof value.type === 'string' && value.type.startsWith('Action.')) {
      assert.ok(['Action.Submit', 'Action.ShowCard', 'Action.OpenUrl'].includes(value.type));
      assert.ok(!['positive', 'destructive'].includes(value.style));
    }
    if (typeof value.type === 'string' && value.type.startsWith('Input.')) assert.ok(['Input.Text', 'Input.ChoiceSet'].includes(value.type));
    for (const child of Object.values(value)) inspect(child);
  };
  inspect(activity);
  assert.ok(!JSON.stringify(activity).includes('synthetic-secret'), 'existing redaction is preserved');
}
console.log('PASS: actual personal notification renderer declares1.6, limited actions and attachment-only masked output');

const envelope = factory.notification({ job, conversationId: job.conversationId, kind: 'result', phase: 'completed',
  message: '합성 결과 token=synthetic-secret' });
for (const element of [{ type: 'Action.Execute' }, { type: 'Action.Submit', style: 'positive' },
  { type: 'Action.OpenUrl', style: 'destructive' }, { type: 'Input.Toggle' }]) {
  const activity = createPersonalNotificationCard(envelope);
  activity.attachments[0].content.body.push(element);
  assert.throws(() => upgradePersonalNotificationCard(activity as any), /PERSONAL_NOTIFICATION_CARD_UNSUPPORTED/);
}
const nested = createPersonalNotificationCard(envelope);
nested.attachments[0].content.body.push({ type: 'Action.ShowCard', card: { type: 'AdaptiveCard', version: '1.2', body: [] } });
upgradePersonalNotificationCard(nested as any);
assert.equal((nested.attachments[0].content.body.at(-1) as any).card.version, '1.6');
let boundaryCalls = 0;
await sendPersonalNotificationCard(async (text, passedEnvelope, activity) => {
  boundaryCalls++;
  assert.equal(passedEnvelope, undefined);
  assert.ok(!text.includes('synthetic-secret'), 'fallback sender boundary is masked');
  assert.equal('text' in (activity as object), false);
  assert.equal((activity as any).attachments[0].content.version, '1.6');
  return { state: 'connector-accepted' };
}, envelope);
assert.equal(boundaryCalls, 1);
console.log('PASS: prohibited nested elements fail closed; actual callback adapter preserves masked fallback and override');
