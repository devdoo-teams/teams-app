import assert from 'node:assert/strict';

import { ensureAzureWorkerBlob } from './azure-worker-blob-stage.mjs';

const accountName = 'teamsappfixture';
const containerName = 'worker-artifacts';
const commit = 'a'.repeat(40);
const blobName = `${commit}/worker-runtime-${commit}.tar`;
const archivePath = '/tmp/worker-runtime.tar';
const sha256 = 'b'.repeat(64);

const calls = [];
const existing = await ensureAzureWorkerBlob({
  accountName,
  containerName,
  blobName,
  archivePath,
  sha256,
  maxAttempts: 1,
  retryDelayMs: 0,
  runAz: async (args) => {
    calls.push(args);
    if (args[1] === 'blob' && args[2] === 'exists') return { stdout: 'true\n', stderr: '' };
    if (args[1] === 'blob' && args[2] === 'metadata') return { stdout: `${sha256}\n`, stderr: '' };
    throw new Error(`unexpected command: ${args.join(' ')}`);
  },
  sleep: async () => {},
});
assert.deepEqual(existing, { status: 'existing', sha256 });
assert.equal(calls.some((args) => args.includes('--auth-mode') && args.includes('login')), true);
const metadataCall = calls.find((args) => args[1] === 'blob' && args[2] === 'metadata');
assert.ok(metadataCall, 'existing Blob validation must read user-defined metadata');
assert.equal(metadataCall[metadataCall.indexOf('--query') + 1], 'sha256', 'metadata show returns the metadata map at the top level');
assert.equal(metadataCall.includes('metadata.sha256'), false, 'metadata show must not query a nested metadata object');

let stage = 0;
const uploaded = await ensureAzureWorkerBlob({
  accountName,
  containerName,
  blobName,
  archivePath,
  sha256,
  maxAttempts: 1,
  retryDelayMs: 0,
  runAz: async (args) => {
    if (args[1] === 'blob' && args[2] === 'exists') {
      stage += 1;
      return { stdout: stage === 1 ? 'false\n' : 'true\n', stderr: '' };
    }
    if (args[1] === 'blob' && args[2] === 'upload') {
      const error = new Error('Azure CLI failed');
      error.stderr = 'Blob upload interrupted after the request was accepted';
      throw error;
    }
    if (args[1] === 'blob' && args[2] === 'metadata') return { stdout: `${sha256}\n`, stderr: '' };
    throw new Error(`unexpected command: ${args.join(' ')}`);
  },
  sleep: async () => {},
});
assert.deepEqual(uploaded, { status: 'existing-after-upload-race', sha256 });

await assert.rejects(
  ensureAzureWorkerBlob({
    accountName,
    containerName,
    blobName,
    archivePath,
    sha256,
    maxAttempts: 1,
    retryDelayMs: 0,
    runAz: async (args) => {
      if (args[1] === 'blob' && args[2] === 'exists') return { stdout: 'false\n', stderr: '' };
      if (args[1] === 'blob' && args[2] === 'upload') {
        const error = new Error('Azure CLI failed');
        error.stderr = 'AuthorizationPermissionMismatch: caller is not authorized';
        throw error;
      }
      throw new Error(`unexpected command: ${args.join(' ')}`);
    },
    sleep: async () => {},
  }),
  /AuthorizationPermissionMismatch/i,
  'a failed upload must preserve a safe diagnostic instead of collapsing to exit code 1',
);

await assert.rejects(
  ensureAzureWorkerBlob({
    accountName,
    containerName,
    blobName: '../secret',
    archivePath,
    sha256,
  }),
  /blob name/i,
);

console.log('azure-worker-blob-stage-test: PASS');
