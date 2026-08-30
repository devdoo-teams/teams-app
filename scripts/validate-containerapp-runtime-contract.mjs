import assert from 'node:assert/strict';
import fs from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Container App JSON path is required.');
  process.exit(1);
}

const document = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const container = document?.properties?.template?.containers?.[0];
if (!container || typeof container !== 'object') {
  throw new Error('Container App must expose a first container template.');
}

const entries = new Map(
  (Array.isArray(container.env) ? container.env : [])
    .filter((entry) => entry && typeof entry.name === 'string')
    .map((entry) => [entry.name, entry]),
);

function requireEntry(name) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`Container App runtime environment is missing ${name}.`);
  return entry;
}

function readDirect(name) {
  const entry = requireEntry(name);
  if (typeof entry.value !== 'string' || !entry.value.trim()) {
    if (entry.secretRef) {
      throw new Error(`Container App runtime identity ${name} must be directly verifiable, not secretRef-backed.`);
    }
    throw new Error(`Container App runtime environment ${name} must have a non-empty value.`);
  }
  return entry.value.trim();
}

function expected(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Expected deployment variable ${name} is unavailable.`);
  return value;
}

const directlyVerified = [
  'BOT_CLIENT_ID',
  'CLIENT_ID',
  'TENANT_ID',
  'TAB_DOMAIN',
  'APPLICATION_ID_URI',
  'TEAMS_CATALOG_APP_ID',
];

for (const name of directlyVerified) {
  assert.equal(
    readDirect(name),
    expected(name),
    `Container App runtime ${name} does not match the packaged Teams/Entra identity.`,
  );
}

const publicUrl = new URL(expected('PUBLIC_BASE_URL'));
assert.equal(publicUrl.protocol, 'https:', 'PUBLIC_BASE_URL must use HTTPS.');
assert.equal(publicUrl.hostname, expected('TAB_DOMAIN'), 'PUBLIC_BASE_URL host must match TAB_DOMAIN.');

const expectedApplicationIdUri = `api://${expected('TAB_DOMAIN')}/botid-${expected('BOT_CLIENT_ID')}`;
assert.equal(
  expected('APPLICATION_ID_URI'),
  expectedApplicationIdUri,
  'APPLICATION_ID_URI must use the combined Teams bot+tab resource URI.',
);
assert.equal(
  readDirect('APPLICATION_ID_URI'),
  expectedApplicationIdUri,
  'Container App APPLICATION_ID_URI must use the combined Teams bot+tab resource URI.',
);

const clientSecret = requireEntry('CLIENT_SECRET');
if (!clientSecret.value && !clientSecret.secretRef) {
  throw new Error('Container App runtime environment must provide CLIENT_SECRET or a secretRef.');
}

const audiences = readDirect('TEAMS_USER_AUTH_ACCEPTED_AUDIENCES')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (audiences.length === 0) {
  throw new Error('TEAMS_USER_AUTH_ACCEPTED_AUDIENCES must not be empty.');
}
const allowedAudiences = new Set([expected('CLIENT_ID'), expected('APPLICATION_ID_URI')]);
if (audiences.some((audience) => !allowedAudiences.has(audience))) {
  throw new Error('TEAMS_USER_AUTH_ACCEPTED_AUDIENCES contains an audience outside the packaged identity.');
}

console.log('PASS: Container App runtime environment matches the packaged Teams/Entra identity and auth contract.');
