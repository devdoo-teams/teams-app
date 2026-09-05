import assert from 'node:assert/strict';

import { probeAzureStorageBlobAccess } from './azure-storage-blob-rbac-probe.mjs';

const accountName = 'teamsappfixture';
const containerName = 'worker-artifacts';
const commit = 'a'.repeat(40);
const blobName = `${commit}/worker-runtime-${commit}.tar`;
const authorizationError = `You do not have the required permissions needed to perform this operation.\nStorage Blob Data Contributor`;

const calls = [];
let attempts = 0;
const exists = await probeAzureStorageBlobAccess({
  accountName,
  containerName,
  blobName,
  maxAttempts: 3,
  retryDelayMs: 0,
  runAz: async (args) => {
    calls.push(args);
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('Azure CLI failed');
      error.stderr = authorizationError;
      throw error;
    }
    return { stdout: 'false\n', stderr: '' };
  },
  sleep: async () => {},
});
assert.equal(exists, false);
assert.equal(calls.length, 3, 'recognized RBAC propagation errors must be retried within the bound');
for (const args of calls) {
  assert.deepEqual(args, [
    'storage', 'blob', 'exists',
    '--auth-mode', 'login',
    '--account-name', accountName,
    '--container-name', containerName,
    '--name', blobName,
    '--query', 'exists',
    '--output', 'tsv',
    '--only-show-errors',
  ]);
  assert.equal(args.includes('key'), false);
  assert.equal(args.some((value) => /sas|account-key/i.test(value)), false);
}

let unknownCalls = 0;
await assert.rejects(
  probeAzureStorageBlobAccess({
    accountName,
    containerName,
    blobName,
    maxAttempts: 5,
    retryDelayMs: 0,
    runAz: async () => {
      unknownCalls += 1;
      const error = new Error('Azure CLI failed');
      error.stderr = 'The storage account name is invalid.';
      throw error;
    },
    sleep: async () => {},
  }),
  /storage account name is invalid/i,
);
assert.equal(unknownCalls, 1, 'non-RBAC failures must not enter a retry loop');

let exhaustedCalls = 0;
await assert.rejects(
  probeAzureStorageBlobAccess({
    accountName,
    containerName,
    blobName,
    maxAttempts: 2,
    retryDelayMs: 0,
    runAz: async () => {
      exhaustedCalls += 1;
      const error = new Error('Azure CLI failed');
      error.stderr = authorizationError;
      throw error;
    },
    sleep: async () => {},
  }),
  /did not propagate after 2 attempts/i,
);
assert.equal(exhaustedCalls, 2);

await assert.rejects(
  probeAzureStorageBlobAccess({
    accountName,
    containerName,
    blobName: '../secret',
    runAz: async () => ({ stdout: 'true', stderr: '' }),
  }),
  /blob name/i,
);

console.log('azure-storage-blob-rbac-probe-test: PASS');
