export function parseLocalModelBaseUrl(value: string | undefined): URL | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  try {
    const url = new URL(normalized);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || !url.hostname
      || url.username
      || url.password
      || url.search
      || url.hash
      || normalized.includes('?')
      || normalized.includes('#')
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export function isLocalModelBaseUrlConfigured(value: string | undefined): boolean {
  return parseLocalModelBaseUrl(value) !== undefined;
}
