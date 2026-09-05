import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const JWT_PART = /^[A-Za-z0-9_-]+$/u;
const MAX_TOKEN_LENGTH = 64 * 1024;

function fail(message) {
  throw new Error(`Invalid Azure service principal access token: ${message}`);
}

function normalizeGuid(value, label) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!GUID.test(normalized)) fail(`${label} must be a GUID`);
  return normalized;
}

function decodePayload(accessToken) {
  const encoded = String(accessToken ?? '').trim();
  if (!encoded || encoded.length > MAX_TOKEN_LENGTH) fail('JWT length is invalid');
  const parts = encoded.split('.');
  if (parts.length !== 3 || parts.some((part) => !JWT_PART.test(part))) fail('JWT structure is invalid');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    fail('JWT payload is invalid JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('JWT payload must be an object');
  return payload;
}

export function resolveAzureServicePrincipalObjectId({
  accessToken,
  expectedTenantId,
  expectedClientId,
}) {
  const tenantId = normalizeGuid(expectedTenantId, 'expected tenant ID');
  const clientId = normalizeGuid(expectedClientId, 'expected client ID');
  const payload = decodePayload(accessToken);
  const tokenTenantId = normalizeGuid(payload.tid, 'token tenant ID');
  const objectId = normalizeGuid(payload.oid, 'token object ID');
  const clientClaims = [payload.appid, payload.azp]
    .filter((value) => value !== undefined)
    .map((value) => normalizeGuid(value, 'token client ID'));

  if (tokenTenantId !== tenantId) fail('token tenant does not match the selected Azure endpoint');
  if (clientClaims.length === 0 || clientClaims.some((value) => value !== clientId)) {
    fail('token client does not match the selected Azure endpoint');
  }
  return objectId;
}

function parseArguments(args) {
  if (args.length !== 4) fail('expected --expected-tenant and --expected-client');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['--expected-tenant', '--expected-client'].includes(name)) fail('unknown argument');
    if (values.has(name)) fail('duplicate argument');
    values.set(name, args[index + 1]);
  }
  if (!values.has('--expected-tenant') || !values.has('--expected-client')) fail('both expected identity arguments are required');
  return values;
}

function runCli() {
  const values = parseArguments(process.argv.slice(2));
  const accessToken = fs.readFileSync(0, 'utf8');
  const objectId = resolveAzureServicePrincipalObjectId({
    accessToken,
    expectedTenantId: values.get('--expected-tenant'),
    expectedClientId: values.get('--expected-client'),
  });
  process.stdout.write(`${objectId}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid Azure service principal access token');
    process.exitCode = 1;
  }
}
