import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createTeamsCatalogAttestation,
  TeamsCatalogAttestationError,
  verifyTeamsCatalogAttestation,
} from './teams-catalog-attestation.mjs';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CATALOG_APP_ID = '22222222-2222-4222-8222-222222222222';
const MANIFEST_ID = '33333333-3333-4333-8333-333333333333';
const PACKAGE_SHA256 = 'a'.repeat(64);
const MANIFEST_SHA256 = 'b'.repeat(64);
const SOURCE_COMMIT = 'c'.repeat(40);
const OBSERVED_AT = '2026-08-12T03:00:00.000Z';
const ACCESS_TOKEN = 'secret-access-token-that-must-never-be-attested';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function successBody(overrides = {}) {
  return {
    value: [{
      id: CATALOG_APP_ID,
      externalId: MANIFEST_ID,
      distributionMethod: 'organization',
      ...overrides,
    }],
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function validOptions(overrides = {}) {
  const provider = trustedProvider();
  return {
    tenantId: TENANT_ID,
    catalogAppId: CATALOG_APP_ID,
    manifestId: MANIFEST_ID,
    appVersion: '1.0.44',
    sourceCommit: SOURCE_COMMIT,
    packageSha256: PACKAGE_SHA256,
    packagedManifestSha256: MANIFEST_SHA256,
    trustedProvider: provider,
    trustedProviderAllowlist: Object.freeze([provider]),
    fetchFn: async () => jsonResponse(successBody()),
    ...overrides,
  };
}

function trustedProvider({
  tenantId = TENANT_ID,
  integrationId = 'test-msal-release',
  authority = `https://login.microsoftonline.com/${tenantId}/`,
  acquisition = {
    credentialType: 'confidential-client',
    grant: 'client-credentials',
    permission: 'AppCatalog.Read.All',
    scope: 'https://graph.microsoft.com/.default',
  },
  acquireToken = async () => ({ accessToken: ACCESS_TOKEN }),
} = {}) {
  return Object.freeze({
    integrationId,
    tenantId,
    authority,
    acquisition: Object.freeze(acquisition),
    acquireToken,
  });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.name, 'TeamsCatalogAttestationError');
    assert.equal(error?.code, code);
    return true;
  });
}

test('accepts only an explicitly allowlisted tenant-bound provider integration', async () => {
  const provider = trustedProvider();
  const attestation = await createTeamsCatalogAttestation(validOptions({
    trustedProvider: provider,
    trustedProviderAllowlist: Object.freeze([provider]),
  }));

  assert.equal(attestation.observationProvenance.provider.integrationId, 'test-msal-release');
  assert.equal(attestation.observationProvenance.provider.tenantId, TENANT_ID);
  assert.equal(attestation.observationProvenance.provider.authority, `https://login.microsoftonline.com/${TENANT_ID}/`);
  assert.equal(attestation.observationProvenance.provider.acquisition.permission, 'AppCatalog.Read.All');
  assert.doesNotMatch(JSON.stringify(attestation), /secret-access-token/i);
});

test('rejects a provider result returned after 10.12 seconds without starting Graph fetch', async () => {
  let fetchCalls = 0;
  const provider = trustedProvider({
    acquireToken() {
      const until = performance.now() + 10_120;
      while (performance.now() < until) {
        // Deliberately block the event loop to prove the monotonic post-call check.
      }
      return { accessToken: ACCESS_TOKEN };
    },
  });

  await expectCode(
    createTeamsCatalogAttestation(validOptions({
      trustedProvider: provider,
      trustedProviderAllowlist: Object.freeze([provider]),
      fetchFn: async () => {
        fetchCalls += 1;
        return jsonResponse(successBody());
      },
    })),
    'GRAPH_REQUEST_TIMEOUT',
  );
  assert.equal(fetchCalls, 0);
});

test('rejects a fetch result returned after 10.12 seconds without reading its body', async () => {
  let getReaderCalls = 0;
  await expectCode(createTeamsCatalogAttestation(validOptions({
    fetchFn() {
      const until = performance.now() + 10_120;
      while (performance.now() < until) {
        // Deliberately block the event loop to exercise the post-fetch monotonic check.
      }
      return {
        status: 200,
        headers: new Headers(),
        body: {
          getReader() {
            getReaderCalls += 1;
            throw new Error('late response body must not be read');
          },
        },
      };
    },
  })), 'GRAPH_REQUEST_TIMEOUT');
  assert.equal(getReaderCalls, 0);
});

