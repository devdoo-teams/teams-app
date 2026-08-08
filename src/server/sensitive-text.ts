const REDACTED = '[REDACTED]';

// These patterns intentionally target credential-shaped values only.  Generic
// task IDs, weather coordinates, and action payloads are not passed through a
// broad "token" matcher.
const PRIVATE_KEY_PATTERN = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi;
const URL_CREDENTIAL_PATTERN = /([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|apikey|password|passwd|pwd|secret|token|signature|sig|code)=)([^&#\s)\[\]]+)/gi;
const URL_AUTH_CREDENTIAL_PATTERN = /(https?:\/\/)([^\s/:@]+)(?::[^\s/@]*)?@/gi;
const KEY_VALUE_CREDENTIAL_PATTERN = /((?:"|')?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|apikey|password|passwd|pwd|secret|token)(?:"|')?\s*[:=]\s*)(?:"([^"]*)"|'([^']*)'|([^\s,;)}\[\]&]+))/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const OPENAI_KEY_PATTERN = /\b(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g;

function redactKeyValue(
  _match: string,
  prefix: string,
  doubleQuoted: string | undefined,
  singleQuoted: string | undefined,
): string {
  const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : '';
  return `${prefix}${quote}${REDACTED}${quote}`;
}

/**
 * Redact credential-shaped values before text is rendered into a shared
 * GenUI envelope or sent to a Teams client.  This function is pure: callers'
 * source strings and records are never mutated.
 */
export function redactSensitiveText(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, '-----BEGIN PRIVATE KEY-----\nREDACTED\n-----END PRIVATE KEY-----')
    .replace(URL_AUTH_CREDENTIAL_PATTERN, `$1${REDACTED}@`)
    .replace(URL_CREDENTIAL_PATTERN, `$1${REDACTED}`)
    .replace(KEY_VALUE_CREDENTIAL_PATTERN, redactKeyValue)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(OPENAI_KEY_PATTERN, `sk-${REDACTED}`);
}

/** Recursively redact credential-shaped strings without changing ordinary IDs, coordinates, or public URLs. */
export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((entry) => redactSensitiveValue(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactSensitiveValue(entry)]));
}
