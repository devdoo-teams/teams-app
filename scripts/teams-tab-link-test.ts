import assert from 'node:assert/strict';

import { buildTeamsPersonalTabDeepLink, withTeamsCopilotJobDeepLink } from '../src/server/teams-tab-link.js';

const link = buildTeamsPersonalTabDeepLink({
  catalogAppId: '9b20fd94-2ac9-4423-ac1f-ff528ab245c1',
  tabDomain: 'example.com',
  tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
});

assert.equal(
  link,
  'https://teams.microsoft.com/l/entity/9b20fd94-2ac9-4423-ac1f-ff528ab245c1/home?webUrl=https%3A%2F%2Fexample.com%2Ftabs%2Fhome%2F&label=%EC%97%85%EB%AC%B4+%ED%97%88%EB%B8%8C&tenantId=72f988bf-86f1-41af-91ab-2d7cd011db47',
);
assert.equal(buildTeamsPersonalTabDeepLink({ catalogAppId: '', tabDomain: 'example.com' }), undefined);
assert.equal(buildTeamsPersonalTabDeepLink({
  catalogAppId: '9b20fd94-2ac9-4423-ac1f-ff528ab245c1',
  tabDomain: 'https://example.com/tabs/home',
}), undefined);

const copilotLink = new URL(withTeamsCopilotJobDeepLink(link, 'task-detail-1')!);
assert.equal(copilotLink.pathname, new URL(link!).pathname, 'rich navigation reuses the existing catalog and tab identity');
assert.deepEqual(JSON.parse(copilotLink.searchParams.get('context')!), { subEntityId: 'copilot-ui:task-detail-1' });
const webCopilot = new URL(copilotLink.searchParams.get('webUrl')!);
assert.equal(webCopilot.searchParams.get('view'), 'copilot');
assert.equal(webCopilot.searchParams.get('jobId'), 'task-detail-1');
assert.equal(webCopilot.pathname, '/tabs/home/');
assert.equal(withTeamsCopilotJobDeepLink('https://synthetic.invalid/', 'task-detail-1'), undefined);
assert.equal(withTeamsCopilotJobDeepLink(link, '../foreign'), undefined);
assert.equal(buildTeamsPersonalTabDeepLink({
  catalogAppId: '9b20fd94-2ac9-4423-ac1f-ff528ab245c1',
  tabDomain: 'example.com',
  tenantId: 'not-a-guid',
}), undefined);

console.log('PASS: Teams personal tab deep links are encoded and reject invalid deployment values');

const jobLink = buildTeamsPersonalTabDeepLink({
  catalogAppId: '9b20fd94-2ac9-4423-ac1f-ff528ab245c1', tabDomain: 'example.com', jobId: 'task-detail-1',
});
assert.ok(jobLink);
const target = new URL(jobLink);
assert.deepEqual(JSON.parse(target.searchParams.get('context')!), { subEntityId: 'task-detail-1' });
assert.equal(new URL(target.searchParams.get('webUrl')!).searchParams.get('jobId'), 'task-detail-1');
assert.equal(target.searchParams.has('prompt'), false);
assert.equal(buildTeamsPersonalTabDeepLink({
  catalogAppId: '9b20fd94-2ac9-4423-ac1f-ff528ab245c1', tabDomain: 'example.com', jobId: '../private?user=other',
}), undefined);
