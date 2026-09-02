import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  coreOrchestrationCommandHelp,
  parseCoreOrchestrationChatCommand,
} from '../src/server/response-engine-deterministic.js';
import {
  createCoreOrchestrationJobActivity,
  createCoreOrchestrationListActivity,
} from '../src/server/genui-response.js';
import type {
  CoreOrchestrationJob,
  CoreProviderFact,
} from '../src/shared/core-orchestration.js';

const job = (status: CoreOrchestrationJob['status']): CoreOrchestrationJob => ({
  id: 'job-durable-42',
  idempotencyKey: 'teams-activity-v1:activity-42',
  prompt: '저장소 상태를 점검해줘',
  mode: 'read-only',
  provider: 'codex',
  status,
  progress: ['작업을 접수했습니다.'],
  createdAt: '2026-09-03T00:00:00.000Z',
});

assert.deepEqual(parseCoreOrchestrationChatCommand('agent run 저장소 상태를 점검해줘'), {
  kind: 'submit',
  mode: 'read-only',
  prompt: '저장소 상태를 점검해줘',
});
assert.deepEqual(parseCoreOrchestrationChatCommand('에이전트 write README를 수정해줘'), {
  kind: 'submit',
  mode: 'workspace-write',
  prompt: 'README를 수정해줘',
});
assert.deepEqual(parseCoreOrchestrationChatCommand('agent status job-durable-42'), {
  kind: 'status',
  jobId: 'job-durable-42',
});
assert.deepEqual(parseCoreOrchestrationChatCommand('agent list'), { kind: 'list' });
assert.deepEqual(parseCoreOrchestrationChatCommand('agent cancel job-durable-42'), {
  kind: 'cancel',
  jobId: 'job-durable-42',
});
assert.deepEqual(parseCoreOrchestrationChatCommand('agent approve job-durable-42'), {
  kind: 'approve',
  jobId: 'job-durable-42',
});
assert.deepEqual(parseCoreOrchestrationChatCommand('agent retry job-durable-42'), {
  kind: 'retry',
  jobId: 'job-durable-42',
});
assert.deepEqual(parseCoreOrchestrationChatCommand('agent input job-durable-42 서울로 조회해줘'), {
  kind: 'provide-input',
  jobId: 'job-durable-42',
  input: '서울로 조회해줘',
});
assert.equal(parseCoreOrchestrationChatCommand('agent run'), undefined, 'empty submissions are rejected');
assert.equal(parseCoreOrchestrationChatCommand('agent status'), undefined, 'job commands require a durable job ID');
assert.equal(parseCoreOrchestrationChatCommand('status'), undefined, 'legacy status remains outside the orchestration namespace');
assert.match(coreOrchestrationCommandHelp(), /agent input <작업 ID> <입력>/);

type AdaptiveCard = {
  type?: string;
  version?: string;
  body?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
};

function cardFrom(activity: ReturnType<typeof createCoreOrchestrationJobActivity>): AdaptiveCard {
  assert.equal(activity.type, 'message');
  assert.equal('text' in activity, false, 'Core orchestration Teams activities must be attachment-only');
  assert.equal(activity.attachments?.length, 1);
  const card = activity.attachments?.[0]?.content as AdaptiveCard | undefined;
  assert.equal(card?.type, 'AdaptiveCard');
  assert.equal(card?.version, '1.2');
  return card ?? {};
}

function actionPayloads(card: AdaptiveCard): Array<Record<string, unknown>> {
  return (card.actions ?? []).map((action) => {
    const showCard = action.card as AdaptiveCard | undefined;
    const nestedAction = showCard?.actions?.[0];
    return (action.data ?? nestedAction?.data ?? {}) as Record<string, unknown>;
  });
}

for (const [status, expectedActions] of [
  ['queued', ['orchestration.confirm-cancel']],
  ['running', ['orchestration.confirm-cancel']],
  ['awaiting_approval', ['orchestration.confirm-approve', 'orchestration.confirm-cancel']],
  ['failed', ['orchestration.retry']],
  ['completed', []],
  ['cancelled', []],
] as const) {
  const card = cardFrom(createCoreOrchestrationJobActivity(job(status)));
  assert.deepEqual(
    actionPayloads(card).map((payload) => payload.action),
    expectedActions,
    `${status} exposes only valid lifecycle actions`,
  );
  assert.ok(actionPayloads(card).every((payload) => payload.jobId === 'job-durable-42'));
}

const inputCard = cardFrom(createCoreOrchestrationJobActivity(job('input_required')));
const inputAction = inputCard.actions?.[0];
assert.equal(inputAction?.type, 'Action.ShowCard');
const inputForm = inputAction?.card as AdaptiveCard | undefined;
assert.ok(inputForm?.body?.some((element) => element.type === 'Input.Text' && element.id === 'input'));
assert.deepEqual(inputForm?.actions?.[0]?.data, {
  schemaVersion: '1',
  action: 'orchestration.provide-input',
  jobId: 'job-durable-42',
});

const providers: CoreProviderFact[] = [{
  provider: 'codex',
  availability: 'unknown',
  capabilities: [],
  observedAt: '2026-09-03T00:00:00.000Z',
  source: 'runtime-observation',
}];
const listActivity = createCoreOrchestrationListActivity([job('running')], providers);
const listCard = cardFrom(listActivity);
assert.match(JSON.stringify(listCard), /job-durable-42/);
assert.match(JSON.stringify(listCard), /unknown/);
assert.doesNotMatch(JSON.stringify(listCard), /provider.*available/i, 'unknown providers are not promoted to live availability');

const manifest = JSON.parse(await readFile(new URL('../appPackage/manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, '1.0.100');
const commands = manifest.bots[0].commandLists[0].commands.map((command: { title: string }) => command.title);
for (const command of ['agent run', 'agent status', 'agent list', 'agent cancel', 'agent approve', 'agent retry', 'agent input']) {
  assert.ok(commands.includes(command), `manifest discovers ${command}`);
}

console.log('core-orchestration-chat-card-test: PASS');
