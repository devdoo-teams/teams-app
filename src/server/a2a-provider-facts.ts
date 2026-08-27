export type A2AProviderIdentityFact = Readonly<{
  provider: string;
  agentId: string;
  providerId: string;
}>;

export type A2AProviderFact = A2AProviderIdentityFact & Readonly<{
  configured: boolean;
}>;

export function createA2AProviderFacts(
  localProviders: readonly A2AProviderFact[],
  remoteProvider?: A2AProviderIdentityFact,
): A2AProviderFact[] {
  return [
    ...localProviders,
    ...(remoteProvider ? [{ ...remoteProvider, configured: true }] : []),
  ];
}
