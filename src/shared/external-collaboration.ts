export type ExternalCollaborationApp = Readonly<{
  id: string;
  kind: 'external-app';
  name: string;
  providerId: null;
  createsInternalJob: false;
  contributesProviderReadiness: false;
  installUrl: string;
  documentationUrl: string;
}>;

export const GITHUB_TEAMS_EXTERNAL_APP: ExternalCollaborationApp = Object.freeze({
  id: 'github-copilot-coding-agent-for-teams',
  kind: 'external-app',
  name: '@GitHub',
  providerId: null,
  createsInternalJob: false,
  contributesProviderReadiness: false,
  installUrl: 'https://github.com/apps/github-for-microsoft-teams',
  documentationUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-integrations/integrate-cloud-agent-with-teams',
});

export function isExternalCollaborationApp(value: unknown): value is ExternalCollaborationApp {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ExternalCollaborationApp>;
  return candidate.kind === 'external-app'
    && candidate.providerId === null
    && candidate.createsInternalJob === false
    && candidate.contributesProviderReadiness === false
    && typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && isSafeHttpsUrl(candidate.installUrl)
    && isSafeHttpsUrl(candidate.documentationUrl);
}

function isSafeHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'github.com' || parsed.hostname === 'docs.github.com')
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}
