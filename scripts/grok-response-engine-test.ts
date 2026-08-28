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
    id,
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
    id,
    output: [{
      type: 'function_call',
      id: `fc-${id}`,
      call_id: callId,
      name,
      arguments: argumentsValue,
    }],
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

    console.log('PASS: xAI Responses API text, function-call roundtrip, approval boundary, malformed-tool rejection, and no-key gate');
  } finally {
    if (originalKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.XAI_MODEL;
    else process.env.XAI_MODEL = originalModel;
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

await main();
