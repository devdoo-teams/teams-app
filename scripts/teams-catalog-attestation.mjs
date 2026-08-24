import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_API_VERSION = 'v1.0';
const GRAPH_PATH = `/${GRAPH_API_VERSION}/appCatalogs/teamsApps`;
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const DISTRIBUTION_METHOD = 'organization';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RESPONSE_CHUNKS = 1_024;
const MAX_ATTESTATION_AGE_MS = 5 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 30 * 1_000;
const EARLIEST_OBSERVATION_MS = Date.parse('2020-01-01T00:00:00.000Z');
const SCHEMA_VERSION = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IDENTIFIER = /^[A-Za-z0-9._-]{1,128}$/;
const TRUSTED_PROOF_SCHEMES = new Set([
  'ecdsa-p256-sha256',
  'ed25519',
  'hmac-sha256',
  'rsa-pss-sha256',
]);

const INTERNAL_ERRORS = new WeakSet();

const ATTESTATION_KEYS = Object.freeze([
  'appVersion',
  'catalogAppId',
  'catalogBindingSha256',
  'distributionMethod',
  'evidenceAssurance',
  'evidenceSha256',
  'graphApiVersion',
  'manifestExternalId',
  'observationProvenance',
  'observedAt',
  'packageSha256',
  'packagedManifestSha256',
  'querySha256',
  'resultProjectionSha256',
  'schemaVersion',
  'sourceCommit',
  'tenantId',
]);

export class TeamsCatalogAttestationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TeamsCatalogAttestationError';
    this.code = code;
  }
}

function fail(code, message) {
  const error = new TeamsCatalogAttestationError(code, message);
  INTERNAL_ERRORS.add(error);
  throw error;
}

function rethrowInternalOrFail(error, code, message) {
  if (INTERNAL_ERRORS.has(error)) throw error;
  fail(code, message);
}

function rethrowExternalOrTimeout(error, deadline, code, message) {
  if (INTERNAL_ERRORS.has(error)) throw error;
  requireWithinDeadline(deadline);
  fail(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  fail('INVALID_CANONICAL_VALUE', 'attestation data is not canonically serializable');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeUuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    fail('INVALID_INPUT', `${label} must be a UUID`);
  }
  return value.toLowerCase();
}

function normalizeSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('INVALID_INPUT', `${label} must be a lowercase SHA-256`);
  }
  return value;
}

function normalizeSourceCommit(value) {
  if (typeof value !== 'string' || !SOURCE_COMMIT.test(value)) {
    fail('INVALID_INPUT', 'sourceCommit must be a lowercase full Git object ID');
  }
  return value;
}

function normalizeAppVersion(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.trim() !== value) {
    fail('INVALID_INPUT', 'appVersion must be a non-empty bounded string');
  }
  return value;
}

function normalizeObservedAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('INVALID_INPUT', 'observedAt must be a valid timestamp');
  const normalized = date.toISOString();
  if (typeof value === 'string' && value !== normalized) {
    fail('INVALID_INPUT', 'observedAt must be a canonical UTC ISO timestamp');
  }
  return normalized;
}

function normalizeSubject(input) {
  if (!isPlainObject(input)) fail('INVALID_INPUT', 'attestation options must be an object');
  const manifestId = Object.prototype.hasOwnProperty.call(input, 'manifestId')
    ? ownDataValue(input, 'manifestId', 'INVALID_INPUT', 'manifestId must be an own data property')
    : ownDataValue(
      input,
      'manifestExternalId',
      'INVALID_INPUT',
      'manifestExternalId must be an own data property',
    );
  return {
    tenantId: normalizeUuid(
      ownDataValue(input, 'tenantId', 'INVALID_INPUT', 'tenantId must be an own data property'),
      'tenantId',
    ),
    catalogAppId: normalizeUuid(
      ownDataValue(
        input,
        'catalogAppId',
        'INVALID_INPUT',
        'catalogAppId must be an own data property',
      ),
      'catalogAppId',
    ),
    manifestExternalId: normalizeUuid(manifestId, 'manifestId'),
    appVersion: normalizeAppVersion(
      ownDataValue(input, 'appVersion', 'INVALID_INPUT', 'appVersion must be an own data property'),
    ),
    sourceCommit: normalizeSourceCommit(
      ownDataValue(
        input,
        'sourceCommit',
        'INVALID_INPUT',
        'sourceCommit must be an own data property',
      ),
    ),
    packageSha256: normalizeSha256(
      ownDataValue(
        input,
        'packageSha256',
        'INVALID_INPUT',
        'packageSha256 must be an own data property',
      ),
      'packageSha256',
    ),
    packagedManifestSha256: normalizeSha256(
      ownDataValue(
        input,
        'packagedManifestSha256',
        'INVALID_INPUT',
        'packagedManifestSha256 must be an own data property',
      ),
      'packagedManifestSha256',
    ),
  };
}

