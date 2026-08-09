import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import process from 'node:process';

import {
  assertPackagedManifest,
  assertPublicAsset,
  assertPublicTab,
  assertPublicHealth,
  formatReleaseFailure,
  parseDotEnv,
  resolvePublicUrl,
  runWithTimeout,
  validatePublicTabDeployment,
} from './release-gate.mjs';

const expected = {
  version: '1.0.15',
  appId: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5',
  tabDomain: 'runtime.example.com',
  clientId: '5b48ad62-f024-4a63-b3e8-66b589e3cd43',
  botClientId: '32127cdd-f19d-4fce-95c9-431e27cca739',
  applicationIdUri: 'api://runtime.example.com/botid-32127cdd-f19d-4fce-95c9-431e27cca739',
};

const validManifest = {
  version: expected.version,
  id: expected.appId,
  staticTabs: [{ contentUrl: `https://${expected.tabDomain}/tabs/home/` }],
  validDomains: [expected.tabDomain, 'token.botframework.com'],
  devicePermissions: ['geolocation'],
  webApplicationInfo: {
    id: expected.clientId,
    resource: expected.applicationIdUri,
  },
};

const validHealth = {
  ok: true,
  service: 'teams-sdk-mvp',
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
  () => assertPackagedManifest({ ...validManifest, validDomains: ['token.botframework.com'] }, expected),
  /tab domain|validDomains/i,
);
assert.throws(
  () => assertPackagedManifest({ ...validManifest, validDomains: [expected.tabDomain] }, expected),
  /token\.botframework\.com|validDomains/i,
);
const mismatchedBotContract = {
  ...expected,
  applicationIdUri: `api://${expected.tabDomain}/botid-${expected.clientId}`,
};
assert.throws(
  () => assertPackagedManifest({
    ...validManifest,
    webApplicationInfo: { ...validManifest.webApplicationInfo, resource: mismatchedBotContract.applicationIdUri },
  }, mismatchedBotContract),
  /Bot client ID|resource/i,
);
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
const validTabResponse = {
  status: 200,
  url: `https://${expected.tabDomain}/tabs/home/`,
  headers: { get: (name) => name === 'content-type' ? 'text/html; charset=utf-8' : null },
};
const validBundle = Buffer.from('console.log("release build identity");');
const validBuildId = crypto.createHash('sha256').update(validBundle).digest('hex').slice(0, 12);
const validTab = assertPublicTab(
  validTabResponse,
  `<title>Teams SDK MVP</title><div id="root"></div><script type="module" src="./assets/main.js?v=${validBuildId}"></script>`,
  validManifest,
);
assert.equal(validTab.buildId, validBuildId);
assert.equal(validTab.scriptUrl, `https://${expected.tabDomain}/tabs/home/assets/main.js?v=${validBuildId}`);
const validAssetResponse = {
  status: 200,
  url: validTab.scriptUrl,
  headers: { get: (name) => name === 'content-type' ? 'text/javascript; charset=utf-8' : null },
};
assert.equal(assertPublicAsset(validAssetResponse, validBundle, validTab).buildId, validBuildId);
assert.throws(
  () => assertPublicAsset(validAssetResponse, Buffer.from('console.log("tampered");'), validTab),
  /hash|build|digest|identity/i,
  'the public script bytes must match the build ID referenced by the tab HTML',
);
const publicFetches = [];
const deployedTab = await validatePublicTabDeployment({
  tabUrl: validTabResponse.url,
  manifest: validManifest,
  timeoutMs: 100,
  fetchResource: async (url, _timeoutMs, bodyType) => {
    publicFetches.push({ url, bodyType });
    if (bodyType === 'text') {
      return {
        response: validTabResponse,
        text: `<title>Teams SDK MVP</title><div id="root"></div><script type="module" src="./assets/main.js?v=${validBuildId}"></script>`,
      };
    }
    return { response: validAssetResponse, bytes: validBundle };
  },
});
assert.deepEqual(publicFetches, [
  { url: validTabResponse.url, bodyType: 'text' },
  { url: validTab.scriptUrl, bodyType: 'bytes' },
]);
assert.equal(deployedTab.asset.sha256, crypto.createHash('sha256').update(validBundle).digest('hex'));
assert.throws(
  () => assertPublicTab(
    validTabResponse,
    '<title>Sign in</title><form>Dev Tunnel login</form><!-- Teams SDK MVP <div id="root"></div> assets/main.js?v=abcdef123456 -->',
    validManifest,
  ),
  /sign.?in|login|interstitial|dev.?tunnel|marker|root|build/i,
  'login and Dev Tunnel interstitial HTML cannot satisfy markers hidden in comments',
);
assert.throws(
  () => assertPublicTab(
    { ...validTabResponse, url: 'https://interstitial.example.com/login' },
    '<title>Teams SDK MVP</title><div id="root"></div>',
    validManifest,
  ),
  /origin|path|URL/i,
);
assert.throws(
  () => assertPublicTab(validTabResponse, '<title>Sign in</title><p>interstitial</p>', validManifest),
  /marker|Teams SDK|root|build|sign.?in|login|interstitial/i,
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
