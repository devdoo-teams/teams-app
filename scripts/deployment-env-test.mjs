import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const base = {
  TEAMS_APP_ID: '00000000-0000-4000-8000-000000000001',
  BOT_ID: '00000000-0000-4000-8000-000000000002',
  TAB_DOMAIN: 'runtime.example.com',
  CLIENT_ID: '00000000-0000-4000-8000-000000000003',
  BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000004',
  TENANT_ID: '00000000-0000-4000-8000-000000000005',
  APPLICATION_ID_URI: 'api://runtime.example.com/00000000-0000-4000-8000-000000000003',
};

function run(overrides = {}) {
  return spawnSync(process.execPath, ['scripts/validate-deployment-env.mjs'], {
    env: { ...process.env, ...base, ...overrides },
    encoding: 'utf8',
  });
}

const valid = run();
assert.equal(valid.status, 0, valid.stderr || valid.stdout);

const mismatched = run({ APPLICATION_ID_URI: 'api://00000000-0000-4000-8000-000000000003' });
assert.notEqual(mismatched.status, 0, 'an origin-mismatched Application ID URI must fail preflight');
assert.match(
  `${mismatched.stdout}\n${mismatched.stderr}`,
  /APPLICATION_ID_URI must match the Teams tab origin/,
);

console.log('Deployment environment tests passed: exact Teams tab origin URI is mandatory.');
