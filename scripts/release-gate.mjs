import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
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
  if (tabIdentity.expectedSha256 !== undefined) {
    assert.match(
      String(tabIdentity.expectedSha256),
      /^[a-f0-9]{64}$/,
      'expected public Teams tab build script SHA-256 is invalid',
    );
    assert.equal(
      sha256,
      tabIdentity.expectedSha256,
      'public Teams tab build script SHA-256 does not match the local release asset',
    );
  }
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

export function createPreflightCommands(timeoutOverride, profile = 'core') {
  if (!RELEASE_PROFILES.has(profile)) {
    throw new Error('release profile must be either core or optional');
  }
  if (profile === 'optional') {
    // Keep the Core regression suite in the optional promotion gate, then
    // rebuild the server in optional mode last so the marker cannot be
    // accidentally left at Core after a test/build helper runs.
    return [
      ['core-source-check', 'typecheck:core', timeoutOverride ?? defaultTimeouts.typecheck],
      ['core-test', 'test:core', timeoutOverride ?? defaultTimeouts.test],
      ['optional-test', 'test:optional', timeoutOverride ?? defaultTimeouts.test],
      ['optional-server-build', 'build:server', timeoutOverride ?? defaultTimeouts.build],
      ['deployment', 'check:deployment', timeoutOverride ?? defaultTimeouts.deployment],
    ];
  }
  return [
    ['core-source-check', 'typecheck:core', timeoutOverride ?? defaultTimeouts.typecheck],
    ['core-build', 'build:core', timeoutOverride ?? defaultTimeouts.build],
    ['server-build-determinism', 'test:server-build-determinism', timeoutOverride ?? defaultTimeouts.serverDeterminism],
    ['core-test', 'test:core', timeoutOverride ?? defaultTimeouts.test],
    ['deployment', 'check:deployment', timeoutOverride ?? defaultTimeouts.deployment],
  ];
}

async function runPreflight({ timeoutOverride, releaseSource } = {}) {
  const { env, sourceCommit } = releaseSource;
  const commands = createPreflightCommands(timeoutOverride, releaseSource.profile);
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
  expectedAssetSha256,
}) {
  const tabResult = await fetchResource(tabUrl, timeoutMs, 'text');
  const tab = assertPublicTab(tabResult.response, tabResult.text, manifest);
  const assetResult = await fetchResource(tab.scriptUrl, timeoutMs, 'bytes');
  const asset = assertPublicAsset(
    assetResult.response,
    assetResult.bytes,
    expectedAssetSha256 === undefined ? tab : { ...tab, expectedSha256: expectedAssetSha256 },
  );
  return { tabResult, tab, asset };
}

async function readLocalClientAssetIdentity() {
  const clientDir = path.join(resolveRuntimeDistRoot(root), 'client');
  const html = await fs.readFile(path.join(clientDir, 'index.html'), 'utf8');
  const assetPath = html.match(/(?:src|href)=["'](?:\.\/)?(assets\/main\.js(?:\?[^"']*)?)["']/i)?.[1];
  assert.ok(assetPath, 'local Core client index must reference its main asset');
  const relativeAssetPath = assetPath.split('?')[0];
  assert.equal(relativeAssetPath, 'assets/main.js', 'local Core client main asset path is invalid');
  const bytes = await fs.readFile(path.join(clientDir, relativeAssetPath));
  const assetSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const buildId = new URL(assetPath, 'https://release.local/tabs/home/').searchParams.get('v');
  assert.equal(buildId, assetSha256.slice(0, 12), 'local Core client asset hash does not match its HTML build ID');
  return { relativeAssetPath, assetSha256, buildId };
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

  const localClientAsset = await readLocalClientAssetIdentity();
  const tabDeployment = await validatePublicTabDeployment({
    tabUrl: `${baseUrl}/tabs/home/`,
    manifest: packageManifest,
    timeoutMs,
    expectedAssetSha256: localClientAsset.assetSha256,
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
      { asset: { ...tabDeployment.asset, localSha256: localClientAsset.assetSha256 } },
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
  const status = ['ETIMEDOUT', 'EPROCESSREAPTIMEOUT', 'ECOMMAND'].includes(error.code) ? 'BLOCKED' : 'FAILED';
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