test('maps a thenable that rejects after 10.12 seconds to timeout before later stages', async () => {
  let fetchCalls = 0;
  const provider = trustedProvider({
    acquireToken() {
      return {
        then(_resolve, reject) {
          const until = performance.now() + 10_120;
          while (performance.now() < until) {
            // Promise assimilation blocks; the rejection path still owes a monotonic check.
          }
          reject(new Error(`late provider rejection ${ACCESS_TOKEN}`));
        },
      };
    },
  });

  await assert.rejects(createTeamsCatalogAttestation(validOptions({
    trustedProvider: provider,
    trustedProviderAllowlist: Object.freeze([provider]),
    fetchFn: async () => {
      fetchCalls += 1;
      return jsonResponse(successBody());
    },
  })), (error) => {
    assert.equal(error.code, 'GRAPH_REQUEST_TIMEOUT');
    assert.doesNotMatch(`${error.message}\n${JSON.stringify(error)}`, new RegExp(ACCESS_TOKEN));
    return true;
  });
  assert.equal(fetchCalls, 0);
});

test('remaps forged domain errors from every external callback without token disclosure', async () => {
  const forged = () => new TeamsCatalogAttestationError(
    'GRAPH_REQUEST_TIMEOUT',
    `forged callback detail ${ACCESS_TOKEN}`,
  );
  const provider = trustedProvider({
    acquireToken() {
      throw forged();
    },
  });
  const cases = [
    {
      options: validOptions({
        trustedProvider: provider,
        trustedProviderAllowlist: Object.freeze([provider]),
      }),
      code: 'TOKEN_PROVIDER_FAILED',
    },
    {
      options: validOptions({ fetchFn() { throw forged(); } }),
      code: 'GRAPH_REQUEST_FAILED',
    },
  ];

  for (const { options, code } of cases) {
    await assert.rejects(createTeamsCatalogAttestation(options), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(`${error.message}\n${JSON.stringify(error)}`, new RegExp(ACCESS_TOKEN));
      return true;
    });
  }
});

test('rejects inherited Graph projection fields under prototype pollution', async () => {
  Object.prototype.id = CATALOG_APP_ID;
  Object.prototype.externalId = MANIFEST_ID;
  Object.prototype.distributionMethod = 'organization';
  try {
    await expectCode(
      createTeamsCatalogAttestation(validOptions({
        fetchFn: async () => jsonResponse({ value: [{}] }),
      })),
      'GRAPH_RESPONSE_FORMAT',
    );
  } finally {
    delete Object.prototype.id;
    delete Object.prototype.externalId;
    delete Object.prototype.distributionMethod;
  }
});

function readerResponse(read) {
  const counters = { cancel: 0, read: 0, release: 0 };
  const reader = {
    read() {
      counters.read += 1;
      return read(counters.read);
    },
    cancel() {
      counters.cancel += 1;
      return Promise.resolve();
    },
    releaseLock() {
      counters.release += 1;
    },
  };
  return {
    counters,
    response: {
      status: 200,
      headers: new Headers(),
      body: { getReader: () => reader },
    },
  };
}

test('bounds empty stream churn and cancels/releases the reader on stream failures', async () => {
  const empty = readerResponse(async (count) => (
    count <= 100_000
      ? { done: false, value: new Uint8Array() }
      : { done: true, value: undefined }
  ));
  await expectCode(
    createTeamsCatalogAttestation(validOptions({ fetchFn: async () => empty.response })),
    'GRAPH_RESPONSE_WORK_LIMIT',
  );
  assert.ok(empty.counters.read <= 2, 'zero-length churn must be rejected immediately');
  assert.deepEqual(
    { cancel: empty.counters.cancel, release: empty.counters.release },
    { cancel: 1, release: 1 },
  );

  const tooManyChunks = readerResponse(async () => ({
    done: false,
    value: new Uint8Array([0x20]),
  }));
  await expectCode(
    createTeamsCatalogAttestation(validOptions({ fetchFn: async () => tooManyChunks.response })),
    'GRAPH_RESPONSE_WORK_LIMIT',
  );
  assert.equal(tooManyChunks.counters.read, 1_025);
  assert.deepEqual(
    { cancel: tooManyChunks.counters.cancel, release: tooManyChunks.counters.release },
    { cancel: 1, release: 1 },
  );

  const oversize = readerResponse(async () => ({
    done: false,
    value: new Uint8Array((64 * 1024) + 1),
  }));
  await expectCode(
    createTeamsCatalogAttestation(validOptions({ fetchFn: async () => oversize.response })),
    'GRAPH_RESPONSE_TOO_LARGE',
  );
  assert.deepEqual(
    { cancel: oversize.counters.cancel, release: oversize.counters.release },
    { cancel: 1, release: 1 },
  );

  const failed = readerResponse(async () => {
    throw new Error(`external stream detail ${ACCESS_TOKEN}`);
  });
  await assert.rejects(
    createTeamsCatalogAttestation(validOptions({ fetchFn: async () => failed.response })),
    (error) => {
      assert.equal(error.code, 'GRAPH_RESPONSE_FAILED');
      assert.doesNotMatch(error.message, new RegExp(ACCESS_TOKEN));
      return true;
    },
  );
  assert.deepEqual(
    { cancel: failed.counters.cancel, release: failed.counters.release },
    { cancel: 1, release: 1 },
  );
});

