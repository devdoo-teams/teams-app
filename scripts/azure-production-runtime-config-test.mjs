import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { validateAzureProductionRuntimeConfig } from './azure-production-runtime-config.mjs';

const valid = {
  TEAMS_APP_ID: '00000000-0000-4000-8000-000000000001',
  TEAMS_CATALOG_APP_ID: '00000000-0000-4000-8000-000000000002',
  BOT_ID: '00000000-0000-4000-8000-000000000003',
  TAB_DOMAIN: 'teamsapp.example.com',
  CLIENT_ID: '00000000-0000-4000-8000-000000000004',
  BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000005',
  TENANT_ID: '00000000-0000-4000-8000-000000000006',
  APPLICATION_ID_URI: 'api://teamsapp.example.com/botid-00000000-0000-4000-8000-000000000005',
  TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: '00000000-0000-4000-8000-000000000004',
  TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME: 'teams-bot-client-secret',
  TEAMS_OPERATOR_ALLOWLIST_KEY_VAULT_SECRET_NAME: 'teams-operator-allowlist',
};

const configuration = validateAzureProductionRuntimeConfig(valid);
assert.equal(configuration.botClientId, valid.BOT_CLIENT_ID);
assert.equal(configuration.teamsUserAuthAcceptedAudiences, valid.CLIENT_ID);
assert.equal(configuration.botClientSecretKeyVaultSecretName, valid.TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME);
assert.equal(Object.hasOwn(configuration, 'clientSecret'), false, 'secret contents must never enter the configuration object');

for (const [name, value] of [
  ['missing identity', { CLIENT_ID: '' }],
  ['unrelated audience', { TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: 'api://unrelated.example.com' }],
  ['invalid secret name', { TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME: 'secret/name' }],
  ['duplicate secret names', { TEAMS_OPERATOR_ALLOWLIST_KEY_VAULT_SECRET_NAME: valid.TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME }],
]) {
  assert.throws(
    () => validateAzureProductionRuntimeConfig({ ...valid, ...value }),
    /Invalid Azure production runtime configuration:/,
    `${name} must fail closed`,
  );
}

const cli = spawnSync(
  process.execPath,
  ['./scripts/azure-production-runtime-config.mjs'],
  { env: { ...process.env, ...valid }, encoding: 'utf8' },
);
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /secret values remain out of band/);
assert.doesNotMatch(cli.stdout, /secret-value|client-secret-value/i);

console.log('azure-production-runtime-config-test: PASS');
