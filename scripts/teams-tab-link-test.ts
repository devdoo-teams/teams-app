import assert from 'node:assert/strict';

import { buildTeamsPersonalTabDeepLink } from '../src/server/teams-tab-link.js';

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
assert.equal(buildTeamsPersonalTabDeepLink({
  catalogAppId: '9b20fd94-2ac9-4423-ac1f-ff528ab245c1',
  tabDomain: 'example.com',
  tenantId: 'not-a-guid',
}), undefined);

console.log('PASS: Teams personal tab deep links are encoded and reject invalid deployment values');
