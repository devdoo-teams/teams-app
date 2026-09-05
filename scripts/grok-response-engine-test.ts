import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentJobScope } from '../src/server/agent-job-store.js';
import type { AgentService } from '../src/server/agent-service.js';
import { ItemStore } from '../src/server/item-store.js';
import { GrokResponseEngine } from '../src/server/response-engine-grok.js';
import type { ResponseEngineInput } from '../src/server/response-engine.js';
import { GenUiEnvelopeV1Schema } from '../src/shared/genui.js';

const scope: AgentJobScope = {
  requesterId: 'grok-test-user',
  conversationId: 'grok-test-thread',
  tenantId: 'grok-test-tenant',
};

type FakeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function queueFetch(responses: Response[]): {
  fetch: FakeFetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let index = 0;
  const fetch: FakeFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const next = responses[index++];
    if (!next) throw new Error('unexpected fake fetch call');
    return next;
  };
  return { fetch, calls };
}

function messageResponse(text: string, id = 'resp-text'): Response {
  return response({
    object: 'response',
    id,
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [{
      id: `msg-${id}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text }],
    }],
  });
}

function functionResponse(
  name: string,
  argumentsValue = '{}',
  id = 'resp-function',
  callId = 'call-function',
): Response {
  return response({
    object: 'response',
    id,
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [{
      type: 'function_call',
      id: `fc-${id}`,
      call_id: callId,
      name,
      arguments: argumentsValue,
    }],
  });
}

function completedResponse(output: unknown[], id = 'resp-completed'): Response {
  return response({
    object: 'response',
    id,
    status: 'completed',
    error: null,
    incomplete_details: null,
    output,
  });
}

function providerErrorResponse(status: number): Response {
  return new Response(JSON.stringify({
    error: { message: 'provider-secret-response-body' },
  }), {
    status,
    headers: {
      'content-type': 'application/json',
      'retry-after': '3600',
      'x-provider-secret': 'provider-secret-header',
    },
  });
}

function createAgentServiceFake(submitted: Array<{ prompt: string; mode: string }>): AgentService {
  return {
    submit: async (input: { prompt: string; mode: string }) => {
      submitted.push(input);
      return {
        id: 'grok-approval-job',
        prompt: input.prompt,
        mode: input.mode,
        status: 'awaiting_approval',
        scope,
        progress: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
    },
  } as unknown as AgentService;
}

async function createInput(
  itemStore: ItemStore,
  agentService: AgentService,
  prompt: string,
  context: ResponseEngineInput['request']['context'] = [],
): Promise<ResponseEngineInput> {
  return {
    mode: 'grok' as ResponseEngineInput['mode'],
    prompt,
    scope,
    itemStore,
    agentService,
    request: {
      threadId: scope.conversationId,
      runId: 'grok-test-run',
      messages: [{ id: 'grok-message', role: 'user', content: prompt }],
      context,
    } as ResponseEngineInput['request'],
    onText: () => undefined,
    onTool: () => undefined,
    setActiveJobId: () => undefined,
    isCancelled: () => false,
  };
}

async function main(): Promise<void> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'teams-grok-response-engine-'));
  const itemStore = new ItemStore(join(dataDirectory, 'items.json'));
  await itemStore.initialize();
  const originalKey = process.env.XAI_API_KEY;
  const originalModel = process.env.XAI_MODEL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLoopbackFlag = process.env.XAI_ALLOW_LOOPBACK_TEST;
  const originalLocalDev = process.env.TEAMS_LOCAL_DEV;
  const originalSkipAuth = process.env.TEAMS_SKIP_AUTH;
  const originalLoopbackKey = process.env.XAI_LOOPBACK_TEST_KEY;

  try {
    delete process.env.XAI_API_KEY;
    const noKeyFetch = queueFetch([]);
    const noKey = await new GrokResponseEngine({ fetchImpl: noKeyFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake([]), '안녕하세요'));
    assert.equal(noKeyFetch.calls.length, 0, 'missing XAI key must not call xAI');
    assert.equal(noKey.envelope.status, 'error');
    assert.equal(noKey.envelope.aiGenerated, false);
    assert.match(noKey.text, /XAI_API_KEY/);

    const plainFetch = queueFetch([messageResponse('Grok 일반 답변입니다.')]);
    const plain = await new GrokResponseEngine({ apiKey: 'xai-test-secret', fetchImpl: plainFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake([]), '간단히 답해줘'));
    assert.equal(plainFetch.calls.length, 1);
    assert.equal(plainFetch.calls[0]?.url, 'https://api.x.ai/v1/responses');
    const plainHeaders = new Headers(plainFetch.calls[0]?.init?.headers);
    assert.equal(plainHeaders.get('authorization'), 'Bearer xai-test-secret');
    const plainRequest = JSON.parse(String(plainFetch.calls[0]?.init?.body));
    assert.equal(plainRequest.model, 'grok-4.6');
    assert.equal(plainRequest.input.at(-1).role, 'user');
    assert.ok(plainRequest.tools.every((tool: any) => tool.type === 'function' && typeof tool.name === 'string'));
    assert.equal(plain.text, 'Grok 일반 답변입니다.');
    assert.equal(plain.envelope.kind, 'answer');
    assert.equal(plain.envelope.aiGenerated, true);
    assert.equal((plain.envelope.metadata as any).provider, 'grok');
    assert.equal((plain.envelope.metadata as any).source, 'xai');
    assert.doesNotMatch(JSON.stringify(plain), /xai-test-secret/);

    const untrustedBaseUrls = [
      'http://127.0.0.1:43210/v1',
      'https://attacker.example.test/v1',
      'https://api.x.ai.evil.example.test/v1',
    ];
    for (const baseUrl of untrustedBaseUrls) {
      const untrustedFetch = queueFetch([messageResponse('이 응답은 도달하면 안 됩니다.')]);
      const invalidBaseUrl = await new GrokResponseEngine({
        apiKey: 'untrusted-url-secret',
        baseUrl,
        fetchImpl: untrustedFetch.fetch,
      }).run(await createInput(itemStore, createAgentServiceFake([]), '주소 검증'));
      assert.equal(untrustedFetch.calls.length, 0, `untrusted base URL must be rejected before fetch: ${baseUrl}`);
      assert.equal(invalidBaseUrl.envelope.metadata.errorCode, 'grok-invalid-url');
      assert.doesNotMatch(JSON.stringify(invalidBaseUrl), /untrusted-url-secret/);
    }

    process.env.NODE_ENV = 'development';
    process.env.XAI_ALLOW_LOOPBACK_TEST = 'true';
    process.env.TEAMS_LOCAL_DEV = 'true';
    process.env.TEAMS_SKIP_AUTH = 'true';
    const developmentLoopbackFetch = queueFetch([messageResponse('개발 loopback 응답')]);
    const developmentLoopback = await new GrokResponseEngine({
      apiKey: 'real-xai-key-must-not-be-forwarded',
      baseUrl: 'http://127.0.0.1:43210/v1',
      fetchImpl: developmentLoopbackFetch.fetch,
    }).run(await createInput(itemStore, createAgentServiceFake([]), '개발 loopback'));
    assert.equal(developmentLoopbackFetch.calls.length, 0, 'loopback override must be test-only');
    assert.equal(developmentLoopback.envelope.metadata.errorCode, 'grok-invalid-url');

    process.env.NODE_ENV = 'test';
    process.env.XAI_LOOPBACK_TEST_KEY = 'loopback-fixture-key';
    const loopbackFetch = queueFetch([messageResponse('로컬 fixture 응답')]);
    const loopback = await new GrokResponseEngine({
      apiKey: 'real-xai-key-must-not-be-forwarded',
      baseUrl: 'http://127.0.0.1:43210/v1',
      fetchImpl: loopbackFetch.fetch,
    }).run(await createInput(itemStore, createAgentServiceFake([]), '로컬 fixture'));
    assert.equal(loopbackFetch.calls.length, 1, 'explicit loopback test mode may reach a loopback fixture');
    assert.equal(loopback.text, '로컬 fixture 응답');
    const loopbackHeaders = new Headers(loopbackFetch.calls[0]?.init?.headers);
    assert.equal(loopbackHeaders.get('authorization'), 'Bearer loopback-fixture-key');
    assert.notEqual(loopbackHeaders.get('authorization'), 'Bearer real-xai-key-must-not-be-forwarded');
    assert.doesNotMatch(JSON.stringify(loopback), /real-xai-key-must-not-be-forwarded/);

    const retiredWeatherFetch = queueFetch([messageResponse('날씨 기능은 제공하지 않습니다.')]);
    await new GrokResponseEngine({ apiKey: 'retired-weather-secret', fetchImpl: retiredWeatherFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake([]), '날씨 알려줘', [
        { description: '날씨 컨텍스트', value: JSON.stringify({ source: 'open-meteo', secret: 'retired-weather-context' }) },
      ]));
    const retiredWeatherRequest = JSON.parse(String(retiredWeatherFetch.calls[0]?.init?.body));
    assert.equal(retiredWeatherRequest.tool_choice, 'auto', 'retired weather prompts must not force a tool');
    assert.deepEqual(
      retiredWeatherRequest.tools.map((tool: any) => tool.name),
      ['showTaskCard', 'workspaceApproval'],
    );
    assert.doesNotMatch(retiredWeatherRequest.instructions, /날씨|weather|현재 위치|Open-Meteo/i);
    assert.doesNotMatch(JSON.stringify(retiredWeatherRequest), /retired-weather-context/);

    const retiredToolCalls: Array<{ prompt: string; mode: string }> = [];
    const retiredTool = await new GrokResponseEngine({
      apiKey: 'retired-tool-secret',
      fetchImpl: queueFetch([functionResponse('showWeatherCard')]).fetch,
    }).run(await createInput(itemStore, createAgentServiceFake(retiredToolCalls), '날씨 알려줘'));
    assert.equal(retiredTool.envelope.kind, 'error');
    assert.equal(retiredTool.envelope.metadata.errorCode, 'grok-invalid-tool');
    assert.equal(retiredToolCalls.length, 0);
    assert.doesNotMatch(retiredTool.text, /내 위치|위치 권한/);

    const responseStatusCases = [
      { status: 'in_progress' },
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
      { status: 'completed', error: { code: 'provider_error', message: 'do not expose this' } },
    ];
    for (const [index, fields] of responseStatusCases.entries()) {
      const statusFetch = queueFetch([response({
        object: 'response',
        id: `resp-invalid-status-${index}`,
        output: [{
          id: `msg-invalid-status-${index}`,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: '잘못된 응답' }],
        }],
        error: null,
        incomplete_details: null,
        ...fields,
      })]);
      const invalidStatus = await new GrokResponseEngine({ apiKey: 'status-secret', fetchImpl: statusFetch.fetch })
        .run(await createInput(itemStore, createAgentServiceFake([]), '응답 상태 검증'));
      assert.equal(invalidStatus.envelope.kind, 'error');
      assert.equal(invalidStatus.envelope.metadata.errorCode, 'grok-invalid-response');
      assert.doesNotMatch(JSON.stringify(invalidStatus), /do not expose this/);
    }

    const invalidOutputItems = [
      {
        id: 'message-role',
        output: [{
          id: 'message-role-item',
          type: 'message',
          role: 'user',
          status: 'completed',
          content: [{ type: 'output_text', text: '잘못된 역할' }],
        }],
      },
      {
        id: 'message-status',
        output: [{
          id: 'message-status-item',
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [{ type: 'output_text', text: '완료되지 않은 메시지' }],
        }],
      },
      {
        id: 'function-status',
        output: [{
          id: 'function-status-item',
          type: 'function_call',
          status: 'in_progress',
          call_id: 'call-function-status',
          name: 'showTaskCard',
          arguments: '{}',
        }],
      },
      {
        id: 'function-role',
        output: [{
          id: 'function-role-item',
          type: 'function_call',
          role: 'tool',
          call_id: 'call-function-role',
          name: 'showTaskCard',
          arguments: '{}',
        }],
      },
    ];
    for (const itemCase of invalidOutputItems) {
      const itemFetch = queueFetch([completedResponse(itemCase.output, `resp-${itemCase.id}`)]);
      const invalidItem = await new GrokResponseEngine({ apiKey: 'item-status-secret', fetchImpl: itemFetch.fetch })
        .run(await createInput(itemStore, createAgentServiceFake([]), '출력 항목 검증'));
      assert.equal(invalidItem.envelope.kind, 'error', itemCase.id);
      assert.equal(invalidItem.envelope.metadata.errorCode, 'grok-invalid-response', itemCase.id);
    }

    const nonRetryableHttpCases = [
      [401, 'grok-http-401'],
      [403, 'grok-http-403'],
      [404, 'grok-http-404'],
      [422, 'grok-http-422'],
    ] as const;
    for (const [status, errorCode] of nonRetryableHttpCases) {
      const httpFetch = queueFetch([providerErrorResponse(status)]);
      const httpFailure = await new GrokResponseEngine({ apiKey: 'http-secret', fetchImpl: httpFetch.fetch })
        .run(await createInput(itemStore, createAgentServiceFake([]), `HTTP ${status} 검증`));
      assert.equal(httpFetch.calls.length, 1, `${status} must not be retried`);
      assert.equal(httpFailure.envelope.metadata.errorCode, errorCode);
      assert.doesNotMatch(JSON.stringify(httpFailure), /provider-secret/);
    }

    const retryDelays: number[] = [];
    const rateLimitFetch = queueFetch([
      providerErrorResponse(429),
      providerErrorResponse(429),
      messageResponse('제한 해제 후 응답'),
    ]);
    const rateLimit = await new GrokResponseEngine({
      apiKey: 'rate-limit-secret',
      fetchImpl: rateLimitFetch.fetch,
      sleepImpl: async (delayMs: number) => { retryDelays.push(delayMs); },
    })
      .run(await createInput(itemStore, createAgentServiceFake([]), '재시도 가능한 요청'));
    assert.equal(rateLimit.text, '제한 해제 후 응답');
    assert.equal(rateLimitFetch.calls.length, 3);
    assert.deepEqual(retryDelays, [100, 200], '429 backoff must be bounded and ignore undocumented Retry-After');

    const serverRetryFetch = queueFetch([
      providerErrorResponse(503),
      messageResponse('일시 장애 후 응답'),
    ]);
    const serverRetry = await new GrokResponseEngine({
      apiKey: 'server-retry-secret',
      fetchImpl: serverRetryFetch.fetch,
      sleepImpl: async () => undefined,
    })
      .run(await createInput(itemStore, createAgentServiceFake([]), '서버 재시도'));
    assert.equal(serverRetry.text, '일시 장애 후 응답');
    assert.equal(serverRetryFetch.calls.length, 2, '5xx may be retried once within the bounded policy');

    const networkRetryCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    let networkAttempts = 0;
    const networkRetryFetch: FakeFetch = async (input, init) => {
      networkRetryCalls.push({ url: String(input), init });
      networkAttempts += 1;
      if (networkAttempts === 1) throw new TypeError('network-secret-response');
      return messageResponse('네트워크 재시도 후 응답');
    };
    const networkRetryDelays: number[] = [];
    const networkRetry = await new GrokResponseEngine({
      apiKey: 'network-retry-secret',
      fetchImpl: networkRetryFetch,
      sleepImpl: async (delayMs: number) => { networkRetryDelays.push(delayMs); },
    })
      .run(await createInput(itemStore, createAgentServiceFake([]), '네트워크 재시도'));
    assert.equal(networkRetry.text, '네트워크 재시도 후 응답');
    assert.equal(networkRetryCalls.length, 2, 'a transient network failure may be retried once');
    assert.deepEqual(networkRetryDelays, [100]);
    assert.doesNotMatch(JSON.stringify(networkRetry), /network-secret-response/);

    const exhaustedServerFetch = queueFetch([
      providerErrorResponse(500),
      providerErrorResponse(502),
      providerErrorResponse(503),
    ]);
    const exhaustedServer = await new GrokResponseEngine({
      apiKey: 'exhausted-server-secret',
      fetchImpl: exhaustedServerFetch.fetch,
      sleepImpl: async () => undefined,
    })
      .run(await createInput(itemStore, createAgentServiceFake([]), '서버 장애'));
    assert.equal(exhaustedServer.envelope.metadata.errorCode, 'grok-http-5xx');
    assert.equal(exhaustedServerFetch.calls.length, 3);

    const taskFetch = queueFetch([
      functionResponse('showTaskCard', '{}', 'resp-task', 'call-task'),
      messageResponse('업무 목록을 확인했습니다.', 'resp-task-final'),
    ]);
    const task = await new GrokResponseEngine({ apiKey: 'task-secret', fetchImpl: taskFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake([]), '업무 목록 보여줘'));
    assert.equal(task.envelope.kind, 'task-list');
    assert.equal(task.envelope.aiGenerated, true);
    assert.equal(taskFetch.calls.length, 2);
    const followUp = JSON.parse(String(taskFetch.calls[1]?.init?.body));
    assert.equal(followUp.previous_response_id, 'resp-task');
    assert.deepEqual(followUp.input, [{
      type: 'function_call_output',
      call_id: 'call-task',
      output: followUp.input[0].output,
    }]);
    assert.match(followUp.input[0].output, /업무/);

    const multiRoundFetch = queueFetch([
      functionResponse('showTaskCard', '{}', 'resp-round-1', 'call-round-1'),
      functionResponse('showTaskCard', '{}', 'resp-round-2', 'call-round-2'),
      functionResponse('showTaskCard', '{}', 'resp-round-3', 'call-round-3'),
      messageResponse('여러 도구 라운드를 처리했습니다.', 'resp-round-final'),
    ]);
    const multiRound = await new GrokResponseEngine({ apiKey: 'multi-round-secret', fetchImpl: multiRoundFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake([]), '업무 목록 보여줘'));
    assert.equal(multiRound.envelope.kind, 'task-list');
    assert.equal(multiRoundFetch.calls.length, 4, 'Grok must continue through more than one function-call round');
    const multiRoundFollowUps = multiRoundFetch.calls.slice(1).map((call) => JSON.parse(String(call.init?.body)));
    assert.deepEqual(multiRoundFollowUps.map((body) => body.previous_response_id), [
      'resp-round-1',
      'resp-round-2',
      'resp-round-3',
    ]);
    assert.ok(multiRoundFollowUps.every((body) => body.tool_choice === 'auto'));

    const roundLimitFetch = queueFetch([
      functionResponse('showTaskCard', '{}', 'resp-limit-1', 'call-limit-1'),
      functionResponse('showTaskCard', '{}', 'resp-limit-2', 'call-limit-2'),
      functionResponse('showTaskCard', '{}', 'resp-limit-3', 'call-limit-3'),
      functionResponse('showTaskCard', '{}', 'resp-limit-4', 'call-limit-4'),
    ]);
    const roundLimit = await new GrokResponseEngine({ apiKey: 'round-limit-secret', fetchImpl: roundLimitFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake([]), '업무 목록 보여줘'));
    assert.equal(roundLimit.envelope.kind, 'error');
    assert.equal(roundLimit.envelope.metadata.errorCode, 'grok-tool-round-limit');
    assert.equal(roundLimitFetch.calls.length, 4);

    const approvalCalls: Array<{ prompt: string; mode: string }> = [];
    const approvalFetch = queueFetch([
      functionResponse('workspaceApproval', JSON.stringify({ prompt: '파일을 수정해줘' }), 'resp-approval', 'call-approval'),
      messageResponse('승인 요청을 만들었습니다.', 'resp-approval-final'),
    ]);
    const approval = await new GrokResponseEngine({ apiKey: 'approval-secret', fetchImpl: approvalFetch.fetch })
      .run({
        ...(await createInput(itemStore, createAgentServiceFake(approvalCalls), '파일을 수정해줘')),
        approvalEnvelope: async (job) => GenUiEnvelopeV1Schema.parse({
          schemaVersion: '1',
          kind: 'approval',
          status: 'approval',
          id: job.id,
          correlationId: 'grok-approval-correlation',
          title: '쓰기 작업 승인 필요',
          sections: [{ type: 'status', title: '승인 경계', status: 'awaiting_approval' }],
          actions: [],
          citations: [],
          aiGenerated: false,
          fallbackText: '승인 필요',
          metadata: { source: 'test' },
        }),
      });
    assert.equal(approval.envelope.kind, 'approval');
    assert.deepEqual(
      approvalCalls.map(({ prompt, mode }) => ({ prompt, mode })),
      [{ prompt: '파일을 수정해줘', mode: 'workspace-write' }],
    );

    const approvalRetryCalls: Array<{ prompt: string; mode: string }> = [];
    const approvalRetryFetch = queueFetch([
      functionResponse('workspaceApproval', JSON.stringify({ prompt: '재시도 중복 승인 금지' }), 'resp-approval-retry', 'call-approval-retry'),
      providerErrorResponse(503),
      messageResponse('재시도 후 승인 요청을 만들었습니다.', 'resp-approval-retry-final'),
    ]);
    const approvalRetry = await new GrokResponseEngine({
      apiKey: 'approval-retry-secret',
      fetchImpl: approvalRetryFetch.fetch,
      sleepImpl: async () => undefined,
    })
      .run({
        ...(await createInput(itemStore, createAgentServiceFake(approvalRetryCalls), '파일을 수정해줘')),
        approvalEnvelope: async (job) => GenUiEnvelopeV1Schema.parse({
          schemaVersion: '1',
          kind: 'approval',
          status: 'approval',
          id: job.id,
          correlationId: 'grok-approval-retry-correlation',
          title: '쓰기 작업 승인 필요',
          sections: [{ type: 'status', title: '승인 경계', status: 'awaiting_approval' }],
          actions: [],
          citations: [],
          aiGenerated: false,
          fallbackText: '승인 필요',
          metadata: { source: 'test' },
        }),
      });
    assert.equal(approvalRetry.envelope.kind, 'approval');
    assert.equal(approvalRetryFetch.calls.length, 3, 'a follow-up HTTP retry must not replay the first tool round');
    assert.equal(approvalRetryCalls.length, 1, 'HTTP retries after a mutation must not duplicate the mutation');

    const duplicateApprovalCalls: Array<{ prompt: string; mode: string }> = [];
    const duplicateApprovalFetch = queueFetch([
      functionResponse('workspaceApproval', JSON.stringify({ prompt: '중복 승인 금지' }), 'resp-duplicate-1', 'call-duplicate'),
      functionResponse('workspaceApproval', JSON.stringify({ prompt: '중복 승인 금지' }), 'resp-duplicate-2', 'call-duplicate'),
    ]);
    const duplicateApproval = await new GrokResponseEngine({ apiKey: 'duplicate-secret', fetchImpl: duplicateApprovalFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake(duplicateApprovalCalls), '파일을 수정해줘'));
    assert.equal(duplicateApproval.envelope.kind, 'error');
    assert.equal(duplicateApproval.envelope.metadata.errorCode, 'grok-duplicate-tool-call');
    assert.equal(duplicateApprovalCalls.length, 1, 'replayed function_call IDs must not repeat a mutation');

    const invalidCalls: Array<{ prompt: string; mode: string }> = [];
    const invalid = await new GrokResponseEngine({
      apiKey: 'invalid-tool-secret',
      fetchImpl: queueFetch([response({
        id: 'resp-invalid',
        output: [
          { type: 'function_call', call_id: 'call-approval', name: 'workspaceApproval', arguments: JSON.stringify({ prompt: '부분 실행 금지' }) },
          { type: 'function_call', call_id: 'call-unknown', name: 'deleteEverything', arguments: '{}' },
        ],
      })]).fetch,
    }).run(await createInput(itemStore, createAgentServiceFake(invalidCalls), '여러 도구를 호출해줘'));
    assert.equal(invalid.envelope.kind, 'error');
    assert.equal(invalidCalls.length, 0, 'invalid mixed function calls must not partially mutate');

    const malformed = await new GrokResponseEngine({
      apiKey: 'malformed-secret',
      fetchImpl: queueFetch([response({ id: 'resp-malformed', output: [{ type: 'message', content: [{ type: 'not-output-text' }] }] })]).fetch,
    }).run(await createInput(itemStore, createAgentServiceFake([]), '형식 오류'));
    assert.equal(malformed.envelope.kind, 'error');
    assert.equal(malformed.envelope.aiGenerated, false);

    process.env.XAI_MODEL = 'grok-test-model';
    const configuredFetch = queueFetch([messageResponse('환경 설정 답변')]);
    await new GrokResponseEngine({ apiKey: 'configured-secret', fetchImpl: configuredFetch.fetch })
      .run(await createInput(itemStore, createAgentServiceFake([]), '환경 설정'));
    assert.equal(JSON.parse(String(configuredFetch.calls[0]?.init?.body)).model, 'grok-test-model');

    console.log('PASS: xAI Responses API weather-pruned tools, response/item validation, bounded tool rounds, HTTP classification/retry redaction, mutation-safe retry, approval boundary, and no-key gate');
  } finally {
    if (originalKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.XAI_MODEL;
    else process.env.XAI_MODEL = originalModel;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalLoopbackFlag === undefined) delete process.env.XAI_ALLOW_LOOPBACK_TEST;
    else process.env.XAI_ALLOW_LOOPBACK_TEST = originalLoopbackFlag;
    if (originalLocalDev === undefined) delete process.env.TEAMS_LOCAL_DEV;
    else process.env.TEAMS_LOCAL_DEV = originalLocalDev;
    if (originalSkipAuth === undefined) delete process.env.TEAMS_SKIP_AUTH;
    else process.env.TEAMS_SKIP_AUTH = originalSkipAuth;
    if (originalLoopbackKey === undefined) delete process.env.XAI_LOOPBACK_TEST_KEY;
    else process.env.XAI_LOOPBACK_TEST_KEY = originalLoopbackKey;
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

await main();
