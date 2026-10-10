const VERSION = /^\d+\.\d+\.\d+$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MODES = /^(?:core|optional)$/u;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const valid = (value, pattern) => typeof value === 'string' && pattern.test(value);

/** The loaded stamp comes from compiled code, never a health response or URL. */
export function parseClientBuildStamp(value) {
  if (!record(value) || value.schemaVersion !== 1 || !valid(value.version, VERSION)
    || !valid(value.sourceCommit, COMMIT) || !valid(value.mode, MODES)
    || !valid(value.buildFingerprint, SHA256)) return undefined;
  return Object.freeze({ schemaVersion: 1, version: value.version, sourceCommit: value.sourceCommit,
    mode: value.mode, buildFingerprint: value.buildFingerprint });
}

const assessment = (mismatches, missing) => Object.freeze({
  status: mismatches.length ? 'FAIL' : missing.length ? 'UNVERIFIED' : 'PASS',
  mismatches: Object.freeze([...new Set(mismatches)]), missing: Object.freeze([...new Set(missing)]),
});

/** Compare independently captured installation, About, loaded bytes and runtime.
 * A provided disagreement remains FAIL even when another observation is absent.
 * This pure comparison does not fetch, synthesize or attest any live evidence. */
export function assessIndependentReleaseIdentity(expected, observation) {
  const mismatches = [], missing = [];
  if (!record(observation)) return assessment(['independentIdentity:invalid'], []);
  if (!record(expected)) return assessment([], ['expectedIdentity']);
  const keys = (value, allowed, path) => {
    if (value === undefined || value === null) return;
    if (!record(value)) { mismatches.push(`${path}:invalid`); return; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) mismatches.push(`${path}.${key}:unexpected`);
  };
  keys(observation, ['schemaVersion', 'installedDefinitionVersion', 'aboutVersion', 'installedPackageSha256', 'loadedClient', 'runtime'], 'independentIdentity');
  keys(observation.loadedClient, ['schemaVersion', 'version', 'sourceCommit', 'mode', 'buildFingerprint', 'assetSha256'], 'loadedClient');
  keys(observation.runtime, ['version', 'sourceCommit', 'serverBundleSha256', 'clientBundleSha256', 'teamsPackageSha256'], 'runtime');
  if (observation.schemaVersion === undefined) missing.push('schemaVersion');
  else if (observation.schemaVersion !== 1) mismatches.push('schemaVersion:invalid');
  if (record(observation.loadedClient) && observation.loadedClient.schemaVersion !== 1) {
    if (observation.loadedClient.schemaVersion === undefined) missing.push('loadedClient.schemaVersion');
    else mismatches.push('loadedClient.schemaVersion:invalid');
  }
  const check = (path, actual, expectedKey, pattern) => {
    if (actual === undefined || actual === null) missing.push(path);
    else if (!valid(actual, pattern)) mismatches.push(`${path}:invalid`);
    const wanted = expected[expectedKey];
    if (wanted === undefined || wanted === null) missing.push(`expected.${expectedKey}`);
    else if (!valid(wanted, pattern)) mismatches.push(`expected.${expectedKey}:invalid`);
    else if (valid(actual, pattern) && actual !== wanted) mismatches.push(path);
  };
  check('installedDefinitionVersion', observation.installedDefinitionVersion, 'version', VERSION);
  check('aboutVersion', observation.aboutVersion, 'version', VERSION);
  check('installedPackageSha256', observation.installedPackageSha256, 'packageSha256', SHA256);
  const client = record(observation.loadedClient) ? observation.loadedClient : {};
  check('loadedClient.version', client.version, 'version', VERSION);
  check('loadedClient.sourceCommit', client.sourceCommit, 'sourceCommit', COMMIT);
  check('loadedClient.mode', client.mode, 'clientBuildMode', MODES);
  check('loadedClient.buildFingerprint', client.buildFingerprint, 'clientBuildFingerprint', SHA256);
  check('loadedClient.assetSha256', client.assetSha256, 'clientBundleSha256', SHA256);
  const runtime = record(observation.runtime) ? observation.runtime : {};
  check('runtime.version', runtime.version, 'version', VERSION);
  check('runtime.sourceCommit', runtime.sourceCommit, 'sourceCommit', COMMIT);
  check('runtime.serverBundleSha256', runtime.serverBundleSha256, 'serverBundleSha256', SHA256);
  check('runtime.clientBundleSha256', runtime.clientBundleSha256, 'clientBundleSha256', SHA256);
  check('runtime.teamsPackageSha256', runtime.teamsPackageSha256, 'packageSha256', SHA256);
  return assessment(mismatches, missing);
}

/** This narrower UI comparison verifies only the compiled-client/runtime pair.
 * It does not claim installed/About/package verification or hash loaded bytes. */
export function assessClientRuntimeIdentity(loaded, runtime) {
  const client = parseClientBuildStamp(loaded);
  if (!client) return assessment(loaded === undefined ? [] : ['loadedClient:invalid'], ['loadedClient']);
  if (!record(runtime)) return assessment([], ['runtime']);
  const mismatches = [], missing = [];
  for (const field of ['version', 'sourceCommit']) {
    if (runtime[field] === undefined) missing.push(`runtime.${field}`);
    else if (runtime[field] !== client[field]) mismatches.push(`runtime.${field}`);
  }
  const served = parseClientBuildStamp(runtime.clientBuildIdentity);
  if (!served) {
    if (runtime.clientBuildIdentity === undefined) missing.push('runtime.clientBuildIdentity');
    else mismatches.push('runtime.clientBuildIdentity:invalid');
  } else {
    for (const field of ['version', 'sourceCommit', 'mode', 'buildFingerprint']) {
      if (served[field] !== client[field]) mismatches.push(`runtime.clientBuildIdentity.${field}`);
    }
    if (!valid(runtime.clientBuildIdentity.clientBundleSha256, SHA256)) {
      if (runtime.clientBuildIdentity.clientBundleSha256 === undefined) missing.push('runtime.clientBuildIdentity.clientBundleSha256');
      else mismatches.push('runtime.clientBuildIdentity.clientBundleSha256:invalid');
    }
  }
  return assessment(mismatches, missing);
}
