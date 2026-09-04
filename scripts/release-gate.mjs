import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCleanTrackedWorktreeForFileProvider,
  isFullCommitOid,
  resolvePinnedCommitOid,
} from './fileprovider-git-clean.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';
import { parseServerBuildMarker } from './server-build-marker.mjs';
import { validateAzureReleaseInput } from './azure-release-input.mjs';
import {
  assertNoSensitiveMaterial,
  readMigrationBundle,
  stableMigrationJson,
  validateMigrationBundle,
} from './azure-state-export.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'appPackage', 'build', 'teams-sdk-mvp.zip');
const runtimeEnvPath = path.join(root, '.env.runtime');
let activeFailureEnvironment = process.env;
const defaultTimeouts = {
  typecheck: 60_000,
  build: 300_000,
  test: 300_000,
  serverDeterminism: 300_000,
  deployment: 30_000,
  package: 300_000,
  shell: 30_000,
  public: 15_000,
};

const RELEASE_PROFILES = new Set(['core', 'optional']);
const RELEASE_TARGETS = new Set(['local', 'azure']);

export function resolveReleaseTarget(env = process.env) {
  const target = String(env.TEAMS_RELEASE_TARGET ?? '').trim().toLowerCase() || 'local';
  if (!RELEASE_TARGETS.has(target)) {
    throw new Error('TEAMS_RELEASE_TARGET must be either local or azure.');
  }
  return target;
}

export function resolveReleaseProfile(env = process.env) {
  const configured = String(env.TEAMS_RELEASE_RUNTIME ?? '').trim().toLowerCase();
  const profile = configured || 'core';
  if (!RELEASE_PROFILES.has(profile)) {
    throw new Error('TEAMS_RELEASE_RUNTIME must be either core or optional.');
  }
  return profile;
}

export function assertReleaseRuntimePrerequisites(env = process.env, profile = resolveReleaseProfile(env)) {
  if (!RELEASE_PROFILES.has(profile)) {
    throw new Error('release profile must be either core or optional');
  }
  if (profile === 'core') return true;

  if (env.TEAMS_OPTIONAL_RUNTIME !== 'true') {
    throw new Error('optional release requires TEAMS_OPTIONAL_RUNTIME=true');
  }
  if (typeof env.XAI_API_KEY !== 'string' || !env.XAI_API_KEY.trim()) {
    throw new Error('optional Grok release requires XAI_API_KEY');
  }
  return true;
}

/**
 * The package phase is a serial gate: two cheap checks, package creation, and
 * three bounded package contracts. Keep outer runners longer than that exact
 * sequence so a healthy FileProvider/build path is not mistaken for a hang.
 */
export function packageGateTimeoutMs({
  checkTimeout = defaultTimeouts.deployment,
  commandTimeout = defaultTimeouts.package,
  overheadMs = 60_000,
} = {}) {
  return (checkTimeout * 2) + (commandTimeout * 4) + overheadMs;
}

export function createReleaseSourceEnvironment(
  env = process.env,
  {
    rootDir = root,
    verifySource = assertCleanTrackedWorktreeForFileProvider,
    resolveSource = resolvePinnedCommitOid,
  } = {},
) {
  const profile = resolveReleaseProfile(env);
  assertReleaseRuntimePrerequisites(env, profile);
  const sourceCommit = env.TEAMS_SOURCE_COMMIT ?? resolveSource(rootDir, { env });
  assert.equal(isFullCommitOid(sourceCommit), true, 'release source resolver must return a full Git OID');
  const verification = verifySource(rootDir, {
    commitOid: sourceCommit,
    env,
  });
  assert.equal(
    verification?.commitOid,
    sourceCommit,
    'release source verification must retain the exact pinned Git OID',
  );
  return {
    sourceCommit,
    profile,
    verificationMode: verification.verificationMode,
    env: { ...env, TEAMS_SOURCE_COMMIT: sourceCommit, TEAMS_RELEASE_RUNTIME: profile },
  };
}

