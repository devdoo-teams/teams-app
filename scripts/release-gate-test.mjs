import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import process from 'node:process';

import {
  assertPackagedManifest,
  assertPublicAsset,
  assertServerBuildIdentity,
  assertPublicTab,
  assertPublicHealth,
  assertReleaseRuntimePrerequisites,
  createReleaseSourceEnvironment,
  createPreflightCommands,
  formatReleaseFailure,
  parseDotEnv,
  packageGateTimeoutMs,
  resolvePublicUrl,
  resolveReleaseProfile,
  runWithTimeout,
  validatePublicTabDeployment,
} from './release-gate.mjs';

const expected = {
  version: '1.0.15',
  sourceCommit: '0123456789abcdef0123456789abcdef01234567',
  serverBundleSha256: 'a'.repeat(64),
  appId: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5',
  tabDomain: 'runtime.example.com',
  clientId: '5b48ad62-f024-4a63-b3e8-66b589e3cd43',
  botClientId: '32127cdd-f19d-4fce-95c9-431e27cca739',
  applicationIdUri: 'api://runtime.example.com/botid-32127cdd-f19d-4fce-95c9-431e27cca739',
};

assert.equal(resolveReleaseProfile({}), 'core', 'the release profile must default to Core');
assert.equal(resolveReleaseProfile({ TEAMS_RELEASE_RUNTIME: 'core' }), 'core');
assert.equal(resolveReleaseProfile({ TEAMS_RELEASE_RUNTIME: 'optional' }), 'optional');
assert.throws(
  () => resolveReleaseProfile({ TEAMS_RELEASE_RUNTIME: 'grok' }),
  /TEAMS_RELEASE_RUNTIME|core|optional/i,
  'unsupported release profiles must fail closed',
);
assert.doesNotThrow(() => assertReleaseRuntimePrerequisites(
  { TEAMS_OPTIONAL_RUNTIME: 'true', XAI_API_KEY: 'xai-test-secret' },
  'optional',
));
assert.throws(
  () => assertReleaseRuntimePrerequisites({ XAI_API_KEY: 'xai-test-secret' }, 'optional'),
  /TEAMS_OPTIONAL_RUNTIME/i,
  'optional releases must require the optional runtime flag',
);
assert.throws(
  () => assertReleaseRuntimePrerequisites({ TEAMS_OPTIONAL_RUNTIME: 'true' }, 'optional'),
  /XAI_API_KEY/i,
  'optional Grok releases must require a non-empty API key',
);
const optionalPreflight = createPreflightCommands(123, 'optional');
assert.equal(optionalPreflight.find(([, script]) => script === 'build:server')?.[0], 'optional-server-build');
assert.equal(optionalPreflight.some(([, script]) => script === 'build:core'), false);

assert.deepEqual(
  createPreflightCommands(123),
  [
    ['core-source-check', 'typecheck:core', 123],
    ['core-build', 'build:core', 123],
    ['server-build-determinism', 'test:server-build-determinism', 123],
    ['core-test', 'test:core', 123],
    ['deployment', 'check:deployment', 123],
  ],
  'preflight must lock server bundle determinism before package/public identity checks',
);
assert.equal(
  packageGateTimeoutMs(),
  1_320_000,
  'package timeout must cover the two checks, four bounded package commands, and cleanup overhead',
);

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
  sourceCommit: expected.sourceCommit,
  serverBundleSha256: expected.serverBundleSha256,
};

{
  const entryBytes = Buffer.from('pinned server bundle');
  const bundleSha256 = crypto.createHash('sha256').update(entryBytes).digest('hex');
  const marker = {
    schemaVersion: 3,
    sourceCommit: expected.sourceCommit,
    commit: expected.sourceCommit,
    mode: 'core',
    worktree: 'clean',
    bundleSha256,
  };
  assert.deepEqual(
    assertServerBuildIdentity(marker, entryBytes, expected.sourceCommit),
    { sourceCommit: expected.sourceCommit, serverBundleSha256: bundleSha256 },
  );
  const optionalMarker = { ...marker, mode: 'optional' };
  assert.deepEqual(
    assertServerBuildIdentity(optionalMarker, entryBytes, expected.sourceCommit, 'optional'),
    { sourceCommit: optionalMarker.sourceCommit, serverBundleSha256: bundleSha256 },
  );
  assert.throws(
    () => assertServerBuildIdentity(optionalMarker, entryBytes, expected.sourceCommit),
    /Core|mode/i,
    'an optional marker must not satisfy the default Core identity check',
  );
  assert.throws(
    () => assertServerBuildIdentity(marker, entryBytes, 'f'.repeat(40)),
    /source.*commit|OID|identity/i,
  );
}

