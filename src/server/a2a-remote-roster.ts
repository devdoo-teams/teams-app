const MAX_REMOTE_PEERS = 8;
const MAX_LIST_VALUES = 8;
const MAX_IDENTIFIER_LENGTH = 120;
const MAX_LIST_VALUE_LENGTH = 120;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_ROSTER_JSON_LENGTH = 32_768;
const MAX_BEARER_TOKEN_LENGTH = 4_096;
const MAX_ERROR_MESSAGE_LENGTH = 256;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const SAFE_ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

const REMOTE_KINDS = new Set<A2ARemotePeerKind>(['a2a', 'hermes', 'grok-hermes']);
const PEER_KEYS = Object.freeze([
  'agentId',
  'providerId',
  'kind',
  'endpoint',
  'tokenEnv',
  'executionIdentity',
  'executionBoundaryId',
  'roles',
  'capabilities',
  'expectedPeerIdentity',
  'credentialPrincipal',
] as const);
const REQUIRED_PEER_KEYS = Object.freeze([
  'agentId',
  'providerId',
  'kind',
  'endpoint',
  'tokenEnv',
  'executionIdentity',
  'executionBoundaryId',
  'roles',
  'capabilities',
] as const);
const UNIQUE_PEER_FIELDS = Object.freeze([
  'agentId',
  'providerId',
  'endpoint',
  'tokenEnv',
  'executionIdentity',
  'executionBoundaryId',
] as const);

export type A2ARemotePeerKind = 'a2a' | 'hermes' | 'grok-hermes';

/**
 * Configuration for one independently addressable remote A2A peer.
 *
 * A roster deliberately contains a token environment-variable name rather
 * than a credential. Credentials are resolved only for an individual runtime
 * operation by resolveA2ARemotePeerCredentials.
 */
export type A2ARemotePeerConfig = Readonly<{
  agentId: string;
  providerId: string;
  kind: A2ARemotePeerKind;
  endpoint: string;
  tokenEnv: string;
  executionIdentity: string;
  executionBoundaryId: string;
  roles: readonly string[];
  capabilities: readonly string[];
  expectedPeerIdentity?: string;
  credentialPrincipal?: string;
}>;

export type A2ARemotePeerCredential = Readonly<A2ARemotePeerConfig & {
  bearerToken: string;
}>;

type PeerField = typeof UNIQUE_PEER_FIELDS[number];

function fail(message: string): never {
  throw new Error(message.slice(0, MAX_ERROR_MESSAGE_LENGTH));
}

function failAt(index: number, field: string, issue: string): never {
  return fail(`TEAMS_A2A_REMOTE_AGENTS[${index}].${field} ${issue}.`);
}

