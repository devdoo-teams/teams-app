export type AzureReleaseIdentity = Readonly<{
  commit: string;
  version: string;
  imageDigest: string;
  teamsPackageSha256: string;
  clientBundleSha256: string;
  serverBundleSha256: string;
}>;

type AzureReleaseEnvironment = Readonly<Record<string, string | undefined>>;
type RunningServerIdentity = Readonly<{
  appVersion: string;
  sourceCommit: string;
  serverBundleSha256: string;
}>;

const commitPattern = /^[a-f0-9]{40}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function requiredEnvironmentValue(environment: AzureReleaseEnvironment, name: string): string {
  const value = environment[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Azure release identity requires ${name}.`);
  }
  return value;
}

function assertPattern(name: string, value: string, pattern: RegExp): void {
  if (!pattern.test(value)) throw new Error(`Azure release identity ${name} is invalid.`);
}

/**
 * Resolves the public Azure release identity only from an explicit revision
 * environment. The identity intentionally contains immutable non-secret
 * values and is rejected when it disagrees with the running server artifact.
 */
export function resolveAzureReleaseIdentity(
  environment: AzureReleaseEnvironment,
  running: RunningServerIdentity,
): AzureReleaseIdentity | undefined {
  const mode = environment.AZURE_RELEASE_MODE;
  if (mode === undefined || mode === '') return undefined;
  if (mode !== 'true') throw new Error('AZURE_RELEASE_MODE must be exactly true when configured.');

  const identity: AzureReleaseIdentity = Object.freeze({
    commit: requiredEnvironmentValue(environment, 'RELEASE_SOURCE_COMMIT'),
    version: requiredEnvironmentValue(environment, 'RELEASE_APP_VERSION'),
    imageDigest: requiredEnvironmentValue(environment, 'RELEASE_IMAGE_DIGEST'),
    teamsPackageSha256: requiredEnvironmentValue(environment, 'RELEASE_TEAMS_PACKAGE_SHA256'),
    clientBundleSha256: requiredEnvironmentValue(environment, 'RELEASE_CLIENT_BUNDLE_SHA256'),
    serverBundleSha256: requiredEnvironmentValue(environment, 'RELEASE_SERVER_BUNDLE_SHA256'),
  });

  assertPattern('RELEASE_SOURCE_COMMIT', identity.commit, commitPattern);
  assertPattern('RELEASE_APP_VERSION', identity.version, versionPattern);
  assertPattern('RELEASE_IMAGE_DIGEST', identity.imageDigest, imageDigestPattern);
  for (const [name, value] of [
    ['RELEASE_TEAMS_PACKAGE_SHA256', identity.teamsPackageSha256],
    ['RELEASE_CLIENT_BUNDLE_SHA256', identity.clientBundleSha256],
    ['RELEASE_SERVER_BUNDLE_SHA256', identity.serverBundleSha256],
  ] as const) {
    assertPattern(name, value, sha256Pattern);
  }

  if (identity.commit !== running.sourceCommit) {
    throw new Error('Azure release identity commit does not match the running server bundle.');
  }
  if (identity.version !== running.appVersion) {
    throw new Error('Azure release identity version does not match the running application.');
  }
  if (identity.serverBundleSha256 !== running.serverBundleSha256) {
    throw new Error('Azure release identity server bundle digest does not match the running server bundle.');
  }

  return identity;
}