export function parseDotEnv(text) {
  const values = {};
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export function assertPackagedManifest(manifest, expected) {
  assert.equal(manifest.version, expected.version, 'packaged manifest version must match the source version');
  assert.equal(manifest.id, expected.appId, 'packaged manifest app ID must match the deployment app ID');

  const contentUrl = manifest.staticTabs?.[0]?.contentUrl;
  assert.equal(
    contentUrl,
    `https://${expected.tabDomain}/tabs/home/`,
    'packaged tab content URL must use the current public tab origin',
  );
  assert.equal(
    manifest.validDomains?.includes(expected.tabDomain),
    true,
    'packaged manifest validDomains must include the current public tab domain',
  );
  assert.equal(
    manifest.validDomains?.includes('token.botframework.com'),
    true,
    'packaged manifest validDomains must include token.botframework.com for Teams SSO redirect handling',
  );
  assert.equal(
    manifest.devicePermissions?.includes('geolocation'),
    true,
    'packaged manifest must declare geolocation',
  );
  assert.equal(
    manifest.webApplicationInfo?.id,
    expected.clientId,
    'packaged SSO app ID must match the Entra client ID',
  );
  assert.equal(
    manifest.webApplicationInfo?.resource,
    expected.applicationIdUri,
    'packaged SSO resource must match the Entra Application ID URI',
  );
  assert.equal(
    manifest.webApplicationInfo?.resource,
    `api://${expected.tabDomain}/botid-${expected.botClientId}`,
    'packaged SSO resource must contain the expected Bot client ID in the combined URI',
  );
  assert.equal(
    JSON.stringify(manifest).includes('${{'),
    false,
    'packaged manifest must not contain unresolved environment placeholders',
  );
  return true;
}

function originAndPath(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${parsed.origin}${pathname}`;
}

export function assertPublicTab(response, text, manifest) {
  assert.equal(response?.status, 200, 'public Teams tab must resolve to HTTP 200');
  const expectedUrl = manifest?.staticTabs?.[0]?.contentUrl;
  assert.ok(expectedUrl, 'packaged manifest must contain a tab content URL');
  assert.equal(
    originAndPath(response.url, 'public Teams tab final URL'),
    originAndPath(expectedUrl, 'packaged tab content URL'),
    'public Teams tab final URL must match the packaged origin and path',
  );
  const contentType = response.headers?.get?.('content-type') ?? '';
  assert.match(contentType, /text\/html/i, 'public Teams tab must return HTML');
  const html = String(text).replace(/<!--[\s\S]*?-->/g, '');
  const activeHtml = html
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, ' ');
  const visibleText = activeHtml
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  assert.doesNotMatch(
    visibleText,
    /\b(?:sign\s*in|log\s*in|login|dev\s*tunnels?|tunnel\s+interstitial|continue\s+to\s+(?:the\s+)?site)\b/i,
    'public Teams tab resolved to a login or Dev Tunnel interstitial',
  );
  const appMarker = String(manifest.developer?.name || 'Teams SDK MVP');
  assert.ok(visibleText.includes(appMarker), 'public Teams tab is missing the expected visible app marker');
  const structureHtml = activeHtml
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');
  assert.match(structureHtml, /<div\b(?=[^>]*\bid=["']root["'])[^>]*>/i, 'public Teams tab is missing the app root marker');

  const scriptTags = [...activeHtml.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)];
  const buildScripts = scriptTags.flatMap(([tag]) => {
    const src = tag.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i)?.[2];
    const type = tag.match(/\btype\s*=\s*(["'])([^"']+)\1/i)?.[2];
    if (!src || type?.toLowerCase() !== 'module') return [];
    let scriptUrl;
    try {
      scriptUrl = new URL(src, response.url);
    } catch {
      return [];
    }
    const buildId = scriptUrl.searchParams.get('v');
    if (!scriptUrl.pathname.endsWith('/assets/main.js') || !/^[a-f0-9]{12}$/.test(buildId ?? '')) return [];
    return [{ scriptUrl, buildId }];
  });
  assert.equal(buildScripts.length, 1, 'public Teams tab must contain exactly one hashed module build script');
  const [{ scriptUrl, buildId }] = buildScripts;
  assert.equal(scriptUrl.origin, new URL(expectedUrl).origin, 'public Teams tab build script must remain on the packaged origin');
  return { finalUrl: response.url, scriptUrl: scriptUrl.href, buildId };
}

export function assertPublicAsset(response, bytes, tabIdentity) {
  assert.equal(response?.status, 200, 'public Teams tab build script must resolve to HTTP 200');
  assert.ok(tabIdentity?.scriptUrl && tabIdentity?.buildId, 'public Teams tab build identity is missing');
  let finalUrl;
  try {
    finalUrl = new URL(response.url).href;
  } catch {
    throw new Error('public Teams tab build script final URL must be absolute');
  }
  assert.equal(finalUrl, tabIdentity.scriptUrl, 'public Teams tab build script must not redirect');
  const contentType = response.headers?.get?.('content-type') ?? '';
  assert.match(contentType, /(?:text|application)\/(?:java|ecma)script/i, 'public Teams tab build script must return JavaScript');
  assert.ok(bytes instanceof Uint8Array && bytes.byteLength > 0, 'public Teams tab build script body is empty');
  assert.ok(bytes.byteLength <= 20 * 1024 * 1024, 'public Teams tab build script exceeds the 20 MiB safety limit');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256.slice(0, 12), tabIdentity.buildId, 'public Teams tab build script hash does not match its build identity');
  return { finalUrl, sha256, buildId: tabIdentity.buildId };
}

export function assertPublicHealth(health, expected, profile = 'core') {
  if (!RELEASE_PROFILES.has(profile)) {
    throw new Error('public health profile must be either core or optional');
  }
  const required = {
    ok: true,
    service: 'teams-sdk-mvp',
    environment: 'production',
    auth: 'teams-authenticated',
    userAuth: 'entra-sso',
    bot: 'teams-sdk',
    outbound: 'teams-sdk',
  };
  for (const [field, expected] of Object.entries(required)) {
    assert.equal(health?.[field], expected, `public health ${field} must be ${expected}`);
  }
  assert.equal(health.version, expected.version, 'public health version must match the packaged version');
  assert.equal(health.sourceCommit, expected.sourceCommit, 'public health source commit must match the built server identity');
  assert.equal(
    health.serverBundleSha256,
    expected.serverBundleSha256,
    'public health server bundle SHA-256 must match the built server identity',
  );
  if (profile === 'optional') {
    assert.equal(health.genAI, 'grok-configured', 'optional public health must report Grok as configured');
    assert.equal(health.genAIProvider?.provider, 'grok', 'optional public health must identify the Grok provider');
    assert.equal(health.responseProviders?.grok, true, 'optional public health must expose the Grok response provider');
  }
  return true;
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function terminateProcessGroup(child, { force = false } = {}) {
  if (!child.pid) return false;
  try {
    const signal = force ? 'SIGKILL' : 'SIGTERM';
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
    return true;
  } catch {
    try {
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
      return true;
    } catch {
      // The process may have exited between the timeout and cleanup.
      return false;
    }
  }
}

export function runWithTimeout(command, args = [], options = {}) {
  const {
    cwd = root,
    env = process.env,
    timeoutMs = defaultTimeouts.shell,
    terminationGraceMs = 500,
    reapTimeoutMs = 5_000,
    maxOutputChars = 12_000,
  } = options;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');
  if (!Number.isFinite(terminationGraceMs) || terminationGraceMs < 0) {
    throw new Error('terminationGraceMs must be non-negative');
  }
  if (!Number.isFinite(reapTimeoutMs) || reapTimeoutMs <= 0) {
    throw new Error('reapTimeoutMs must be positive');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...env },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let closeSeen = false;
    let timeoutTriggered = false;
    let timeoutTimer;
    let graceTimer;
    let reapTimer;
    const termination = { sentTerm: false, sentKill: false, reaped: false };

    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
      clearTimeout(reapTimer);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };

    const append = (target, chunk) => `${target}${chunk}`.slice(-maxOutputChars);
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk.toString());
    });
    child.once('error', (error) => {
      finishReject(error);
    });
    child.once('close', (code, signal) => {
      closeSeen = true;
      termination.reaped = true;
      clearTimers();
      if (settled) return;
      if (timeoutTriggered) {
        const error = new Error(`Command timed out after ${timeoutMs}ms: ${commandText(command, args)}`);
        error.code = 'ETIMEDOUT';
        error.command = commandText(command, args);
        error.timeoutMs = timeoutMs;
        error.stdout = stdout;
        error.stderr = stderr;
        error.termination = { ...termination };
        finishReject(error);
        return;
      }
      settled = true;
      resolve({ code, signal, stdout, stderr, command: commandText(command, args) });
    });

    timeoutTimer = setTimeout(() => {
      if (settled || closeSeen || timeoutTriggered) return;
      timeoutTriggered = true;
      termination.sentTerm = terminateProcessGroup(child);
      graceTimer = setTimeout(() => {
        if (closeSeen || settled) return;
        termination.sentKill = terminateProcessGroup(child, { force: true });
        reapTimer = setTimeout(() => {
          if (closeSeen || settled) return;
          const error = new Error(
            `Command process did not reap after SIGKILL within ${reapTimeoutMs}ms: ${commandText(command, args)}`,
          );
          error.code = 'EPROCESSREAPTIMEOUT';
          error.command = commandText(command, args);
          error.timeoutMs = timeoutMs;
          error.stdout = stdout;
          error.stderr = stderr;
          error.termination = { ...termination };
          finishReject(error);
        }, reapTimeoutMs);
      }, terminationGraceMs);
    }, timeoutMs);
  });
}

async function readRuntimeEnv() {
  let fileValues = {};
  try {
    fileValues = parseDotEnv(await fs.readFile(runtimeEnvPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { ...fileValues, ...process.env };
}

function redactReleaseText(value, env = process.env) {
  let output = String(value ?? '');
  const secrets = Object.entries(env ?? {})
    .filter(([name, secret]) => /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && typeof secret === 'string' && secret.trim().length >= 8)
    .map(([, secret]) => secret.trim())
    .sort((left, right) => right.length - left.length);
  for (const secret of secrets) output = output.split(secret).join('[REDACTED]');
  return output;
}

export function resolvePublicUrl(env = process.env) {
  const explicit = env.TEAMS_PUBLIC_URL || env.PUBLIC_BASE_URL;
  if (explicit) return String(explicit).replace(/\/$/, '');
  if (env.TAB_DOMAIN) return `https://${String(env.TAB_DOMAIN).replace(/\/$/, '')}`;
  return undefined;
}

async function readSourceManifest(sourceCommit, env) {
  const result = await runCommand('git', ['show', `${sourceCommit}:appPackage/manifest.json`], {
    timeoutMs: defaultTimeouts.shell,
    env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return JSON.parse(result.stdout);
}

async function expectedDeployment(env, sourceCommit) {
  const sourceManifest = await readSourceManifest(sourceCommit, env);
  const expected = {
    version: sourceManifest.version,
    appId: env.TEAMS_APP_ID,
    catalogAppId: env.TEAMS_CATALOG_APP_ID,
    tabDomain: env.TAB_DOMAIN,
    clientId: env.CLIENT_ID,
    botClientId: env.BOT_CLIENT_ID,
    applicationIdUri: env.APPLICATION_ID_URI,
  };
  const missing = Object.entries(expected)
    .filter(([, value]) => !String(value ?? '').trim())
    .map(([name]) => name);
  assert.equal(missing.length, 0, `release gate is missing deployment values: ${missing.join(', ')}`);
  return expected;
}

function npmInvocation(args) {
  if (process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  return { command: 'npm', args };
}

async function runCommand(command, args, options = {}) {
  const result = await runWithTimeout(command, args, options);
  if (result.code !== 0) {
    const error = new Error(
      `Command failed with exit code ${result.code ?? 'unknown'}: ${result.command}`,
    );
    error.code = 'ECOMMAND';
    error.command = result.command;
    error.exitCode = result.code;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result;
}

async function runNpmScript(script, timeoutMs, env) {
  const invocation = npmInvocation(['run', script]);
  return runCommand(invocation.command, invocation.args, { timeoutMs, env });
}

function tailOutput(error, env = process.env) {
  return {
    stdout: redactReleaseText(error.stdout, env).slice(-2_000),
    stderr: redactReleaseText(error.stderr, env).slice(-2_000),
  };
}

async function readZipManifest() {
  const result = await runCommand('unzip', ['-p', packagePath, 'manifest.json'], {
    timeoutMs: defaultTimeouts.package,
  });
  return JSON.parse(result.stdout);
}

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function assertServerBuildIdentity(marker, entryBytes, expectedSourceCommit, expectedMode = 'core') {
  if (!RELEASE_PROFILES.has(expectedMode)) {
    throw new Error('expected server build mode must be either core or optional');
  }
  assert.ok(marker, 'local server build identity marker is missing or invalid');
  assert.equal(marker.mode, expectedMode, `local server build identity must be ${expectedMode} mode`);
  assert.equal(
    marker.sourceCommit,
    expectedSourceCommit,
    'local server build source commit must match the release-pinned Git OID',
  );
  const serverBundleSha256 = crypto.createHash('sha256').update(entryBytes).digest('hex');
  assert.equal(
    marker.bundleSha256,
    serverBundleSha256,
    'local server bundle SHA-256 does not match its build identity marker',
  );
  return { sourceCommit: marker.sourceCommit, serverBundleSha256 };
}

async function readExpectedServerBuildIdentity(expectedSourceCommit, expectedMode = 'core') {
  const serverDir = path.join(resolveRuntimeDistRoot(root), 'server');
  const entryPath = path.join(serverDir, 'index.js');
  const markerPath = path.join(serverDir, '.teams-server-build-commit');
  const [entryBytes, markerRaw] = await Promise.all([
    fs.readFile(entryPath),
    fs.readFile(markerPath, 'utf8'),
  ]);
  const marker = parseServerBuildMarker(markerRaw);
  return assertServerBuildIdentity(marker, entryBytes, expectedSourceCommit, expectedMode);
}

function azureGateError(message, code = 'AZURE_INTEGRATED_GATE_BLOCKED') {
  const error = new Error(`Azure integrated preflight: ${message}`);
  error.code = code;
  error.releaseStatus = code === 'AZURE_LIVE_EVIDENCE_UNVERIFIED' ? 'UNVERIFIED' : 'BLOCKED';
  return error;
}

function requireAzureConfiguration(env) {
  const required = [
    'AZURE_COSMOS_ENDPOINT',
    'AZURE_COSMOS_DATABASE',
    'AZURE_COSMOS_CONTAINER',
    'AZURE_STORAGE_QUEUE_ENDPOINT',
    'AZURE_CLIENT_ID',
    'TEAMS_APP_ID',
    'TAB_DOMAIN',
    'CLIENT_ID',
    'BOT_CLIENT_ID',
    'APPLICATION_ID_URI',
    'AZURE_DEVOPS_ENVIRONMENT_ID',
    'AZURE_DEVOPS_ENVIRONMENT_NAME',
  ];
  if (env.TEAMS_STORAGE_BACKEND !== 'cosmos') {
    throw azureGateError('TEAMS_STORAGE_BACKEND must be cosmos.');
  }
  if (env.TEAMS_AGENT_DISPATCH_MODE !== 'azure-queue') {
    throw azureGateError('TEAMS_AGENT_DISPATCH_MODE must be azure-queue.');
  }
  const configuration = {
    TEAMS_STORAGE_BACKEND: env.TEAMS_STORAGE_BACKEND,
    TEAMS_AGENT_DISPATCH_MODE: env.TEAMS_AGENT_DISPATCH_MODE,
  };
  for (const name of required) {
    const value = env[name]?.trim();
    if (!value) throw azureGateError(`${name} is required.`);
    configuration[name] = value;
  }
  for (const [name, value] of Object.entries(env)) {
    if (value?.trim() && /COSMOS.*(?:KEY|CONNECTION.?STRING)|(?:KEY|CONNECTION.?STRING).*COSMOS/iu.test(name)) {
      throw azureGateError(`key-based Cosmos setting ${name} is forbidden.`);
    }
  }
  for (const name of ['AZURE_COSMOS_ENDPOINT', 'AZURE_STORAGE_QUEUE_ENDPOINT']) {
    let url;
    try {
      url = new URL(configuration[name]);
    } catch {
      throw azureGateError(`${name} must be an HTTPS URL.`);
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw azureGateError(`${name} must be a credential-free HTTPS URL.`);
    }
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(configuration.AZURE_CLIENT_ID)) {
    throw azureGateError('AZURE_CLIENT_ID must be a UUID.');
  }
  for (const name of ['TEAMS_APP_ID', 'CLIENT_ID', 'BOT_CLIENT_ID']) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(configuration[name])) {
      throw azureGateError(`${name} must be a UUID.`);
    }
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu.test(configuration.TAB_DOMAIN)) {
    throw azureGateError('TAB_DOMAIN must be a public hostname.');
  }
  if (configuration.APPLICATION_ID_URI !== `api://${configuration.TAB_DOMAIN}/botid-${configuration.BOT_CLIENT_ID}`) {
    throw azureGateError('APPLICATION_ID_URI must match the Teams bot and tab identity contract.');
  }
  return configuration;
}

function assertReleaseIdentity(actual, expected, label) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw azureGateError(`${label} release identity is missing.`);
  }
  const mappings = {
    commit: 'commit',
    version: 'version',
    imageDigest: 'imageDigest',
    teamsPackageSha256: 'teamsPackageSha256',
    clientBundleSha256: 'clientBundleSha256',
    serverBundleSha256: 'serverBundleSha256',
  };
  for (const [actualField, expectedField] of Object.entries(mappings)) {
    if (actual[actualField] !== expected[expectedField]) {
      throw azureGateError(`${label} release identity ${actualField} does not match the immutable handoff receipt.`);
    }
  }
}

function assertExactObjectKeys(value, expectedKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw azureGateError(`${label} must be an object.`, 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  const actualKeys = Object.keys(value).sort();
  const wantedKeys = [...expectedKeys].sort();
  if (stableMigrationJson(actualKeys) !== stableMigrationJson(wantedKeys)) {
    throw azureGateError(`${label} contains missing or unknown fields.`, 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
}

function attestationSha256(value) {
  return crypto.createHash('sha256').update(stableMigrationJson(value)).digest('hex');
}

function assertNoFixtureEvidence(value, location, seen = new Set()) {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) throw azureGateError(`Cyclic evidence is invalid at ${location}.`, 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoFixtureEvidence(entry, `${location}[${index}]`, seen));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
      if (
        ['evidenceclass', 'producerprovenance'].includes(normalizedKey)
        && typeof entry === 'string'
        && /(?:^|[-_])(fixture|local)(?:$|[-_])|local-contract/iu.test(entry)
      ) {
        throw azureGateError(
          `Fixture/local-contract provenance at ${location}.${key} cannot satisfy the producer attestation gate.`,
          'AZURE_LIVE_EVIDENCE_UNVERIFIED',
        );
      }
      assertNoFixtureEvidence(entry, `${location}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function parseTrustedAttestationKey(trustedPublicKeys, keyId) {
  const encoded = stableMigrationJson(trustedPublicKeys);
  if (!trustedPublicKeys || typeof trustedPublicKeys !== 'object' || Array.isArray(trustedPublicKeys) || encoded.length > 64 * 1024) {
    throw azureGateError(
      'The protected verifier must provide a bounded public-key allowlist.',
      'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    );
  }
  if (Object.keys(trustedPublicKeys).length < 1 || Object.keys(trustedPublicKeys).length > 16) {
    throw azureGateError('The protected verifier public-key allowlist must contain between 1 and 16 keys.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  const trusted = Object.hasOwn(trustedPublicKeys, keyId) ? trustedPublicKeys[keyId] : undefined;
  if (!trusted) {
    throw azureGateError(`Release attestation key ${keyId || '<missing>'} is not in the trusted allowlist.`, 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  assertExactObjectKeys(trusted, ['publicKeyPem', 'issuer', 'subject', 'audience'], 'trusted release-attestation key');
  if (![trusted.publicKeyPem, trusted.issuer, trusted.subject, trusted.audience].every((value) => typeof value === 'string' && value.trim())) {
    throw azureGateError('The trusted release-attestation key entry is incomplete.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(trusted.publicKeyPem);
  } catch {
    throw azureGateError('The trusted release-attestation public key is invalid.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
    throw azureGateError('The trusted release-attestation key must be an Ed25519 public key.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  return { trusted, publicKey };
}

function assertCanonicalAttestationTimestamp(value, label) {
  let canonical;
  try {
    canonical = typeof value === 'string' && value ? new Date(value).toISOString() : '';
  } catch {
    canonical = '';
  }
  if (canonical !== value) {
    throw azureGateError(`Release attestation ${label} must be a canonical timestamp.`, 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  return Date.parse(value);
}

const protectedAzureVerifierCapabilities = new WeakMap();
const protectedAzureOperationalVerifierProviders = new WeakSet();

/**
 * @typedef {Readonly<{
 *   configuration: Readonly<Record<string, string>>;
 *   trustedPublicKeys: Readonly<Record<string, unknown>>;
 *   expectedChallenge: Readonly<{releaseRunId: string; challengeId: string; nonce: string; attempt: number}>;
 * }>} AzureOperationalVerifierPolicy
 */

/**
 * Deployment-owned operational verifier capability. The evidence caller only
 * supplies evidence to verify(); policy and replay state stay behind this
 * boundary. Implementations must be registered by a protected deployment
 * adapter, never reconstructed from evidence or ordinary environment input.
 *
 * @typedef {Readonly<{
 *   kind: 'protected-operational-verifier';
 *   getPolicy: () => AzureOperationalVerifierPolicy;
 *   consumeChallenge: (challengeKey: string) => boolean;
 * }>} AzureOperationalEvidenceVerifierProvider
 */

function immutableJsonClone(value) {
  const clone = JSON.parse(stableMigrationJson(value));
  const freeze = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return candidate;
    for (const entry of Object.values(candidate)) freeze(entry);
    return Object.freeze(candidate);
  };
  return freeze(clone);
}

function requireExpectedReleaseChallenge(expectedChallenge) {
  assertExactObjectKeys(expectedChallenge, ['releaseRunId', 'challengeId', 'nonce', 'attempt'], 'expected release challenge');
  for (const name of ['releaseRunId', 'challengeId']) {
    if (!/^[A-Za-z0-9._-]{8,128}$/u.test(expectedChallenge[name] ?? '')) {
      throw azureGateError(`Expected release challenge ${name} is invalid.`, 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
    }
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(expectedChallenge.nonce ?? '')) {
    throw azureGateError('Expected release challenge nonce is invalid.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  if (!Number.isSafeInteger(expectedChallenge.attempt) || expectedChallenge.attempt < 1) {
    throw azureGateError('Expected release challenge attempt is invalid.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  return immutableJsonClone(expectedChallenge);
}

function releaseChallengeKey(challenge) {
  return crypto
    .createHash('sha256')
    .update(stableMigrationJson({
      releaseRunId: challenge.releaseRunId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      attempt: challenge.attempt,
    }), 'utf8')
    .digest('hex');
}

/**
 * Deterministic local-only durable replay fixture. Each consumed challenge is
 * represented by an atomically-created marker file, so a new verifier object
 * or a new Node process observes the same consumed state. No Azure is touched.
 */
export function createLocalDurableAzureChallengeStore(markerPath) {
  if (typeof markerPath !== 'string' || !path.isAbsolute(markerPath)) {
    throw new TypeError('local protected challenge marker path must be an absolute path');
  }
  const resolvedMarkerPath = path.resolve(markerPath);
  return Object.freeze({
    consume(challengeKey) {
      if (!/^[0-9a-f]{64}$/u.test(challengeKey ?? '')) {
        throw new TypeError('protected challenge key must be a SHA-256 digest');
      }
      fsSync.mkdirSync(path.dirname(resolvedMarkerPath), { recursive: true, mode: 0o700 });
      const consumedPath = `${resolvedMarkerPath}.${challengeKey}.consumed`;
      try {
        const descriptor = fsSync.openSync(consumedPath, 'wx', 0o400);
        fsSync.closeSync(descriptor);
        return true;
      } catch (error) {
        if (error?.code === 'EEXIST') return false;
        throw error;
      }
    },
  });
}

/**
 * Creates the repository's deterministic protected fixture. This is not a
 * production provider: it is deliberately the only provider registered here,
 * while a real deployment must supply its own protected adapter and durable
 * challenge store outside the evidence-caller process.
 */
export function createLocalProtectedAzureOperationalVerifier({
  expectedConfiguration,
  trustedPublicKeys,
  expectedChallenge,
  challengeStore,
}) {
  if (!challengeStore || typeof challengeStore.consume !== 'function') {
    throw new TypeError('local protected verifier requires a durable challenge store');
  }
  const policy = immutableJsonClone({
    configuration: requireAzureConfiguration(immutableJsonClone(expectedConfiguration)),
    trustedPublicKeys,
    expectedChallenge: requireExpectedReleaseChallenge(expectedChallenge),
  });
  const provider = Object.freeze({
    kind: 'protected-operational-verifier',
    getPolicy: () => policy,
    consumeChallenge: (challengeKey) => challengeStore.consume(challengeKey),
  });
  protectedAzureOperationalVerifierProviders.add(provider);
  return createProtectedAzureOperationalEvidenceVerifier(provider);
}

/**
 * Adapter boundary for a deployment-owned operational verifier. The provider
 * must be registered by that boundary before use; ordinary evidence objects,
 * env variables, and caller-created lookalikes cannot become a capability.
 */
export function createProtectedAzureOperationalEvidenceVerifier(provider) {
  if (!provider || !protectedAzureOperationalVerifierProviders.has(provider)) {
    throw azureGateError(
      'A protected deployment-owned Azure operational verifier provider is required; caller-created capabilities are rejected.',
      'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    );
  }
  const providerPolicy = provider.getPolicy();
  const policy = immutableJsonClone({
    configuration: requireAzureConfiguration(providerPolicy.configuration),
    trustedPublicKeys: providerPolicy.trustedPublicKeys,
    expectedChallenge: requireExpectedReleaseChallenge(providerPolicy.expectedChallenge),
  });
  const capability = Object.freeze(Object.create(null));
  protectedAzureVerifierCapabilities.set(capability, {
    evidenceClass: 'protected-operational-verifier-contract',
    resultStatus: 'PROTECTED_OPERATIONAL_VERIFIER_CONTRACT_PASS',
    configuration: policy.configuration,
    trustedPublicKeys: policy.trustedPublicKeys,
    expectedChallenge: policy.expectedChallenge,
    consumeChallenge: (challengeKey) => provider.consumeChallenge(challengeKey),
  });
  return Object.freeze({
    verify(evidence) {
      return validateAzureIntegratedEvidenceWithCapability(evidence, capability);
    },
  });
}

export function createLocalSignedAzureEvidenceVerifier({
  expectedConfiguration,
  trustedPublicKeys,
  expectedChallenge,
  now,
}) {
  const capability = Object.freeze(Object.create(null));
  protectedAzureVerifierCapabilities.set(capability, {
    evidenceClass: 'local-signed-verifier-contract',
    configuration: immutableJsonClone(requireAzureConfiguration(immutableJsonClone(expectedConfiguration))),
    trustedPublicKeys: immutableJsonClone(trustedPublicKeys),
    expectedChallenge: requireExpectedReleaseChallenge(expectedChallenge),
    now: now === undefined ? undefined : Number(now),
    consumed: false,
    resultStatus: 'LOCAL_SIGNED_VERIFIER_CONTRACT_PASS',
    consumeChallenge: () => {
      if (protectedAzureVerifierCapabilities.get(capability).consumed) return false;
      protectedAzureVerifierCapabilities.get(capability).consumed = true;
      return true;
    },
  });
  return Object.freeze({
    verify(evidence) {
      return validateAzureIntegratedEvidenceWithCapability(evidence, capability);
    },
  });
}

function verifyAzureAggregateAttestation({
  trustedPublicKeys,
  expectedChallenge,
  aggregateAttestation,
  configuration,
  releaseReceipt,
  handoffProvenance,
  migrationBundle,
  migrationReceipt,
  approvalReceipt,
  providerReceipt,
  publicCanaryReceipt,
  jiraReceipt,
  now = Date.now(),
}) {
  if (!aggregateAttestation || typeof aggregateAttestation !== 'object' || Array.isArray(aggregateAttestation)) {
    throw azureGateError(
      'Unsigned local JSON evidence cannot establish live state; a signed aggregate release attestation is required.',
      'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    );
  }
  try {
    assertNoSensitiveMaterial(aggregateAttestation, 'preflight.aggregateAttestation');
  } catch (error) {
    throw azureGateError(error instanceof Error ? error.message : String(error));
  }
  for (const [label, evidence] of Object.entries({
    releaseReceipt,
    handoffProvenance,
    migrationBundle,
    migrationReceipt,
    approvalReceipt,
    providerReceipt,
    publicCanaryReceipt,
    jiraReceipt,
  })) {
    assertNoFixtureEvidence(evidence, `preflight.${label}`);
  }
  if (typeof aggregateAttestation.signature !== 'string' || !aggregateAttestation.signature) {
    throw azureGateError('Release attestation is unsigned; an Ed25519 signature is required.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  assertExactObjectKeys(aggregateAttestation, [
    'schemaVersion', 'algorithm', 'keyId', 'producer', 'issuer', 'subject', 'audience', 'environment', 'resource',
    'issuedAt', 'expiresAt', 'operation', 'nonce', 'releaseIdentity', 'evidenceHashes', 'signature',
  ], 'release aggregate attestation');
  if (
    aggregateAttestation.schemaVersion !== 'teamsapp.azure-release-aggregate-attestation.v1'
    || aggregateAttestation.algorithm !== 'Ed25519'
    || aggregateAttestation.producer !== 'azure-devops-release-pipeline'
  ) {
    throw azureGateError(
      'Release attestation provenance is not the accepted Azure DevOps producer contract; fixture provenance is not live evidence.',
      'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    );
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(aggregateAttestation.keyId ?? '')) {
    throw azureGateError('Release attestation keyId is invalid.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(aggregateAttestation.nonce ?? '')) {
    throw azureGateError('Release attestation nonce is missing or invalid.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  assertExactObjectKeys(aggregateAttestation.operation, ['releaseRunId', 'challengeId', 'attempt'], 'release attestation operation');
  const expectedOperation = {
    releaseRunId: expectedChallenge.releaseRunId,
    challengeId: expectedChallenge.challengeId,
    attempt: expectedChallenge.attempt,
  };
  if (
    stableMigrationJson(aggregateAttestation.operation) !== stableMigrationJson(expectedOperation)
    || aggregateAttestation.nonce !== expectedChallenge.nonce
  ) {
    throw azureGateError(
      'Release attestation operation, attempt, or nonce does not match the protected release challenge.',
      'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    );
  }
  const issuedAt = assertCanonicalAttestationTimestamp(aggregateAttestation.issuedAt, 'issuedAt');
  const expiresAt = assertCanonicalAttestationTimestamp(aggregateAttestation.expiresAt, 'expiresAt');
  if (issuedAt > now + 60_000) {
    throw azureGateError('Release attestation issuedAt is in the future.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  if (expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > 15 * 60_000) {
    throw azureGateError('Release attestation is expired or has an invalid expiry window.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }

  const { trusted, publicKey } = parseTrustedAttestationKey(trustedPublicKeys, aggregateAttestation.keyId);
  for (const claim of ['issuer', 'subject', 'audience']) {
    if (aggregateAttestation[claim] !== trusted[claim]) {
      throw azureGateError(`Release attestation ${claim} is not trusted for key ${aggregateAttestation.keyId}.`, 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
    }
  }
  assertExactObjectKeys(aggregateAttestation.environment, ['id', 'name'], 'release attestation environment');
  const expectedEnvironment = {
    id: configuration.AZURE_DEVOPS_ENVIRONMENT_ID,
    name: configuration.AZURE_DEVOPS_ENVIRONMENT_NAME,
  };
  if (stableMigrationJson(aggregateAttestation.environment) !== stableMigrationJson(expectedEnvironment)) {
    throw azureGateError('Release attestation environment does not match the exact promotion environment.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  const expectedResource = {
    cosmosEndpoint: configuration.AZURE_COSMOS_ENDPOINT,
    cosmosDatabase: configuration.AZURE_COSMOS_DATABASE,
    cosmosContainer: configuration.AZURE_COSMOS_CONTAINER,
    storageQueueEndpoint: configuration.AZURE_STORAGE_QUEUE_ENDPOINT,
    azureClientId: configuration.AZURE_CLIENT_ID,
    teamsAppId: configuration.TEAMS_APP_ID,
    tabDomain: configuration.TAB_DOMAIN,
  };
  assertExactObjectKeys(aggregateAttestation.resource, Object.keys(expectedResource), 'release attestation resource');
  if (stableMigrationJson(aggregateAttestation.resource) !== stableMigrationJson(expectedResource)) {
    throw azureGateError('Release attestation resource/target does not match the configured Azure release target.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  const expectedReleaseIdentity = {
    commit: releaseReceipt.commit,
    version: releaseReceipt.version,
    image: releaseReceipt.image,
    imageDigest: releaseReceipt.imageDigest,
    teamsPackageSha256: releaseReceipt.teamsPackageSha256,
    clientBundleSha256: releaseReceipt.clientBundleSha256,
    serverBundleSha256: releaseReceipt.serverBundleSha256,
  };
  assertExactObjectKeys(aggregateAttestation.releaseIdentity, Object.keys(expectedReleaseIdentity), 'release attestation releaseIdentity');
  if (stableMigrationJson(aggregateAttestation.releaseIdentity) !== stableMigrationJson(expectedReleaseIdentity)) {
    throw azureGateError('Release attestation release identity does not match the exact immutable release.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  const expectedEvidenceHashes = {
    releaseReceipt: attestationSha256(releaseReceipt),
    handoffProvenance: attestationSha256(handoffProvenance),
    migrationBundle: attestationSha256(migrationBundle),
    migrationReceipt: attestationSha256(migrationReceipt),
    approvalReceipt: attestationSha256(approvalReceipt),
    providerReceipt: attestationSha256(providerReceipt),
    publicCanaryReceipt: attestationSha256(publicCanaryReceipt),
    jiraReceipt: attestationSha256(jiraReceipt),
  };
  assertExactObjectKeys(aggregateAttestation.evidenceHashes, Object.keys(expectedEvidenceHashes), 'release attestation evidenceHashes');
  if (stableMigrationJson(aggregateAttestation.evidenceHashes) !== stableMigrationJson(expectedEvidenceHashes)) {
    throw azureGateError('Release attestation evidence hashes do not match the exact release receipts.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  if (!/^[A-Za-z0-9_-]{86}$/u.test(aggregateAttestation.signature ?? '')) {
    throw azureGateError('Release attestation is unsigned or has an invalid Ed25519 signature.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  const unsigned = structuredClone(aggregateAttestation);
  delete unsigned.signature;
  const signature = Buffer.from(aggregateAttestation.signature, 'base64url');
  if (!crypto.verify(null, Buffer.from(stableMigrationJson(unsigned)), publicKey, signature)) {
    throw azureGateError('Release attestation signature verification failed.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  return {
    status: 'LOCAL_CRYPTOGRAPHIC_CONTRACT_VERIFIED',
    evidenceClass: 'signed-attestation-cryptographic-contract',
    verification: 'ED25519_AGGREGATE_CONTRACT_VERIFIED',
    keyId: aggregateAttestation.keyId,
    issuer: aggregateAttestation.issuer,
    subject: aggregateAttestation.subject,
    audience: aggregateAttestation.audience,
    environment: structuredClone(expectedEnvironment),
    resource: structuredClone(expectedResource),
    releaseIdentity: structuredClone(expectedReleaseIdentity),
    issuedAt: aggregateAttestation.issuedAt,
    expiresAt: aggregateAttestation.expiresAt,
    operation: structuredClone(expectedOperation),
    nonce: aggregateAttestation.nonce,
  };
}

function validateAzureIntegratedEvidenceWithCapability({
  env,
  releaseReceipt: releaseReceiptInput,
  handoffProvenance,
  sourceCommit,
  sourceManifest,
  packageBytes,
  packageManifest,
  migrationBundle,
  migrationReceipt,
  approvalReceipt,
  providerReceipt,
  publicCanaryReceipt,
  jiraReceipt,
  aggregateAttestation,
}, verifierCapability) {
  const verifierState = protectedAzureVerifierCapabilities.get(verifierCapability);
  const configuration = verifierState?.configuration ?? requireAzureConfiguration(env ?? {});
  for (const [label, evidence] of Object.entries({
    releaseReceipt: releaseReceiptInput,
    handoffProvenance,
    sourceManifest,
    packageManifest,
    migrationBundle,
    migrationReceipt,
    approvalReceipt,
    providerReceipt,
    publicCanaryReceipt,
    jiraReceipt,
  })) {
    try {
      assertNoSensitiveMaterial(evidence, `preflight.${label}`);
    } catch (error) {
      throw azureGateError(error instanceof Error ? error.message : String(error));
    }
  }
  let releaseReceipt;
  try {
    releaseReceipt = validateAzureReleaseInput(releaseReceiptInput);
  } catch (error) {
    throw azureGateError(error instanceof Error ? error.message : String(error));
  }
  if (sourceCommit !== releaseReceipt.commit) throw azureGateError('source commit does not match the handoff receipt.');
  if (sourceManifest?.version !== releaseReceipt.version) throw azureGateError('source manifest version does not match the handoff receipt.');
  if (
    handoffProvenance?.schemaVersion !== 1
    || handoffProvenance.repository !== 'devdoo-teams/teams-app'
    || handoffProvenance.workflow !== 'devdoo-teams/teams-app/.github/workflows/publish-image.yml'
    || handoffProvenance.commit !== releaseReceipt.commit
    || handoffProvenance.attestationVerified !== true
    || !Number.isSafeInteger(handoffProvenance.artifactId)
    || !/^sha256:[0-9a-f]{64}$/u.test(handoffProvenance.artifactDigest ?? '')
    || !Array.isArray(handoffProvenance.attestedSubjects)
    || !handoffProvenance.attestedSubjects.includes('azure-release-receipt.json')
    || !handoffProvenance.attestedSubjects.includes('teams-sdk-mvp.zip')
    || !handoffProvenance.attestedSubjects.includes(`${releaseReceipt.image}@${releaseReceipt.imageDigest}`)
  ) {
    throw azureGateError('GitHub handoff provenance does not prove the attested immutable receipt, image, and Teams package.');
  }
  if (!(packageBytes instanceof Uint8Array) || packageBytes.byteLength === 0) {
    throw azureGateError('Teams package bytes are missing.');
  }
  const packageDigest = crypto.createHash('sha256').update(packageBytes).digest('hex');
  if (packageDigest !== releaseReceipt.teamsPackageSha256) {
    throw azureGateError('Teams package SHA-256 does not match the immutable handoff receipt.');
  }
  try {
    assertPackagedManifest(packageManifest, {
      version: releaseReceipt.version,
      appId: configuration.TEAMS_APP_ID,
      tabDomain: configuration.TAB_DOMAIN,
      clientId: configuration.CLIENT_ID,
      botClientId: configuration.BOT_CLIENT_ID,
      applicationIdUri: configuration.APPLICATION_ID_URI,
    });
  } catch (error) {
    throw azureGateError(`Teams package identity is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    validateMigrationBundle(migrationBundle);
  } catch (error) {
    throw azureGateError(error instanceof Error ? error.message : String(error));
  }
  if (
    migrationBundle.manifest.source.commit !== sourceCommit
    || migrationBundle.manifest.source.commit !== releaseReceipt.commit
  ) {
    throw azureGateError('migration bundle source commit does not match the release handoff source commit.');
  }
  if (migrationReceipt?.sourceCommit !== sourceCommit || migrationReceipt?.sourceCommit !== releaseReceipt.commit) {
    throw azureGateError('migration reconciliation source commit does not match the release handoff source commit.');
  }
  if (
    migrationReceipt.schemaVersion !== 1
    || migrationReceipt.status !== 'PASS'
    || migrationReceipt.bundleSha256 !== migrationBundle.manifest.bundleSha256
    || stableMigrationJson(migrationReceipt.recordCounts) !== stableMigrationJson(migrationBundle.manifest.recordCounts)
    || migrationReceipt.stableIdsSha256 !== migrationBundle.manifest.stableIdsSha256
    || migrationReceipt.contentHashesSha256 !== migrationBundle.manifest.contentHashesSha256
  ) {
    throw azureGateError('migration reconciliation does not bind counts, stable IDs, and content hashes to the immutable bundle.');
  }

  if (
    approvalReceipt?.schemaVersion !== 1
    || approvalReceipt.approvalConfigured !== true
    || !String(approvalReceipt.environmentId ?? '').trim()
    || !String(approvalReceipt.environmentName ?? '').trim()
    || !String(approvalReceipt.checkId ?? '').trim()
    || !Number.isSafeInteger(approvalReceipt.approverCount)
    || approvalReceipt.approverCount < 1
  ) {
    throw azureGateError('Azure DevOps environment approval receipt is missing or invalid.');
  }
  if (
    approvalReceipt.environmentId !== configuration.AZURE_DEVOPS_ENVIRONMENT_ID
    || approvalReceipt.environmentName !== configuration.AZURE_DEVOPS_ENVIRONMENT_NAME
  ) {
    throw azureGateError('Azure DevOps approval environment does not match the configured promotion environment.');
  }
  assertReleaseIdentity(approvalReceipt.releaseIdentity, releaseReceipt, 'Azure DevOps approval');

  assertReleaseIdentity(providerReceipt.releaseIdentity, releaseReceipt, 'provider readiness');
  if (providerReceipt.schemaVersion !== 1 || !Array.isArray(providerReceipt.providers) || providerReceipt.providers.length < 1) {
    throw azureGateError('provider readiness classification is missing.');
  }
  const providerIds = new Set();
  for (const provider of providerReceipt.providers) {
    if (!provider?.id || providerIds.has(provider.id)) throw azureGateError('provider readiness IDs must be non-empty and unique.');
    providerIds.add(provider.id);
    if (provider.enabled === true) {
      if (
        provider.state !== 'ready'
        || provider.liveRoundTrip !== 'PASS'
        || provider.cancellationRecovery !== 'PASS'
        || !String(provider.receiptId ?? '').trim()
        || !/^[0-9a-f]{64}$/u.test(provider.resultSha256 ?? '')
      ) {
        throw azureGateError(`enabled provider ${provider.id} lacks live readiness, recovery, receipt, or result evidence.`);
      }
    } else if (provider.enabled !== false || provider.state !== 'not-enabled') {
      throw azureGateError(`provider ${provider.id} must be explicitly ready or explicitly not-enabled.`);
    }
  }
  const expectedProviderIds = ['buzz', 'codex', 'github-agent-tasks', 'grok', 'hermes'];
  if (stableMigrationJson([...providerIds].sort()) !== stableMigrationJson(expectedProviderIds)) {
    throw azureGateError('provider readiness must classify codex, Hermes, Grok, Buzz, and GitHub agent-tasks explicitly.');
  }
  if (providerReceipt.providers.find((provider) => provider.id === 'codex')?.enabled !== true) {
    throw azureGateError('the Azure worker-plane Codex provider must have live ready evidence.');
  }

  assertReleaseIdentity(publicCanaryReceipt.releaseIdentity, releaseReceipt, 'public canary');
  let healthUrl;
  try {
    healthUrl = new URL(publicCanaryReceipt.healthUrl);
  } catch {
    throw azureGateError('public canary health URL is invalid.');
  }
  const expectedCanaryOrigin = `https://${configuration.TAB_DOMAIN}`;
  if (
    publicCanaryReceipt.schemaVersion !== 1
    || publicCanaryReceipt.status !== 'PASS'
    || !String(publicCanaryReceipt.revisionName ?? '').trim()
    || healthUrl.protocol !== 'https:'
    || healthUrl.origin !== expectedCanaryOrigin
    || healthUrl.pathname !== '/api/health'
    || healthUrl.username
    || healthUrl.password
    || healthUrl.search
    || healthUrl.hash
  ) {
    throw azureGateError(`public canary identity receipt is incomplete, unsafe, or does not match ${expectedCanaryOrigin}.`);
  }

  if (jiraReceipt.schemaVersion !== 1 || !Array.isArray(jiraReceipt.findings)) {
    throw azureGateError('Jira mapping receipt is malformed.');
  }
  for (const finding of jiraReceipt.findings) {
    if (!['reproduced-defect', 'release-blocker', 'improvement'].includes(finding?.kind)) {
      throw azureGateError('Jira mapping finding kind is invalid.');
    }
    if (
      !String(finding.stableId ?? '').trim()
      || !/^[A-Z][A-Z0-9]+-\d+$/u.test(finding.jiraKey ?? '')
      || !String(finding.status ?? '').trim()
    ) {
      throw azureGateError(`Jira mapping is missing for finding ${finding?.stableId ?? '<unknown>'}.`);
    }
  }

  if (!verifierState) {
    throw azureGateError(
      'No protected operational verifier trust capability is available; caller evidence and environment configuration cannot establish READY.',
      'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    );
  }
  if (verifierState.consumed) {
    throw azureGateError('The protected release challenge was already consumed; replay is rejected.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  const attestation = verifyAzureAggregateAttestation({
    trustedPublicKeys: verifierState.trustedPublicKeys,
    expectedChallenge: verifierState.expectedChallenge,
    aggregateAttestation,
    configuration,
    releaseReceipt,
    handoffProvenance,
    migrationBundle,
    migrationReceipt,
    approvalReceipt,
    providerReceipt,
    publicCanaryReceipt,
    jiraReceipt,
    now: verifierState.now,
  });
  if (!verifierState.consumeChallenge(releaseChallengeKey(verifierState.expectedChallenge))) {
    throw azureGateError('The protected release challenge was already consumed; replay is rejected.', 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  return {
    phase: 'azure-integrated-evidence',
    status: verifierState.resultStatus ?? 'LOCAL_SIGNED_VERIFIER_CONTRACT_PASS',
    evidenceClass: verifierState.evidenceClass,
    attestation,
  };
}

export function validateAzureIntegratedEvidence(evidence) {
  return validateAzureIntegratedEvidenceWithCapability(evidence, undefined);
}

async function readBoundedJson(filePath, label, maxBytes = 1024 * 1024) {
  if (!filePath?.trim()) {
    throw azureGateError(`${label} path is required.`, 'AZURE_LIVE_EVIDENCE_UNVERIFIED');
  }
  try {
    const resolved = path.resolve(filePath);
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) {
      throw azureGateError(`${label} must be a non-empty bounded JSON file.`);
    }
    return JSON.parse(await fs.readFile(resolved, 'utf8'));
  } catch (error) {
    if (error?.releaseStatus) throw error;
    throw azureGateError(
      `${label} could not be read and validated: ${error instanceof Error ? error.message : String(error)}`,
      'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    );
  }
}

async function readAndValidateAzureIntegratedEvidence({ env, sourceCommit }) {
  const releaseReceipt = await readBoundedJson(env.AZURE_RELEASE_RECEIPT_PATH, 'release receipt');
  const handoffProvenance = await readBoundedJson(env.AZURE_HANDOFF_PROVENANCE_PATH, 'handoff provenance');
  const aggregateAttestation = await readBoundedJson(env.AZURE_RELEASE_ATTESTATION_PATH, 'aggregate release attestation');
  const migrationBundlePath = env.AZURE_MIGRATION_BUNDLE_PATH;
  if (!migrationBundlePath?.trim()) throw azureGateError('AZURE_MIGRATION_BUNDLE_PATH is required.');
  let migrationBundle;
  try {
    migrationBundle = await readMigrationBundle(migrationBundlePath);
  } catch (error) {
    throw azureGateError(`migration bundle could not be read and validated: ${error instanceof Error ? error.message : String(error)}`);
  }
  const [migrationReceipt, approvalReceipt, providerReceipt, publicCanaryReceipt, jiraReceipt, sourceManifest] = await Promise.all([
    readBoundedJson(env.AZURE_MIGRATION_RECONCILIATION_RECEIPT_PATH, 'migration reconciliation receipt'),
    readBoundedJson(env.AZURE_APPROVAL_RECEIPT_PATH, 'Azure DevOps approval receipt'),
    readBoundedJson(env.AZURE_PROVIDER_READINESS_RECEIPT_PATH, 'provider readiness receipt'),
    readBoundedJson(env.AZURE_PUBLIC_CANARY_RECEIPT_PATH, 'public canary receipt'),
    readBoundedJson(env.AZURE_JIRA_MAPPING_RECEIPT_PATH, 'Jira mapping receipt'),
    readSourceManifest(sourceCommit, env),
  ]);
  const packageFile = env.AZURE_TEAMS_PACKAGE_PATH;
  if (!packageFile?.trim()) throw azureGateError('AZURE_TEAMS_PACKAGE_PATH is required.');
  let packageStat;
  try {
    packageStat = await fs.stat(path.resolve(packageFile));
  } catch (error) {
    throw azureGateError(
      `Teams package could not be observed: ${error instanceof Error ? error.message : String(error)}`,
      'AZURE_LIVE_EVIDENCE_UNVERIFIED',
    );
  }
  if (!packageStat.isFile() || packageStat.size === 0 || packageStat.size > 1024 * 1024 * 1024) {
    throw azureGateError('Teams package must be a non-empty file no larger than 1 GiB.');
  }
  const [packageBytes, packageManifestResult] = await Promise.all([
    fs.readFile(path.resolve(packageFile)),
    runCommand('unzip', ['-p', path.resolve(packageFile), 'manifest.json'], { timeoutMs: defaultTimeouts.package, env }),
  ]);
  return validateAzureIntegratedEvidence({
    env,
    releaseReceipt,
    handoffProvenance,
    sourceCommit,
    sourceManifest,
    packageBytes,
    packageManifest: JSON.parse(packageManifestResult.stdout),
    migrationBundle,
    migrationReceipt,
    approvalReceipt,
    providerReceipt,
    publicCanaryReceipt,
    jiraReceipt,
    aggregateAttestation,
  });
}

export function createPreflightCommands(timeoutOverride, profile = 'core', target = 'local') {
  if (!RELEASE_PROFILES.has(profile)) {
    throw new Error('release profile must be either core or optional');
  }
  if (!RELEASE_TARGETS.has(target)) {
    throw new Error('release target must be either local or azure');
  }
  const azureChecks = target === 'azure'
    ? [
      ['azure-state-migration', 'test:azure-state-migration', timeoutOverride ?? defaultTimeouts.test],
      ['manifest', 'validate:manifest', timeoutOverride ?? defaultTimeouts.deployment],
      ['package-determinism', 'test:package-determinism', timeoutOverride ?? defaultTimeouts.package],
    ]
    : [];
  if (profile === 'optional') {
    // Keep the Core regression suite in the optional promotion gate, then
    // rebuild the server in optional mode last so the marker cannot be
    // accidentally left at Core after a test/build helper runs.
    return [
      ['core-source-check', 'typecheck:core', timeoutOverride ?? defaultTimeouts.typecheck],
      ['azure-core', 'test:azure-core', timeoutOverride ?? defaultTimeouts.test],
      ['core-test', 'test:core', timeoutOverride ?? defaultTimeouts.test],
      ['optional-test', 'test:optional', timeoutOverride ?? defaultTimeouts.test],
      ['optional-server-build', 'build:server', timeoutOverride ?? defaultTimeouts.build],
      ['deployment', 'check:deployment', timeoutOverride ?? defaultTimeouts.deployment],
      ...azureChecks,
    ];
  }
  return [
    ['core-source-check', 'typecheck:core', timeoutOverride ?? defaultTimeouts.typecheck],
    ['core-build', 'build:core', timeoutOverride ?? defaultTimeouts.build],
    ['server-build-determinism', 'test:server-build-determinism', timeoutOverride ?? defaultTimeouts.serverDeterminism],
    ['azure-core', 'test:azure-core', timeoutOverride ?? defaultTimeouts.test],
    ['core-test', 'test:core', timeoutOverride ?? defaultTimeouts.test],
    ['deployment', 'check:deployment', timeoutOverride ?? defaultTimeouts.deployment],
    ...azureChecks,
  ];
}

async function runPreflight({ timeoutOverride, releaseSource } = {}) {
  const { env, sourceCommit } = releaseSource;
  const target = resolveReleaseTarget(env);
  const commands = createPreflightCommands(timeoutOverride, releaseSource.profile, target);
  const evidence = [];
  for (const [label, script, timeoutMs] of commands) {
    const invocation = npmInvocation(['run', script]);
    const result = await runCommand(invocation.command, invocation.args, { timeoutMs, env });
    evidence.push({
      command: label,
      profile: releaseSource.profile,
      exitCode: result.code,
      sourceCommit,
      output: `${result.stdout}\n${result.stderr}`.trim().slice(-2_000),
    });
  }
  if (target === 'azure') {
    evidence.push(await readAndValidateAzureIntegratedEvidence({ env, sourceCommit }));
  }
  return { evidence, uiGates: ['DESKTOP_UNVERIFIED', 'MOBILE_UNVERIFIED'] };
}

async function runPackage({ timeoutOverride, releaseSource } = {}) {
  const { env, sourceCommit } = releaseSource;
  const expected = await expectedDeployment(env, sourceCommit);
  const checkTimeout = timeoutOverride ?? defaultTimeouts.deployment;
  await runNpmScript('check:deployment', checkTimeout, env);
  await runNpmScript('validate:manifest', checkTimeout, env);
  await runNpmScript('package:app', timeoutOverride ?? defaultTimeouts.package, env);
  await runNpmScript('test:package-determinism', timeoutOverride ?? defaultTimeouts.package, env);
  await runNpmScript('test:package-atomic', timeoutOverride ?? defaultTimeouts.package, env);
  await runNpmScript('test:release-timeout', timeoutOverride ?? defaultTimeouts.package, env);
  const manifest = await readZipManifest();
  assertPackagedManifest(manifest, expected);
  return {
    evidence: [
      { package: packagePath, version: manifest.version, sha256: await sha256(packagePath), sourceCommit, profile: releaseSource.profile },
      {
        manifest: {
          version: manifest.version,
          appId: manifest.id,
          contentUrl: manifest.staticTabs?.[0]?.contentUrl,
          devicePermissions: manifest.devicePermissions,
          ssoResource: manifest.webApplicationInfo?.resource,
        },
      },
    ],
    uiGates: ['PORTAL_UPLOAD_UNVERIFIED', 'DESKTOP_UNVERIFIED', 'MOBILE_UNVERIFIED'],
  };
}

async function fetchWithTimeout(url, timeoutMs, bodyType = 'text') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (bodyType === 'bytes') {
      const bytes = Buffer.from(await response.arrayBuffer());
      return { response, bytes };
    }
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function validatePublicTabDeployment({
  tabUrl,
  manifest,
  timeoutMs,
  fetchResource = fetchWithTimeout,
}) {
  const tabResult = await fetchResource(tabUrl, timeoutMs, 'text');
  const tab = assertPublicTab(tabResult.response, tabResult.text, manifest);
  const assetResult = await fetchResource(tab.scriptUrl, timeoutMs, 'bytes');
  const asset = assertPublicAsset(assetResult.response, assetResult.bytes, tab);
  return { tabResult, tab, asset };
}

async function runPublic({ url, timeoutOverride, releaseSource } = {}) {
  assert.ok(url, 'public phase requires --url or TEAMS_PUBLIC_URL');
  const baseUrl = String(url).replace(/\/$/, '');
  const timeoutMs = timeoutOverride ?? defaultTimeouts.public;
  const { env, sourceCommit } = releaseSource;
  const expected = await expectedDeployment(env, sourceCommit);
  const packageShaBefore = await sha256(packagePath);
  const packageManifest = await readZipManifest();
  assertPackagedManifest(packageManifest, expected);
  const publicOrigin = new URL(baseUrl).origin;
  const packagedOrigin = new URL(packageManifest.staticTabs[0].contentUrl).origin;
  assert.equal(
    publicOrigin,
    packagedOrigin,
    'public release URL must match the packaged tab origin',
  );
  const healthResult = await fetchWithTimeout(`${baseUrl}/api/health`, timeoutMs);
  assert.equal(healthResult.response.status, 200, 'public health endpoint must return HTTP 200');
  const health = JSON.parse(healthResult.text);
  const serverBuildIdentity = await readExpectedServerBuildIdentity(sourceCommit, releaseSource.profile);
  assertPublicHealth(health, { version: packageManifest.version, ...serverBuildIdentity }, releaseSource.profile);

  const websiteRootResult = await fetchWithTimeout(`${baseUrl}/`, timeoutMs);
  assert.equal(websiteRootResult.response.status, 200, 'public website root must resolve after following its canonical tab redirect');
  assert.equal(
    originAndPath(websiteRootResult.response.url, 'public website root final URL'),
    originAndPath(packageManifest.staticTabs[0].contentUrl, 'packaged tab content URL'),
    'public website root must resolve to the packaged canonical tab surface',
  );

  const tabDeployment = await validatePublicTabDeployment({
    tabUrl: `${baseUrl}/tabs/home/`,
    manifest: packageManifest,
    timeoutMs,
  });
  const packageShaAfter = await sha256(packagePath);
  assert.equal(packageShaAfter, packageShaBefore, 'package SHA changed during public validation');
  return {
    evidence: [
      { package: packagePath, version: packageManifest.version, sha256: packageShaAfter, sourceCommit, profile: releaseSource.profile },
      {
        health: {
          status: healthResult.response.status,
          service: health.service,
          version: health.version,
          sourceCommit: health.sourceCommit,
          serverBundleSha256: health.serverBundleSha256,
          auth: health.auth,
          userAuth: health.userAuth,
          bot: health.bot,
          outbound: health.outbound,
          environment: health.environment,
          profile: releaseSource.profile,
        },
      },
      {
        websiteRoot: {
          status: websiteRootResult.response.status,
          finalUrl: websiteRootResult.response.url,
        },
      },
      {
        tab: {
          status: tabDeployment.tabResult.response.status,
          finalUrl: tabDeployment.tabResult.response.url,
          buildId: tabDeployment.tab.buildId,
        },
      },
      { asset: tabDeployment.asset },
    ],
    uiGates: ['INSTALLED_VERSION_UNVERIFIED', 'DESKTOP_UNVERIFIED', 'MOBILE_UNVERIFIED'],
  };
}

function parseArgs(argv) {
  const [phase = 'all', ...rest] = argv;
  const options = { phase };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--url') options.url = rest[++index];
    else if (arg === '--timeout-ms') options.timeoutOverride = Number(rest[++index]);
    else throw new Error(`Unknown release gate argument: ${arg}`);
  }
  if (options.timeoutOverride !== undefined) {
    assert.ok(Number.isInteger(options.timeoutOverride) && options.timeoutOverride > 0, '--timeout-ms must be a positive integer');
  }
  return options;
}

async function runPhase(options) {
  const runtimeEnv = await readRuntimeEnv();
  activeFailureEnvironment = runtimeEnv;
  const releaseSource = createReleaseSourceEnvironment(runtimeEnv);
  const phaseOptions = { ...options, releaseSource };
  if (options.phase === 'preflight') return { profile: releaseSource.profile, ...(await runPreflight(phaseOptions)) };
  if (options.phase === 'package') return { profile: releaseSource.profile, ...(await runPackage(phaseOptions)) };
  if (options.phase === 'public') {
    return {
      profile: releaseSource.profile,
      ...(await runPublic({ ...phaseOptions, url: options.url ?? resolvePublicUrl(releaseSource.env) })),
    };
  }
  if (options.phase === 'all') {
    const phases = [];
    phases.push({ phase: 'preflight', ...(await runPreflight(phaseOptions)) });
    phases.push({ phase: 'package', ...(await runPackage(phaseOptions)) });
    phases.push({
      phase: 'public',
      ...(await runPublic({ ...phaseOptions, url: options.url ?? resolvePublicUrl(releaseSource.env) })),
    });
    return { profile: releaseSource.profile, evidence: phases, uiGates: ['PORTAL_UPLOAD_UNVERIFIED', 'INSTALLED_VERSION_UNVERIFIED', 'DESKTOP_UNVERIFIED', 'MOBILE_UNVERIFIED'] };
  }
  throw new Error(`Unknown release gate phase: ${options.phase}`);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function formatReleaseFailure(error, phase = 'all', env = process.env) {
  const status = error.releaseStatus
    ?? (['ETIMEDOUT', 'EPROCESSREAPTIMEOUT', 'ECOMMAND'].includes(error.code) ? 'BLOCKED' : 'FAILED');
  return {
    status,
    phase,
    evidence: tailOutput(error, env),
    blocker: {
      code: error.code ?? 'EUNKNOWN',
      message: redactReleaseText(error.message, env),
      command: error.command ? redactReleaseText(error.command, env) : null,
      timeoutMs: error.timeoutMs ?? null,
      exitCode: error.exitCode ?? null,
    },
    nextAction: error.code === 'ETIMEDOUT' || error.code === 'EPROCESSREAPTIMEOUT'
      ? 'Fix or isolate the timed-out command/process cleanup, then rerun the same bounded release phase.'
      : 'Inspect the reported command output before continuing.',
  };
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runPhase(options);
    console.log(JSON.stringify({
      status: 'READY',
      phase: options.phase,
      evidence: result.evidence,
      blocker: null,
      nextAction: result.uiGates.length > 0 ? `Complete UI gates: ${result.uiGates.join(', ')}` : 'None',
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify(formatReleaseFailure(error, process.argv[2] ?? 'all', activeFailureEnvironment), null, 2));
    process.exitCode = 1;
  }
}