function failRoster(issue: string): never {
  return fail(`TEAMS_A2A_REMOTE_AGENTS ${issue}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertAllowedKeys(record: Record<string, unknown>, index: number): void {
  const allowed = new Set<string>(PEER_KEYS);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    failAt(index, 'peer', 'contains an unsupported field');
  }
}

function boundedIdentifier(value: unknown, index: number, field: string): string {
  if (
    typeof value !== 'string'
    || value.length > MAX_IDENTIFIER_LENGTH
    || !SAFE_IDENTIFIER.test(value)
  ) {
    failAt(index, field, 'must be a bounded identifier');
  }
  return value;
}

function boundedKind(value: unknown, index: number): A2ARemotePeerKind {
  if (typeof value !== 'string' || !REMOTE_KINDS.has(value as A2ARemotePeerKind)) {
    failAt(index, 'kind', 'must be one of a2a, hermes, or grok-hermes');
  }
  return value as A2ARemotePeerKind;
}

function boundedEndpoint(value: unknown, index: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_ENDPOINT_LENGTH
    || value !== value.trim()
    || CONTROL_CHARACTERS.test(value)
    || value.includes('?')
    || value.includes('#')
  ) {
    failAt(index, 'endpoint', 'must be an HTTPS URL without credentials, query, or fragment');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    failAt(index, 'endpoint', 'must be an HTTPS URL without credentials, query, or fragment');
  }
  if (
    endpoint.protocol !== 'https:'
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
  ) {
    failAt(index, 'endpoint', 'must be an HTTPS URL without credentials, query, or fragment');
  }

  const normalized = endpoint.toString();
  if (normalized.length > MAX_ENDPOINT_LENGTH) {
    failAt(index, 'endpoint', 'must be an HTTPS URL without credentials, query, or fragment');
  }
  return normalized;
}

function boundedTokenEnv(value: unknown, index: number): string {
  if (typeof value !== 'string' || !SAFE_ENV_NAME.test(value)) {
    failAt(index, 'tokenEnv', 'must be an uppercase environment variable name');
  }
  return value;
}

function boundedList(value: unknown, index: number, field: 'roles' | 'capabilities'): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIST_VALUES) {
    failAt(index, field, `must contain one to ${MAX_LIST_VALUES} values`);
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== 'string'
      || entry.length > MAX_LIST_VALUE_LENGTH
      || !entry.trim()
      || CONTROL_CHARACTERS.test(entry)
    ) {
      failAt(index, field, 'contains an invalid value');
    }
    const normalized = entry.trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      values.push(normalized);
    }
  }
  if (values.length === 0) failAt(index, field, `must contain one to ${MAX_LIST_VALUES} values`);
  return Object.freeze(values);
}

function boundedPeerName(value: unknown, index: number): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value !== value.trim()
    || value.length > MAX_LIST_VALUE_LENGTH
    || CONTROL_CHARACTERS.test(value)
  ) {
    failAt(index, 'expectedPeerIdentity', 'must be bounded text');
  }
  return value;
}

function normalizePeer(value: unknown, index: number): A2ARemotePeerConfig {
  if (!isRecord(value)) failAt(index, 'peer', 'must be an object');
  assertAllowedKeys(value, index);
  if (REQUIRED_PEER_KEYS.some((key) => !hasOwn(value, key))) {
    failAt(index, 'peer', 'is missing a required field');
  }

  const kind = boundedKind(value.kind, index);
  if (kind === 'hermes' && (!hasOwn(value, 'expectedPeerIdentity') || !hasOwn(value, 'credentialPrincipal'))) {
    failAt(index, 'peer', 'is missing Hermes peer identity configuration');
  }
  if (kind !== 'hermes' && (hasOwn(value, 'expectedPeerIdentity') || hasOwn(value, 'credentialPrincipal'))) {
    failAt(index, 'peer', 'contains Hermes-only identity configuration');
  }
  const peer = {
    agentId: boundedIdentifier(value.agentId, index, 'agentId'),
    providerId: boundedIdentifier(value.providerId, index, 'providerId'),
    kind,
    endpoint: boundedEndpoint(value.endpoint, index),
    tokenEnv: boundedTokenEnv(value.tokenEnv, index),
    executionIdentity: boundedIdentifier(value.executionIdentity, index, 'executionIdentity'),
    executionBoundaryId: boundedIdentifier(value.executionBoundaryId, index, 'executionBoundaryId'),
    roles: boundedList(value.roles, index, 'roles'),
    capabilities: boundedList(value.capabilities, index, 'capabilities'),
    ...(kind === 'hermes' ? {
      expectedPeerIdentity: boundedPeerName(value.expectedPeerIdentity, index),
      credentialPrincipal: boundedIdentifier(value.credentialPrincipal, index, 'credentialPrincipal'),
    } : {}),
  } satisfies A2ARemotePeerConfig;
  return Object.freeze(peer);
}

function assertUnique(
  peer: A2ARemotePeerConfig,
  index: number,
  seen: ReadonlyMap<PeerField, Set<string>>,
): void {
  for (const field of UNIQUE_PEER_FIELDS) {
    const values = seen.get(field);
    if (!values) fail('TEAMS_A2A_REMOTE_AGENTS uniqueness state is invalid.');
    const value = peer[field];
    if (values.has(value)) failAt(index, field, 'must be unique across peers');
    values.add(value);
  }
}

function normalizeRoster(entries: readonly unknown[]): readonly A2ARemotePeerConfig[] {
  if (entries.length > MAX_REMOTE_PEERS) {
    failRoster(`must contain at most ${MAX_REMOTE_PEERS} peers`);
  }

  const seen = new Map<PeerField, Set<string>>(
    UNIQUE_PEER_FIELDS.map((field) => [field, new Set<string>()]),
  );
  const roster = entries.map((entry, index) => {
    const peer = normalizePeer(entry, index);
    assertUnique(peer, index, seen);
    return peer;
  });
  return Object.freeze(roster);
}

export function parseA2ARemotePeerRoster(rawValue: string | undefined): readonly A2ARemotePeerConfig[] {
  if (rawValue === undefined) return Object.freeze([]);
  if (typeof rawValue !== 'string') failRoster('must be a JSON array');

  const raw = rawValue.trim();
  if (!raw) return Object.freeze([]);
  if (raw.length > MAX_ROSTER_JSON_LENGTH) failRoster('JSON input is too large');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    failRoster('must contain valid JSON');
  }
  if (!Array.isArray(parsed)) failRoster('must be a JSON array');
  return normalizeRoster(parsed);
}

function normalizedInputRoster(roster: readonly A2ARemotePeerConfig[]): readonly A2ARemotePeerConfig[] {
  if (!Array.isArray(roster)) failRoster('roster must be an array');
  return normalizeRoster(roster);
}

function readBearerToken(
  environment: Readonly<Record<string, string | undefined>>,
  peer: A2ARemotePeerConfig,
  index: number,
): string {
  let hasCredential: boolean;
  try {
    hasCredential = Object.prototype.hasOwnProperty.call(environment, peer.tokenEnv);
  } catch {
    failAt(index, 'credential', 'could not be resolved');
  }
  if (!hasCredential) {
    failAt(index, 'credential', `environment variable ${peer.tokenEnv} is missing`);
  }

  let value: unknown;
  try {
    value = environment[peer.tokenEnv];
  } catch {
    failAt(index, 'credential', 'could not be resolved');
  }
  if (
    typeof value !== 'string'
    || value.length > MAX_BEARER_TOKEN_LENGTH
    || /[\r\n]/u.test(value)
    || !value.trim()
  ) {
    failAt(index, 'credential', `environment variable ${peer.tokenEnv} is missing or invalid`);
  }
  return value.trim();
}

export function resolveA2ARemotePeerCredentials(
  roster: readonly A2ARemotePeerConfig[],
  environment: Readonly<Record<string, string | undefined>>,
): readonly A2ARemotePeerCredential[] {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    failRoster('credential environment must be an object');
  }
  const normalizedRoster = normalizedInputRoster(roster);
  const credentials = normalizedRoster.map((peer, index) => Object.freeze({
    ...peer,
    bearerToken: readBearerToken(environment, peer, index),
  }));
  return Object.freeze(credentials);
}
