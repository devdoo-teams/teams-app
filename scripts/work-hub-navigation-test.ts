import assert from 'node:assert/strict';

const navigation = await import('../src/client/work-hub-navigation.js').catch(() => ({} as Record<string, unknown>));
assert.equal(typeof navigation.workHubStorageKey, 'function', 'local navigation preferences are partitioned by Teams user and tenant');
assert.equal(typeof navigation.readWorkHubPreferences, 'function', 'stored navigation preferences are validated before use');
assert.equal(typeof navigation.writeWorkHubPreferences, 'function', 'pins/projects remain local to the current account and device');
assert.equal(typeof navigation.togglePinnedJob, 'function', 'a selected task can be pinned');
assert.equal(typeof navigation.assignJobToProject, 'function', 'a task can be assigned to a local project');
assert.equal(typeof navigation.summarizeWorkHubPrompt, 'function', 'long prompts become bounded titles and previews');

const memory = new Map<string, string>();
const storage = {
  getItem(key: string) { return memory.get(key) ?? null; },
  setItem(key: string, value: string) { memory.set(key, value); },
  removeItem(key: string) { memory.delete(key); },
};
const key = (navigation.workHubStorageKey as (tenant: string, user: string) => string | undefined)('tenant-a', 'user-a')!;
assert.notEqual(key, (navigation.workHubStorageKey as (tenant: string, user: string) => string | undefined)('tenant-b', 'user-a'));
assert.equal((navigation.workHubStorageKey as (tenant: string, user: string) => string | undefined)('', 'user-a'), undefined);

const defaults = (navigation.readWorkHubPreferences as (s: typeof storage, k: string) => any)(storage, key);
let prefs = (navigation.togglePinnedJob as (p: any, id: string) => any)(defaults, 'task-a');
prefs = (navigation.addWorkHubProject as (p: any, name: string) => any)(prefs, 'Core UI');
prefs = (navigation.assignJobToProject as (p: any, id: string, name: string) => any)(prefs, 'task-a', 'Core UI');
(navigation.writeWorkHubPreferences as (s: typeof storage, k: string, p: any) => void)(storage, key, prefs);
const restored = (navigation.readWorkHubPreferences as (s: typeof storage, k: string) => any)(storage, key);
assert.deepEqual({ ...restored, projectByJobId: { ...restored.projectByJobId } }, prefs);
assert.deepEqual((navigation.workHubNavigationJobIds as (p: any, section: string, project?: string) => string[] | undefined)(prefs, 'pinned'), ['task-a']);
assert.deepEqual((navigation.workHubNavigationJobIds as (p: any, section: string, project?: string) => string[] | undefined)(prefs, 'project', 'Core UI'), ['task-a']);
let capped = (navigation.addWorkHubProject as (p: any, name: string) => any)(defaults, 'Bounded');
for (let index = 0; index < 50; index += 1) capped = (navigation.assignJobToProject as (p: any, id: string, name: string) => any)(capped, `job-${index}`, 'Bounded');
const reassigned = (navigation.assignJobToProject as (p: any, id: string, name: string) => any)(capped, 'job-0', 'Bounded');
const overflow = (navigation.assignJobToProject as (p: any, id: string, name: string) => any)(reassigned, 'job-50', 'Bounded');
assert.equal(Object.keys(overflow.projectByJobId).length, 50, 'project IDs fit the server query bound and reject later assignments');
assert.equal(overflow.projectByJobId['job-0'], 'Bounded', 'reassigning at the cap does not erase an existing assignment');

const longPrompt = `Review the current app\n${'Keep the full request available in the detail view. '.repeat(12)}`;
const summary = (navigation.summarizeWorkHubPrompt as (prompt: string) => { title: string; preview: string })(longPrompt);
assert.equal(summary.title, 'Review the current app');
assert.ok(summary.preview.length <= 141, 'preview has a strict display limit');
assert.ok(summary.preview.length > 0);
const corrupt = { getItem: () => '{"projectNames":["ok"],"pinnedJobIds":["bad\u0000id"]}', setItem() {}, removeItem() {} };
assert.deepEqual((navigation.readWorkHubPreferences as (s: typeof corrupt, k: string) => any)(corrupt, key).pinnedJobIds, [], 'invalid persisted IDs are discarded');
console.log('PASS: Work Hub navigation preferences stay scoped and prompts render as bounded summaries');