{
  const calls = [];
  const releaseSource = createReleaseSourceEnvironment(
    { EXISTING: 'value', TEAMS_SOURCE_COMMIT: expected.sourceCommit },
    {
      rootDir: '/repo',
      verifySource(rootDir, options) {
        calls.push({ rootDir, options });
        return { verificationMode: 'worktree-index-commit', commitOid: options.commitOid };
      },
    },
  );
  assert.equal(releaseSource.sourceCommit, expected.sourceCommit);
  assert.equal(releaseSource.profile, 'core', 'the default release source must expose the Core profile');
  assert.equal(releaseSource.env.TEAMS_SOURCE_COMMIT, expected.sourceCommit);
  assert.equal(releaseSource.env.EXISTING, 'value');
  assert.equal(calls.length, 1, 'the release gate must pin its source OID exactly once');
  assert.equal(calls[0].options.commitOid, expected.sourceCommit);
}

{
  const releaseSource = createReleaseSourceEnvironment(
    {
      TEAMS_RELEASE_RUNTIME: 'optional',
      TEAMS_OPTIONAL_RUNTIME: 'true',
      XAI_API_KEY: 'xai-test-secret',
      TEAMS_SOURCE_COMMIT: expected.sourceCommit,
    },
    {
      rootDir: '/repo',
      verifySource(rootDir, options) {
        return { verificationMode: 'worktree-index-commit', commitOid: options.commitOid };
      },
    },
  );
  assert.equal(releaseSource.profile, 'optional', 'optional profile must remain visible in release identity');
}

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
assert.doesNotThrow(() => assertPublicHealth(validHealth, expected));
assert.doesNotThrow(
  () => assertPublicHealth({
    ...validHealth,
    genAI: 'grok-configured',
    genAIProvider: { provider: 'grok' },
    responseProviders: { grok: true },
  }, expected, 'optional'),
  'optional public health must attest to a configured Grok provider',
);
assert.throws(
  () => assertPublicHealth({ ...validHealth, genAI: 'not-configured' }, expected, 'optional'),
  /Grok|configured|response provider/i,
  'optional public health must not accept a non-Grok runtime',
);
assert.throws(
  () => assertPublicHealth({ ...validHealth, outbound: 'local-outbox' }, expected),
  /outbound/,
);
assert.throws(
  () => assertPublicHealth({ ...validHealth, sourceCommit: undefined }, expected),
  /source commit/i,
);
assert.throws(
  () => assertPublicHealth({ ...validHealth, sourceCommit: 'f'.repeat(40) }, expected),
  /source commit/i,
);
assert.throws(
  () => assertPublicHealth({ ...validHealth, serverBundleSha256: undefined }, expected),
  /server bundle/i,
);
assert.throws(
  () => assertPublicHealth({ ...validHealth, serverBundleSha256: 'b'.repeat(64) }, expected),
  /server bundle/i,
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
const validAssetSha256 = crypto.createHash('sha256').update(validBundle).digest('hex');
assert.equal(
  assertPublicAsset(validAssetResponse, validBundle, { ...validTab, expectedSha256: validAssetSha256 }).buildId,
  validBuildId,
);
assert.throws(
  () => assertPublicAsset(validAssetResponse, validBundle, { ...validTab, expectedSha256: 'b'.repeat(64) }),
  /expected client asset|SHA-256|hash/i,
  'the public gate must reject a client asset whose full digest differs from the local build',
);
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
  expectedAssetSha256: validAssetSha256,
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

const reapTimeoutReport = formatReleaseFailure(
  Object.assign(new Error('Process group did not exit during cleanup'), {
    code: 'EPROCESSREAPTIMEOUT',
    command: 'fixture-process',
  }),
  'package',
);
assert.equal(reapTimeoutReport.status, 'BLOCKED', 'a process reap timeout must be blocked');
assert.equal(reapTimeoutReport.blocker.code, 'EPROCESSREAPTIMEOUT');

const redactionSecret = 'xai-test-secret';
const redactedFailure = formatReleaseFailure(
  Object.assign(new Error('optional command failed'), {
    stdout: `provider key=${redactionSecret}`,
    stderr: `provider key=${redactionSecret}`,
  }),
  'preflight',
  { XAI_API_KEY: redactionSecret },
);
assert.equal(JSON.stringify(redactedFailure).includes(redactionSecret), false, 'release evidence must not leak XAI_API_KEY');
assert.match(JSON.stringify(redactedFailure), /REDACTED/);

console.log('Release gate contract tests passed.');
