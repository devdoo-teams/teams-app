export type ClientBuildStamp = Readonly<{
  schemaVersion: 1; version: string; sourceCommit: string; mode: 'core' | 'optional'; buildFingerprint: string;
}>;
export type ClientBuildIdentity = ClientBuildStamp & Readonly<{ clientBundleSha256: string }>;
export type IndependentIdentityAssessment = Readonly<{
  status: 'PASS' | 'FAIL' | 'UNVERIFIED'; mismatches: readonly string[]; missing: readonly string[];
}>;
export type IndependentReleaseExpectedIdentity = Readonly<{
  version?: string; sourceCommit?: string; packageSha256?: string; clientBundleSha256?: string;
  serverBundleSha256?: string; clientBuildFingerprint?: string; clientBuildMode?: 'core' | 'optional';
}>;
export function parseClientBuildStamp(value: unknown): ClientBuildStamp | undefined;
export function assessIndependentReleaseIdentity(expected: IndependentReleaseExpectedIdentity, observation: unknown): IndependentIdentityAssessment;
export function assessClientRuntimeIdentity(loaded: unknown, runtime: unknown): IndependentIdentityAssessment;
