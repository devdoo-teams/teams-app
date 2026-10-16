/** Correlation/precondition only; server authentication still grants access. */
export const API_PRINCIPAL_SCOPE_HEADER = 'X-Teams-Principal-Scope';
export const API_EXPECTED_PRINCIPAL_SCOPE_HEADER = 'X-Teams-Expected-Principal-Scope';
export const isPrincipalScopeKey = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
