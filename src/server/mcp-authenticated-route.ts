import type { RequestHandler } from 'express';

import {
  buildMcpProtectedResourceMetadata,
  buildMcpWwwAuthenticate,
  type McpAuthConfig,
} from './mcp-auth-config.js';

type EnabledMcpAuthConfig = Extract<McpAuthConfig, { enabled: true }>;

export type McpAuthenticatedBoundaryHost = {
  get(path: string, handler: RequestHandler): unknown;
  use(path: string, handler: RequestHandler): unknown;
};

/** Mount public discovery and the authenticated MCP bearer boundary. */
export function mountMcpAuthenticatedBoundary(
  host: McpAuthenticatedBoundaryHost,
  config: EnabledMcpAuthConfig,
  authenticate: RequestHandler,
): void {
  const metadataPath = new URL(config.metadataUrl).pathname;
  host.get(metadataPath, (_request, response) => {
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.type('application/json').json(buildMcpProtectedResourceMetadata(config));
  });
  host.use('/mcp', (request, response, next) => {
    response.setHeader('WWW-Authenticate', buildMcpWwwAuthenticate(config));
    authenticate(request, response, next);
  });
}
