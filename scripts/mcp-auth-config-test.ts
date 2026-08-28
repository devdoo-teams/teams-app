import assert from 'node:assert/strict';

import {
  buildMcpProtectedResourceMetadata,
  buildMcpWwwAuthenticate,
  resolveMcpAuthConfig,
} from '../src/server/mcp-auth-config.js';

const base = {
  coreBuild: false,
  isProduction: true,
  userAuthConfigured: true,
  userAuthValidatorConfigured: true,
  acceptedAudiences: ['client-id'],
  resourceOrigin: 'https://teams.example.com',
  authorizationServerUrl: 'https://login.example.com/oauth2',
  requiredScope: 'access_as_user',
  providerToolsEnabled: true,
  providerEndpointConfigured: true,
  providerCredentialConfigured: true,
} as const;

const disabled = resolveMcpAuthConfig({ ...base, requested: false });
assert.equal(disabled.enabled, false, 'authenticated MCP remains disabled unless explicitly requested');

const coreDisabled = resolveMcpAuthConfig({ ...base, requested: true, coreBuild: true });
assert.equal(coreDisabled.enabled, false, 'Core build cannot expose optional MCP');

const missingAudience = resolveMcpAuthConfig({ ...base, requested: true, acceptedAudiences: [] });
assert.equal(missingAudience.enabled, false, 'missing delegated audience fails closed');
assert.equal(missingAudience.reason, 'user-auth-not-configured', 'missing auth contract is explicit');

const missingAuthorizationServer = resolveMcpAuthConfig({ ...base, requested: true, authorizationServerUrl: undefined });
assert.equal(missingAuthorizationServer.enabled, false, 'MCP does not guess an authorization server');
assert.equal(missingAuthorizationServer.reason, 'authorization-server-not-configured');

const missingScope = resolveMcpAuthConfig({ ...base, requested: true, requiredScope: undefined });
assert.equal(missingScope.enabled, false, 'MCP does not guess a delegated scope');
assert.equal(missingScope.reason, 'scope-not-configured');

const enabled = resolveMcpAuthConfig({ ...base, requested: true });
assert.equal(enabled.enabled, true, 'explicit authenticated provider configuration enables MCP');
if (enabled.enabled) {
  assert.equal(enabled.resourceUrl, 'https://teams.example.com/mcp');
  assert.equal(enabled.metadataUrl, 'https://teams.example.com/.well-known/oauth-protected-resource/mcp');
  assert.equal(enabled.requiredScope, 'access_as_user');

  assert.deepEqual(buildMcpProtectedResourceMetadata(enabled), {
    resource: 'https://teams.example.com/mcp',
    authorization_servers: ['https://login.example.com/oauth2'],
    scopes_supported: ['access_as_user'],
    bearer_methods_supported: ['header'],
  });
  assert.equal(
    buildMcpWwwAuthenticate(enabled),
    'Bearer resource_metadata="https://teams.example.com/.well-known/oauth-protected-resource/mcp", scope="access_as_user"',
  );
}

console.log('MCP auth config test passed: explicit opt-in, Core fail-closed, metadata, and bearer challenge contract.');
