import assert from 'node:assert/strict';
import { createExecutionPresentationActivity } from '../src/server/execution-presentation-activity.js';
import { buildTeamsPersonalTabDeepLink } from '../src/server/teams-tab-link.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
const job: CoreOrchestrationJob = { id: 'synthetic-native-contract', mode: 'read-only', status: 'completed',
  prompt: '합성 업무 검토', result: '합성 검토 결과', progress: [], createdAt: '2026-10-11T00:00:00.000Z' };
const openTabUrl = buildTeamsPersonalTabDeepLink({ catalogAppId: '9b20fd94-2ac9-4423-ac1f-ff528ab245c1', tabDomain: 'synthetic.example.com' });
const plain = createExecutionPresentationActivity(job, 'text', { richEnabled: true, openTabUrl });
assert.equal(typeof (plain as any).text, 'string', 'native text mode must use a real text message');
assert.equal((plain as any).attachments, undefined, 'completed text mode has no replacement card');
assert.match((plain as any).text, /합성 검토 결과/);
const rich = createExecutionPresentationActivity(job, 'rich', { richEnabled: true, openTabUrl, richSurface: 'dialog' } as any);
const action = (rich as any).attachments?.[0]?.content?.actions?.[0];
assert.equal(action.type, 'Action.Submit');
assert.equal(action.data.msteams.type, 'task/fetch');
assert.equal(action.data.dialog_id, 'core-job-detail');
assert.equal(action.data.jobId, job.id, 'native Dialog only navigates to the same owner-authorized job');
assert.equal(action.data.url, undefined, 'caller cannot choose a foreign Dialog URL');
for (const status of ['awaiting_approval', 'failed', 'cancelled'] as const) {
  const activity = createExecutionPresentationActivity({ ...job, status }, 'text', { richEnabled: true, openTabUrl });
  assert.match((activity as any).text, new RegExp(status));
}
console.log('PASS: real native text serializer and same-job Dialog launch contract');
