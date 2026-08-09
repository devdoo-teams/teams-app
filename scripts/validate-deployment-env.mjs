const required = [
  'TEAMS_APP_ID',
  'BOT_ID',
  'TAB_DOMAIN',
  'CLIENT_ID',
  'BOT_CLIENT_ID',
  'TENANT_ID',
  'APPLICATION_ID_URI',
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Missing deployment environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const values = Object.fromEntries(required.map((name) => [name, process.env[name].trim()]));
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalidGuids = ['TEAMS_APP_ID', 'BOT_ID', 'CLIENT_ID', 'BOT_CLIENT_ID', 'TENANT_ID'].filter(
  (name) => !guidPattern.test(values[name]),
);

if (invalidGuids.length > 0) {
  console.error(`These deployment IDs must be UUIDs: ${invalidGuids.join(', ')}`);
  process.exit(1);
}

// Teams SDK apps that combine a bot and a tab use the bot's resource URI for
// SSO. The auth app ID in webApplicationInfo.id may remain separate (for
// example, when a managed identity or dedicated auth registration is used),
// but the resource must use the Teams bot client ID.

if (
  values.TAB_DOMAIN.includes('://') ||
  values.TAB_DOMAIN.includes('/') ||
  values.TAB_DOMAIN.includes('*') ||
  values.TAB_DOMAIN === 'localhost' ||
  values.TAB_DOMAIN.startsWith('127.') ||
  !values.TAB_DOMAIN.includes('.')
) {
  console.error('TAB_DOMAIN must be a public HTTPS hostname without a scheme, path, wildcard, or localhost.');
  process.exit(1);
}

if (!values.APPLICATION_ID_URI.startsWith('api://') || /[<>$]|\$\{\{/.test(values.APPLICATION_ID_URI)) {
  console.error('APPLICATION_ID_URI must be a real api:// Application ID URI without template placeholders.');
  process.exit(1);
}

const expectedApplicationIdUri = `api://${values.TAB_DOMAIN}/botid-${values.BOT_CLIENT_ID}`;
if (values.APPLICATION_ID_URI !== expectedApplicationIdUri) {
  console.error(
    `APPLICATION_ID_URI must match the Teams SDK combined bot+tab resource: expected ${expectedApplicationIdUri}. ` +
      'Verify the Bot Entra app Expose an API URI before creating or uploading a Teams package.',
  );
  process.exit(1);
}

const placeholderPattern = /demo\.example\.com|11111111-1111-1111-1111-111111111111|22222222-2222-2222-2222-222222222222|33333333-3333-3333-3333-333333333333|\$\{\{/i;
const placeholderFields = required.filter((name) => placeholderPattern.test(values[name]));
if (placeholderFields.length > 0) {
  console.error(`Deployment values still look like placeholders: ${placeholderFields.join(', ')}`);
  process.exit(1);
}

console.log('Deployment environment looks ready for an operational Teams package.');
