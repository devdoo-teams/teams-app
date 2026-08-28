import assert from 'node:assert/strict';

import {
  createPrincipalScopedCredentialBroker,
  type ProviderCredentialBackend,
  type ProviderPrincipal,
} from '../src/server/mcp-provider-auth-boundary.js';

const principal: ProviderPrincipal = { tenantId: 'tenant-a', requesterId: 'requester-a' };
const rawToken = 'raw-provider-token-must-not-cross-the-boundary';
const received: Array<Record<string, unknown>> = [];

const backend: ProviderCredentialBackend = {
  async send(request) {
    received.push({
      principal: request.principal,
      provider: request.provider,
      url: request.url,
      headers: request.headers,
    });
    return new Response(JSON.stringify({
      account: 'visible-account',
      access_token: rawToken,
      message: `Bearer ${rawToken}`,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
};

const broker = createPrincipalScopedCredentialBroker({ principal, backend });
const success = await broker.request('atlassian', {
  url: 'https://provider.example.test/api/resource',
  headers: { Accept: 'application/json' },
});

assert.equal(success.ok, true, 'provider response succeeds through the broker');
assert.deepEqual(received[0]?.principal, principal, 'backend receives the bound principal');
assert.equal(received[0]?.provider, 'atlassian', 'backend receives the selected provider');
assert.deepEqual(received[0]?.headers, { accept: 'application/json' }, 'caller headers are normalized without auth material');
assert.equal(JSON.stringify(success).includes(rawToken), false, 'raw credentials never cross the public result boundary');

const invalidAuthRequest = await broker.request('bitbucket', {
  url: 'https://provider.example.test/api/resource',
  headers: { Authorization: `Bearer ${rawToken}` },
});
assert.equal(invalidAuthRequest.ok, false, 'credential-bearing requests fail closed');
assert.equal(invalidAuthRequest.error.code, 'invalid-request', 'credential headers are broker-owned');
assert.equal(received.length, 1, 'rejected credential-bearing requests do not reach the backend');

const isolatedPrincipal: ProviderPrincipal = { tenantId: 'tenant-b', requesterId: 'requester-b' };
const isolatedBroker = createPrincipalScopedCredentialBroker({ principal: isolatedPrincipal, backend });
await isolatedBroker.request('bitbucket', { url: 'https://provider.example.test/api/resource' });
assert.deepEqual(received[1]?.principal, isolatedPrincipal, 'each broker instance remains scoped to its own principal');

const oversizedResponseBroker = createPrincipalScopedCredentialBroker({
  principal,
  backend: {
    async send() {
      return new Response('x'.repeat(256 * 1024 + 1), { status: 200 });
    },
  },
});
const oversizedResponse = await oversizedResponseBroker.request('atlassian', { url: 'https://provider.example.test/api/resource' });
assert.equal(oversizedResponse.ok, false, 'direct credential boundary bounds provider response bodies');
if (!oversizedResponse.ok) assert.equal(oversizedResponse.error.code, 'provider-error', 'oversized direct responses use the stable provider error');

const oversizedRequest = await broker.request('atlassian', {
  url: 'https://provider.example.test/api/resource',
  method: 'POST',
  body: 'é'.repeat(33_000),
});
assert.equal(oversizedRequest.ok, false, 'direct credential boundary bounds request bodies by UTF-8 bytes');
if (!oversizedRequest.ok) assert.equal(oversizedRequest.error.code, 'invalid-request', 'oversized direct requests use the stable validation error');
assert.equal(received.length, 2, 'oversized direct requests never reach the backend');

console.log('PASS: principal-scoped provider credential boundary owns auth headers, redacts sensitive output, and fails closed');
