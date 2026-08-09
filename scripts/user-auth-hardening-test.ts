import assert from 'node:assert/strict';

import { createUserAuthMiddleware } from '../src/server/user-auth.js';

type InvokeResult = {
  nextCalled: boolean;
  statusCode: number;
  responseBody: unknown;
  locals: Record<string, unknown>;
  warnings: string[];
};

async function invokeMiddleware(options: {
  token: string;
  claims: unknown | null;
  configuredTenantId?: string;
  acceptedAudiences?: string[];
  requiredDelegatedScope?: string;
}): Promise<InvokeResult> {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map((value) => String(value)).join(' '));

  let nextCalled = false;
  let statusCode = 200;
  let responseBody: unknown;
  const locals: Record<string, unknown> = {};
  const middleware = createUserAuthMiddleware({
    allowUnauthenticated: false,
    validator: { validateAccessToken: async () => options.claims },
    configuredTenantId: options.configuredTenantId ?? 'tenant-a',
    acceptedAudiences: options.acceptedAudiences ?? ['api://teams-runtime'],
    requiredDelegatedScope: options.requiredDelegatedScope ?? 'access_as_user',
  });

  try {
    await middleware(
      {
        headers: { authorization: `Bearer ${options.token}` },
        method: 'GET',
        originalUrl: '/api/items',
      } as any,
      {
        locals,
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: unknown) {
          responseBody = body;
          return this;
        },
      } as any,
      () => { nextCalled = true; },
    );
  } finally {
    console.warn = originalWarn;
  }

  return { nextCalled, statusCode, responseBody, locals, warnings };
}

const accepted = await invokeMiddleware({
  token: 'header.payload.signature',
  claims: {
    tid: 'tenant-a',
    aud: 'api://teams-runtime',
    scp: 'openid profile access_as_user',
    oid: 'user-oid',
    sub: 'user-sub',
  },
});
assert.equal(accepted.statusCode, 200, 'valid delegated Teams token is accepted');
assert.equal(accepted.nextCalled, true, 'valid delegated Teams token reaches the handler');
assert.equal((accepted.locals.user as any).requesterId, 'user-oid', 'oid is the stable delegated requester id');
assert.equal((accepted.locals.user as any).principalKey, 'tenant-a/user-oid', 'principal key is stable across tenant and user');

const fallbackSub = await invokeMiddleware({
  token: 'header.payload.signature',
  claims: {
    tid: 'tenant-a',
    aud: 'api://teams-runtime',
    scp: 'access_as_user',
    sub: 'user-sub-only',
  },
});
assert.equal(fallbackSub.nextCalled, true, 'sub-only delegated token remains valid');
assert.equal((fallbackSub.locals.user as any).requesterId, 'user-sub-only', 'sub is the stable fallback requester id');

const wrongTenant = await invokeMiddleware({
  token: 'header.payload.signature',
  claims: {
    tid: 'tenant-b',
    aud: 'api://teams-runtime',
    scp: 'access_as_user',
    oid: 'user-oid',
  },
});
assert.equal(wrongTenant.statusCode, 401, 'wrong-tenant token is rejected');
assert.deepEqual(wrongTenant.responseBody, { error: 'Invalid bearer token' });

const wrongAudience = await invokeMiddleware({
  token: 'header.payload.signature',
  claims: {
    tid: 'tenant-a',
    aud: 'api://other-audience',
    scp: 'access_as_user',
    oid: 'user-oid',
  },
});
assert.equal(wrongAudience.statusCode, 401, 'wrong-audience token is rejected');

const missingScope = await invokeMiddleware({
  token: 'header.payload.signature',
  claims: {
    tid: 'tenant-a',
    aud: 'api://teams-runtime',
    scp: 'profile User.Read',
    oid: 'user-oid',
  },
});
assert.equal(missingScope.statusCode, 401, 'token without access_as_user delegated scope is rejected');

const rolesOnly = await invokeMiddleware({
  token: 'header.payload.signature',
  claims: {
    tid: 'tenant-a',
    aud: 'api://teams-runtime',
    roles: ['access_as_user'],
    oid: 'user-oid',
  },
});
assert.equal(rolesOnly.statusCode, 401, 'roles-only or app tokens are rejected');

const missingPrincipal = await invokeMiddleware({
  token: 'header.payload.signature',
  claims: {
    tid: 'tenant-a',
    aud: 'api://teams-runtime',
    scp: 'access_as_user',
  },
});
assert.equal(missingPrincipal.statusCode, 401, 'token without oid/sub is rejected');

const missingAudienceConfig = await invokeMiddleware({
  token: 'header.payload.signature',
  claims: {
    tid: 'tenant-a',
    aud: 'api://teams-runtime',
    scp: 'access_as_user',
    oid: 'user-oid',
  },
  acceptedAudiences: [],
});
assert.equal(missingAudienceConfig.statusCode, 401, 'auth fails closed when accepted audiences are not configured');

const rawToken = [
  'eyJhbGciOiJub25lIn0',
  Buffer.from(JSON.stringify({
    aud: 'api://unexpected-teams-audience',
    scp: 'access_as_user profile',
    tid: 'tenant-a',
    oid: 'sensitive-user-identifier',
  })).toString('base64url'),
  'signature',
].join('.');
const invalidLogging = await invokeMiddleware({
  token: rawToken,
  claims: null,
});
assert.equal(invalidLogging.statusCode, 401, 'invalid validator result is rejected');
assert(invalidLogging.warnings.length > 0, 'invalid auth emits a warning');
assert(invalidLogging.warnings.every((line) => !line.includes(rawToken)), 'warnings never log the raw bearer token');
assert(
  invalidLogging.warnings.some((line) => line.includes('aud=api://unexpected-teams-audience')),
  'invalid auth logs only the unverified audience needed to diagnose Teams SSO configuration',
);
assert(
  invalidLogging.warnings.some((line) => line.includes('scp=access_as_user profile')),
  'invalid auth logs only the delegated scopes needed to diagnose Teams SSO configuration',
);
assert(
  invalidLogging.warnings.every((line) => !line.includes('sensitive-user-identifier')),
  'invalid auth diagnostics never log user identifiers',
);

console.log('PASS: user auth hardening rejects wrong tenant/scope/audience/app claims, derives a stable requester key, and never logs raw tokens');
