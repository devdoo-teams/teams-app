import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentJob, AgentJobScope } from '../src/server/agent-job-store.js';
import type { AgentService } from '../src/server/agent-service.js';
import { ItemStore } from '../src/server/item-store.js';
import { DeterministicResponseEngine } from '../src/server/response-engine-deterministic.js';
import type { ResponseEngineInput } from '../src/server/response-engine.js';
import { GenUiEnvelopeV1Schema } from '../src/shared/genui.js';

const scope: AgentJobScope = {
  requesterId: 'test-user',
  conversationId: 'test-thread',
  tenantId: 'test-tenant',
};

function job(
  status: AgentJob['status'] = 'completed',
  prompt = '저장소를 분석해줘',
  result = '테스트 작업이 완료되었습니다.',
): AgentJob {
  return {
    id: 'job-test-1',
    prompt,
    mode: 'read-only',
    status,
    scope,
    progress: [],
    result,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    startedAt: '2026-08-07T00:00:00.000Z',
    finishedAt: '2026-08-07T00:00:01.000Z',
  };
}

type AgentServiceFakeTrace = {
  submissions: Array<{ notify?: boolean; prompt: string }>;
  continuations: Array<{ notify?: boolean; prompt: string }>;
  waitForTerminalCalls: number;
};

function createAgentServiceFake(
  terminalJob = job(),
  previous?: AgentJob,
  trace: AgentServiceFakeTrace = { submissions: [], continuations: [], waitForTerminalCalls: 0 },
): AgentService {
  const submitted: AgentJob[] = [];
  const service = {
    countActive: () => 0,
    list: () => submitted.slice(),
    latestCompletedForConversation: () => previous,
    submit: async (input: { prompt: string; mode: AgentJob['mode']; scope: AgentJobScope; notify?: boolean }) => {
      trace.submissions.push({ notify: input.notify, prompt: input.prompt });
      const created = { ...job(input.mode === 'workspace-write' ? 'awaiting_approval' : 'running', input.prompt), mode: input.mode };
      submitted.push(created);
      return created;
    },
    continue: async (_id: string, prompt: string, _scope: AgentJobScope, options: { notify?: boolean } = {}) => {
      trace.continuations.push({ notify: options.notify, prompt });
      return previous ? terminalJob : undefined;
    },
    waitForTerminal: async () => {
      trace.waitForTerminalCalls += 1;
      return terminalJob;
    },
  } as unknown as AgentService;
  return service;
}

async function createInput(
  itemStore: ItemStore,
  agentService: AgentService,
  prompt: string,
  context: ResponseEngineInput['request']['context'] = [],
  onTool: ResponseEngineInput['onTool'] = () => undefined,
  approvalEnvelope?: ResponseEngineInput['approvalEnvelope'],
  onText: ResponseEngineInput['onText'],
): Promise<ResponseEngineInput> {
  return {
    mode: 'deterministic',
    prompt,
    scope,
    itemStore,
    agentService,
    request: {
      threadId: scope.conversationId,
      runId: 'run-test-1',
      messages: [{ id: 'message-1', role: 'user', content: prompt }],
      context,
    } as ResponseEngineInput['request'],
    onTool,
    onText,
    setActiveJobId: () => undefined,
    isCancelled: () => false,
    approvalEnvelope,
  };
}

