import assert from 'node:assert/strict';
import http from 'node:http';

import express from 'express';

import { createUserAuthMiddleware } from '../src/server/user-auth.js';
import { mountMcpAuthenticatedBoundary } from '../src/server/mcp-authenticated-route.js';
import { resolveMcpAuthConfig } from '../src/server/mcp-auth-config.js';

const resolved = resolveMcpAuthConfig({
  requested: true,
  coreBuild: false,
  isProduction: true,
  userAuthConfigured: true,
  userAuthValidatorConfigured: true,
  acceptedAudiences: ['mcp-client'],
  resourceOrigin: 'https://teams.example.com',
  authorizationServerUrl: 'https://login.example.com/tenant/v2.0',
  requiredScope: 'mcp.read',
  providerToolsEnabled: true,
  providerEndpointConfigured: true,
  providerCredentialConfigured: true,
});
assert.equal(resolved.enabled, true, 'route fixture has an enabled MCP auth contract');
if (!resolved.enabled) throw new Error('route fixture did not resolve to enabled');

const authenticate = createUserAuthMiddleware({
  allowUnauthenticated: false,
  validator: {
    validateAccessToken: async (token) => token === 'valid-token'
      ? { tid: 'tenant-a', aud: 'mcp-client', scp: 'mcp.read', oid: 'requester-a' }
      : null,
  },
  configuredTenantId: 'tenant-a',
  acceptedAudiences: ['mcp-client'],
  requiredDelegatedScope: 'mcp.read',
  logger: { warn: () => undefined },
});

const app = express();
mountMcpAuthenticatedBoundary(app, resolved, authenticate);
app.post('/mcp', (_request, response) => response.json({ ok: true }));

const server = http.createServer(app);
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert(address && typeof address === 'object', 'route fixture has a bound address');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(metadata.status, 200, 'protected-resource metadata is public and discoverable');
  assert.match(metadata.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await metadata.json(), {
    resource: 'https://teams.example.com/mcp',
    authorization_servers: ['https://login.example.com/tenant/v2.0'],
    scopes_supported: ['mcp.read'],
    bearer_methods_supported: ['header'],
  });

  const missing = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
  assert.equal(missing.status, 401, 'missing bearer is rejected');
  assert.equal(
    missing.headers.get('www-authenticate'),
    'Bearer resource_metadata="https://teams.example.com/.well-known/oauth-protected-resource/mcp", scope="mcp.read"',
  );

  const invalid = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { authorization: 'Bearer invalid-token' },
  });
  assert.equal(invalid.status, 401, 'invalid bearer is rejected');
  assert.equal(invalid.headers.get('www-authenticate'), missing.headers.get('www-authenticate'));

  const valid = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
  });
  assert.equal(valid.status, 200, 'validated bearer reaches the MCP handler');
  assert.deepEqual(await valid.json(), { ok: true });
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log('MCP authenticated route test passed: metadata discovery, bearer challenge, invalid-token rejection, and valid-token pass-through.');
