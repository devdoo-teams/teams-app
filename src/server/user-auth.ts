import type { NextFunction, Request, Response } from 'express';

type TokenValidator = {
  validateAccessToken(rawToken: string): Promise<unknown | null>;
};

type UserAuthOptions = {
  allowUnauthenticated: boolean;
  validator?: TokenValidator;
};

export function createUserAuthMiddleware(options: UserAuthOptions) {
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
      response.status(401).json({ error: 'Invalid bearer token' });
      return;
    }

    response.locals.user = claims;
    next();
  };
}
