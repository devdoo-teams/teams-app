import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'appPackage', 'build', 'teams-sdk-mvp.zip');
const runtimeEnvPath = path.join(root, '.env.runtime');
const defaultTimeouts = {
  typecheck: 60_000,
  build: 300_000,
  test: 300_000,
  deployment: 30_000,
  package: 30_000,
  shell: 30_000,
  public: 15_000,
};

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

export function assertPublicHealth(health, expectedVersion) {
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
  assert.equal(health.version, expectedVersion, 'public health version must match the packaged version');
  return true;
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function terminateProcessGroup(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // The process may have exited between the timeout and cleanup.
    }
  }
}

export function runWithTimeout(command, args = [], options = {}) {
  const {
    cwd = root,
    env = process.env,
    timeoutMs = defaultTimeouts.shell,
    maxOutputChars = 12_000,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...env },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timer;

    const append = (target, chunk) => `${target}${chunk}`.slice(-maxOutputChars);
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk.toString());
    });
    child.once('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, command: commandText(command, args) });
    });

    timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      terminateProcessGroup(child);
      const error = new Error(`Command timed out after ${timeoutMs}ms: ${commandText(command, args)}`);
      error.code = 'ETIMEDOUT';
      error.command = commandText(command, args);
      error.timeoutMs = timeoutMs;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
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

export function resolvePublicUrl(env = process.env) {
  const explicit = env.TEAMS_PUBLIC_URL || env.PUBLIC_BASE_URL;
  if (explicit) return String(explicit).replace(/\/$/, '');
  if (env.TAB_DOMAIN) return `https://${String(env.TAB_DOMAIN).replace(/\/$/, '')}`;
  return undefined;
}

async function readSourceManifest() {
  return JSON.parse(await fs.readFile(path.join(root, 'appPackage', 'manifest.json'), 'utf8'));
}

async function expectedDeployment(env) {
  const sourceManifest = await readSourceManifest();
  const expected = {
    version: sourceManifest.version,
    appId: env.TEAMS_APP_ID,
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

function tailOutput(error) {
  return {
    stdout: String(error.stdout ?? '').slice(-2_000),
    stderr: String(error.stderr ?? '').slice(-2_000),
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

export function createPreflightCommands(timeoutOverride) {
  return [
    ['core-source-check', 'typecheck:core', timeoutOverride ?? defaultTimeouts.typecheck],
    ['core-build', 'build:core', timeoutOverride ?? defaultTimeouts.build],
    ['core-test', 'test:core', timeoutOverride ?? defaultTimeouts.test],
    ['deployment', 'check:deployment', timeoutOverride ?? defaultTimeouts.deployment],
  ];
}

async function runPreflight({ timeoutOverride } = {}) {
  const env = await readRuntimeEnv();
  const commands = createPreflightCommands(timeoutOverride);
  const evidence = [];
  for (const [label, script, timeoutMs] of commands) {
    const invocation = npmInvocation(['run', script]);
    const result = await runCommand(invocation.command, invocation.args, { timeoutMs, env });
    evidence.push({
      command: label,
      exitCode: result.code,
      output: `${result.stdout}\n${result.stderr}`.trim().slice(-2_000),
    });
  }
  return { evidence, uiGates: ['DESKTOP_UNVERIFIED', 'MOBILE_UNVERIFIED'] };
}

async function runPackage({ timeoutOverride } = {}) {
  const env = await readRuntimeEnv();
  const expected = await expectedDeployment(env);
  const checkTimeout = timeoutOverride ?? defaultTimeouts.deployment;
  await runNpmScript('check:deployment', checkTimeout, env);
  await runNpmScript('validate:manifest', checkTimeout, env);
  await runNpmScript('package:app', timeoutOverride ?? defaultTimeouts.package, env);
  const manifest = await readZipManifest();
  assertPackagedManifest(manifest, expected);
  return {
    evidence: [
      { package: packagePath, version: manifest.version, sha256: await sha256(packagePath) },
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

async function runPublic({ url, timeoutOverride } = {}) {
  assert.ok(url, 'public phase requires --url or TEAMS_PUBLIC_URL');
  const baseUrl = String(url).replace(/\/$/, '');
  const timeoutMs = timeoutOverride ?? defaultTimeouts.public;
  const env = await readRuntimeEnv();
  const expected = await expectedDeployment(env);
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
  assertPublicHealth(health, packageManifest.version);

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
      { package: packagePath, version: packageManifest.version, sha256: packageShaAfter },
      {
        health: {
          status: healthResult.response.status,
          service: health.service,
          version: health.version,
          auth: health.auth,
          userAuth: health.userAuth,
          bot: health.bot,
          outbound: health.outbound,
          environment: health.environment,
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
  if (options.phase === 'preflight') return runPreflight(options);
  if (options.phase === 'package') return runPackage(options);
  if (options.phase === 'public') {
    const env = await readRuntimeEnv();
    return runPublic({ ...options, url: options.url ?? resolvePublicUrl(env) });
  }
  if (options.phase === 'all') {
    const phases = [];
    phases.push({ phase: 'preflight', ...(await runPreflight(options)) });
    phases.push({ phase: 'package', ...(await runPackage(options)) });
    const env = await readRuntimeEnv();
    phases.push({ phase: 'public', ...(await runPublic({ ...options, url: options.url ?? resolvePublicUrl(env) })) });
    return { evidence: phases, uiGates: ['PORTAL_UPLOAD_UNVERIFIED', 'INSTALLED_VERSION_UNVERIFIED', 'DESKTOP_UNVERIFIED', 'MOBILE_UNVERIFIED'] };
  }
  throw new Error(`Unknown release gate phase: ${options.phase}`);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function formatReleaseFailure(error, phase = 'all') {
  const status = error.code === 'ETIMEDOUT' || error.code === 'ECOMMAND' ? 'BLOCKED' : 'FAILED';
  return {
    status,
    phase,
    evidence: tailOutput(error),
    blocker: {
      code: error.code ?? 'EUNKNOWN',
      message: error.message,
      command: error.command ?? null,
      timeoutMs: error.timeoutMs ?? null,
      exitCode: error.exitCode ?? null,
    },
    nextAction: error.code === 'ETIMEDOUT'
      ? 'Fix or isolate the timed-out command, then rerun the same bounded release phase.'
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
    console.error(JSON.stringify(formatReleaseFailure(error, process.argv[2] ?? 'all'), null, 2));
    process.exitCode = 1;
  }
}
