import assert from 'node:assert/strict';

import { GITHUB_TEAMS_EXTERNAL_APP, isExternalCollaborationApp } from '../src/shared/external-collaboration.js';

assert.deepEqual(GITHUB_TEAMS_EXTERNAL_APP, {
  id: 'github-copilot-coding-agent-for-teams',
  kind: 'external-app',
  name: '@GitHub',
  providerId: null,
  createsInternalJob: false,
  contributesProviderReadiness: false,
  installUrl: 'https://github.com/apps/github-for-microsoft-teams',
  documentationUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-integrations/integrate-cloud-agent-with-teams',
});
assert.equal(isExternalCollaborationApp(GITHUB_TEAMS_EXTERNAL_APP), true);
assert.equal(isExternalCollaborationApp({ ...GITHUB_TEAMS_EXTERNAL_APP, providerId: 'github' }), false);
assert.equal(isExternalCollaborationApp({ ...GITHUB_TEAMS_EXTERNAL_APP, createsInternalJob: true }), false);
assert.equal(isExternalCollaborationApp({ ...GITHUB_TEAMS_EXTERNAL_APP, contributesProviderReadiness: true }), false);

console.log('PASS: external @GitHub Teams app never becomes an internal provider or AgentJob');
