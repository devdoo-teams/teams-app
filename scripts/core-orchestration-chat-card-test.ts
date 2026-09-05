import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  coreOrchestrationCommandHelp,
  parseCoreOrchestrationChatCommand,
} from '../src/server/response-engine-deterministic.js';
import {
  createCoreOrchestrationConfirmationActivity,
  createCoreOrchestrationJobActivity,
  createCoreOrchestrationListActivity,
  createCoreOrchestrationModelSelectionActivity,
  createCoreOrchestrationReasoningSelectionActivity,
  type CoreOrchestrationTeamsActivity,
} from '../src/server/genui-response.js';
import { parseCodexModelCatalogPayload } from '../src/server/codex-model-catalog.js';
import type {
  CoreCodexModelCatalog,
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
  tools: [
    { category: 'cli', name: 'rg', observedAt: '2026-09-03T00:01:00.000Z' },
    { category: 'skill', name: 'systematic-debugging', observedAt: '2026-09-03T00:02:00.000Z' },
  ],
  model: 'gpt-5.6-sol',
  reasoningEffort: 'high',
  catalogRevision: 'a'.repeat(64),
  tokenUsage: {
    source: 'codex.exec.jsonl.turn.completed.usage',
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningOutputTokens: 10,
  },
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
assert.deepEqual(parseCoreOrchestrationChatCommand('agent choose 저장소를 깊게 점검해줘'), {
  kind: 'select-submit',
  mode: 'read-only',
  prompt: '저장소를 깊게 점검해줘',
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

function cardFrom(activity: CoreOrchestrationTeamsActivity): AdaptiveCard {
  assert.equal(activity.type, 'message');
  assert.equal('text' in activity, false, 'Core orchestration Teams activities must be attachment-only');
  assert.equal(activity.attachments?.length, 1);
  const card = activity.attachments?.[0]?.content as AdaptiveCard | undefined;
  assert.equal(card?.type, 'AdaptiveCard');
  assert.equal(card?.version, '1.6', 'canonical Microsoft Teams documentation supports mobile through 1.6');
  return card ?? {};
}

function actionPayloads(card: AdaptiveCard): Array<Record<string, unknown>> {
  return (card.actions ?? []).map((action) => {
    const showCard = action.card as AdaptiveCard | undefined;
    const nestedAction = showCard?.actions?.[0];
    return (action.data ?? nestedAction?.data ?? {}) as Record<string, unknown>;
  });
}

const tabUrl = 'https://teams.microsoft.com/l/entity/00000000-0000-4000-8000-000000000000/home?webUrl=https%3A%2F%2Fexample.contoso.com%2Ftabs%2Fhome%2F';

for (const [status, expectedActions] of [
  ['queued', ['orchestration.confirm-cancel']],
  ['running', ['orchestration.confirm-cancel']],
  ['awaiting_approval', ['orchestration.confirm-approve', 'orchestration.confirm-cancel']],
  ['failed', ['orchestration.retry']],
  ['completed', []],
  ['cancelled', []],
] as const) {
  const card = cardFrom(createCoreOrchestrationJobActivity(job(status), { openTabUrl: tabUrl }));
  const commandPayloads = actionPayloads(card).filter((payload) => typeof payload.action === 'string');
  assert.deepEqual(
    commandPayloads.map((payload) => payload.action),
    expectedActions,
    `${status} exposes only valid lifecycle actions`,
  );
  assert.ok(commandPayloads.every((payload) => payload.jobId === 'job-durable-42'));
  assert.ok(
    (card.actions ?? []).every((action) => action.style === undefined),
    `${status} omits positive/destructive styling unsupported by Teams`,
  );
  assert.equal(card.actions?.at(-1)?.type, 'Action.OpenUrl', `${status} exposes the 업무 허브 tab link`);
  assert.equal(card.actions?.at(-1)?.url, tabUrl);
}

const inputCard = cardFrom(createCoreOrchestrationJobActivity(job('input_required'), { openTabUrl: tabUrl }));
const inputAction = inputCard.actions?.[0];
assert.equal(inputAction?.type, 'Action.ShowCard');
const inputForm = inputAction?.card as AdaptiveCard | undefined;
assert.ok(inputForm?.body?.some((element) => element.type === 'Input.Text' && element.id === 'input'));
assert.deepEqual(inputForm?.actions?.[0]?.data, {
  schemaVersion: '1',
  action: 'orchestration.provide-input',
  jobId: 'job-durable-42',
});
assert.equal(inputCard.actions?.at(-1)?.type, 'Action.OpenUrl');
assert.equal(inputCard.actions?.at(-1)?.url, tabUrl);

const detailCard = cardFrom(createCoreOrchestrationJobActivity(job('running'), { openTabUrl: tabUrl }));
const jobCardJson = JSON.stringify(detailCard);
assert.match(jobCardJson, /gpt-5\.6-sol/);
assert.match(jobCardJson, /high/);
assert.match(jobCardJson, /100/);
assert.match(jobCardJson, /30/);
assert.match(jobCardJson, /잔여.*제공되지 않음/);
const detailAction = detailCard.actions?.find((action) => action.type === 'Action.ShowCard' && action.title === '프롬프트·도구');
assert.ok(detailAction, 'every job card exposes progressive prompt and observed-tool details');
const detailJson = JSON.stringify(detailAction?.card);
assert.match(detailJson, /저장소 상태를 점검해줘/);
assert.match(detailJson, /systematic-debugging/);
assert.match(detailJson, /CLI · rg/);
assert.doesNotMatch(detailJson, /command|arguments|secret|token/iu, 'the card never exposes raw commands, arguments, or secrets');

const copilotCard = cardFrom(createCoreOrchestrationJobActivity({
  ...job('running'),
  provider: 'copilot',
  model: undefined,
  reasoningEffort: undefined,
  catalogRevision: undefined,
  tokenUsage: undefined,
}, { openTabUrl: tabUrl }));
assert.doesNotMatch(
  JSON.stringify(copilotCard),
  /Codex CLI 기본값|계정 잔여량/u,
  'non-Codex jobs must not display Codex-specific model or quota labels',
);

const longJob = {
  ...job('running'),
  prompt: 'p'.repeat(2_000),
  progress: ['d'.repeat(2_000)],
};
const longCard = cardFrom(createCoreOrchestrationJobActivity(longJob, { openTabUrl: tabUrl }));
for (const element of longCard.body ?? []) {
  if (element.type === 'TextBlock' && typeof element.text === 'string') {
    assert.ok(element.text.length <= 400, 'chat card text stays a short summary');
  }
}

const confirmationCard = cardFrom(createCoreOrchestrationConfirmationActivity(job('awaiting_approval'), 'approve', {
  openTabUrl: tabUrl,
  confirmation: {
    action: 'approve',
    token: 'chat-card-confirmation-token',
    correlationId: 'chat-card-confirmation-correlation',
  },
}));
assert.equal(confirmationCard.actions?.[0]?.data?.action, 'orchestration.approve');
assert.equal(confirmationCard.actions?.[0]?.data?.confirmationToken, 'chat-card-confirmation-token');
assert.equal(confirmationCard.actions?.[0]?.data?.correlationId, 'chat-card-confirmation-correlation');
assert.equal(confirmationCard.actions?.at(-1)?.type, 'Action.OpenUrl');
assert.equal(confirmationCard.actions?.at(-1)?.url, tabUrl);

const providers: CoreProviderFact[] = [{
  provider: 'codex',
  availability: 'unknown',
  capabilities: [],
  observedAt: '2026-09-03T00:00:00.000Z',
  source: 'runtime-observation',
}];
const listActivity = createCoreOrchestrationListActivity([job('running')], providers, { openTabUrl: tabUrl });
const listCard = cardFrom(listActivity);
assert.match(JSON.stringify(listCard), /job-durable-42/);
assert.match(JSON.stringify(listCard), /unknown/);
assert.doesNotMatch(JSON.stringify(listCard), /provider.*available/i, 'unknown providers are not promoted to live availability');
assert.equal(listCard.actions?.at(-1)?.type, 'Action.OpenUrl');
assert.equal(listCard.actions?.at(-1)?.url, tabUrl);

const copilotListCard = cardFrom(createCoreOrchestrationListActivity([{
  ...job('running'),
  provider: 'copilot',
  model: undefined,
  reasoningEffort: undefined,
  catalogRevision: undefined,
  tokenUsage: undefined,
}], providers));
assert.doesNotMatch(
  JSON.stringify(copilotListCard),
  /CLI 기본 모델|CLI 기본 추론|tokens/u,
  'non-Codex list rows must not imply Codex model or token telemetry',
);

const catalog: CoreCodexModelCatalog = parseCodexModelCatalogPayload({
  models: [{
    slug: 'gpt-5.6-sol',
    display_name: 'GPT-5.6-Sol',
    visibility: 'list',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
  }],
}, '2026-09-05T06:00:00.000Z');
const modelCard = cardFrom(createCoreOrchestrationModelSelectionActivity({
  prompt: '저장소를 점검해줘',
  mode: 'read-only',
  catalog,
  submissionKey: '11111111-1111-4111-8111-111111111111',
}, { openTabUrl: tabUrl }));
const modelInput = modelCard.body?.find((element) => element.type === 'Input.ChoiceSet');
assert.equal(modelInput?.id, 'model');
assert.deepEqual(modelInput?.choices, [{ title: 'GPT-5.6-Sol', value: 'gpt-5.6-sol' }]);
assert.equal(modelCard.actions?.[0]?.data?.action, 'orchestration.select-model');
assert.equal(modelCard.actions?.[0]?.data?.catalogRevision, catalog.revision);

const reasoningCard = cardFrom(createCoreOrchestrationReasoningSelectionActivity({
  prompt: '저장소를 점검해줘',
  mode: 'read-only',
  catalog,
  model: 'gpt-5.6-sol',
  submissionKey: '11111111-1111-4111-8111-111111111111',
}, { openTabUrl: tabUrl }));
const reasoningInput = reasoningCard.body?.find((element) => element.type === 'Input.ChoiceSet');
assert.equal(reasoningInput?.id, 'reasoningEffort');
assert.deepEqual(reasoningInput?.choices, [
  { title: 'low', value: 'low' },
  { title: 'high', value: 'high' },
]);
assert.equal(reasoningCard.actions?.[0]?.data?.action, 'orchestration.submit-selected');
assert.equal(reasoningCard.actions?.[0]?.data?.model, 'gpt-5.6-sol');

const manifest = JSON.parse(await readFile(new URL('../appPackage/manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, '1.0.100');
const commands = manifest.bots[0].commandLists[0].commands.map((command: { title: string }) => command.title);
for (const command of ['agent run', 'agent write', 'agent choose', 'agent status', 'agent list', 'agent cancel', 'agent approve', 'agent retry', 'agent input']) {
  assert.ok(commands.includes(command), `manifest discovers ${command}`);
}

console.log('core-orchestration-chat-card-test: PASS');
