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
    `https://${expected.tabDomain}/tabs/home`,
    'packaged tab content URL must use the current public tab origin',
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
    JSON.stringify(manifest).includes('${{'),
    false,
    'packaged manifest must not contain unresolved environment placeholders',
  );
  return true;
}

export function assertPublicHealth(health, expectedVersion) {
  const required = {
    ok: true,
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

async function runPreflight({ timeoutOverride } = {}) {
  const env = await readRuntimeEnv();
  const commands = [
    ['typecheck', 'typecheck', timeoutOverride ?? defaultTimeouts.typecheck],
    ['test', 'test', timeoutOverride ?? defaultTimeouts.test],
    ['deployment', 'check:deployment', timeoutOverride ?? defaultTimeouts.deployment],
  ];
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

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function runPublic({ url, timeoutOverride } = {}) {
  assert.ok(url, 'public phase requires --url or TEAMS_PUBLIC_URL');
  const baseUrl = String(url).replace(/\/$/, '');
  const timeoutMs = timeoutOverride ?? defaultTimeouts.public;
  const healthResult = await fetchWithTimeout(`${baseUrl}/api/health`, timeoutMs);
  assert.equal(healthResult.response.status, 200, 'public health endpoint must return HTTP 200');
  const health = JSON.parse(healthResult.text);
  const packageManifest = await readZipManifest();
  assertPublicHealth(health, packageManifest.version);

  const tabResult = await fetchWithTimeout(`${baseUrl}/tabs/home`, timeoutMs);
  assert.equal(tabResult.response.status, 200, 'public Teams tab must resolve to HTTP 200');
  return {
    evidence: [
      {
        health: {
          status: healthResult.response.status,
          version: health.version,
          auth: health.auth,
          userAuth: health.userAuth,
          bot: health.bot,
          outbound: health.outbound,
          environment: health.environment,
        },
      },
      { tab: { status: tabResult.response.status, finalUrl: tabResult.response.url } },
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
    const status = error.code === 'ETIMEDOUT' || error.code === 'ECOMMAND' ? 'BLOCKED' : 'FAILED';
    console.error(JSON.stringify({
      status,
      phase: process.argv[2] ?? 'all',
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
    }, null, 2));
    process.exitCode = 1;
  }
}
