export type A2AProviderIdentityFact = Readonly<{
  provider: string;
  agentId: string;
  providerId: string;
}>;

export type A2AProviderExecutionState = 'configured' | 'unavailable' | 'unknown';

export type A2AProviderFact = A2AProviderIdentityFact & Readonly<{
  configured: boolean;
  /** Startup configuration only; it is not proof of a completed child run. */
  execution: A2AProviderExecutionState;
  executionReason?: string;
}>;

const REMOTE_A2A_EXECUTION_UNVERIFIED_REASON = 'live-round-trip-unverified.';

export function createA2AProviderFacts(
  localProviders: readonly A2AProviderFact[],
  remoteProvider?: A2AProviderIdentityFact,
): A2AProviderFact[] {
  return [
    ...localProviders,
    ...(remoteProvider
      ? [{
        ...remoteProvider,
        configured: true,
        execution: 'unknown' as const,
        executionReason: REMOTE_A2A_EXECUTION_UNVERIFIED_REASON,
      }]
      : []),
  ];
}

export function unverifiedRemoteA2AProviderFact(remoteProvider: A2AProviderIdentityFact): A2AProviderFact {
  return {
    ...remoteProvider,
    configured: true,
    execution: 'unknown',
    executionReason: REMOTE_A2A_EXECUTION_UNVERIFIED_REASON,
  };
}
