import { isValidPublicHostname } from '../src/shared/public-hostname.js';
import { fileURLToPath } from 'node:url';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SECRET_NAME = /^[0-9A-Za-z-]{1,127}$/u;
const PLACEHOLDER = /demo\.example\.com|(?:11111111|22222222|33333333)-[0-9a-f-]{27,}|\$\{\{/iu;

const REQUIRED_NAMES = Object.freeze([
  'TEAMS_APP_ID',
  'TEAMS_CATALOG_APP_ID',
  'BOT_ID',
  'TAB_DOMAIN',
  'CLIENT_ID',
  'BOT_CLIENT_ID',
  'TENANT_ID',
  'APPLICATION_ID_URI',
  'TEAMS_USER_AUTH_ACCEPTED_AUDIENCES',
  'TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME',
  'TEAMS_OPERATOR_ALLOWLIST_KEY_VAULT_SECRET_NAME',
]);

function fail(message) {
  throw new Error(`Invalid Azure production runtime configuration: ${message}`);
}

function trimmedValues(input) {
  return Object.fromEntries(REQUIRED_NAMES.map((name) => [name, String(input?.[name] ?? '').trim()]));
}

/**
 * Validate only the non-secret production contract needed by the Container App.
 * Secret contents are deliberately not accepted, returned, or printed here.
 */
export function validateAzureProductionRuntimeConfig(input) {
  const values = trimmedValues(input);
  const missing = REQUIRED_NAMES.filter((name) => !values[name]);
  if (missing.length > 0) fail(`missing values: ${missing.join(', ')}`);

  const invalidGuids = [
    'TEAMS_APP_ID',
    'TEAMS_CATALOG_APP_ID',
    'BOT_ID',
    'CLIENT_ID',
    'BOT_CLIENT_ID',
    'TENANT_ID',
  ].filter((name) => !GUID.test(values[name]));
  if (invalidGuids.length > 0) fail(`these values must be UUIDs: ${invalidGuids.join(', ')}`);

  if (!isValidPublicHostname(values.TAB_DOMAIN)) {
    fail('TAB_DOMAIN must be a public HTTPS hostname without a scheme, path, wildcard, or localhost');
  }

  const expectedApplicationIdUri = `api://${values.TAB_DOMAIN}/botid-${values.BOT_CLIENT_ID}`;
  if (values.APPLICATION_ID_URI !== expectedApplicationIdUri) {
    fail('APPLICATION_ID_URI must match the Teams bot and tab identity contract');
  }

  const acceptedAudiences = [...new Set(values.TEAMS_USER_AUTH_ACCEPTED_AUDIENCES
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean))];
  if (acceptedAudiences.length === 0) {
    fail('TEAMS_USER_AUTH_ACCEPTED_AUDIENCES must contain at least one audience');
  }
  if (acceptedAudiences.some((audience) => audience !== values.CLIENT_ID && audience !== values.APPLICATION_ID_URI)) {
    fail('TEAMS_USER_AUTH_ACCEPTED_AUDIENCES must contain only CLIENT_ID or APPLICATION_ID_URI');
  }

  const placeholderNames = REQUIRED_NAMES.filter((name) => PLACEHOLDER.test(values[name]));
  if (placeholderNames.length > 0) fail(`values still look like placeholders: ${placeholderNames.join(', ')}`);

  const secretNameFields = [
    'TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME',
    'TEAMS_OPERATOR_ALLOWLIST_KEY_VAULT_SECRET_NAME',
  ];
  const invalidSecretNames = secretNameFields.filter((name) => !SECRET_NAME.test(values[name]));
  if (invalidSecretNames.length > 0) {
    fail(`Key Vault secret names are invalid: ${invalidSecretNames.join(', ')}`);
  }
  if (values.TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME === values.TEAMS_OPERATOR_ALLOWLIST_KEY_VAULT_SECRET_NAME) {
    fail('bot client secret and operator allowlist must use different Key Vault secret names');
  }

  return Object.freeze({
    teamsAppId: values.TEAMS_APP_ID,
    teamsCatalogAppId: values.TEAMS_CATALOG_APP_ID,
    botId: values.BOT_ID,
    tabDomain: values.TAB_DOMAIN,
    clientId: values.CLIENT_ID,
    botClientId: values.BOT_CLIENT_ID,
    tenantId: values.TENANT_ID,
    applicationIdUri: values.APPLICATION_ID_URI,
    teamsUserAuthAcceptedAudiences: acceptedAudiences.join(','),
    botClientSecretKeyVaultSecretName: values.TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME,
    operatorAllowlistKeyVaultSecretName: values.TEAMS_OPERATOR_ALLOWLIST_KEY_VAULT_SECRET_NAME,
  });
}

export function readAzureProductionRuntimeConfig(environment = process.env) {
  return validateAzureProductionRuntimeConfig(environment);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    readAzureProductionRuntimeConfig();
    process.stdout.write('Azure production runtime configuration is structurally valid; secret values remain out of band.\n');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
