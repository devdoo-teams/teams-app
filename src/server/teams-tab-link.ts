const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

export type TeamsPersonalTabDeepLinkInput = {
  appId: string;
  tabDomain: string;
  tenantId?: string;
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
  const appId = input.appId.trim();
  const tabDomain = input.tabDomain.trim();
  const tenantId = input.tenantId?.trim();

  if (!validGuid(appId) || !validPublicHost(tabDomain)) return undefined;
  if (tenantId !== undefined && !validGuid(tenantId)) return undefined;

  const params = new URLSearchParams({
    webUrl: `https://${tabDomain}/tabs/home/`,
    label: '업무 허브',
  });
  if (tenantId) params.set('tenantId', tenantId);

  return `https://teams.microsoft.com/l/entity/${appId}/home?${params.toString()}`;
}
