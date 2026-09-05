import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { resolveAzureServicePrincipalObjectId } from './azure-access-token-principal.mjs';

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function token(payload) {
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.fixture-signature`;
}

const expectedTenantId = '32441482-5adf-4438-8a8f-0e15f33b77f1';
const expectedClientId = '11111111-2222-3333-4444-555555555555';
const expectedObjectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const v1Token = token({
  aud: 'https://management.core.windows.net/',
  appid: expectedClientId,
  oid: expectedObjectId,
  tid: expectedTenantId,
  ver: '1.0',
});

assert.equal(resolveAzureServicePrincipalObjectId({
  accessToken: v1Token,
  expectedTenantId,
  expectedClientId,
}), expectedObjectId);

assert.equal(resolveAzureServicePrincipalObjectId({
  accessToken: token({
    aud: 'https://management.azure.com/',
    azp: expectedClientId.toUpperCase(),
    oid: expectedObjectId.toUpperCase(),
    tid: expectedTenantId.toUpperCase(),
    ver: '2.0',
  }),
  expectedTenantId,
  expectedClientId,
}), expectedObjectId);

for (const [name, accessToken, pattern] of [
  ['malformed JWT', 'not-a-jwt', /JWT/i],
  ['missing object ID', token({ appid: expectedClientId, tid: expectedTenantId }), /object ID/i],
  ['tenant mismatch', token({ appid: expectedClientId, oid: expectedObjectId, tid: '99999999-9999-9999-9999-999999999999' }), /tenant/i],
  ['client mismatch', token({ appid: '99999999-9999-9999-9999-999999999999', oid: expectedObjectId, tid: expectedTenantId }), /client/i],
  ['conflicting client claims', token({ appid: expectedClientId, azp: '99999999-9999-9999-9999-999999999999', oid: expectedObjectId, tid: expectedTenantId }), /client/i],
]) {
  assert.throws(
    () => resolveAzureServicePrincipalObjectId({ accessToken, expectedTenantId, expectedClientId }),
    pattern,
    name,
  );
}

const cliPath = path.join(import.meta.dirname, 'azure-access-token-principal.mjs');
const cli = spawnSync(process.execPath, [
  cliPath,
  '--expected-tenant', expectedTenantId,
  '--expected-client', expectedClientId,
], {
  encoding: 'utf8',
  input: v1Token,
});
assert.equal(cli.status, 0, cli.stderr);
assert.equal(cli.stdout.trim(), expectedObjectId);
assert.equal(cli.stderr.includes(v1Token), false, 'the bearer token must never be echoed');

const rejected = spawnSync(process.execPath, [
  cliPath,
  '--expected-tenant', expectedTenantId,
  '--expected-client', expectedClientId,
], {
  encoding: 'utf8',
  input: `${v1Token}.unexpected`,
});
assert.notEqual(rejected.status, 0);
assert.equal(rejected.stderr.includes(v1Token), false, 'rejection diagnostics must never echo the bearer token');

console.log('azure-access-token-principal-test: PASS');
