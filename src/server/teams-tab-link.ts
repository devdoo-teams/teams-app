const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

export type TeamsPersonalTabDeepLinkInput = {
  catalogAppId: string;
  tabDomain: string;
  tenantId?: string;
  jobId?: string;
};

function validGuid(value: string): boolean {
  return GUID_PATTERN.test(value);
}

function validPublicHost(value: string): boolean {
  return PUBLIC_HOST_PATTERN.test(value)
    && value.includes('.')
    && !value.includes('..')
    && !value.startsWith('localhost')
    && !value.startsWith('127.');
}

export function buildTeamsPersonalTabDeepLink(
  input: TeamsPersonalTabDeepLinkInput,
): string | undefined {
  const catalogAppId = input.catalogAppId.trim();
  const tabDomain = input.tabDomain.trim();
  const tenantId = input.tenantId?.trim();

  if (!validGuid(catalogAppId) || !validPublicHost(tabDomain)) return undefined;
  if (tenantId !== undefined && !validGuid(tenantId)) return undefined;

  const params = new URLSearchParams({
    webUrl: `https://${tabDomain}/tabs/home/`,
    label: '업무 허브',
  });
  if (tenantId) params.set('tenantId', tenantId);

  const link = `https://teams.microsoft.com/l/entity/${catalogAppId}/home?${params.toString()}`;
  return input.jobId === undefined ? link : withTeamsJobDeepLink(link, input.jobId);
}

/** Navigation hint only: the tab must reauthorize the job using its authenticated API. */
export function withTeamsJobDeepLink(base: string | undefined, jobId: string): string | undefined {
  if (!base || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(jobId)) return undefined;
  try {
    const url = new URL(base);
    if (url.origin !== 'https://teams.microsoft.com' || !url.pathname.startsWith('/l/entity/')) return undefined;
    const web = new URL(url.searchParams.get('webUrl') ?? '');
    if (web.protocol !== 'https:' || web.username || web.password) return undefined;
    web.searchParams.set('jobId', jobId);
    url.searchParams.set('webUrl', web.toString());
    url.searchParams.set('context', JSON.stringify({ subEntityId: jobId }));
    return url.toString();
  } catch { return undefined; }
}
