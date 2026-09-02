import assert from 'node:assert/strict';

import { resolveAzureReleaseIdentity } from '../src/server/azure-release-identity.js';

const receipt = Object.freeze({
  commit: 'a'.repeat(40),
  version: '1.0.100',
  imageDigest: `sha256:${'b'.repeat(64)}`,
  teamsPackageSha256: 'c'.repeat(64),
  clientBundleSha256: 'd'.repeat(64),
  serverBundleSha256: 'e'.repeat(64),
});

const azureEnvironment = Object.freeze({
  AZURE_RELEASE_MODE: 'true',
  RELEASE_SOURCE_COMMIT: receipt.commit,
  RELEASE_APP_VERSION: receipt.version,
  RELEASE_IMAGE_DIGEST: receipt.imageDigest,
  RELEASE_TEAMS_PACKAGE_SHA256: receipt.teamsPackageSha256,
  RELEASE_CLIENT_BUNDLE_SHA256: receipt.clientBundleSha256,
  RELEASE_SERVER_BUNDLE_SHA256: receipt.serverBundleSha256,
});

assert.deepEqual(
  resolveAzureReleaseIdentity(azureEnvironment, {
    appVersion: receipt.version,
    sourceCommit: receipt.commit,
    serverBundleSha256: receipt.serverBundleSha256,
  }),
  receipt,
  'Azure release mode must expose the complete non-secret attested identity only when it matches the running server',
);

assert.throws(
  () => resolveAzureReleaseIdentity({
    ...azureEnvironment,
    RELEASE_CLIENT_BUNDLE_SHA256: 'not-a-sha256',
  }, {
    appVersion: receipt.version,
    sourceCommit: receipt.commit,
    serverBundleSha256: receipt.serverBundleSha256,
  }),
  /RELEASE_CLIENT_BUNDLE_SHA256/i,
  'Azure release mode must fail closed for malformed receipt identity fields',
);

assert.throws(
  () => resolveAzureReleaseIdentity({
    ...azureEnvironment,
    RELEASE_TEAMS_PACKAGE_SHA256: '',
  }, {
    appVersion: receipt.version,
    sourceCommit: receipt.commit,
    serverBundleSha256: receipt.serverBundleSha256,
  }),
  /RELEASE_TEAMS_PACKAGE_SHA256/i,
  'Azure release mode must fail closed for a missing receipt identity field',
);

assert.throws(
  () => resolveAzureReleaseIdentity({
    ...azureEnvironment,
    RELEASE_SERVER_BUNDLE_SHA256: 'f'.repeat(64),
  }, {
    appVersion: receipt.version,
    sourceCommit: receipt.commit,
    serverBundleSha256: receipt.serverBundleSha256,
  }),
  /server bundle/i,
  'Azure release mode must fail closed when the receipt does not describe the running server bundle',
);

assert.equal(
  resolveAzureReleaseIdentity({}, {
    appVersion: receipt.version,
    sourceCommit: receipt.commit,
    serverBundleSha256: receipt.serverBundleSha256,
  }),
  undefined,
  'local/Core environments must not claim an Azure release identity',
);

assert.equal(
  resolveAzureReleaseIdentity({
    RELEASE_SOURCE_COMMIT: receipt.commit,
    RELEASE_APP_VERSION: receipt.version,
  }, {
    appVersion: receipt.version,
    sourceCommit: receipt.commit,
    serverBundleSha256: receipt.serverBundleSha256,
  }),
  undefined,
  'a legacy local/Core process with release-looking environment values must not claim Azure identity without explicit Azure release mode',
);

console.log('PASS: Azure release identity is complete, matched to the running server, and absent outside Azure release mode.');
