import assert from 'node:assert/strict';

import {
  diagnoseRemoteAgentResult,
  diagnoseRemoteTroubleshooting,
} from '../src/server/remote-troubleshooting.js';

assert.equal(
  diagnoseRemoteTroubleshooting('Browser is not available: iab unavailable').code,
  'browser-unavailable',
);
assert.equal(
  diagnoseRemoteTroubleshooting('teams status: Not logged in').code,
  'teams-cli-auth',
);
assert.equal(
  diagnoseRemoteTroubleshooting('Sideloading: not allowed; Upload custom apps is blocked').code,
  'sideload-policy',
);
assert.equal(
  diagnoseRemoteTroubleshooting('APPLICATION_ID_URI mismatch: expected api://example/client').code,
  'sso-uri-mismatch',
);
assert.equal(
  diagnoseRemoteAgentResult('REMOTE TEAMS CODEX OPERATING RULES\nBrowser is not available').code,
  'unknown',
);
assert.equal(
  diagnoseRemoteAgentResult('STATUS: BLOCKED\nBLOCKER: teams status Not logged in').code,
  'teams-cli-auth',
);

console.log('Remote troubleshooting classification tests passed.');
