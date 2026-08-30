import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(root, 'scripts', 'validate-containerapp-runtime-contract.mjs');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-containerapp-runtime-'));

const identity = {
  BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
  CLIENT_ID: '00000000-0000-4000-8000-000000000002',
  TENANT_ID: '00000000-0000-4000-8000-000000000003',
  TEAMS_CATALOG_APP_ID: '00000000-0000-4000-8000-000000000004',
  TAB_DOMAIN: 'runtime.example.com',
};
identity.APPLICATION_ID_URI = `api://${identity.TAB_DOMAIN}/botid-${identity.BOT_CLIENT_ID}`;

function documentFor(overrides = {}) {
  const values = { ...identity, ...overrides };
  return {
    properties: {
      template: {
        containers: [{
          name: 'teams-app',
          env: [
            ...Object.entries(values).map(([name, value]) => ({ name, value })),
            { name: 'CLIENT_SECRET', secretRef: 'teams-client-secret' },
            { name: 'TEAMS_USER_AUTH_ACCEPTED_AUDIENCES', value: `${values.CLIENT_ID},${values.APPLICATION_ID_URI}` },
          ],
        }],
      },
    },
  };
}

function run(document, overrides = {}) {
  const documentPath = path.join(fixtureRoot, 'container-app.json');
  fs.writeFileSync(documentPath, `${JSON.stringify(document)}\n`);
  const env = {
    PATH: process.env.PATH ?? '',
    ...identity,
    PUBLIC_BASE_URL: `https://${identity.TAB_DOMAIN}`,
    ...overrides,
  };
  return execFileSync(process.execPath, [validator, documentPath], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

try {
  assert.match(run(documentFor()), /PASS: Container App runtime environment/);

  assert.throws(
    () => run(documentFor({ TAB_DOMAIN: 'other.example.com' })),
    /TAB_DOMAIN.*does not match/,
    'a target runtime with a different tab host must fail closed',
  );

  assert.throws(
    () => run(documentFor({ APPLICATION_ID_URI: 'api://unrelated.example.com/botid-00000000-0000-4000-8000-000000000001' })),
    /APPLICATION_ID_URI.*does not match/,
    'a target runtime with a different application URI must fail closed',
  );

  const missingAudience = documentFor();
  missingAudience.properties.template.containers[0].env = missingAudience.properties.template.containers[0].env
    .filter(({ name }) => name !== 'TEAMS_USER_AUTH_ACCEPTED_AUDIENCES');
  assert.throws(
    () => run(missingAudience),
    /TEAMS_USER_AUTH_ACCEPTED_AUDIENCES/,
    'a target runtime without delegated audience validation must fail closed',
  );

  const secretBackedIdentity = documentFor();
  secretBackedIdentity.properties.template.containers[0].env = secretBackedIdentity.properties.template.containers[0].env
    .map((entry) => entry.name === 'TAB_DOMAIN' ? { name: entry.name, secretRef: 'tab-domain' } : entry);
  assert.throws(
    () => run(secretBackedIdentity),
    /TAB_DOMAIN.*secretRef-backed/,
    'identity fields must be directly verifiable without reading secrets',
  );

  console.log('PASS: Container App runtime identity contract accepts matching fixtures and rejects drift or unverifiable fields');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
}