test('cancels and releases a pending response reader when the global deadline expires', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendingReader = readerResponse(() => new Promise(() => {}));
  const pending = createTeamsCatalogAttestation(validOptions({
    fetchFn: async () => pendingReader.response,
  }));

  for (let index = 0; index < 8 && pendingReader.counters.read === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(pendingReader.counters.read, 1);
  t.mock.timers.tick(10_000);
  await expectCode(pending, 'GRAPH_REQUEST_TIMEOUT');
  await Promise.resolve();
  assert.deepEqual(
    { cancel: pendingReader.counters.cancel, release: pendingReader.counters.release },
    { cancel: 1, release: 1 },
  );
});

test('rejects an offline-forged checksum unless a trusted detached proof verifier accepts it', async () => {
  const observed = await createTeamsCatalogAttestation(validOptions());
  const { evidenceSha256: _discarded, ...payload } = observed;
  payload.appVersion = '9.9.9';
  const forged = {
    ...payload,
    evidenceSha256: sha256(canonicalJson(payload)),
  };
  const expectedSubject = validOptions({ appVersion: '9.9.9' });

  await expectCode(
    verifyTeamsCatalogAttestation(forged, expectedSubject),
    'ATTESTATION_PROVENANCE_REQUIRED',
  );

  let verifierCalls = 0;
  const verifier = Object.freeze({
    verifierId: 'test-release-mac-v1',
    async verify({ checksum, canonicalPayload, proof }) {
      verifierCalls += 1;
      assert.equal(checksum, forged.evidenceSha256);
      assert.equal(sha256(canonicalPayload), checksum);
      assert.deepEqual(proof, {
        scheme: 'hmac-sha256',
        keyId: 'test-release-key',
        signature: 'detached-test-signature',
      });
      return { verified: true };
    },
  });

  assert.equal(await verifyTeamsCatalogAttestation(forged, expectedSubject, {
    trustedProof: {
      scheme: 'hmac-sha256',
      keyId: 'test-release-key',
      signature: 'detached-test-signature',
    },
    trustedProofVerifier: verifier,
    trustedProofVerifierAllowlist: Object.freeze([verifier]),
  }), true);
  assert.equal(verifierCalls, 1);
});

test('remaps a forged detached-proof verifier error without disclosing its secret detail', async () => {
  const attestation = await createTeamsCatalogAttestation(validOptions());
  const verifier = Object.freeze({
    verifierId: 'throwing-release-verifier',
    verify() {
      throw new TeamsCatalogAttestationError(
        'ATTESTATION_PROOF_REJECTED',
        `forged verifier detail ${ACCESS_TOKEN}`,
      );
    },
  });
  await assert.rejects(verifyTeamsCatalogAttestation(attestation, validOptions(), {
    trustedProof: {
      scheme: 'hmac-sha256',
      keyId: 'release-key',
      signature: 'detached-signature',
    },
    trustedProofVerifier: verifier,
    trustedProofVerifierAllowlist: Object.freeze([verifier]),
  }), (error) => {
    assert.equal(error.code, 'ATTESTATION_PROOF_VERIFIER_FAILED');
    assert.doesNotMatch(`${error.message}\n${JSON.stringify(error)}`, new RegExp(ACCESS_TOKEN));
    return true;
  });
});

