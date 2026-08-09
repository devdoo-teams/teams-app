import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const base = {
  TEAMS_APP_ID: '00000000-0000-4000-8000-000000000001',
  BOT_ID: '00000000-0000-4000-8000-000000000002',
  TAB_DOMAIN: 'runtime.example.com',
  CLIENT_ID: '00000000-0000-4000-8000-000000000003',
  BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000004',
  TENANT_ID: '00000000-0000-4000-8000-000000000005',
  APPLICATION_ID_URI: 'api://runtime.example.com/botid-00000000-0000-4000-8000-000000000004',
};

function run(overrides = {}) {
  return spawnSync(process.execPath, ['scripts/validate-deployment-env.mjs'], {
    env: { ...process.env, ...base, ...overrides },
    encoding: 'utf8',
  });
}

const valid = run();
assert.equal(valid.status, 0, valid.stderr || valid.stdout);

const mismatched = run({ APPLICATION_ID_URI: 'api://runtime.example.com/00000000-0000-4000-8000-000000000003' });
assert.notEqual(mismatched.status, 0, 'a non-botid Application ID URI must fail preflight for a Teams SDK bot app');
assert.match(
  `${mismatched.stdout}\n${mismatched.stderr}`,
  /APPLICATION_ID_URI must match the Teams SDK combined bot\+tab resource/,
);

const standalone = run({ APPLICATION_ID_URI: 'api://botid-00000000-0000-4000-8000-000000000004' });
assert.notEqual(standalone.status, 0, 'the standalone bot URI must fail for the combined bot and tab contract');
assert.match(
  `${standalone.stdout}\n${standalone.stderr}`,
  /api:\/\/runtime\.example\.com\/botid-00000000-0000-4000-8000-000000000004/,
);

const devTunnel = run({
  TAB_DOMAIN: 'dxshc7dx-3978.jpe1.devtunnels.ms',
  APPLICATION_ID_URI: 'api://dxshc7dx-3978.jpe1.devtunnels.ms/botid-00000000-0000-4000-8000-000000000004',
});
assert.equal(devTunnel.status, 0, devTunnel.stderr || devTunnel.stdout);

for (const [label, TAB_DOMAIN] of [
  ['port', 'runtime.example.com:3978'],
  ['query', 'runtime.example.com?unexpected'],
  ['fragment', 'runtime.example.com#unexpected'],
  ['whitespace', 'runtime.example.com with-space'],
  ['empty label', 'runtime..example.com'],
  ['leading dot', '.runtime.example.com'],
  ['trailing dot', 'runtime.example.com.'],
  ['leading hyphen', '-runtime.example.com'],
  ['trailing hyphen', 'runtime.example.com-'],
  ['underscore', 'runtime_example.com'],
]) {
  const invalid = run({ TAB_DOMAIN });
  assert.notEqual(invalid.status, 0, `${label} TAB_DOMAIN must fail preflight`);
  assert.match(
    `${invalid.stdout}\n${invalid.stderr}`,
    /TAB_DOMAIN must be a public HTTPS hostname/,
    `${label} TAB_DOMAIN must fail at hostname validation`,
  );
}

console.log('Deployment environment tests passed: combined Teams SDK bot+tab resource URI is mandatory.');
