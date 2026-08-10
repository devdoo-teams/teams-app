import { strict as assert } from 'node:assert';

const { buildHubSearch, parseHubView, preserveBrowserPreview } = await import('../src/client/hub-navigation.js');

assert.equal(parseHubView(undefined), 'today');
assert.equal(parseHubView('?view=work'), 'work');
assert.equal(parseHubView('?view=activity'), 'activity');
assert.equal(parseHubView('?view=settings'), 'settings');
assert.equal(parseHubView('?view=unknown'), 'today');
assert.equal(parseHubView('?workItemId=work-123'), 'work');
assert.equal(parseHubView('?view=unknown&workItemId=work-123'), 'work');
assert.equal(parseHubView('?collaborationType=goal&collaborationId=goal-7'), 'activity');
assert.equal(parseHubView('?view=unknown&collaborationType=work-item&collaborationId=item-8'), 'activity');
assert.equal(parseHubView('?collaborationType=project'), 'activity', 'a malformed collaboration link still opens Activity so it can show recovery guidance');
assert.equal(parseHubView('?collaborationId=project-9'), 'activity', 'a missing collaboration type is handled by the Activity surface');

assert.equal(buildHubSearch('', 'today'), '');
assert.equal(buildHubSearch('?workItemId=work-123', 'work'), '?workItemId=work-123&view=work');
assert.equal(buildHubSearch('?view=settings&workItemId=work-123', 'today'), '?workItemId=work-123');
assert.equal(buildHubSearch('?q=a%20b', 'activity'), '?q=a+b&view=activity');
assert.equal(
  buildHubSearch('?collaborationType=goal&collaborationId=goal-7', 'today'),
  '',
  'leaving Activity clears collaboration deep-link state so reload stays on Today',
);
assert.equal(
  buildHubSearch('?collaborationType=goal&collaborationId=goal-7', 'settings'),
  '?view=settings',
);
assert.equal(
  buildHubSearch('?collaborationType=goal&collaborationId=goal-7', 'activity'),
  '?collaborationType=goal&collaborationId=goal-7&view=activity',
);
assert.equal(
  preserveBrowserPreview('/tabs/home/?collaborationType=work-item&collaborationId=item-8', '?preview=1&view=activity'),
  '/tabs/home/?collaborationType=work-item&collaborationId=item-8&preview=1',
  'local preview is retained when an Activity notification is opened',
);
assert.equal(
  preserveBrowserPreview('/tabs/home/?collaborationType=work-item&collaborationId=item-8&preview=true', '?preview=1'),
  '/tabs/home/?collaborationType=work-item&collaborationId=item-8&preview=true',
  'an explicit link preview value is not overwritten',
);
assert.equal(
  preserveBrowserPreview('/tabs/home/?view=activity', ''),
  '/tabs/home/?view=activity',
  'production Teams links are unchanged',
);

console.log('Client hub navigation tests passed');
