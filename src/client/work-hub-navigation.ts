export type WorkHubPreferences = Readonly<{
  pinnedJobIds: readonly string[];
  projectNames: readonly string[];
  projectByJobId: Readonly<Record<string, string>>;
}>;

export type WorkHubNavigationSection = 'recent' | 'pinned' | 'project';
export type WorkHubStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const MAX_PINNED_JOBS = 50;
const MAX_PROJECTS = 40;
const MAX_PROJECT_ASSIGNMENTS = MAX_PINNED_JOBS;
const MAX_PROJECT_NAME_LENGTH = 64;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const EMPTY_PREFERENCES: WorkHubPreferences = Object.freeze({
  pinnedJobIds: Object.freeze([]),
  projectNames: Object.freeze([]),
  projectByJobId: Object.freeze({}),
});

function validJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID.test(value);
}

function normalizedProject(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || name.length > MAX_PROJECT_NAME_LENGTH || CONTROL.test(name)) return undefined;
  return name;
}

function uniqueNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const name = normalizedProject(value);
    if (!name || seen.has(name.toLocaleLowerCase('en-US'))) continue;
    seen.add(name.toLocaleLowerCase('en-US'));
    result.push(name);
    if (result.length >= MAX_PROJECTS) break;
  }
  return result;
}

export function workHubStorageKey(tenantId: string | undefined, userId: string | undefined): string | undefined {
  // Teams context values partition local preferences only; the server token
  // remains the sole authorization source.
  if (!tenantId || !userId || tenantId.length > 256 || userId.length > 256 || CONTROL.test(tenantId) || CONTROL.test(userId)) return undefined;
  return `teams-core-work-hub:v1:${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}`;
}

export function readWorkHubPreferences(storage: WorkHubStorage | undefined, key: string | undefined): WorkHubPreferences {
  if (!storage || !key) return EMPTY_PREFERENCES;
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 100_000) return EMPTY_PREFERENCES;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_PREFERENCES;
    const record = value as Record<string, unknown>;
    const projectNames = uniqueNames(record.projectNames);
    const knownProjects = new Set(projectNames.map(name => name.toLocaleLowerCase('en-US')));
    const pinnedJobIds = Array.isArray(record.pinnedJobIds)
      ? [...new Set(record.pinnedJobIds.filter(validJobId))].slice(0, MAX_PINNED_JOBS) : [];
    const projectByJobId: Record<string, string> = Object.create(null) as Record<string, string>;
    if (record.projectByJobId && typeof record.projectByJobId === 'object' && !Array.isArray(record.projectByJobId)) {
      for (const [jobId, rawName] of Object.entries(record.projectByJobId).slice(0, MAX_PROJECT_ASSIGNMENTS)) {
        const name = normalizedProject(rawName);
        if (validJobId(jobId) && name && knownProjects.has(name.toLocaleLowerCase('en-US'))) projectByJobId[jobId] = name;
      }
    }
    return { pinnedJobIds, projectNames, projectByJobId };
  } catch {
    return EMPTY_PREFERENCES;
  }
}

export function writeWorkHubPreferences(storage: WorkHubStorage | undefined, key: string | undefined, preferences: WorkHubPreferences): void {
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify({
      pinnedJobIds: preferences.pinnedJobIds.filter(validJobId).slice(0, MAX_PINNED_JOBS),
      projectNames: uniqueNames(preferences.projectNames),
      projectByJobId: preferences.projectByJobId,
    }));
  } catch { /* Browser storage can be disabled or full; in-memory state remains usable. */ }
}

export function togglePinnedJob(preferences: WorkHubPreferences, jobId: string): WorkHubPreferences {
  if (!validJobId(jobId)) return preferences;
  if (preferences.pinnedJobIds.includes(jobId)) {
    return { ...preferences, pinnedJobIds: preferences.pinnedJobIds.filter(id => id !== jobId) };
  }
  if (preferences.pinnedJobIds.length >= MAX_PINNED_JOBS) return preferences;
  return { ...preferences, pinnedJobIds: [...preferences.pinnedJobIds, jobId] };
}

export function addWorkHubProject(preferences: WorkHubPreferences, rawName: string): WorkHubPreferences {
  const name = normalizedProject(rawName);
  if (!name || preferences.projectNames.length >= MAX_PROJECTS
    || preferences.projectNames.some(project => project.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) return preferences;
  return { ...preferences, projectNames: [...preferences.projectNames, name] };
}

export function assignJobToProject(preferences: WorkHubPreferences, jobId: string, rawName: string): WorkHubPreferences {
  if (!validJobId(jobId)) return preferences;
  const projectByJobId: Record<string, string> = { ...preferences.projectByJobId };
  const name = rawName ? normalizedProject(rawName) : undefined;
  if (name && preferences.projectNames.some(project => project.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))
    && (Object.hasOwn(projectByJobId, jobId) || Object.keys(projectByJobId).length < MAX_PROJECT_ASSIGNMENTS)) projectByJobId[jobId] = name;
  else delete projectByJobId[jobId];
  return { ...preferences, projectByJobId };
}

export function workHubNavigationJobIds(
  preferences: WorkHubPreferences,
  section: WorkHubNavigationSection,
  projectName?: string,
): string[] | undefined {
  if (section === 'recent') return undefined;
  if (section === 'pinned') return [...preferences.pinnedJobIds].slice(0, MAX_PINNED_JOBS);
  if (!projectName) return [];
  return Object.entries(preferences.projectByJobId)
    .filter(([, name]) => name.toLocaleLowerCase('en-US') === projectName.toLocaleLowerCase('en-US'))
    .map(([jobId]) => jobId).slice(0, MAX_PINNED_JOBS);
}

export function summarizeWorkHubPrompt(prompt: string): { title: string; preview: string } {
  const lines = prompt.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const firstLine = (lines.shift() ?? '').replace(/\s+/gu, ' ');
  const titleLimit = 72;
  const previewLimit = 140;
  const title = firstLine.length > titleLimit ? `${firstLine.slice(0, titleLimit - 1).trimEnd()}…` : firstLine;
  const remainder = [firstLine.length > titleLimit ? firstLine.slice(titleLimit) : '', ...lines]
    .filter(Boolean).join(' ').replace(/\s+/gu, ' ').trim();
  const preview = remainder.length > previewLimit ? `${remainder.slice(0, previewLimit - 1).trimEnd()}…` : remainder;
  return { title: title || '제목 없는 작업', preview };
}