export function buildTeamsCatalogQuery({ catalogAppId, manifestId, manifestExternalId } = {}) {
  const catalog = normalizeUuid(catalogAppId, 'catalogAppId');
  const manifest = normalizeUuid(manifestId ?? manifestExternalId, 'manifestId');
  const filter = `id eq '${catalog}' and externalId eq '${manifest}' and distributionMethod eq '${DISTRIBUTION_METHOD}'`;
  const url = new URL(GRAPH_PATH, GRAPH_ORIGIN);
  url.searchParams.set('$filter', filter);
  url.searchParams.set('$select', 'id,externalId,distributionMethod');
  return url.href;
}

function resultProjection({ catalogAppId, manifestExternalId }) {
  return {
    id: catalogAppId,
    externalId: manifestExternalId,
    distributionMethod: DISTRIBUTION_METHOD,
  };
}

function catalogBinding({ tenantId, catalogAppId, manifestExternalId }) {
  return {
    tenantId,
    catalogAppId,
    manifestExternalId,
    distributionMethod: DISTRIBUTION_METHOD,
  };
}

function createTimeoutError() {
  const error = new TeamsCatalogAttestationError(
    'GRAPH_REQUEST_TIMEOUT',
    'Graph request exceeded 10 seconds',
  );
  INTERNAL_ERRORS.add(error);
  return error;
}

function startDeadline() {
  const controller = new AbortController();
  let timeoutHandle;
  const deadline = {
    controller,
    expiresAt: performance.now() + REQUEST_TIMEOUT_MS,
    timeout: undefined,
    stop() {
      clearTimeout(timeoutHandle);
    },
  };
  deadline.timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = createTimeoutError();
      controller.abort(error);
      reject(error);
    }, REQUEST_TIMEOUT_MS);
  });
  return deadline;
}

function requireWithinDeadline(deadline) {
  if (deadline.controller.signal.aborted || performance.now() >= deadline.expiresAt) {
    if (!deadline.controller.signal.aborted) deadline.controller.abort(createTimeoutError());
    fail('GRAPH_REQUEST_TIMEOUT', 'Graph request exceeded 10 seconds');
  }
}

function exactOwnKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expectedKeys.length && actual.every((key, index) => key === expectedKeys[index]);
}

function ownDataValue(value, key, code = 'INVALID_INPUT', message = 'input field is invalid') {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    fail(code, message);
  }
  return descriptor.value;
}

function exactOwnDataObject(value, expectedKeys, code, message) {
  if (!exactOwnKeys(value, [...expectedKeys].sort())) fail(code, message);
  const output = Object.create(null);
  for (const key of expectedKeys) output[key] = ownDataValue(value, key, code, message);
  return output;
}

