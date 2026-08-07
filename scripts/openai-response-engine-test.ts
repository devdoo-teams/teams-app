import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentJobScope } from '../src/server/agent-job-store.js';
import type { AgentService } from '../src/server/agent-service.js';
import { ItemStore } from '../src/server/item-store.js';
import { OpenAIResponseEngine } from '../src/server/response-engine-openai.js';
import type { ResponseEngineInput } from '../src/server/response-engine.js';

const scope: AgentJobScope = {
  requesterId: 'openai-test-user',
  conversationId: 'openai-test-thread',
  tenantId: 'openai-test-tenant',
};

type FakeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type FakeAgentService = AgentService & {
  submitted: Array<{ prompt: string; mode: string }>;
};

function createAgentServiceFake(): FakeAgentService {
  const submitted: Array<{ prompt: string; mode: string }> = [];
  return {
    submitted,
    countActive: () => 0,
    list: () => [],
    latestCompletedForConversation: () => undefined,
    submit: async (input: { prompt: string; mode: string }) => {
      submitted.push(input);
      return {
        id: 'task-openai-approval',
        prompt: input.prompt,
        mode: input.mode,
        status: 'awaiting_approval',
        scope,
        progress: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
    },
  } as unknown as FakeAgentService;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function queueFetch(responses: Array<Response | Error | 'timeout'>): {
  fetch: FakeFetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let index = 0;
  const fetch: FakeFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const next = responses[index++];
    if (next === 'timeout') {
      await new Promise<never>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    }
    if (next instanceof Error) throw next;
    if (!next) throw new Error('unexpected fake fetch call');
    return next;
  };
  return { fetch, calls };
}

function toolResponse(name: string, args = '{}'): Response {
  return toolCallsResponse([{ name, args }]);
}

function toolCallsResponse(calls: Array<{ name: string; args?: string }>): Response {
  return response({
    choices: [{
      message: {
        content: null,
        tool_calls: calls.map((call, index) => ({
          id: `call-${call.name}-${index}`,
          type: 'function',
          function: { name: call.name, arguments: call.args ?? '{}' },
        })),
      },
    }],
  });
}

function textResponse(text: string): Response {
  return response({ choices: [{ message: { content: text } }] });
}

async function createInput(
  itemStore: ItemStore,
  agentService: AgentService,
  prompt: string,
  context: ResponseEngineInput['request']['context'] = [],
  onTool: ResponseEngineInput['onTool'] = () => undefined,
): Promise<ResponseEngineInput> {
  return {
    mode: 'openai',
    prompt,
    scope,
    itemStore,
    agentService,
    request: {
      threadId: scope.conversationId,
      runId: 'run-openai-test',
      messages: [{ id: 'message-openai-test', role: 'user', content: prompt }],
      context,
    } as ResponseEngineInput['request'],
    onTool,
    onText: () => undefined,
    setActiveJobId: () => undefined,
    isCancelled: () => false,
  };
}

async function main(): Promise<void> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'teams-openai-response-engine-'));
  const itemStore = new ItemStore(join(dataDirectory, 'items.json'));
  await itemStore.initialize();
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  const originalBaseUrl = process.env.OPENAI_BASE_URL;

  try {
    delete process.env.OPENAI_API_KEY;
    const noKeyFetch = queueFetch([]);
    const noKey = await new OpenAIResponseEngine({ fetchImpl: noKeyFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(), '안녕하세요'));
    assert.equal(noKeyFetch.calls.length, 0, 'missing key must not call the provider');
    assert.equal(noKey.envelope.status, 'error');
    assert.equal(noKey.envelope.aiGenerated, false);
    assert.match(noKey.text, /OPENAI_API_KEY/);

    const plainFetch = queueFetch([textResponse('안전한 일반 답변입니다.')]);
    const plain = await new OpenAIResponseEngine({ apiKey: 'test-secret', fetchImpl: plainFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(), '간단히 답해줘'));
    assert.equal(plainFetch.calls.length, 1);
    assert.equal(plain.envelope.kind, 'answer');
    assert.equal(plain.envelope.aiGenerated, true);
    assert.equal(plain.text, '안전한 일반 답변입니다.');
    const plainRequest = JSON.parse(String(plainFetch.calls[0]?.init?.body));
    assert.equal(plainRequest.model, 'gpt-4o-mini');
    assert.equal(plainFetch.calls[0]?.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(plainFetch.calls[0]?.init?.headers && new Headers(plainFetch.calls[0]?.init?.headers).get('authorization'), 'Bearer test-secret');
    assert.ok(JSON.stringify(plain).indexOf('test-secret') === -1, 'provider secret must not enter output');

    const liveWeather = {
      source: 'open-meteo',
      location: { name: '서울', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' },
      current: {
        time: '2026-08-07T00:00:00Z', temperature: 25, apparentTemperature: 26,
        humidity: 60, windSpeed: 8, precipitation: 0, condition: '맑음', icon: 'sun',
      },
    };
    const weatherFetch = queueFetch([toolResponse('showWeatherCard'), textResponse('현재 위치 날씨를 확인했습니다.')]);
    const weatherTools: string[] = [];
    const weather = await new OpenAIResponseEngine({ apiKey: 'weather-secret', fetchImpl: weatherFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(), '현재 날씨 알려줘', [
        { description: '날씨 컨텍스트', value: JSON.stringify(liveWeather) },
      ], (tool) => weatherTools.push(tool.name)));
    assert.equal(weather.envelope.kind, 'weather');
    assert.equal(weather.envelope.aiGenerated, true);
    assert.deepEqual(weatherTools, ['showWeatherCard']);
    assert.equal(weatherFetch.calls.length, 2);
    const weatherFollowUpRequest = JSON.parse(String(weatherFetch.calls[1]?.init?.body));
    assert.equal(weatherFollowUpRequest.messages[0].role, 'system');

    const taskFetch = queueFetch([toolResponse('showTaskCard'), textResponse('업무 목록을 확인했습니다.')]);
    const taskTools: string[] = [];
    const task = await new OpenAIResponseEngine({ apiKey: 'task-secret', fetchImpl: taskFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(), '업무 목록 보여줘', [], (tool) => taskTools.push(tool.name)));
    assert.equal(task.envelope.kind, 'task-list');
    assert.equal(task.envelope.aiGenerated, true);
    assert.deepEqual(taskTools, ['showTaskCard']);

    const approvalService = createAgentServiceFake();
    const approvalFetch = queueFetch([
      toolResponse('workspaceApproval', JSON.stringify({ prompt: '설정 파일을 수정해줘' })),
      textResponse('승인 요청을 만들었습니다.'),
    ]);
    const approvalTools: string[] = [];
    const approval = await new OpenAIResponseEngine({ apiKey: 'approval-secret', fetchImpl: approvalFetch.fetch })
      .run(await createInput(itemStore, approvalService, '파일 변경을 해줘', [], (tool) => approvalTools.push(tool.name)));
    assert.equal(approval.envelope.kind, 'approval');
    assert.equal(approval.envelope.aiGenerated, true);
    assert.deepEqual(approvalTools, ['workspaceApproval']);
    assert.deepEqual(
      approvalService.submitted.map(({ prompt, mode }) => ({ prompt, mode })),
      [{ prompt: '설정 파일을 수정해줘', mode: 'workspace-write' }],
    );

    const partialService = createAgentServiceFake();
    const partialFetch = queueFetch([toolCallsResponse([
      { name: 'workspaceApproval', args: JSON.stringify({ prompt: '부분 실행 금지' }) },
      { name: 'deleteEverything' },
    ])]);
    const partial = await new OpenAIResponseEngine({ apiKey: 'partial-secret', fetchImpl: partialFetch.fetch })
      .run(await createInput(itemStore, partialService, '여러 도구를 호출해줘'));
    assert.equal(partial.envelope.kind, 'error');
    assert.equal(partialService.submitted.length, 0, 'invalid tool calls must be rejected before side effects');

    const missingWeatherFetch = queueFetch([toolResponse('showWeatherCard')]);
    const missingWeather = await new OpenAIResponseEngine({ apiKey: 'location-secret', fetchImpl: missingWeatherFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(), '현재 날씨 알려줘'));
    assert.equal(missingWeather.envelope.kind, 'error');
    assert.match(missingWeather.text, /현재 위치 날씨 컨텍스트/);

    for (const malformedArguments of ['{"unexpected":true}', '{not-json']) {
      const malformedFetch = queueFetch([toolResponse('showTaskCard', malformedArguments)]);
      const malformed = await new OpenAIResponseEngine({ apiKey: 'malformed-secret', fetchImpl: malformedFetch.fetch })
        .run(await createInput(itemStore, createAgentServiceFake(), '업무 목록'));
      assert.equal(malformedFetch.calls.length, 1);
      assert.equal(malformed.envelope.kind, 'error');
      assert.equal(malformed.envelope.aiGenerated, false);
    }

    const unknownFetch = queueFetch([toolResponse('deleteEverything')]);
    const unknown = await new OpenAIResponseEngine({ apiKey: 'unknown-secret', fetchImpl: unknownFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(), '이것저것 해줘'));
    assert.equal(unknown.envelope.kind, 'error');
    assert.equal(unknown.envelope.aiGenerated, false);

    const timeoutFetch = queueFetch(['timeout']);
    const timeout = await new OpenAIResponseEngine({ apiKey: 'timeout-secret', timeoutMs: 20, fetchImpl: timeoutFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(), '시간 초과 테스트'));
    assert.equal(timeout.envelope.kind, 'error');
    assert.equal(timeout.envelope.aiGenerated, false);
    assert.match(timeout.text, /시간|응답/);

    const providerErrorFetch = queueFetch([response({ error: { message: 'secret-provider-detail' } }, 401)]);
    const providerError = await new OpenAIResponseEngine({ apiKey: 'error-secret', fetchImpl: providerErrorFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(), '제공자 오류 테스트'));
    assert.equal(providerError.envelope.kind, 'error');
    assert.equal(providerError.envelope.aiGenerated, false);
    assert.doesNotMatch(JSON.stringify(providerError), /secret-provider-detail|error-secret/);

    const invalidConfig = await new OpenAIResponseEngine({ apiKey: 'config-secret', baseUrl: 'not-a-url' })
      .run(await createInput(itemStore, createAgentServiceFake(), '설정 오류 테스트'));
    assert.equal(invalidConfig.envelope.kind, 'error');
    assert.doesNotMatch(invalidConfig.text, /configuration|config-secret/);

    process.env.OPENAI_MODEL = 'test-model';
    process.env.OPENAI_BASE_URL = 'https://provider.example/v1/';
    const configuredFetch = queueFetch([textResponse('환경 설정 답변')]);
    await new OpenAIResponseEngine({ apiKey: 'configured-secret', fetchImpl: configuredFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(), '환경 설정 테스트'));
    assert.equal(configuredFetch.calls[0]?.url, 'https://provider.example/v1/chat/completions');
    assert.equal(JSON.parse(String(configuredFetch.calls[0]?.init?.body)).model, 'test-model');

    console.log('OpenAI response engine tests passed: no-key gate, plain output, validated weather/task/approval tools, malformed/unknown tools, timeout, and provider errors');
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
    if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalBaseUrl;
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

await main();