test('generates observedAt only after live success and enforces epoch, future, and stale time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(OBSERVED_AT) });
  let fetchCompleted = false;
  const attestation = await createTeamsCatalogAttestation(validOptions({
    fetchFn: async () => {
      fetchCompleted = true;
      return jsonResponse(successBody());
    },
  }));
  assert.equal(fetchCompleted, true);
  assert.equal(attestation.observedAt, OBSERVED_AT);

  let fetchCalls = 0;
  await expectCode(createTeamsCatalogAttestation(validOptions({
    observedAt: OBSERVED_AT,
    fetchFn: async () => {
      fetchCalls += 1;
      return jsonResponse(successBody());
    },
  })), 'INVALID_INPUT');
  assert.equal(fetchCalls, 0, 'caller-supplied observation time fails before Graph access');

  t.mock.timers.setTime(Date.parse(OBSERVED_AT) + (5 * 60 * 1_000) + 1);
  await expectCode(
    verifyTeamsCatalogAttestation(attestation, validOptions()),
    'ATTESTATION_NOT_FRESH',
  );

  t.mock.timers.setTime(Date.parse(OBSERVED_AT) - (30 * 1_000) - 1);
  await expectCode(
    verifyTeamsCatalogAttestation(attestation, validOptions()),
    'ATTESTATION_NOT_FRESH',
  );

  t.mock.timers.setTime(0);
  const epochAttestation = await createTeamsCatalogAttestation(validOptions());
  assert.equal(epochAttestation.observedAt, '1970-01-01T00:00:00.000Z');
  await expectCode(
    verifyTeamsCatalogAttestation(epochAttestation, validOptions()),
    'ATTESTATION_NOT_FRESH',
  );
});

test('accepts persisted evidence after a fresh live Graph re-observation by the same provider', async () => {
  const options = validOptions();
  const attestation = await createTeamsCatalogAttestation(options);
  let reobservationCalls = 0;
  assert.equal(await verifyTeamsCatalogAttestation(attestation, options, {
    liveObservation: {
      trustedProvider: options.trustedProvider,
      trustedProviderAllowlist: options.trustedProviderAllowlist,
      fetchFn: async () => {
        reobservationCalls += 1;
        return jsonResponse(successBody());
      },
    },
  }), true);
  assert.equal(reobservationCalls, 1);
});

test('rejects false tenant self-assertions and non-tenant-specific authorities before fetch', async () => {
  const wrongTenantProvider = trustedProvider({
    tenantId: '99999999-9999-4999-8999-999999999999',
  });
  const commonAuthorityProvider = trustedProvider({
    authority: 'https://login.microsoftonline.com/common/',
  });
  const selfAssertingProvider = trustedProvider({
    acquireToken: async () => ({
      tenantId: TENANT_ID,
      accessToken: ACCESS_TOKEN,
    }),
  });
  const cases = [
    [wrongTenantProvider, 'TENANT_BINDING_MISMATCH'],
    [commonAuthorityProvider, 'TENANT_BINDING_MISMATCH'],
    [selfAssertingProvider, 'TOKEN_PROVIDER_INVALID'],
  ];

  for (const [provider, code] of cases) {
    let fetchCalls = 0;
    await expectCode(createTeamsCatalogAttestation(validOptions({
      trustedProvider: provider,
      trustedProviderAllowlist: Object.freeze([provider]),
      fetchFn: async () => {
        fetchCalls += 1;
        return jsonResponse(successBody());
      },
    })), code);
    assert.equal(fetchCalls, 0);
  }
});

