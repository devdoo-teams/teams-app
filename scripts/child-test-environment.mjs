const STANDARD_CHILD_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LC_NUMERIC',
  'LC_TIME',
  'LC_COLLATE',
  'LC_MONETARY',
  'LC_MESSAGES',
  'LC_PAPER',
  'LC_NAME',
  'LC_ADDRESS',
  'LC_TELEPHONE',
  'LC_MEASUREMENT',
  'LC_IDENTIFICATION',
  'TZ',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
]);

const CHILD_TEST_HARNESS_KEYS = new Set([
  'TEAMS_SOURCE_COMMIT',
  'TEAMS_TEST_TIMEOUT_MS',
  'TEAMS_FILEPROVIDER_SERVER_REUSE',
]);

function normalizedKeys(keys) {
  return [...keys].map((key) => String(key).toUpperCase());
}

export function createChildTestEnvironment(
  parentEnv = process.env,
  { additionalPassThrough = [], overrides = {} } = {},
) {
  const allowedKeys = new Set([
    ...STANDARD_CHILD_ENV_KEYS,
    ...CHILD_TEST_HARNESS_KEYS,
    ...normalizedKeys(additionalPassThrough),
  ]);
  const childEnv = {};

  for (const [key, value] of Object.entries(parentEnv)) {
    const normalizedKey = key.toUpperCase();
    if (typeof value !== 'string') continue;
    if (!allowedKeys.has(normalizedKey)) continue;
    childEnv[normalizedKey] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    const normalizedKey = key.toUpperCase();
    if (value === undefined || value === null) {
      delete childEnv[normalizedKey];
      continue;
    }
    childEnv[normalizedKey] = String(value);
  }

  return childEnv;
}