function normalizeProvider(provider, allowlist, expectedTenantId) {
  if (!Array.isArray(allowlist) || !Object.isFrozen(allowlist) || !allowlist.includes(provider)) {
    fail('UNTRUSTED_TOKEN_PROVIDER', 'Graph token provider is not an allowlisted integration');
  }
  if (!Object.isFrozen(provider)) {
    fail('UNTRUSTED_TOKEN_PROVIDER', 'Graph token provider must be an immutable allowlisted integration');
  }
  const record = exactOwnDataObject(
    provider,
    ['integrationId', 'tenantId', 'authority', 'acquisition', 'acquireToken'],
    'UNTRUSTED_TOKEN_PROVIDER',
    'Graph token provider has an invalid integration contract',
  );
  if (typeof record.integrationId !== 'string' || !IDENTIFIER.test(record.integrationId)) {
    fail('UNTRUSTED_TOKEN_PROVIDER', 'Graph token provider identity is invalid');
  }
  const tenantId = normalizeUuid(record.tenantId, 'trusted provider tenantId');
  if (tenantId !== expectedTenantId) {
    fail('TENANT_BINDING_MISMATCH', 'Graph token provider is not bound to the expected tenant');
  }
  let authority;
  try {
    authority = new URL(record.authority);
  } catch {
    fail('TENANT_BINDING_MISMATCH', 'Graph token provider authority is invalid');
  }
  if (
    authority.protocol !== 'https:'
    || authority.hostname !== 'login.microsoftonline.com'
    || authority.port !== ''
    || authority.username !== ''
    || authority.password !== ''
    || authority.search !== ''
    || authority.hash !== ''
    || authority.pathname !== `/${tenantId}/`
  ) {
    fail('TENANT_BINDING_MISMATCH', 'Graph token provider authority is not tenant-specific');
  }
  if (!Object.isFrozen(record.acquisition)) {
    fail('UNTRUSTED_TOKEN_PROVIDER', 'Graph token acquisition metadata must be immutable');
  }
  const acquisition = exactOwnDataObject(
    record.acquisition,
    ['credentialType', 'grant', 'permission', 'scope'],
    'UNTRUSTED_TOKEN_PROVIDER',
    'Graph token acquisition metadata is invalid',
  );
  if (
    acquisition.credentialType !== 'confidential-client'
    || acquisition.grant !== 'client-credentials'
    || acquisition.permission !== 'AppCatalog.Read.All'
    || acquisition.scope !== GRAPH_SCOPE
  ) {
    fail('UNTRUSTED_TOKEN_PROVIDER', 'Graph token acquisition metadata is not least-privileged');
  }
  if (typeof record.acquireToken !== 'function') {
    fail('UNTRUSTED_TOKEN_PROVIDER', 'Graph token provider has no acquisition adapter');
  }
  return {
    acquireToken(argument) {
      return Reflect.apply(record.acquireToken, provider, [argument]);
    },
    metadata: Object.freeze({
      integrationId: record.integrationId,
      tenantId,
      authority: authority.href,
      acquisition: Object.freeze({ ...acquisition }),
    }),
  };
}

async function readBoundedJson(response, deadline) {
  let reader;
  let cancelReader = true;
  try {
    try {
      reader = response?.body?.getReader?.();
    } catch {
      fail('GRAPH_RESPONSE_FORMAT', 'Graph response body is not a readable byte stream');
    }
    if (!reader) fail('GRAPH_RESPONSE_FORMAT', 'Graph response body is not a readable byte stream');

    let contentLengthValue;
    try {
      contentLengthValue = response?.headers?.get?.('content-length');
    } catch {
      fail('GRAPH_RESPONSE_FORMAT', 'Graph response has invalid headers');
    }
    if (contentLengthValue !== null && contentLengthValue !== undefined) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(contentLengthValue)) {
        fail('GRAPH_RESPONSE_FORMAT', 'Graph response has an invalid content length');
      }
      if (Number(contentLengthValue) > MAX_RESPONSE_BYTES) {
        fail('GRAPH_RESPONSE_TOO_LARGE', 'Graph response exceeds 64 KiB');
      }
    }

    const chunks = [];
    let bytes = 0;
    let chunkCount = 0;
    while (true) {
      requireWithinDeadline(deadline);
      let readResult;
      try {
        const readPromise = reader.read();
        requireWithinDeadline(deadline);
        readResult = await Promise.race([Promise.resolve(readPromise), deadline.timeout]);
        requireWithinDeadline(deadline);
      } catch (error) {
        rethrowExternalOrTimeout(
          error,
          deadline,
          'GRAPH_RESPONSE_FAILED',
          'Graph response body could not be read',
        );
      }
      if (!isPlainObject(readResult)) {
        fail('GRAPH_RESPONSE_FORMAT', 'Graph response reader returned an invalid result');
      }
      const done = ownDataValue(
        readResult,
        'done',
        'GRAPH_RESPONSE_FORMAT',
        'Graph response reader result is missing done',
      );
      const value = ownDataValue(
        readResult,
        'value',
        'GRAPH_RESPONSE_FORMAT',
        'Graph response reader result is missing value',
      );
      if (typeof done !== 'boolean') {
        fail('GRAPH_RESPONSE_FORMAT', 'Graph response reader done flag is invalid');
      }
      requireWithinDeadline(deadline);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        fail('GRAPH_RESPONSE_FORMAT', 'Graph response contained a non-byte chunk');
      }
      chunkCount += 1;
      if (chunkCount > MAX_RESPONSE_CHUNKS || value.byteLength === 0) {
        fail('GRAPH_RESPONSE_WORK_LIMIT', 'Graph response exceeded the bounded stream work limit');
      }
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        fail('GRAPH_RESPONSE_TOO_LARGE', 'Graph response exceeds 64 KiB');
      }
      chunks.push(value);
    }

    const source = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(source);
    } catch {
      fail('GRAPH_RESPONSE_FORMAT', 'Graph response is not valid UTF-8');
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      fail('GRAPH_RESPONSE_FORMAT', 'Graph response is not valid JSON');
    }
    if (!isPlainObject(parsed)) fail('GRAPH_RESPONSE_FORMAT', 'Graph response must be a JSON object');
    cancelReader = false;
    return parsed;
  } catch (error) {
    rethrowInternalOrFail(
      error,
      'GRAPH_RESPONSE_FAILED',
      'Graph response body could not be read',
    );
  } finally {
    if (reader && cancelReader) {
      try {
        Promise.resolve(reader.cancel?.('catalog-attestation-aborted')).catch(() => {});
      } catch {
        // External cancellation details are intentionally discarded.
      }
    }
    try {
      reader?.releaseLock?.();
    } catch {
      // A release failure cannot make a sanitized response error disclose transport details.
    }
  }
}

