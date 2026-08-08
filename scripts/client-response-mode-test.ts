import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  DEFAULT_RESPONSE_MODE_STATE,
  ResponseModeSelector,
  fetchResponseMode,
  normalizeResponseModePayload,
  responseModeErrorMessage,
  saveResponseMode,
  type ResponseModeApiFetcher,
} from '../src/client/ResponseModeSelector.js';

const unavailableProviderPayload = {
  mode: 'deterministic',
  availability: [
    { mode: 'deterministic', label: '결정형', configured: true, requiresServerConfiguration: false },
    {
      mode: 'openai',
      label: 'OpenAI',
      configured: false,
      requiresServerConfiguration: true,
      model: 'https://provider.example.test/v1?api_key=super-secret',
    },
    {
      mode: 'local',
      label: '로컬/사내 모델',
      configured: false,
      requiresServerConfiguration: true,
      model: 'http://10.0.0.5:11434/v1',
    },
  ],
};

const responseHeaders = { 'content-type': 'application/json' };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

const getOnlyFetcher: ResponseModeApiFetcher = async (input, init) => {
  assert.equal(String(input), '/api/response-mode');
  assert.equal(init, undefined);
  return response(unavailableProviderPayload);
};

const initial = normalizeResponseModePayload(unavailableProviderPayload);
assert.equal(initial.mode, 'deterministic', 'new users must start in usable deterministic mode');
assert.equal(initial.availability.find((entry) => entry.mode === 'deterministic')?.configured, true);
assert.equal(initial.availability.find((entry) => entry.mode === 'openai')?.configured, false);
assert.equal(initial.availability.find((entry) => entry.mode === 'local')?.configured, false);

const loaded = await fetchResponseMode(getOnlyFetcher);
assert.deepEqual(loaded, initial, 'GET response is normalized to public mode metadata');

const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
const postFetcher: ResponseModeApiFetcher = async (input, init) => {
  calls.push({ input, init });
  return response({
    mode: 'openai',
    availability: [
      { mode: 'deterministic', label: '결정형', configured: true, requiresServerConfiguration: false },
      { mode: 'openai', label: 'OpenAI', configured: true, requiresServerConfiguration: true },
      { mode: 'local', label: '로컬/사내 모델', configured: false, requiresServerConfiguration: true },
    ],
  });
};

const saved = await saveResponseMode('openai', postFetcher);
assert.equal(saved.mode, 'openai');
assert.equal(calls.length, 1);
assert.equal(String(calls[0]?.input), '/api/response-mode');
assert.equal(calls[0]?.init?.method, 'POST');
assert.equal(calls[0]?.init?.headers && new Headers(calls[0].init.headers).get('content-type'), 'application/json');
assert.equal(calls[0]?.init?.body, '{"mode":"openai"}', 'POST body must contain exactly the selected mode');

const unavailableError = await (async () => {
  try {
    await saveResponseMode('openai', async () => response({
      code: 'response-mode-not-configured',
      error: 'OPENAI_API_KEY=super-secret at https://provider.example.test',
    }, 409));
    return undefined;
  } catch (error) {
    return error;
  }
})();
assert.ok(unavailableError instanceof Error);
assert.equal(
  responseModeErrorMessage(unavailableError, 'openai'),
  'OpenAI 응답 모드는 서버 설정이 필요합니다. 결정형 또는 사용 가능한 모드를 선택하세요.',
);
assert.doesNotMatch(responseModeErrorMessage(unavailableError, 'openai'), /OPENAI_API_KEY|https?:\/\//);
assert.equal(
  responseModeErrorMessage(new Error('network failure')),
  '응답 모드 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.',
);

const readyMarkup = renderToStaticMarkup(React.createElement(ResponseModeSelector, {
  state: initial,
  onSelectMode: async () => undefined,
}));
assert.match(readyMarkup, /<fieldset/);
assert.match(readyMarkup, /role="radiogroup"/);
assert.match(readyMarkup, /결정형/);
assert.match(readyMarkup, /OpenAI/);
assert.match(readyMarkup, /로컬\/사내 모델/);
assert.match(readyMarkup, /disabled=""/);
assert.doesNotMatch(readyMarkup, /provider\.example|super-secret|OPENAI_API_KEY|10\.0\.0\.5/);

const loadingMarkup = renderToStaticMarkup(React.createElement(ResponseModeSelector, {
  state: { ...DEFAULT_RESPONSE_MODE_STATE, status: 'loading' },
  onSelectMode: async () => undefined,
}));
assert.match(loadingMarkup, /aria-busy="true"/);
assert.match(loadingMarkup, /응답 모드 상태를 불러오는 중/);

const errorMarkup = renderToStaticMarkup(React.createElement(ResponseModeSelector, {
  state: {
    ...initial,
    status: 'error',
    error: '응답 모드 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.',
  },
  onSelectMode: async () => undefined,
}));
assert.match(errorMarkup, /role="alert"/);
assert.match(errorMarkup, /잠시 후 다시 시도하세요/);
assert.doesNotMatch(errorMarkup, /OPENAI_API_KEY|https?:\/\//);

console.log('Client response-mode selector tests passed');
