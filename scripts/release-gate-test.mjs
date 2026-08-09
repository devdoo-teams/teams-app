import assert from 'node:assert/strict';
import process from 'node:process';

import {
  assertPackagedManifest,
  assertPublicHealth,
  formatReleaseFailure,
  parseDotEnv,
  resolvePublicUrl,
  runWithTimeout,
} from './release-gate.mjs';

const expected = {
  version: '1.0.15',
  appId: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5',
  tabDomain: 'runtime.example.com',
  clientId: '5b48ad62-f024-4a63-b3e8-66b589e3cd43',
  applicationIdUri: 'api://runtime.example.com/5b48ad62-f024-4a63-b3e8-66b589e3cd43',
};

const validManifest = {
  version: expected.version,
  id: expected.appId,
  staticTabs: [{ contentUrl: `https://${expected.tabDomain}/tabs/home` }],
  devicePermissions: ['geolocation'],
  webApplicationInfo: {
    id: expected.clientId,
    resource: expected.applicationIdUri,
  },
};

const validHealth = {
  ok: true,
  version: expected.version,
  environment: 'production',
  auth: 'teams-authenticated',
  userAuth: 'entra-sso',
  bot: 'teams-sdk',
  outbound: 'teams-sdk',
};

assert.deepEqual(parseDotEnv('A=one\nB="two words"\n# ignored\n'), {
  A: 'one',
  B: 'two words',
});
assert.equal(resolvePublicUrl({ TEAMS_PUBLIC_URL: 'https://explicit.test/' }), 'https://explicit.test');
assert.equal(resolvePublicUrl({ PUBLIC_BASE_URL: 'https://base.test/' }), 'https://base.test');
assert.equal(resolvePublicUrl({ TAB_DOMAIN: 'tab.test' }), 'https://tab.test');
assert.equal(resolvePublicUrl({}), undefined);
assert.doesNotThrow(() => assertPackagedManifest(validManifest, expected));
assert.throws(
  () => assertPackagedManifest({ ...validManifest, devicePermissions: [] }, expected),
  /geolocation/,
);
assert.doesNotThrow(() => assertPublicHealth(validHealth, expected.version));
assert.throws(
  () => assertPublicHealth({ ...validHealth, outbound: 'local-outbox' }, expected.version),
  /outbound/,
);
assert.throws(
  () => assertPackagedManifest({ ...validManifest, webApplicationInfo: { ...validManifest.webApplicationInfo, resource: '${{APPLICATION_ID_URI}}' } }, expected),
  /placeholder|resource/i,
);
await assert.rejects(
  runWithTimeout(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 25 }),
  /timed out/,
);

const timeoutReport = formatReleaseFailure(
  Object.assign(new Error('Command timed out after 25ms'), {
    code: 'ETIMEDOUT',
    timeoutMs: 25,
    command: 'fixture-command',
  }),
  'preflight',
);
assert.equal(timeoutReport.status, 'BLOCKED', 'a timed-out release phase must be blocked');
assert.equal(timeoutReport.blocker.code, 'ETIMEDOUT');
assert.match(timeoutReport.nextAction, /timed-out/i);

console.log('Release gate contract tests passed.');
