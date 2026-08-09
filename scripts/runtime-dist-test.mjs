import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = '/workspace/TeamsApp';
assert.equal(
  resolveRuntimeDistRoot(root, { TEAMS_RUNTIME_DIST_DIR: '/tmp/teams-runtime' }),
  '/tmp/teams-runtime',
);
assert.equal(
  resolveRuntimeDistRoot(root, {}, () => ({ isDirectory: () => true, blocks: 0 })),
  path.join(os.tmpdir(), 'teams-sdk-mvp-runtime', 'dist'),
);
assert.equal(
  resolveRuntimeDistRoot(root, {}, () => ({ isDirectory: () => true, blocks: 16 })),
  path.join(root, 'dist'),
);

console.log('Runtime dist path tests passed.');
