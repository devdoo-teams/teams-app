import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const teamsJsTestModule = `
export const app = { initialize: async () => undefined, isInitialized: () => true };
export const authentication = { getAuthToken: async () => 'test-token' };
export const geoLocation = { isSupported: () => false };
export const location = { isSupported: () => false };
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@microsoft/teams-js') {
      return {
        format: 'module',
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(teamsJsTestModule)}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  healthAuthLabel,
  healthBotLabel,
  healthStorageLabel,
  healthUserAuthLabel,
  genAiLabel,
  runtimeBadgeLabel,
} = await import('../src/client/App.js');

assert.equal(healthAuthLabel('teams-authenticated'), 'Teams 인증');
assert.equal(healthAuthLabel('local-bypass'), '로컬 런타임');
assert.equal(healthAuthLabel('not-configured'), '인증 설정 필요');

assert.equal(healthUserAuthLabel('entra-sso'), 'Entra SSO');
assert.equal(healthUserAuthLabel('local-bypass'), '로컬 우회');
assert.equal(healthUserAuthLabel('not-configured'), '인증 설정 필요');

assert.equal(healthBotLabel('teams-sdk'), 'Teams SDK');
assert.equal(healthBotLabel('local-handler'), '로컬 핸들러');
assert.equal(healthBotLabel('not-configured'), 'Bot 설정 필요');

assert.equal(healthStorageLabel('file-json-single-process'), '파일 JSON (단일 프로세스)');
assert.equal(genAiLabel('not-configured'), '미사용 · 결정형 기본');
assert.equal(genAiLabel('deterministic-test'), '결정형 테스트');
assert.equal(genAiLabel('openai-configured'), 'OpenAI (선택형)');
assert.equal(
  runtimeBadgeLabel({ healthLoading: false, teamsHost: false, auth: 'not-configured' }),
  '인증 설정 필요',
);
assert.equal(
  runtimeBadgeLabel({ healthLoading: false, teamsHost: false, auth: 'teams-authenticated' }),
  'Teams 인증',
);

console.log('Client health contract tests passed');
