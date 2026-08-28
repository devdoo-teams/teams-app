export type McpAuthDisabledReason =
  | 'not-requested'
  | 'core-build'
  | 'user-auth-not-configured'
  | 'authorization-server-not-configured'
  | 'scope-not-configured'
  | 'provider-tools-not-configured'
  | 'provider-credentials-not-configured'
  | 'resource-origin-not-configured';

export type McpAuthConfigInput = Readonly<{
  requested: boolean;
  coreBuild: boolean;
  isProduction: boolean;
  userAuthConfigured: boolean;
  userAuthValidatorConfigured: boolean;
  acceptedAudiences: readonly string[];
  resourceOrigin?: string;
  authorizationServerUrl?: string;
  requiredScope?: string;
  providerToolsEnabled: boolean;
  providerEndpointConfigured: boolean;
  providerCredentialConfigured: boolean;
}>;

export type McpAuthConfig = Readonly<{
  enabled: true;
  resourceUrl: string;
  metadataUrl: string;
  authorizationServerUrl: string;
  requiredScope: string;
}> | Readonly<{
  enabled: false;
  reason: McpAuthDisabledReason;
}>;

function parseCleanHttpsUrl(value: string | undefined): URL | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function parseResourceOrigin(value: string | undefined): URL | undefined {
  const parsed = parseCleanHttpsUrl(value);
  if (!parsed || parsed.pathname !== '/' || parsed.port) return undefined;
  return parsed;
}

export function resolveMcpAuthConfig(input: McpAuthConfigInput): McpAuthConfig {
  if (!input.requested) return { enabled: false, reason: 'not-requested' };
  if (input.coreBuild) return { enabled: false, reason: 'core-build' };

  if (
    !input.userAuthConfigured
    || !input.userAuthValidatorConfigured
    || input.acceptedAudiences.length === 0
  ) return { enabled: false, reason: 'user-auth-not-configured' };

  const resourceOrigin = parseResourceOrigin(input.resourceOrigin);
  if (!resourceOrigin) return { enabled: false, reason: 'resource-origin-not-configured' };

  const authorizationServer = parseCleanHttpsUrl(input.authorizationServerUrl);
  if (!authorizationServer) return { enabled: false, reason: 'authorization-server-not-configured' };

  const requiredScope = input.requiredScope?.trim() ?? '';
  if (!requiredScope || requiredScope.length > 256 || /[\u0000-\u001f\u007f\s]/.test(requiredScope)) {
    return { enabled: false, reason: 'scope-not-configured' };
  }

  if (!input.providerToolsEnabled) return { enabled: false, reason: 'provider-tools-not-configured' };
  if (!input.providerEndpointConfigured) return { enabled: false, reason: 'provider-tools-not-configured' };
  if (!input.providerCredentialConfigured) return { enabled: false, reason: 'provider-credentials-not-configured' };

  const resourceUrl = new URL('/mcp', resourceOrigin).toString();
  return {
    enabled: true,
    resourceUrl,
    metadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', resourceOrigin).toString(),
    authorizationServerUrl: authorizationServer.toString(),
    requiredScope,
  };
}

export function buildMcpProtectedResourceMetadata(config: Extract<McpAuthConfig, { enabled: true }>): Record<string, unknown> {
  return {
    resource: config.resourceUrl,
    authorization_servers: [config.authorizationServerUrl],
    scopes_supported: [config.requiredScope],
    bearer_methods_supported: ['header'],
  };
}

export function buildMcpWwwAuthenticate(config: Extract<McpAuthConfig, { enabled: true }>): string {
  return `Bearer resource_metadata="${config.metadataUrl}", scope="${config.requiredScope}"`;
}