async function observeCatalog(subject, provider, fetchFn, deadline) {
  const signal = deadline.controller.signal;
  let tokenRecord;
  try {
    requireWithinDeadline(deadline);
    const tokenResult = provider.acquireToken({
      tenantId: subject.tenantId,
      scopes: Object.freeze([GRAPH_SCOPE]),
      signal,
    });
    requireWithinDeadline(deadline);
    tokenRecord = await Promise.race([Promise.resolve(tokenResult), deadline.timeout]);
    requireWithinDeadline(deadline);
  } catch (error) {
    rethrowExternalOrTimeout(
      error,
      deadline,
      'TOKEN_PROVIDER_FAILED',
      'tenant-bound Graph token acquisition failed',
    );
  }

  if (!exactOwnKeys(tokenRecord, ['accessToken'])) {
    fail('TOKEN_PROVIDER_INVALID', 'token provider returned an invalid tenant-bound result');
  }
  const accessToken = ownDataValue(
    tokenRecord,
    'accessToken',
    'TOKEN_PROVIDER_INVALID',
    'token provider returned invalid access token material',
  );
  if (
    typeof accessToken !== 'string'
    || accessToken.length === 0
    || accessToken.length > 16 * 1024
    || !/^[\x21-\x7e]+$/.test(accessToken)
  ) {
    fail('TOKEN_PROVIDER_INVALID', 'token provider returned invalid access token material');
  }

  const queryUrl = buildTeamsCatalogQuery(subject);
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${accessToken}`,
  });

  let response;
  try {
    requireWithinDeadline(deadline);
    const fetchResult = fetchFn(queryUrl, {
      method: 'GET',
      headers,
      signal,
      redirect: 'error',
    });
    requireWithinDeadline(deadline);
    response = await Promise.race([Promise.resolve(fetchResult), deadline.timeout]);
    requireWithinDeadline(deadline);
  } catch (error) {
    rethrowExternalOrTimeout(
      error,
      deadline,
      'GRAPH_REQUEST_FAILED',
      'Graph request failed',
    );
  } finally {
    tokenRecord = undefined;
  }

  if (!response || response.status !== 200) {
    fail('GRAPH_HTTP_STATUS', 'Graph request did not return HTTP 200');
  }

  requireWithinDeadline(deadline);
  const payload = await Promise.race([readBoundedJson(response, deadline), deadline.timeout]);
  requireWithinDeadline(deadline);
  if (Object.prototype.hasOwnProperty.call(payload, '@odata.nextLink')) {
    fail('GRAPH_PAGINATION_FORBIDDEN', 'Graph response must not be paginated');
  }
  const value = ownDataValue(
    payload,
    'value',
    'GRAPH_RESPONSE_FORMAT',
    'Graph response value must be an own data property',
  );
  if (!Array.isArray(value)) {
    fail('GRAPH_RESPONSE_FORMAT', 'Graph response value must be an array');
  }
  if (value.length !== 1) {
    fail('GRAPH_RESULT_CARDINALITY', 'Graph response must contain exactly one matching app');
  }

  const match = value[0];
  if (!isPlainObject(match)) fail('GRAPH_RESPONSE_FORMAT', 'Graph result must be an object');
  const id = ownDataValue(
    match,
    'id',
    'GRAPH_RESPONSE_FORMAT',
    'Graph result id must be an own data property',
  );
  const externalId = ownDataValue(
    match,
    'externalId',
    'GRAPH_RESPONSE_FORMAT',
    'Graph result externalId must be an own data property',
  );
  const distributionMethod = ownDataValue(
    match,
    'distributionMethod',
    'GRAPH_RESPONSE_FORMAT',
    'Graph result distributionMethod must be an own data property',
  );
  if (id !== subject.catalogAppId || externalId !== subject.manifestExternalId) {
    fail('GRAPH_RESULT_MISMATCH', 'Graph result IDs do not match the release subject');
  }
  if (
    typeof distributionMethod !== 'string'
    || !/^[\x00-\x7f]+$/.test(distributionMethod)
    || distributionMethod.toLowerCase() !== DISTRIBUTION_METHOD
  ) {
    fail('GRAPH_RESULT_MISMATCH', 'Graph result is not an organization-distributed app');
  }

  return { queryUrl, provider: provider.metadata };
}

function createAttestationPayload(subject, observedAt, queryUrl, provider) {
  const projection = resultProjection(subject);
  const binding = catalogBinding(subject);
  return {
    schemaVersion: SCHEMA_VERSION,
    tenantId: subject.tenantId,
    graphApiVersion: GRAPH_API_VERSION,
    catalogAppId: subject.catalogAppId,
    manifestExternalId: subject.manifestExternalId,
    distributionMethod: DISTRIBUTION_METHOD,
    evidenceAssurance: 'sha256-integrity-checksum-only',
    observationProvenance: Object.freeze({
      kind: 'live-microsoft-graph',
      provider,
    }),
    appVersion: subject.appVersion,
    sourceCommit: subject.sourceCommit,
    packageSha256: subject.packageSha256,
    packagedManifestSha256: subject.packagedManifestSha256,
    querySha256: sha256(queryUrl),
    resultProjectionSha256: sha256(canonicalJson(projection)),
    catalogBindingSha256: sha256(canonicalJson(binding)),
    observedAt,
  };
}

export async function createTeamsCatalogAttestation(options) {
  const subject = normalizeSubject(options);
  if (Object.prototype.hasOwnProperty.call(options, 'observedAt')) {
    fail('INVALID_INPUT', 'observedAt is generated internally after Graph success');
  }
  const provider = normalizeProvider(
    options.trustedProvider,
    options.trustedProviderAllowlist,
    subject.tenantId,
  );
  if (typeof options.fetchFn !== 'function') fail('INVALID_INPUT', 'fetchFn must be a function');

  const deadline = startDeadline();

  try {
    requireWithinDeadline(deadline);
    const observation = await Promise.race([
      observeCatalog(subject, provider, options.fetchFn, deadline),
      deadline.timeout,
    ]);
    requireWithinDeadline(deadline);
    const observedAt = new Date().toISOString();
    const payload = createAttestationPayload(
      subject,
      observedAt,
      observation.queryUrl,
      observation.provider,
    );
    return Object.freeze({
      ...payload,
      evidenceSha256: sha256(canonicalJson(payload)),
    });
  } catch (error) {
    rethrowInternalOrFail(error, 'GRAPH_REQUEST_FAILED', 'Graph catalog attestation failed');
  } finally {
    deadline.stop();
  }
}

function normalizeRecordedProviderMetadata(value, expectedTenantId) {
  const record = exactOwnDataObject(
    value,
    ['integrationId', 'tenantId', 'authority', 'acquisition'],
    'ATTESTATION_INVALID',
    'attestation provider metadata is invalid',
  );
  if (typeof record.integrationId !== 'string' || !IDENTIFIER.test(record.integrationId)) {
    fail('ATTESTATION_INVALID', 'attestation provider identity is invalid');
  }
  if (
    typeof record.tenantId !== 'string'
    || !UUID.test(record.tenantId)
    || record.tenantId !== record.tenantId.toLowerCase()
    || record.tenantId !== expectedTenantId
  ) {
    fail('ATTESTATION_INVALID', 'attestation provider tenant binding is invalid');
  }
  let authority;
  try {
    authority = new URL(record.authority);
  } catch {
    fail('ATTESTATION_INVALID', 'attestation provider authority is invalid');
  }
  if (
    authority.href !== record.authority
    || authority.protocol !== 'https:'
    || authority.hostname !== 'login.microsoftonline.com'
    || authority.port !== ''
    || authority.username !== ''
    || authority.password !== ''
    || authority.search !== ''
    || authority.hash !== ''
    || authority.pathname !== `/${expectedTenantId}/`
  ) {
    fail('ATTESTATION_INVALID', 'attestation provider authority is not tenant-specific');
  }
  const acquisition = exactOwnDataObject(
    record.acquisition,
    ['credentialType', 'grant', 'permission', 'scope'],
    'ATTESTATION_INVALID',
    'attestation acquisition metadata is invalid',
  );
  if (
    acquisition.credentialType !== 'confidential-client'
    || acquisition.grant !== 'client-credentials'
    || acquisition.permission !== 'AppCatalog.Read.All'
    || acquisition.scope !== GRAPH_SCOPE
  ) {
    fail('ATTESTATION_INVALID', 'attestation acquisition metadata is not least-privileged');
  }
  return Object.freeze({
    integrationId: record.integrationId,
    tenantId: record.tenantId,
    authority: record.authority,
    acquisition: Object.freeze({ ...acquisition }),
  });
}

function validateAttestation(attestation, expectedSubject) {
  const record = exactOwnDataObject(
    attestation,
    ATTESTATION_KEYS,
    'ATTESTATION_INVALID',
    'attestation has an invalid field set',
  );
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.graphApiVersion !== GRAPH_API_VERSION
    || record.distributionMethod !== DISTRIBUTION_METHOD
    || record.evidenceAssurance !== 'sha256-integrity-checksum-only'
  ) {
    fail('ATTESTATION_INVALID', 'attestation schema or assurance is invalid');
  }
  if (
    typeof record.tenantId !== 'string'
    || typeof record.catalogAppId !== 'string'
    || typeof record.manifestExternalId !== 'string'
    || !UUID.test(record.tenantId)
    || !UUID.test(record.catalogAppId)
    || !UUID.test(record.manifestExternalId)
    || record.tenantId !== record.tenantId.toLowerCase()
    || record.catalogAppId !== record.catalogAppId.toLowerCase()
    || record.manifestExternalId !== record.manifestExternalId.toLowerCase()
  ) {
    fail('ATTESTATION_INVALID', 'attestation IDs are invalid');
  }
  if (
    typeof record.appVersion !== 'string'
    || record.appVersion.length === 0
    || record.appVersion.length > 128
    || record.appVersion.trim() !== record.appVersion
    || typeof record.sourceCommit !== 'string'
    || !SOURCE_COMMIT.test(record.sourceCommit)
    || typeof record.packageSha256 !== 'string'
    || !SHA256.test(record.packageSha256)
    || typeof record.packagedManifestSha256 !== 'string'
    || !SHA256.test(record.packagedManifestSha256)
    || typeof record.evidenceSha256 !== 'string'
    || !SHA256.test(record.evidenceSha256)
  ) {
    fail('ATTESTATION_INVALID', 'attestation release identity is invalid');
  }

  const provenance = exactOwnDataObject(
    record.observationProvenance,
    ['kind', 'provider'],
    'ATTESTATION_INVALID',
    'attestation observation provenance is invalid',
  );
  if (provenance.kind !== 'live-microsoft-graph') {
    fail('ATTESTATION_INVALID', 'attestation observation provenance kind is invalid');
  }
  const provider = normalizeRecordedProviderMetadata(provenance.provider, record.tenantId);
  const recordedSubject = Object.freeze({
    tenantId: record.tenantId,
    catalogAppId: record.catalogAppId,
    manifestExternalId: record.manifestExternalId,
    appVersion: record.appVersion,
    sourceCommit: record.sourceCommit,
    packageSha256: record.packageSha256,
    packagedManifestSha256: record.packagedManifestSha256,
  });
  let observedAt;
  try {
    observedAt = normalizeObservedAt(record.observedAt);
  } catch {
    fail('ATTESTATION_INVALID', 'attestation observedAt is invalid');
  }
  const queryUrl = buildTeamsCatalogQuery(recordedSubject);
  const expectedPayload = createAttestationPayload(recordedSubject, observedAt, queryUrl, provider);
  const actualPayload = { ...record };
  delete actualPayload.evidenceSha256;
  actualPayload.observationProvenance = {
    kind: provenance.kind,
    provider,
  };
  if (canonicalJson(actualPayload) !== canonicalJson(expectedPayload)) {
    fail('ATTESTATION_INVALID', 'attestation payload is internally inconsistent');
  }
  if (record.evidenceSha256 !== sha256(canonicalJson(expectedPayload))) {
    fail('ATTESTATION_INVALID', 'attestation evidence checksum is invalid');
  }

  const expected = normalizeSubject(expectedSubject);
  for (const key of Object.keys(recordedSubject)) {
    if (recordedSubject[key] !== expected[key]) {
      fail('ATTESTATION_SUBJECT_DRIFT', `attestation subject drift detected for ${key}`);
    }
  }

  const observedMs = Date.parse(observedAt);
  const nowMs = Date.now();
  if (
    observedMs < EARLIEST_OBSERVATION_MS
    || observedMs > nowMs + MAX_FUTURE_SKEW_MS
    || nowMs - observedMs > MAX_ATTESTATION_AGE_MS
  ) {
    fail('ATTESTATION_NOT_FRESH', 'attestation observation is outside the accepted freshness window');
  }

  return {
    canonicalPayload: canonicalJson(expectedPayload),
    checksum: record.evidenceSha256,
    provider,
    recordedSubject,
  };
}

async function callExternalWithinDeadline(callback, argument, deadline, code, message) {
  try {
    requireWithinDeadline(deadline);
    const callbackResult = callback(argument);
    requireWithinDeadline(deadline);
    const result = await Promise.race([Promise.resolve(callbackResult), deadline.timeout]);
    requireWithinDeadline(deadline);
    return result;
  } catch (error) {
    rethrowExternalOrTimeout(error, deadline, code, message);
  }
}

async function verifyWithLiveObservation(validated, liveObservation) {
  const live = exactOwnDataObject(
    liveObservation,
    ['trustedProvider', 'trustedProviderAllowlist', 'fetchFn'],
    'ATTESTATION_PROVENANCE_REQUIRED',
    'live Graph verification options are invalid',
  );
  const provider = normalizeProvider(
    live.trustedProvider,
    live.trustedProviderAllowlist,
    validated.recordedSubject.tenantId,
  );
  if (canonicalJson(provider.metadata) !== canonicalJson(validated.provider)) {
    fail('ATTESTATION_PROVENANCE_MISMATCH', 'live Graph provider does not match recorded provenance');
  }
  if (typeof live.fetchFn !== 'function') {
    fail('ATTESTATION_PROVENANCE_REQUIRED', 'live Graph fetch adapter is invalid');
  }
  const deadline = startDeadline();
  try {
    requireWithinDeadline(deadline);
    await Promise.race([
      observeCatalog(validated.recordedSubject, provider, live.fetchFn, deadline),
      deadline.timeout,
    ]);
    requireWithinDeadline(deadline);
    return true;
  } catch (error) {
    rethrowInternalOrFail(
      error,
      'ATTESTATION_LIVE_REOBSERVATION_FAILED',
      'fresh live Graph re-observation failed',
    );
  } finally {
    deadline.stop();
  }
}

async function verifyWithTrustedProof(validated, verification) {
  const verifier = ownDataValue(
    verification,
    'trustedProofVerifier',
    'ATTESTATION_PROVENANCE_REQUIRED',
    'detached proof verifier contract is invalid',
  );
  const allowlist = ownDataValue(
    verification,
    'trustedProofVerifierAllowlist',
    'ATTESTATION_PROVENANCE_REQUIRED',
    'detached proof verifier allowlist is invalid',
  );
  if (
    !Array.isArray(allowlist)
    || !Object.isFrozen(allowlist)
    || !allowlist.includes(verifier)
    || !Object.isFrozen(verifier)
  ) {
    fail('ATTESTATION_PROVENANCE_REQUIRED', 'detached proof verifier is not an allowlisted integration');
  }
  const verifierRecord = exactOwnDataObject(
    verifier,
    ['verifierId', 'verify'],
    'ATTESTATION_PROVENANCE_REQUIRED',
    'detached proof verifier contract is invalid',
  );
  if (
    typeof verifierRecord.verifierId !== 'string'
    || !IDENTIFIER.test(verifierRecord.verifierId)
    || typeof verifierRecord.verify !== 'function'
  ) {
    fail('ATTESTATION_PROVENANCE_REQUIRED', 'detached proof verifier contract is invalid');
  }
  const proofRecord = exactOwnDataObject(
    ownDataValue(
      verification,
      'trustedProof',
      'ATTESTATION_PROVENANCE_REQUIRED',
      'detached proof is invalid',
    ),
    ['scheme', 'keyId', 'signature'],
    'ATTESTATION_PROVENANCE_REQUIRED',
    'detached proof is invalid',
  );
  if (
    typeof proofRecord.scheme !== 'string'
    || !TRUSTED_PROOF_SCHEMES.has(proofRecord.scheme)
    || typeof proofRecord.keyId !== 'string'
    || !IDENTIFIER.test(proofRecord.keyId)
    || typeof proofRecord.signature !== 'string'
    || proofRecord.signature.length === 0
    || proofRecord.signature.length > 16 * 1024
    || !/^[\x21-\x7e]+$/.test(proofRecord.signature)
  ) {
    fail('ATTESTATION_PROVENANCE_REQUIRED', 'detached proof is invalid');
  }
  const proof = Object.freeze({ ...proofRecord });
  const deadline = startDeadline();
  try {
    requireWithinDeadline(deadline);
    const result = await callExternalWithinDeadline(
      (argument) => Reflect.apply(verifierRecord.verify, verifier, [argument]),
      Object.freeze({
        canonicalPayload: validated.canonicalPayload,
        checksum: validated.checksum,
        proof,
      }),
      deadline,
      'ATTESTATION_PROOF_VERIFIER_FAILED',
      'trusted detached proof verification failed',
    );
    requireWithinDeadline(deadline);
    const resultRecord = exactOwnDataObject(
      result,
      ['verified'],
      'ATTESTATION_PROOF_REJECTED',
      'trusted detached proof was rejected',
    );
    if (resultRecord.verified !== true) {
      fail('ATTESTATION_PROOF_REJECTED', 'trusted detached proof was rejected');
    }
    return true;
  } finally {
    deadline.stop();
  }
}

export async function verifyTeamsCatalogAttestation(
  attestation,
  expectedSubject,
  verification = undefined,
) {
  const validated = validateAttestation(attestation, expectedSubject);
  if (!isPlainObject(verification)) {
    fail('ATTESTATION_PROVENANCE_REQUIRED', 'release verification requires trusted provenance');
  }
  const hasLive = Object.prototype.hasOwnProperty.call(verification, 'liveObservation');
  const hasProof = Object.prototype.hasOwnProperty.call(verification, 'trustedProof')
    || Object.prototype.hasOwnProperty.call(verification, 'trustedProofVerifier')
    || Object.prototype.hasOwnProperty.call(verification, 'trustedProofVerifierAllowlist');
  if (hasLive === hasProof) {
    fail(
      'ATTESTATION_PROVENANCE_REQUIRED',
      'release verification requires exactly one trusted provenance method',
    );
  }
  if (hasLive) {
    if (!exactOwnKeys(verification, ['liveObservation'])) {
      fail('ATTESTATION_PROVENANCE_REQUIRED', 'live Graph verification options are invalid');
    }
    return verifyWithLiveObservation(
      validated,
      ownDataValue(
        verification,
        'liveObservation',
        'ATTESTATION_PROVENANCE_REQUIRED',
        'live Graph verification options are invalid',
      ),
    );
  }
  if (!exactOwnKeys(verification, [
    'trustedProof',
    'trustedProofVerifier',
    'trustedProofVerifierAllowlist',
  ])) {
    fail('ATTESTATION_PROVENANCE_REQUIRED', 'detached proof verification options are invalid');
  }
  return verifyWithTrustedProof(validated, verification);
}

export const TEAMS_CATALOG_ATTESTATION_LIMITS = Object.freeze({
  maxAttestationAgeMs: MAX_ATTESTATION_AGE_MS,
  maxFutureSkewMs: MAX_FUTURE_SKEW_MS,
  maxResponseChunks: MAX_RESPONSE_CHUNKS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  timeoutMs: REQUEST_TIMEOUT_MS,
});