async function main(): Promise<void> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'teams-response-engine-'));
  const itemStore = new ItemStore(join(dataDirectory, 'items.json'));
  await itemStore.initialize();
  const agentService = createAgentServiceFake();
  const engine = new DeterministicResponseEngine();

  try {
    const help = await engine.run(await createInput(itemStore, agentService, 'help'));
    assert.equal(help.envelope.kind, 'answer');
    assert.equal(help.envelope.aiGenerated, false);
    assert.match(help.text, /업무 허브 명령/);
    assert.doesNotMatch(help.text, /CopilotKit/);

    const list = await engine.run(await createInput(itemStore, agentService, 'list'));
    assert.equal(list.envelope.kind, 'task-list');
    assert.equal(list.envelope.aiGenerated, false);
    assert.equal(list.toolCalls[0]?.name, 'showTaskCard');
    assert.match(list.text, /첫 번째 업무 항목 만들기/);

    const status = await engine.run(await createInput(itemStore, agentService, 'status'));
    assert.equal(status.envelope.kind, 'job-status');
    assert.equal(status.envelope.aiGenerated, false);
    assert.match(status.text, /활성 Codex 작업/);

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('deterministic weather must not call a provider');
    }) as typeof fetch;
    try {
      const weather = await engine.run(await createInput(itemStore, agentService, 'weather'));
      assert.equal(weather.envelope.kind, 'answer');
      assert.equal(weather.envelope.aiGenerated, false);
      assert.equal(weather.toolCalls.length, 0, 'deterministic no-location weather must not call a demo provider');
      assert.match(weather.text, /내 위치 사용|위치를 추측하지 않습니다/);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetchCalled, false);

    const liveWeather = await engine.run(await createInput(
      itemStore,
      agentService,
      'weather',
      [{ description: '날씨 컨텍스트', value: JSON.stringify({
        source: 'open-meteo',
        location: { name: '서울', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' },
        current: {
          time: '2026-08-08T00:00:00Z', temperature: 25, apparentTemperature: 26,
          humidity: 60, windSpeed: 8, precipitation: 0, condition: '맑음', icon: 'sun',
        },
      }) }],
    ));
    assert.equal(liveWeather.envelope.kind, 'weather');
    assert.equal(liveWeather.toolCalls[0]?.name, 'showWeatherCard');

    const approvalEnvelope = (createdJob: AgentJob) => GenUiEnvelopeV1Schema.parse({
      schemaVersion: '1',
      kind: 'approval',
      status: 'approval',
      id: createdJob.id,
      correlationId: 'deterministic-approval-correlation',
      title: '쓰기 작업 승인 필요',
      summary: '승인 필요',
      sections: [{ type: 'status', title: '승인 경계', status: 'awaiting_approval' }],
      actions: [
        { action: 'approve', label: '승인', entityId: createdJob.id, correlationId: 'deterministic-approval-correlation', actionToken: 'a'.repeat(32), style: 'positive' },
        { action: 'cancel', label: '취소', entityId: createdJob.id, correlationId: 'deterministic-approval-correlation', actionToken: 'b'.repeat(32), style: 'destructive' },
      ],
      citations: [],
      aiGenerated: false,
      fallbackText: '승인 필요',
      metadata: { source: 'test' },
    });

    const approvalTools: string[] = [];
    const write = await engine.run(await createInput(itemStore, agentService, 'write 설정 파일을 수정해줘', [], (tool) => {
      approvalTools.push(tool.name);
    }, approvalEnvelope));
    assert.equal(write.envelope.kind, 'approval');
    assert.equal(write.envelope.aiGenerated, false);
    assert.equal(write.envelope.actions.length, 2, 'host approval factory supplies approve/cancel actions');
    assert.deepEqual(approvalTools, ['workspaceApproval']);

    const naturalTrace: AgentServiceFakeTrace = { submissions: [], continuations: [], waitForTerminalCalls: 0 };
    const natural = await engine.run(await createInput(
      itemStore,
      createAgentServiceFake(job('completed'), undefined, naturalTrace),
      '저장소를 분석해줘',
    ));
    assert.equal(naturalTrace.waitForTerminalCalls, 0, 'natural-language requests do not wait for terminal state before acknowledging');
    assert.equal(naturalTrace.submissions[0]?.notify, true, 'natural-language requests enable same-conversation notifications');
    assert.equal(natural.envelope.kind, 'job-status');
    assert.equal(natural.envelope.status, 'loading');
    assert.match(natural.text, /작업 job-test-1을 시작했습니다/);

    const botTrace: AgentServiceFakeTrace = { submissions: [], continuations: [], waitForTerminalCalls: 0 };
    const botResponse = await engine.run(await createInput(
      itemStore,
      createAgentServiceFake(job('completed'), undefined, botTrace),
      'Bot no-stream request',
    ));
    assert.equal(botTrace.waitForTerminalCalls, 0, 'Bot requests without onText acknowledge without waiting for terminal state');
    assert.equal(botTrace.submissions[0]?.notify, true, 'Bot requests enable same-conversation proactive notifications');
    assert.equal(botResponse.envelope.status, 'loading');

    const agUiTrace: AgentServiceFakeTrace = { submissions: [], continuations: [], waitForTerminalCalls: 0 };
    const agUiText: string[] = [];
    const agUiResponse = await engine.run(await createInput(
      itemStore,
      createAgentServiceFake(job('completed'), undefined, agUiTrace),
      'AG-UI streamed request',
      [],
      () => undefined,
      undefined,
      (text) => { agUiText.push(text); },
    ));
    assert.equal(agUiTrace.waitForTerminalCalls, 1, 'AG-UI requests with onText wait for terminal state');
    assert.equal(agUiResponse.envelope.status, 'complete');
    assert.ok(agUiText.length === 0, 'terminal-only fake runner does not invent streamed text');

    const missingResultResponse = await engine.run(await createInput(
      itemStore,
      createAgentServiceFake(job('completed', 'missing result', ''), undefined, { submissions: [], continuations: [], waitForTerminalCalls: 0 }),
      'missing result request',
      [],
      () => undefined,
      undefined,
      () => undefined,
    ));
    assert.equal(missingResultResponse.envelope.status, 'error', 'a completed Codex job without a result cannot render as complete');
    assert.match(missingResultResponse.text, /결과가 없어|실패|추가 확인/, 'missing terminal result explains why completion is withheld');

    const failedResponse = await engine.run(await createInput(
      itemStore,
      createAgentServiceFake(job('failed', 'failed request'), undefined, { submissions: [], continuations: [], waitForTerminalCalls: 0 }),
      'failed envelope request',
      [],
      () => undefined,
      undefined,
      () => undefined,
    ));
    assert.equal(failedResponse.envelope.kind, 'job-status');
    assert.equal(failedResponse.envelope.status, 'error', 'failed terminal jobs preserve the error envelope');

    const runningResponse = await engine.run(await createInput(
      itemStore,
      createAgentServiceFake(job('running', 'running request')),
      'running envelope request',
    ));
    assert.equal(runningResponse.envelope.kind, 'job-status');
    assert.equal(runningResponse.envelope.status, 'loading', 'running jobs preserve the immediate loading envelope');

    const oversizedResponse = await engine.run(await createInput(
      itemStore,
      createAgentServiceFake(job('completed', 'oversized request', '결과 '.repeat(2_000))),
      'oversized envelope request',
      [],
      () => undefined,
      undefined,
      () => undefined,
    ));
    assert.equal(oversizedResponse.envelope.kind, 'job-status');
    assert.equal(oversizedResponse.envelope.status, 'complete');
    assert.ok(oversizedResponse.text.length <= 4_000, 'oversized terminal results use the bounded fallback envelope');

    const previous = job('completed', '이전 요청');
    const continuedTrace: AgentServiceFakeTrace = { submissions: [], continuations: [], waitForTerminalCalls: 0 };
    const continued = await engine.run(await createInput(
      itemStore,
      createAgentServiceFake(job('completed', '후속 요청'), previous, continuedTrace),
      '같은 대화에서 이어서 확인해줘',
    ));
    assert.match(continued.text, /이전 Codex 대화를 이어서/);
    assert.equal(continuedTrace.continuations[0]?.notify, true, 'continued natural-language requests enable same-conversation notifications');

    console.log('deterministic response engine tests passed');
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

await main();
