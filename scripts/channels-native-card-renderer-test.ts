import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as channels from '../src/server/copilot-channels-shadow.js';
import { createCoreOrchestrationConfirmationActivity, createCoreOrchestrationJobActivity } from '../src/server/genui-response.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

// A missing renderer is an assertion failure, so the pre-implementation RED
// proves this contract is absent without an import-resolution error.
const render = (channels as unknown as { renderChannelsNativeCard?: (input: any) => any }).renderChannelsNativeCard;
assert.equal(typeof render, 'function', 'renderer-only canonical Core adapter is missing');
const renderCard = render!;
const scope = { tenantId: 'tenant-a', requesterId: 'owner-a', conversationId: 'conversation-a' };
const identity = { requestId: 'request-a', jobId: 'job-a', approvalId: 'approval-a' };
const job: CoreOrchestrationJob = {
  id: identity.jobId, prompt: '합성 문서 수정', status: 'awaiting_approval', mode: 'workspace-write',
  progress: ['승인 대기'], createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:01:00Z',
};
function submits(card: any): any[] {
  return [ ...(card.actions ?? []).filter((action: any) => action.type === 'Action.Submit'),
    ...(card.actions ?? []).flatMap((action: any) => action.card ? submits(action.card) : []),
    ...(card.body ?? []).flatMap((element: any) => submits({ actions: element.actions, body: element.items ?? element.columns })) ];
}
const grants = (card: any) => submits(card).map(action => ({ scope, identity, data: action.data }));
const confirmation = createCoreOrchestrationConfirmationActivity(job, 'approve', {
  confirmation: { action: 'approve', token: 'unchanged-confirmation-token', correlationId: 'correlation-a' },
}).attachments[0].content;
const untouched = JSON.stringify(confirmation);
const confirmed = renderCard({ card: confirmation, kind: 'approval', scope, identity, actionGrants: grants(confirmation) });
assert.equal(confirmed.status, 'faithful');
assert.deepEqual(confirmed.card, confirmation, 'native Channels codec preserves canonical 1.6 card and action data');
assert.deepEqual(confirmed.identity, identity);
assert.deepEqual(submits(confirmed.card).map(action => action.data), submits(confirmation).map(action => action.data));
assert.equal(JSON.stringify(confirmation), untouched, 'canonical input remains untouched');
assert.equal(confirmed.contract.crossPlatformVersion, '1.5');
assert.equal(confirmed.contract.deliveredVersion, '1.6');
assert.equal(confirmed.contract.callbackRegistryUsed, false);
for (const name of ['channels-teams', 'channels-ui']) {
  const installed = JSON.parse(readFileSync(new URL(`../node_modules/@copilotkit/${name}/package.json`, import.meta.url), 'utf8'));
  assert.equal(installed.version, confirmed.contract.packageVersion, 'installed renderer contract remains pinned');
  assert.equal(installed.license, confirmed.contract.license);
}
assert.doesNotMatch(JSON.stringify(confirmed.card), /ckActionId|channels_action|copilotkit-channels-shadow/);
assert.doesNotMatch(confirmed.plainText, /unchanged-confirmation-token|correlation-a|tenant-a|owner-a/);

for (const status of ['awaiting_approval', 'completed', 'failed', 'input_required'] as const) {
  const canonical = createCoreOrchestrationJobActivity({ ...job, status,
    ...(status === 'completed' ? { result: '완료 결과' } : {}),
    ...(status === 'failed' ? { error: '도구 실패: 새 승인 후 다시 시도하세요.' } : {}),
  }, { openTabUrl: 'https://example.com/workspace' }).attachments[0].content;
  const output = renderCard({ card: canonical, kind: status === 'failed' ? 'error' : status === 'awaiting_approval' ? 'approval' : 'result',
    scope, identity, actionGrants: grants(canonical) });
  assert.deepEqual(output.card, canonical, `${status}: exact native and Channels card parity`);
  assert.equal(output.status, 'faithful');
  for (const action of output.card.actions ?? []) {
    if (action.card) assert.equal(action.card.version, '1.6', 'nested ShowCard version is retained');
  }
}

for (const overrides of [
  { actionGrants: [] },
  { actionGrants: grants(confirmation).map(grant => ({ ...grant, scope: { ...scope, tenantId: 'tenant-b' } })) },
  { actionGrants: grants(confirmation).map(grant => ({ ...grant, scope: { ...scope, requesterId: 'other-user' } })) },
  { actionGrants: grants(confirmation).map(grant => ({ ...grant, scope: { ...scope, conversationId: 'other-thread' } })) },
  { actionGrants: grants(confirmation).map(grant => ({ ...grant, identity: { ...identity, requestId: 'other-request' } })) },
  { actionGrants: grants(confirmation).map(grant => ({ ...grant, identity: { ...identity, approvalId: 'other-approval' } })) },
  { actionGrants: grants(confirmation).map(grant => ({ ...grant, data: { ...grant.data, confirmationToken: 'other-token' } })) },
]) {
  const denied = renderCard({ card: confirmation, kind: 'approval', scope, identity, actionGrants: grants(confirmation), ...overrides });
  assert.equal(submits(denied.card).length, 0, 'ungranted, changed, or cross-scope submit is excluded');
  assert.equal(denied.status, 'fallback');
}
const wrongJob = { ...confirmation, actions: [{ type: 'Action.Submit', title: '승인', data: {
  ...submits(confirmation)[0].data, jobId: 'wrong-job', requestId: 'other-request', approvalId: 'other-approval',
} }] };
assert.equal(submits(renderCard({ card: wrongJob, kind: 'approval', scope, identity, actionGrants: grants(wrongJob) }).card).length, 0,
  'a grant cannot bind another job/request/approval to this renderer identity');

