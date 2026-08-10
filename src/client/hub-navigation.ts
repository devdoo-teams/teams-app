export const hubViews = ['today', 'work', 'activity', 'settings'] as const;

export type HubView = (typeof hubViews)[number];

export const hubViewLabels: Record<HubView, string> = {
  today: '오늘',
  work: '내 업무',
  activity: '활동',
  settings: '설정',
};

export function parseHubView(search: string | undefined): HubView {
  if (!search) return 'today';
  const params = new URLSearchParams(search);
  const requested = params.get('view')?.trim();
  if (requested && (hubViews as readonly string[]).includes(requested)) {
    return requested as HubView;
  }
  if (params.has('collaborationType') || params.has('collaborationId')) return 'activity';
  return params.get('workItemId')?.trim() ? 'work' : 'today';
}

export function buildHubSearch(search: string | undefined, view: HubView): string {
  const params = new URLSearchParams(search ?? '');
  if (view === 'today') params.delete('view');
  else params.set('view', view);
  if (view !== 'activity') {
    params.delete('collaborationType');
    params.delete('collaborationId');
  }
  const next = params.toString();
  return next ? `?${next}` : '';
}

/**
 * Browser-only preview is an explicit opt-in. Preserve it when a card/link
 * navigates within the same local tab; production Teams deep links remain
 * unchanged because they do not carry the preview parameter.
 */
export function preserveBrowserPreview(href: string, currentSearch: string | undefined): string {
  const current = new URLSearchParams(currentSearch ?? '');
  const preview = current.get('preview')?.trim();
  if (!preview) return href;

  const target = new URL(href, 'http://teams-local.invalid');
  if (!target.searchParams.has('preview')) target.searchParams.set('preview', preview);
  const query = target.searchParams.toString();
  return `${target.pathname}${query ? `?${query}` : ''}${target.hash}`;
}
