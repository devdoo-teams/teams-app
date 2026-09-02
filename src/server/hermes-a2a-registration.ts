import type { A2AAgentAuthorizationPolicy } from './a2a-agent-authorization.js';
import type { A2AConfiguredRemoteAgentFailure } from './a2a-remote-agent-adapter.js';
import type { A2ARemoteFetch } from './a2a-remote-client.js';
import type { A2ARemotePeerConfig } from './a2a-remote-roster.js';
import type { A2AProductionAgent } from './a2a-production-runtime.js';
import { createHermesA2AProductionAgent } from './hermes-a2a-adapter.js';
import type { ProviderLifecycleStore } from './provider-lifecycle-runner.js';

export type ConfiguredHermesA2AAgentsOptions = Readonly<{
  peers: readonly A2ARemotePeerConfig[];
  store: ProviderLifecycleStore;
  authorizationPolicyFor: (agentId: string) => A2AAgentAuthorizationPolicy;
  environment?: Readonly<Record<string, string | undefined>>;
  fetchForPeer?: (peer: A2ARemotePeerConfig) => A2ARemoteFetch | undefined;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
}>;

export type ConfiguredHermesA2AAgentsResult = Readonly<{
  agents: readonly A2AProductionAgent[];
  failures: readonly A2AConfiguredRemoteAgentFailure[];
}>;

/**
 * Registers only explicitly configured Hermes A2A v1 peers. A failed peer is
 * isolated from healthy peers and reports only safe roster identities.
 */
export async function createConfiguredHermesA2AAgents(
  options: ConfiguredHermesA2AAgentsOptions,
): Promise<ConfiguredHermesA2AAgentsResult> {
  const agents: A2AProductionAgent[] = [];
  const failures: A2AConfiguredRemoteAgentFailure[] = [];
  for (const peer of options.peers) {
    if (peer.kind !== 'hermes') throw new TypeError('Hermes registration accepts only kind=hermes peers.');
    try {
      if (!peer.expectedPeerIdentity || !peer.credentialPrincipal) {
        throw new TypeError('Hermes peer identity configuration is required.');
      }
      const fetcher = options.fetchForPeer?.(peer);
      agents.push(await createHermesA2AProductionAgent({
        store: options.store,
        agentId: peer.agentId,
        providerId: peer.providerId,
        origin: peer.endpoint,
        expectedPeerIdentity: peer.expectedPeerIdentity,
        credentialPrincipal: peer.credentialPrincipal,
        credentialRef: peer.tokenEnv,
        executionIdentity: peer.executionIdentity,
        executionBoundaryId: peer.executionBoundaryId,
        roles: peer.roles,
        capabilities: peer.capabilities,
        authorizationPolicy: options.authorizationPolicyFor(peer.agentId),
        ...(options.environment ? { environment: options.environment } : {}),
        ...(fetcher ? { fetch: fetcher } : {}),
        ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
        ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      }));
    } catch {
      failures.push(Object.freeze({
        agentId: peer.agentId,
        providerId: peer.providerId,
        kind: peer.kind,
        code: 'CONFIGURATION_ERROR',
      }));
    }
  }
  return Object.freeze({
    agents: Object.freeze(agents),
    failures: Object.freeze(failures),
  });
}
