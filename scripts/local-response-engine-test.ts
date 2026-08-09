import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentJob, AgentJobScope } from '../src/server/agent-job-store.js';
import type { AgentService } from '../src/server/agent-service.js';
import { ItemStore } from '../src/server/item-store.js';
import { LocalCompatibleResponseEngine } from '../src/server/response-engine-local.js';
import type { ResponseEngineInput } from '../src/server/response-engine.js';
import { GenUiEnvelopeV1Schema } from '../src/shared/genui.js';

const scope: AgentJobScope = {
  requesterId: 'local-test-user',
  conversationId: 'local-test-thread',
  tenantId: 'local-test-tenant',
};

const liveWeather = {
  source: 'open-meteo',
  location: { name: '서울', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' },
  current: {
    time: '2026-08-08T00:00:00Z',
    temperature: 25,
    apparentTemperature: 26,
    humidity: 60,
    windSpeed: 8,
    precipitation: 0,
    condition: '맑음',
    icon: 'sun',
  },
};

type FakeAgentService = AgentService & {
  submitted: Array<{ prompt: string; mode: string; scope: AgentJobScope }>;
};

function createAgentServiceFake(): FakeAgentService {
  const submitted: FakeAgentService['submitted'] = [];
  return {
    submitted,
    countActive: () => 0,
    list: () => [],
    latestCompletedForConversation: () => undefined,
    submit: async (input: { prompt: string; mode: string; scope: AgentJobScope }) => {
      submitted.push(input);
      return {
        id: 'task-local-approval',
        prompt: input.prompt,
        mode: input.mode,
        status: 'awaiting_approval',
        scope: input.scope,
        progress: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
    },
  } as unknown as FakeAgentService;
}

async function createInput(
  itemStore: ItemStore,
  agentService: AgentService,
  prompt: string,
  context: ResponseEngineInput['request']['context'] = [],
  onTool: ResponseEngineInput['onTool'] = () => undefined,
  approvalEnvelope?: ResponseEngineInput['approvalEnvelope'],
): Promise<ResponseEngineInput> {
  return {
    mode: 'local',
    prompt,
    scope,
    itemStore,
    agentService,
    request: {
      threadId: scope.conversationId,
      runId: 'run-local-test',
      messages: [{ id: 'message-local-test', role: 'user', content: prompt }],
      context,
    } as ResponseEngineInput['request'],
    onTool,
    onText: () => undefined,
    setActiveJobId: () => undefined,
    isCancelled: () => false,
    approvalEnvelope,
  };
}

function approvalEnvelope(job: AgentJob): ReturnType<typeof GenUiEnvelopeV1Schema.parse> {
  return GenUiEnvelopeV1Schema.parse({
    schemaVersion: '1',
    kind: 'approval',
    status: 'approval',
    id: job.id,
    correlationId: 'local-approval-correlation',
    title: '쓰기 작업 승인 필요',
    sections: [{ type: 'status', title: '승인 경계', status: 'awaiting_approval' }],
    actions: [
      { action: 'approve', label: '승인', entityId: job.id, correlationId: 'local-approval-correlation', actionToken: 'a'.repeat(32), style: 'positive' },
      { action: 'cancel', label: '취소', entityId: job.id, correlationId: 'local-approval-correlation', actionToken: 'b'.repeat(32), style: 'destructive' },
    ],
    citations: [],
    aiGenerated: false,
    fallbackText: '승인 필요',
    metadata: { source: 'test' },
  });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function withFakeServer(
  handler: (body: Record<string, unknown>, request: IncomingMessage, response: ServerResponse) =>
    | { status?: number; body?: unknown }
    | Promise<{ status?: number; body?: unknown }>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(async (request, response) => {
    try {
      const body = await readJson(request);
      const result = await handler(body, request, response);
      if (response.writableEnded) return;
      response.statusCode = result.status ?? 200;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(result.body ?? {}));
    } catch {
      if (!response.writableEnded) {
        response.statusCode = 500;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ error: 'fake server error' }));
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function textBody(text: string): unknown {
  return { choices: [{ message: { content: text } }] };
}

function toolBody(name: string, args = '{}'): unknown {
  return {
    choices: [{
      message: {
        content: null,
        tool_calls: [{
          id: `call-${name}`,
          type: 'function',
          function: { name, arguments: args },
        }],
      },
    }],
  };
}

function withEnvironment(values: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

const localBaseUrlCases: Array<{ value: string; configured: boolean }> = [
  { value: 'https://model.internal.example/v1', configured: true },
  { value: 'https://user:password@model.internal.example/v1', configured: false },
  { value: 'https://model.internal.example/v1?api_key=url-secret', configured: false },
  { value: 'https://model.internal.example/v1#fragment', configured: false },
  { value: 'file:///tmp/local-model', configured: false },
  { value: 'https://', configured: false },
];

async function main(): Promise<void> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'teams-local-response-engine-'));
  const itemStore = new ItemStore(join(dataDirectory, 'items.json'));
  await itemStore.initialize();
  const originalEnvironment = {
    LOCAL_MODEL_BASE_URL: process.env.LOCAL_MODEL_BASE_URL,
    LOCAL_MODEL_NAME: process.env.LOCAL_MODEL_NAME,
    LOCAL_MODEL_API_KEY: process.env.LOCAL_MODEL_API_KEY,
  };

  try {
    for (const testCase of localBaseUrlCases) {
      const restore = withEnvironment({
        LOCAL_MODEL_BASE_URL: testCase.value,
        LOCAL_MODEL_NAME: 'test-model',
        LOCAL_MODEL_API_KEY: undefined,
      });
      let fetchCalls = 0;
      let requestedUrl = '';
      try {
        const result = await new LocalCompatibleResponseEngine({
          fetchImpl: async (input) => {
            fetchCalls += 1;
            requestedUrl = String(input);
            return new Response(JSON.stringify(textBody('로컬 테스트 응답')), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          },
        }).run(await createInput(itemStore, createAgentServiceFake(), '설정 확인'));

        assert.equal(
          fetchCalls,
          testCase.configured ? 1 : 0,
          `local engine provider call count for ${testCase.value}`,
        );
        if (testCase.configured) {
          assert.equal(requestedUrl, 'https://model.internal.example/v1/chat/completions');
          assert.equal(result.envelope.kind, 'answer');
          assert.equal(result.text, '로컬 테스트 응답');
        } else {
          assert.equal(result.envelope.status, 'error');
          assert.equal(result.envelope.metadata.errorCode, 'local-invalid-url');
          assert.doesNotMatch(JSON.stringify(result), /user:password|url-secret|file:/);
        }
      } finally {
        restore();
      }
    }

    const noUrlRestore = withEnvironment({
      LOCAL_MODEL_BASE_URL: undefined,
      LOCAL_MODEL_NAME: 'ignored-model',
      LOCAL_MODEL_API_KEY: 'local-secret-must-not-leak',
    });
    let noUrlFetchCalls = 0;
    const noUrl = await new LocalCompatibleResponseEngine({
      fetchImpl: async () => {
        noUrlFetchCalls += 1;
        throw new Error('must not fetch without URL');
      },
    }).run(await createInput(itemStore, createAgentServiceFake(), '안녕하세요'));
    noUrlRestore();
    assert.equal(noUrlFetchCalls, 0, 'missing URL must not call the provider');
    assert.equal(noUrl.envelope.kind, 'error');
    assert.equal(noUrl.envelope.status, 'error');
    assert.equal(noUrl.envelope.aiGenerated, false);
    assert.match(noUrl.text, /LOCAL_MODEL_BASE_URL/);
    assert.doesNotMatch(JSON.stringify(noUrl), /local-secret-must-not-leak/);

    await withFakeServer(async (body, request) => {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(body.model, 'enterprise-model');
      assert.equal(new Headers(request.headers as HeadersInit).get('authorization'), null);
      return { body: textBody('로컬 호환 서버의 답변입니다.') };
    }, async (baseUrl) => {
      const restore = withEnvironment({
        LOCAL_MODEL_BASE_URL: baseUrl,
        LOCAL_MODEL_NAME: 'enterprise-model',
        LOCAL_MODEL_API_KEY: undefined,
      });
      const result = await new LocalCompatibleResponseEngine().run(
        await createInput(itemStore, createAgentServiceFake(), '간단히 답해줘'),
      );
      restore();
      assert.equal(result.envelope.kind, 'answer');
      assert.equal(result.envelope.aiGenerated, true);
      assert.equal(result.text, '로컬 호환 서버의 답변입니다.');
      assert.equal(result.envelope.metadata.provider, 'local-compatible');
    });

    await withFakeServer(async () => ({
      body: textBody('Bearer abcdefghijklmnop sk-proj-localabcdefghijklmnop https://user:password@example.test/v1?api_key=url-secret'),
    }), async (baseUrl) => {
      const restore = withEnvironment({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_API_KEY: 'output-secret' });
      const result = await new LocalCompatibleResponseEngine().run(
        await createInput(itemStore, createAgentServiceFake(), '민감정보 redaction 테스트'),
      );
      restore();
      assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnop|localabcdefghijklmnop|url-secret|user:password/);
      assert.match(result.text, /\[REDACTED\]/);
    });

    await withFakeServer(async (body, request) => {
      assert.equal(request.url, '/v1/chat/completions');
      const messages = body.messages as Array<{ role: string; content: string | null }>;
      assert.ok(messages.some((message) => message.role === 'system'));
      if (messages.some((message) => message.role === 'tool')) {
        return { body: textBody('현재 위치 날씨를 확인했습니다.') };
      }
      return { body: toolBody('showWeatherCard') };
    }, async (baseUrl) => {
      const restore = withEnvironment({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_API_KEY: 'weather-secret' });
      const toolNames: string[] = [];
      const result = await new LocalCompatibleResponseEngine().run(await createInput(
        itemStore,
        createAgentServiceFake(),
        '현재 날씨 알려줘',
        [{ description: '날씨 컨텍스트', value: JSON.stringify(liveWeather) }],
        (tool) => toolNames.push(tool.name),
      ));
      restore();
      assert.equal(result.envelope.kind, 'weather');
      assert.equal(result.envelope.aiGenerated, true);
      assert.deepEqual(toolNames, ['showWeatherCard']);
      assert.doesNotMatch(JSON.stringify(result), /weather-secret/);
    });

    await withFakeServer(async (body) => {
      const messages = body.messages as Array<{ role: string }>;
      return messages.some((message) => message.role === 'tool')
        ? { body: textBody('업무 목록을 표시했습니다.') }
        : { body: toolBody('showTaskCard') };
    }, async (baseUrl) => {
      const restore = withEnvironment({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_API_KEY: undefined });
      const result = await new LocalCompatibleResponseEngine().run(
        await createInput(itemStore, createAgentServiceFake(), '업무 목록 보여줘'),
      );
      restore();
      assert.equal(result.envelope.kind, 'task-list');
      assert.equal(result.envelope.aiGenerated, true);
      assert.equal(result.toolCalls[0]?.name, 'showTaskCard');
    });

    await withFakeServer(async (body) => {
      const messages = body.messages as Array<{ role: string }>;
      return messages.some((message) => message.role === 'tool')
        ? { body: textBody('승인 카드를 표시했습니다.') }
        : { body: toolBody('workspaceApproval', JSON.stringify({ prompt: '설정 파일을 수정합니다.' })) };
    }, async (baseUrl) => {
      const restore = withEnvironment({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_API_KEY: 'approval-secret' });
      const service = createAgentServiceFake();
      let activeJobId = '';
      const result = await new LocalCompatibleResponseEngine().run({
        ...(await createInput(itemStore, service, '설정 파일을 수정해줘', [], undefined, approvalEnvelope)),
        setActiveJobId: (id) => { activeJobId = id; },
      });
      restore();
      assert.equal(result.envelope.kind, 'approval');
      assert.equal(result.envelope.status, 'approval');
      assert.equal(service.submitted[0]?.mode, 'workspace-write');
      assert.deepEqual(service.submitted[0]?.scope, scope);
      assert.equal(activeJobId, 'task-local-approval');
      assert.equal(result.envelope.actions.length, 2, 'host approval factory supplies approve/cancel actions');
      assert.doesNotMatch(JSON.stringify(result), /approval-secret/);
    });

    const invalidRestore = withEnvironment({
      LOCAL_MODEL_BASE_URL: 'file:///tmp/local-model',
      LOCAL_MODEL_API_KEY: 'invalid-url-secret',
    });
    let invalidFetchCalls = 0;
    const invalid = await new LocalCompatibleResponseEngine({
      fetchImpl: async () => {
        invalidFetchCalls += 1;
        throw new Error('must not fetch invalid URL');
      },
    }).run(await createInput(itemStore, createAgentServiceFake(), '설정 확인'));
    invalidRestore();
    assert.equal(invalidFetchCalls, 0);
    assert.equal(invalid.envelope.status, 'error');
    assert.doesNotMatch(JSON.stringify(invalid), /invalid-url-secret|file:/);

    await withFakeServer(async () => ({
      body: toolBody('showTaskCard', JSON.stringify({ unexpected: 'malformed-secret' })),
    }), async (baseUrl) => {
      const restore = withEnvironment({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_API_KEY: 'malformed-secret' });
      const result = await new LocalCompatibleResponseEngine().run(
        await createInput(itemStore, createAgentServiceFake(), '업무 목록'),
      );
      restore();
      assert.equal(result.envelope.kind, 'error');
      assert.equal(result.envelope.aiGenerated, false);
      assert.doesNotMatch(JSON.stringify(result), /malformed-secret|unexpected/);
    });

    await withFakeServer(async () => ({ status: 503, body: { error: 'provider-secret' } }), async (baseUrl) => {
      const restore = withEnvironment({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_API_KEY: 'provider-secret' });
      const result = await new LocalCompatibleResponseEngine().run(
        await createInput(itemStore, createAgentServiceFake(), '응답 확인'),
      );
      restore();
      assert.equal(result.envelope.kind, 'error');
      assert.equal(result.envelope.aiGenerated, false);
      assert.doesNotMatch(JSON.stringify(result), /provider-secret/);
    });

    await withFakeServer(async (_body, _request, response) => {
      response.on('close', () => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { body: textBody('늦은 응답') };
    }, async (baseUrl) => {
      const restore = withEnvironment({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_API_KEY: 'timeout-secret' });
      const result = await new LocalCompatibleResponseEngine({ timeoutMs: 20 }).run(
        await createInput(itemStore, createAgentServiceFake(), '시간 초과 확인'),
      );
      restore();
      assert.equal(result.envelope.kind, 'error');
      assert.equal(result.envelope.aiGenerated, false);
      assert.doesNotMatch(JSON.stringify(result), /timeout-secret|늦은 응답/);
    });

    console.log('local compatible response engine tests passed');
  } finally {
    const restore = withEnvironment(originalEnvironment);
    restore();
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

await main();
