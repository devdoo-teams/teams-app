const DEFAULT_MAX_DIAGNOSTIC_CHARS = 8_192;

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function redactCliDiagnostics(
  value: unknown,
  options: Readonly<{ paths?: readonly (string | undefined)[]; maxChars?: number }> = {},
): string {
  const paths = [...new Set((options.paths ?? []).map((path) => path?.trim()).filter((path): path is string => Boolean(path)))]
    .sort((left, right) => right.length - left.length);
  let sanitized = String(value ?? '')
    .replace(/\r\n/gu, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .replace(/authorization\s*:\s*[^\n]+/giu, 'Authorization: <redacted>')
    .replace(/\b(bearer|token|oauth token|access token|refresh token|api[_ -]?key|client[_ -]?secret|password)\b\s*[:=]?\s*[^\s\n]+/giu, '$1 <redacted>')
    .replace(/\b(one-time code|device code|user code)\b\s*[:=]?\s*[A-Z0-9-]{6,}/giu, '$1 <redacted-device-code>')
    .replace(/\b(use this one-time code)\s+[A-Z0-9-]{6,}/giu, '$1 <redacted-device-code>');

  for (const path of paths) sanitized = sanitized.replace(new RegExp(escapePattern(path), 'gu'), '<redacted-path>');
  const maxChars = Number.isFinite(options.maxChars) && (options.maxChars ?? 0) > 0
    ? Math.floor(options.maxChars!)
    : DEFAULT_MAX_DIAGNOSTIC_CHARS;
  return sanitized.slice(0, maxChars);
}
