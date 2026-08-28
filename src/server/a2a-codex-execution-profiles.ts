import fs from 'node:fs/promises';
import path from 'node:path';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_AUTH_FILE_BYTES = 1024 * 1024;

export type A2ACodexExecutionProfile = Readonly<{
  ordinal: number;
  codexHome: string;
  codexExecutable: string;
  codexExecutableSha256: string;
}>;

export type A2ACodexExecutionProfilesOptions = Readonly<{
  ordinals: readonly number[];
  environment?: NodeJS.ProcessEnv;
  /** Test seam for platforms without process.getuid(). */
  currentUid?: number;
}>;

export class A2ACodexExecutionProfileConfigurationError extends Error {
  readonly code = 'A2A_CODEX_EXECUTION_PROFILE_CONFIGURATION_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'A2ACodexExecutionProfileConfigurationError';
  }
}

/**
 * Resolve one isolated Codex configuration for each requested A2A ordinal.
 * Only CODEX_BIN and its digest are shared. Profile homes are read from their
 * indexed variables and are never substituted with the legacy unsuffixed home.
 * Auth file contents are intentionally never read, copied, returned, or
 * logged here. Only bounded metadata is checked so a missing/unsafe profile
 * cannot be advertised as execution-ready by the health roster.
 */
export async function createA2ACodexExecutionProfiles(
  options: A2ACodexExecutionProfilesOptions,
): Promise<readonly A2ACodexExecutionProfile[]> {
  const environment = options.environment ?? process.env;
  const ordinals = normalizeOrdinals(options.ordinals);
  const codexExecutable = requiredAbsolute(environment.CODEX_BIN, 'CODEX_BIN');
  const codexExecutableSha256 = requiredDigest(environment.CODEX_BIN_SHA256);
  const currentUid = options.currentUid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined);

  const profiles = await Promise.all(ordinals.map(async (ordinal) => {
    const environmentKey = `AGENT_CODEX_HOME_${ordinal}`;
    const configuredHome = requiredAbsolute(environment[environmentKey], environmentKey);
    const codexHome = await requirePrivateDirectory(configuredHome, environmentKey, currentUid);
    await requirePrivateAuthFileMetadata(codexHome, environmentKey, currentUid);
    return Object.freeze({
      ordinal,
      codexHome,
      codexExecutable,
      codexExecutableSha256,
    });
  }));

  const identities = new Set<string>();
  for (const profile of profiles) {
    const identity = await directoryIdentity(profile.codexHome);
    if (identities.has(identity)) {
      throw new A2ACodexExecutionProfileConfigurationError(
        'indexed A2A Codex profiles must use distinct private homes.',
      );
    }
    identities.add(identity);
  }

  // The unsuffixed home belongs to the ordinary agent service. If it is
  // configured, an indexed A2A home must not silently alias it.
  const legacyHome = environment.AGENT_CODEX_HOME?.trim();
  if (legacyHome) {
    try {
      const legacyIdentity = await directoryIdentity(await fs.realpath(legacyHome));
      if (identities.has(legacyIdentity)) {
        throw new A2ACodexExecutionProfileConfigurationError(
          'indexed A2A Codex profiles must use homes distinct from the legacy service CODEX_HOME.',
        );
      }
    } catch (error) {
      if (error instanceof A2ACodexExecutionProfileConfigurationError
        && error.message.includes('distinct from the legacy service')) {
        throw error;
      }
      // A malformed legacy setting is diagnosed by the ordinary service
      // policy; it must not become an indexed-profile fallback.
    }
  }

  return Object.freeze(profiles);
}

/**
 * Check the ordinary service Codex home without reading credential bytes.
 * This is used only to keep the top-level readiness report truthful; the
 * native provider still performs its full bounded preflight before a job.
 */
export async function isPrivateCodexAuthFileMetadataAvailable(
  candidate: string | undefined,
  currentUid?: number,
): Promise<boolean> {
  if (!candidate?.trim()) return false;
  try {
    const home = await fs.realpath(candidate);
    await requirePrivateAuthFileMetadata(home, 'AGENT_CODEX_HOME', currentUid);
    return true;
  } catch {
    return false;
  }
}

async function requirePrivateAuthFileMetadata(
  codexHome: string,
  variableName: string,
  currentUid: number | undefined,
): Promise<void> {
  const authPath = path.join(codexHome, 'auth.json');
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(authPath);
  } catch {
    throw new A2ACodexExecutionProfileConfigurationError(
      `${variableName}/auth.json is unavailable.`,
    );
  }

  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || stat.size <= 0
    || stat.size > MAX_AUTH_FILE_BYTES
    || (stat.mode & 0o077) !== 0
    || (currentUid !== undefined && stat.uid !== currentUid)
  ) {
    throw new A2ACodexExecutionProfileConfigurationError(
      `${variableName}/auth.json must be one owner-only regular file.`,
    );
  }
}

function normalizeOrdinals(value: readonly number[]): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new A2ACodexExecutionProfileConfigurationError(
      'at least one positive A2A Codex profile ordinal is required.',
    );
  }

  const ordinals = [...value];
  if (ordinals.some((ordinal) => !Number.isSafeInteger(ordinal) || ordinal < 1)) {
    throw new A2ACodexExecutionProfileConfigurationError(
      'A2A Codex profile ordinals must be unique positive integers.',
    );
  }

  const unique = new Set(ordinals);
  if (unique.size !== ordinals.length) {
    throw new A2ACodexExecutionProfileConfigurationError(
      'A2A Codex profile ordinals must be unique positive integers.',
    );
  }
  return ordinals.sort((left, right) => left - right);
}

function requiredAbsolute(value: string | undefined, variableName: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.includes('\u0000') || !path.isAbsolute(normalized)) {
    throw new A2ACodexExecutionProfileConfigurationError(
      `${variableName} must be an explicit absolute path.`,
    );
  }
  return path.normalize(normalized);
}

function requiredDigest(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !SHA256_PATTERN.test(normalized)) {
    throw new A2ACodexExecutionProfileConfigurationError(
      'CODEX_BIN_SHA256 must be an explicit 64-character hexadecimal SHA-256 digest.',
    );
  }
  return normalized;
}

async function requirePrivateDirectory(
  candidate: string,
  variableName: string,
  currentUid: number | undefined,
): Promise<string> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(candidate);
  } catch {
    throw new A2ACodexExecutionProfileConfigurationError(
      `${variableName} must point to an existing private directory.`,
    );
  }

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new A2ACodexExecutionProfileConfigurationError(
      `${variableName} must point to an existing private directory.`,
    );
  }
  if ((stat.mode & 0o077) !== 0 || (currentUid !== undefined && stat.uid !== currentUid)) {
    throw new A2ACodexExecutionProfileConfigurationError(
      `${variableName} must be an owner-only directory owned by the service user.`,
    );
  }
  try {
    return path.normalize(await fs.realpath(candidate));
  } catch {
    throw new A2ACodexExecutionProfileConfigurationError(
      `${variableName} could not be canonicalized safely.`,
    );
  }
}

async function directoryIdentity(candidate: string): Promise<string> {
  try {
    const stat = await fs.lstat(candidate);
    return `${String(stat.dev)}:${String(stat.ino)}`;
  } catch {
    throw new A2ACodexExecutionProfileConfigurationError(
      'indexed A2A Codex profile homes must remain available during validation.',
    );
  }
}
