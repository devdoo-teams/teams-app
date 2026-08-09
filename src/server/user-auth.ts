import type { NextFunction, Request, Response } from 'express';

type TokenValidator = {
  validateAccessToken(rawToken: string): Promise<unknown | null>;
};

type AuthLogger = Pick<Console, 'warn'>;

type UserAuthOptions = {
  allowUnauthenticated: boolean;
  validator?: TokenValidator;
  configuredTenantId?: string;
  acceptedAudiences?: readonly string[];
  requiredDelegatedScope?: string;
  logger?: AuthLogger;
};

type AuthenticatedUserClaims = Record<string, unknown> & {
  aud: string;
  scp: string;
  tid: string;
  requesterId: string;
  principalKey: string;
};

type ValidationResult =
  | { ok: true; claims: AuthenticatedUserClaims }
  | { ok: false; reason: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyClaim(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

function includesRequiredScope(rawScopes: string, requiredScope: string): boolean {
  return rawScopes.split(/\s+/).includes(requiredScope);
}

function unverifiedJwtDiagnostic(token: string): string {
  try {
    const payload = asRecord(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')));
    const aud = nonEmptyClaim(payload?.aud)?.slice(0, 256);
    const scp = nonEmptyClaim(payload?.scp)?.slice(0, 256);
    return [aud ? `aud=${aud}` : '', scp ? `scp=${scp}` : ''].filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

export function parseAcceptedAudiences(value: string | undefined): string[] {
  const audiences = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(audiences)];
}

function validateDelegatedClaims(
  rawClaims: unknown,
  options: Pick<UserAuthOptions, 'configuredTenantId' | 'acceptedAudiences' | 'requiredDelegatedScope'>,
): ValidationResult {
  const claims = asRecord(rawClaims);
  if (!claims) return { ok: false, reason: 'validated claims must be an object' };

  const acceptedAudiences = options.acceptedAudiences?.filter(Boolean) ?? [];
  if (acceptedAudiences.length === 0) {
    return { ok: false, reason: 'accepted audience allowlist is not configured' };
  }

  const tid = nonEmptyClaim(claims.tid);
  if (!tid) return { ok: false, reason: 'tenant claim is missing' };
  if (options.configuredTenantId && tid !== options.configuredTenantId) {
    return { ok: false, reason: 'tenant claim does not match the configured tenant' };
  }

  const aud = nonEmptyClaim(claims.aud);
  if (!aud || !acceptedAudiences.includes(aud)) {
    return { ok: false, reason: 'audience claim is not in the accepted allowlist' };
  }

  const requiredScope = nonEmptyClaim(options.requiredDelegatedScope) ?? 'access_as_user';
  const scp = nonEmptyClaim(claims.scp);
  if (!scp || !includesRequiredScope(scp, requiredScope)) {
    return { ok: false, reason: `delegated scope ${requiredScope} is required` };
  }

  const requesterId = nonEmptyClaim(claims.oid) ?? nonEmptyClaim(claims.sub);
  if (!requesterId) {
    return { ok: false, reason: 'oid or sub claim is required' };
  }

  return {
    ok: true,
    claims: {
      ...claims,
      aud,
      scp,
      tid,
      requesterId,
      principalKey: `${tid}/${requesterId}`,
    },
  };
}

export function createUserAuthMiddleware(options: UserAuthOptions) {
  const logger = options.logger ?? console;
  return async function requireUserAuth(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    if (options.allowUnauthenticated) {
      next();
      return;
    }

    if (!options.validator) {
      response.status(401).json({ error: 'User authentication is not configured' });
      return;
    }

    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;

    if (!token) {
      logger.warn(`[WARN] user auth rejected (${request.method} ${request.originalUrl}): missing bearer token`);
      response.status(401).json({ error: 'Bearer token is required' });
      return;
    }

    let claims: unknown | null;
    try {
      claims = await options.validator.validateAccessToken(token);
    } catch {
      claims = null;
    }

    if (!claims) {
      const diagnostic = unverifiedJwtDiagnostic(token);
      logger.warn(
        `[WARN] user auth rejected (${request.method} ${request.originalUrl}): invalid bearer token${diagnostic ? ` (${diagnostic})` : ''}`,
      );
      response.status(401).json({ error: 'Invalid bearer token' });
      return;
    }

    const validated = validateDelegatedClaims(claims, options);
    if (!validated.ok) {
      logger.warn(`[WARN] user auth rejected (${request.method} ${request.originalUrl}): ${validated.reason}`);
      response.status(401).json({ error: 'Invalid bearer token' });
      return;
    }

    response.locals.user = validated.claims;
    next();
  };
}