const styled = { ...confirmation, actions: confirmation.actions!.map((action, index) => ({
  ...action, style: index === 0 ? 'positive' : 'destructive', isEnabled: false,
})) };
const styleOutput = renderCard({ card: styled, kind: 'approval', scope, identity, actionGrants: grants(styled) });
assert.doesNotMatch(JSON.stringify(styleOutput.card), /positive|destructive|isEnabled/);
assert.deepEqual(submits(styleOutput.card).map(action => action.data), submits(confirmation).map(action => action.data));

const richer = { ...confirmation, body: [
  ...confirmation.body,
  { type: 'Table', rows: [{ cells: [{ items: [{ type: 'TextBlock', text: '핵심 표 결과' }] }] }] },
  { type: 'Chart.VerticalBar', title: '측정값', data: [{ x: '합성 항목', y: 7 }] },
  { type: 'Image', altText: '합성 결과 이미지', url: 'https://example.com/image.png' },
], actions: [ ...confirmation.actions!, { type: 'Action.OpenUrl', title: '결과물', url: 'https://example.com/result' },
  { type: 'Action.OpenUrl', title: '위험 링크', url: 'javascript:alert(1)' },
] };
const fallback = renderCard({ card: richer, kind: 'result', scope, identity, actionGrants: grants(richer) });
assert.equal(fallback.status, 'fallback');
assert.ok(fallback.plainText.includes('핵심 표 결과'));
assert.ok(fallback.plainText.includes('합성 항목: 7'));
assert.ok(fallback.plainText.includes('https://example.com/result'));
assert.doesNotMatch(JSON.stringify(fallback.card), /Chart\.|"Table"|"Image"|javascript:/);
assert.equal(fallback.card.version, '1.6');
assert.equal(JSON.stringify(confirmation), untouched);

const universal = { ...confirmation, actions: [{ type: 'Action.Execute', title: '승인', verb: 'orchestration.approve',
  data: submits(confirmation)[0].data, fallback: submits(confirmation)[0] }] };
const universalOutput = renderCard({ card: universal, kind: 'approval', scope, identity,
  actionGrants: grants(confirmation) });
assert.equal(universalOutput.status, 'fallback');
assert.equal(universalOutput.card.actions[0].type, 'Action.Submit');
assert.deepEqual(universalOutput.card.actions[0].data, submits(confirmation)[0].data);
const registry = { ...confirmation, actions: [{ ...submits(confirmation)[0], data: {
  ...submits(confirmation)[0].data, ckActionId: 'another-protocol',
} }] };
assert.equal(submits(renderCard({ card: registry, kind: 'approval', scope, identity, actionGrants: grants(registry) }).card).length, 0,
  'caller grants cannot enable a Channels callback registry or foreign submit protocol');

const collision = { ...confirmation, body: [...confirmation.body, { type: 'Input.Text', id: 'jobId', label: '잘못된 입력' }] };
assert.equal(submits(renderCard({ card: collision, kind: 'approval', scope, identity, actionGrants: grants(collision) }).card).length, 0,
  'input fields cannot overwrite the canonical action identity');
const duplicateInput = { ...confirmation, body: [ { type: 'Input.Text', id: 'input' }, { type: 'Input.Text', id: 'input' } ] };
assert.equal(submits(renderCard({ card: duplicateInput, kind: 'approval', scope, identity, actionGrants: grants(duplicateInput) }).card).length, 0);

const drift = renderCard({ card: { ...confirmation, version: '1.7' }, kind: 'approval', scope, identity, actionGrants: grants(confirmation) });
assert.equal(drift.status, 'blocked');
assert.equal(drift.diagnostics.reason, 'CONTRACT_DRIFT_BLOCKED');
assert.equal(submits(drift.card).length, 0);
const giant = { ...confirmation, actions: [{ type: 'Action.Submit', title: '승인', data: {
  ...submits(confirmation)[0].data, confirmationToken: 'token'.repeat(10_000),
} }] };
const tooLarge = renderCard({ card: giant, kind: 'approval', scope, identity, actionGrants: grants(giant) });
assert.equal(tooLarge.status, 'blocked');
assert.equal(submits(tooLarge.card).length, 0, 'oversize opaque action data is never truncated into another usable grant');
assert.ok(tooLarge.payloadBytes <= 28 * 1024);
assert.throws(() => renderCard({ card: confirmation, kind: 'approval', scope: { ...scope, tenantId: '' }, identity, actionGrants: grants(confirmation) }), /CHANNELS_CORE_CONTRACT_INVALID/);
console.log('Channels native renderer contract tests passed: canonical approval/result/error/input parity, scoped grants, identity, conservative fallback, immutable source, and version/budget boundaries.');