test('creates a token-free deterministic attestation for exactly one matching organization app', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(OBSERVED_AT) });
  let request;
  let fetchCalls = 0;
  const options = validOptions({
    fetchFn: async (url, init) => {
      fetchCalls += 1;
      request = { url, init };
      return jsonResponse(successBody({ distributionMethod: 'ORGANIZATION' }));
    },
  });

  const first = await createTeamsCatalogAttestation(options);
  const second = await createTeamsCatalogAttestation(options);

  assert.equal(fetchCalls, 2, 'one Graph request is issued per explicit attestation attempt');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.signal instanceof AbortSignal, true);
  assert.equal(request.init.headers.get('authorization'), `Bearer ${ACCESS_TOKEN}`);

  const requestUrl = new URL(request.url);
  assert.equal(requestUrl.origin, 'https://graph.microsoft.com');
  assert.equal(requestUrl.pathname, '/v1.0/appCatalogs/teamsApps');
  assert.equal(
    requestUrl.searchParams.get('$filter'),
    `id eq '${CATALOG_APP_ID}' and externalId eq '${MANIFEST_ID}' and distributionMethod eq 'organization'`,
  );
  assert.equal(requestUrl.searchParams.get('$select'), 'id,externalId,distributionMethod');

  assert.deepEqual(first, second, 'same subject, observation, and Graph projection are deterministic');
  assert.deepEqual(first, {
    schemaVersion: 2,
    tenantId: TENANT_ID,
    graphApiVersion: 'v1.0',
    catalogAppId: CATALOG_APP_ID,
    manifestExternalId: MANIFEST_ID,
    distributionMethod: 'organization',
    evidenceAssurance: 'sha256-integrity-checksum-only',
    observationProvenance: {
      kind: 'live-microsoft-graph',
      provider: {
        integrationId: 'test-msal-release',
        tenantId: TENANT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}/`,
        acquisition: {
          credentialType: 'confidential-client',
          grant: 'client-credentials',
          permission: 'AppCatalog.Read.All',
          scope: 'https://graph.microsoft.com/.default',
        },
      },
    },
    appVersion: '1.0.44',
    sourceCommit: SOURCE_COMMIT,
    packageSha256: PACKAGE_SHA256,
    packagedManifestSha256: MANIFEST_SHA256,
    querySha256: sha256(request.url),
    resultProjectionSha256: first.resultProjectionSha256,
    catalogBindingSha256: first.catalogBindingSha256,
    observedAt: OBSERVED_AT,
    evidenceSha256: first.evidenceSha256,
  });
  assert.doesNotMatch(JSON.stringify(first), /secret-access-token|authorization|bearer/i);
  assert.equal(await verifyTeamsCatalogAttestation(first, options, {
    liveObservation: {
      trustedProvider: options.trustedProvider,
      trustedProviderAllowlist: options.trustedProviderAllowlist,
      fetchFn: options.fetchFn,
    },
  }), true);
  assert.equal(fetchCalls, 3);
});

test('sanitizes transport and response-stream failures without leaking the bearer token', async () => {
  const throwingProvider = trustedProvider({
    acquireToken: async () => {
      throw new Error(`provider included ${ACCESS_TOKEN}`);
    },
  });
  const cases = [
    validOptions({
      trustedProvider: throwingProvider,
      trustedProviderAllowlist: Object.freeze([throwingProvider]),
    }),
    validOptions({
      fetchFn: async () => {
        throw new Error(`transport included ${ACCESS_TOKEN}`);
      },
    }),
    validOptions({
      fetchFn: async () => ({
        get status() {
          throw new Error(`response metadata included ${ACCESS_TOKEN}`);
        },
      }),
    }),
    validOptions({
      fetchFn: async () => ({
        status: 200,
        headers: new Headers(),
        body: {
          getReader() {
            return {
              async read() {
                throw new Error(`stream included ${ACCESS_TOKEN}`);
              },
              releaseLock() {},
            };
          },
        },
      }),
    }),
  ];

  for (const options of cases) {
    await assert.rejects(
      createTeamsCatalogAttestation(options),
      (error) => {
        assert.equal(error.name, 'TeamsCatalogAttestationError');
        assert.doesNotMatch(`${error.message}\n${JSON.stringify(error)}`, new RegExp(ACCESS_TOKEN));
        return true;
      },
    );
  }
});

test('fails closed for zero, duplicate, paginated, or mismatched Graph catalog results', async () => {
  const cases = [
    ['zero results', { value: [] }, 'GRAPH_RESULT_CARDINALITY'],
    ['two results', { value: [successBody().value[0], successBody().value[0]] }, 'GRAPH_RESULT_CARDINALITY'],
    ['pagination', { ...successBody(), '@odata.nextLink': null }, 'GRAPH_PAGINATION_FORBIDDEN'],
    ['wrong catalog id', successBody({ id: '44444444-4444-4444-8444-444444444444' }), 'GRAPH_RESULT_MISMATCH'],
    ['wrong manifest id', successBody({ externalId: '55555555-5555-4555-8555-555555555555' }), 'GRAPH_RESULT_MISMATCH'],
    ['store distribution', successBody({ distributionMethod: 'store' }), 'GRAPH_RESULT_MISMATCH'],
    ['Unicode lookalike distribution', successBody({ distributionMethod: 'organizati\u043En' }), 'GRAPH_RESULT_MISMATCH'],
  ];

  for (const [label, body, code] of cases) {
    await expectCode(
      createTeamsCatalogAttestation(validOptions({ fetchFn: async () => jsonResponse(body) })),
      code,
    ).catch((error) => {
      error.message = `${label}: ${error.message}`;
      throw error;
    });
  }
});

test('performs zero retries and rejects every non-200 Graph status', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    let calls = 0;
    await expectCode(
      createTeamsCatalogAttestation(validOptions({
        fetchFn: async () => {
          calls += 1;
          return jsonResponse({ error: 'not exposed' }, { status });
        },
      })),
      'GRAPH_HTTP_STATUS',
    );
    assert.equal(calls, 1, `HTTP ${status} must not be retried automatically`);
  }
});

test('rejects non-JSON, non-object, invalid UTF-8, and responses larger than 64 KiB', async () => {
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
  const cases = [
    ['non-JSON', new Response('not-json', { status: 200 }), 'GRAPH_RESPONSE_FORMAT'],
    ['JSON array', new Response('[]', { status: 200 }), 'GRAPH_RESPONSE_FORMAT'],
    ['invalid UTF-8', new Response(invalidUtf8, { status: 200 }), 'GRAPH_RESPONSE_FORMAT'],
    ['oversize stream', new Response('x'.repeat((64 * 1024) + 1), { status: 200 }), 'GRAPH_RESPONSE_TOO_LARGE'],
    [
      'oversize content-length',
      new Response('{}', { status: 200, headers: { 'content-length': String((64 * 1024) + 1) } }),
      'GRAPH_RESPONSE_TOO_LARGE',
    ],
  ];

  for (const [label, response, code] of cases) {
    await expectCode(
      createTeamsCatalogAttestation(validOptions({ fetchFn: async () => response })),
      code,
    ).catch((error) => {
      error.message = `${label}: ${error.message}`;
      throw error;
    });
  }
});

test('validates all tenant/catalog/manifest UUID inputs before acquiring a token', async () => {
  for (const field of ['tenantId', 'catalogAppId', 'manifestId']) {
    let tokenCalls = 0;
    let fetchCalls = 0;
    const provider = trustedProvider({
      acquireToken: async () => {
        tokenCalls += 1;
        return { accessToken: ACCESS_TOKEN };
      },
    });
    await expectCode(
      createTeamsCatalogAttestation(validOptions({
        [field]: 'not-a-uuid',
        trustedProvider: provider,
        trustedProviderAllowlist: Object.freeze([provider]),
        fetchFn: async () => {
          fetchCalls += 1;
          return jsonResponse(successBody());
        },
      })),
      'INVALID_INPUT',
    );
    assert.equal(tokenCalls, 0, `${field} must fail before token acquisition`);
    assert.equal(fetchCalls, 0, `${field} must fail before Graph access`);
  }
});

test('passes exact tenant, scope, and abort signal to the allowlisted provider', async () => {
  let fetchCalls = 0;
  const provider = trustedProvider({
    acquireToken: async ({ tenantId, scopes, signal }) => {
      assert.equal(tenantId, TENANT_ID);
      assert.deepEqual(scopes, ['https://graph.microsoft.com/.default']);
      assert.equal(Object.isFrozen(scopes), true);
      assert.equal(signal instanceof AbortSignal, true);
      return { accessToken: ACCESS_TOKEN };
    },
  });
  await createTeamsCatalogAttestation(validOptions({
    trustedProvider: provider,
    trustedProviderAllowlist: Object.freeze([provider]),
    fetchFn: async () => {
      fetchCalls += 1;
      return jsonResponse(successBody());
    },
  }));
  assert.equal(fetchCalls, 1);
});

test('rejects unsafe token material before fetch and never leaks it through the error', async () => {
  const unsafeToken = `unsafe-${ACCESS_TOKEN}\r\ninjected: value`;
  let fetchCalls = 0;
  const provider = trustedProvider({
    acquireToken: async () => ({ accessToken: unsafeToken }),
  });
  await assert.rejects(
    createTeamsCatalogAttestation(validOptions({
      trustedProvider: provider,
      trustedProviderAllowlist: Object.freeze([provider]),
      fetchFn: async () => {
        fetchCalls += 1;
        return jsonResponse(successBody());
      },
    })),
    (error) => {
      assert.equal(error?.name, 'TeamsCatalogAttestationError');
      assert.equal(error?.code, 'TOKEN_PROVIDER_INVALID');
      assert.doesNotMatch(`${error.message}\n${JSON.stringify(error)}`, new RegExp(ACCESS_TOKEN));
      return true;
    },
  );
  assert.equal(fetchCalls, 0);
});

test('enforces one 10-second deadline across token acquisition, fetch, and body reading', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fetchCalls = 0;
  let requestSignal;
  let settled = false;
  const pending = createTeamsCatalogAttestation(validOptions({
    fetchFn: async (_url, init) => {
      fetchCalls += 1;
      requestSignal = init.signal;
      return new Promise(() => {});
    },
  }));
  pending.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fetchCalls, 1);
  t.mock.timers.tick(9_999);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await expectCode(pending, 'GRAPH_REQUEST_TIMEOUT');
  assert.equal(requestSignal.aborted, true);
  assert.equal(fetchCalls, 1, 'timeout must not cause a retry');
});

test('does not start a late Graph request when token acquisition resolves after the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let releaseToken;
  let fetchCalls = 0;
  const provider = trustedProvider({
    acquireToken: () => new Promise((resolve) => {
      releaseToken = resolve;
    }),
  });
  const pending = createTeamsCatalogAttestation(validOptions({
    trustedProvider: provider,
    trustedProviderAllowlist: Object.freeze([provider]),
    fetchFn: async () => {
      fetchCalls += 1;
      return jsonResponse(successBody());
    },
  }));

  t.mock.timers.tick(10_000);
  await expectCode(pending, 'GRAPH_REQUEST_TIMEOUT');
  releaseToken({ accessToken: ACCESS_TOKEN });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fetchCalls, 0);
});

test('uses deterministic canonical byte strings for every attestation digest', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(OBSERVED_AT) });
  const attestation = await createTeamsCatalogAttestation(validOptions());
  const query = "https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?%24filter=id+eq+%2722222222-2222-4222-8222-222222222222%27+and+externalId+eq+%2733333333-3333-4333-8333-333333333333%27+and+distributionMethod+eq+%27organization%27&%24select=id%2CexternalId%2CdistributionMethod";
  const projection = `{"distributionMethod":"organization","externalId":"${MANIFEST_ID}","id":"${CATALOG_APP_ID}"}`;
  const binding = `{"catalogAppId":"${CATALOG_APP_ID}","distributionMethod":"organization","manifestExternalId":"${MANIFEST_ID}","tenantId":"${TENANT_ID}"}`;
  const expectedQuerySha256 = sha256(query);
  const expectedProjectionSha256 = sha256(projection);
  const expectedBindingSha256 = sha256(binding);
  const { evidenceSha256: _checksum, ...expectedPayload } = attestation;

  assert.equal(attestation.querySha256, expectedQuerySha256);
  assert.equal(attestation.resultProjectionSha256, expectedProjectionSha256);
  assert.equal(attestation.catalogBindingSha256, expectedBindingSha256);
  assert.equal(attestation.evidenceSha256, sha256(canonicalJson(expectedPayload)));
});

test('verification rejects field tampering, added fields, and digest substitution', async () => {
  const attestation = await createTeamsCatalogAttestation(validOptions());
  const tampered = [
    { ...attestation, appVersion: '1.0.45' },
    { ...attestation, querySha256: '0'.repeat(64) },
    { ...attestation, resultProjectionSha256: '0'.repeat(64) },
    { ...attestation, catalogBindingSha256: '0'.repeat(64) },
    { ...attestation, evidenceSha256: '0'.repeat(64) },
    { ...attestation, unexpected: true },
  ];

  for (const candidate of tampered) {
    await expectCode(
      Promise.resolve().then(() => verifyTeamsCatalogAttestation(candidate, validOptions())),
      'ATTESTATION_INVALID',
    );
  }
});

test('verification rejects package, packaged-manifest, and source-commit subject drift independently', async () => {
  const attestation = await createTeamsCatalogAttestation(validOptions());
  const driftCases = [
    { packageSha256: 'd'.repeat(64) },
    { packagedManifestSha256: 'e'.repeat(64) },
    { sourceCommit: 'f'.repeat(40) },
  ];

  for (const drift of driftCases) {
    await expectCode(
      Promise.resolve().then(() => verifyTeamsCatalogAttestation(
        attestation,
        validOptions(drift),
      )),
      'ATTESTATION_SUBJECT_DRIFT',
    );
  }
});
