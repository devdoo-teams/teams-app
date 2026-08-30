#!/usr/bin/env node

import { spawn as defaultSpawn } from 'node:child_process';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_AUTH_FILE_BYTES = 1024 * 1024;
const WORKERS = Object.freeze(['main', ...Array.from({ length: 8 }, (_value, index) => String(index + 1))]);
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LOGIN_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_LOGIN_ATTEMPTS = 2;
const MAX_LOGIN_ATTEMPTS = 2;
const LOGIN_ABORT_GRACE_MS = 250;
const NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const LOGIN_ENV_ALLOWLIST = Object.freeze([
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'APPDATA',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'PATHEXT',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TERM',
  'COLORTERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
]);

export function parseArguments(argv) {
  const args = [...argv];
  let workers = ['main'];
  let runLogin = false;
  let all = false;
  let workerFlagSeen = false;

  while (args.length > 0) {
    const argument = args.shift();
    if (argument === '--run-login') {
      runLogin = true;
      continue;
    }
    if (argument === '--all') {
      all = true;
      continue;
    }
    if (argument === '--worker') {
      const worker = args.shift();
      if (!WORKERS.includes(worker)) throw new Error('worker must be main or 1 through 8');
      workers = [worker];
      workerFlagSeen = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      return { workers: ['main'], runLogin: false, help: true };
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  if (all && workerFlagSeen) throw new Error('--all cannot be combined with --worker');
  return { workers: all ? [...WORKERS] : workers, runLogin };
}

export function resolveWorkerHome(env, worker) {
  const variable = workerHomeVariable(worker);
  const value = typeof env?.[variable] === 'string' ? env[variable].trim() : '';
  if (!value) throw new Error(`${variable} is required`);
  if (!path.isAbsolute(value) || value.includes('\u0000')) {
    throw new Error(`${variable} must be an absolute path`);
  }
  return value;
}

export async function resolveDistinctWorkerHomes(env, workers) {
  const seen = new Map();
  const resolved = [];
  for (const worker of workers) {
    const variable = workerHomeVariable(worker);
    const codexHome = resolveWorkerHome(env, worker);
    const identity = await workerHomeIdentity(codexHome);
    const previous = seen.get(identity);
    if (previous) {
      throw new Error(`${variable} must reference a distinct worker home from ${previous}`);
    }
    seen.set(identity, variable);
    resolved.push({ worker, codexHome });
  }

  if (!workers.includes('main') && workers.some((worker) => worker !== 'main')) {
    const legacyValue = typeof env?.AGENT_CODEX_HOME === 'string' ? env.AGENT_CODEX_HOME.trim() : '';
    if (legacyValue) {
      const legacyIdentity = await workerHomeIdentity(resolveWorkerHome(env, 'main'), { rejectSymlink: false });
      const previous = seen.get(legacyIdentity);
      if (previous) {
        throw new Error(`${previous} must reference a distinct worker home from AGENT_CODEX_HOME`);
      }
    }
  }
  return resolved;
}

export function createLoginInvocation({ codexBin, codexHome }) {
  if (typeof codexBin !== 'string' || !path.isAbsolute(codexBin)) {
    throw new Error('CODEX_BIN must be an absolute path');
  }
  if (typeof codexHome !== 'string' || !path.isAbsolute(codexHome)) {
    throw new Error('AGENT_CODEX_HOME must be an absolute path');
  }
  return {
    command: codexBin,
    args: ['login', '--device-auth'],
    options: {
      env: { CODEX_HOME: codexHome },
      stdio: 'inherit',
    },
  };
}

export function createLoginEnvironment(source, codexHome) {
  if (typeof codexHome !== 'string' || !path.isAbsolute(codexHome)) {
    throw new Error('AGENT_CODEX_HOME must be an absolute path');
  }
  const environment = { CI: '1' };
  const seenKeys = new Set();
  for (const key of LOGIN_ENV_ALLOWLIST) {
    const normalizedKey = key.toLowerCase();
    if (seenKeys.has(normalizedKey)) continue;
    const value = source?.[key];
    if (typeof value === 'string') {
      environment[key] = value;
      seenKeys.add(normalizedKey);
    }
  }
  environment.CODEX_HOME = codexHome;
  return environment;
}

export async function prepareWorkerHome(candidate, currentUid = process.getuid?.()) {
  let stat;
  try {
    stat = await fs.lstat(candidate);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('worker home is unavailable');
    await fs.mkdir(candidate, { recursive: true, mode: 0o700 });
    await fs.chmod(candidate, 0o700);
    stat = await fs.lstat(candidate);
  }
  assertPrivateDirectory(stat, currentUid);
  return candidate;
}

export async function inspectAuthMetadata(authPath, currentUid = process.getuid?.()) {
  let stat;
  try {
    stat = await fs.lstat(authPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing' };
    return { state: 'unavailable' };
  }
  if (stat.isSymbolicLink()) return { state: 'invalid-symlink' };
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AUTH_FILE_BYTES) return { state: 'invalid-file' };
  if (stat.nlink !== 1) return { state: 'invalid-hardlink' };
  if (
    (stat.mode & 0o077) !== 0
    || (stat.mode & 0o400) === 0
    || (currentUid !== undefined && stat.uid !== currentUid)
  ) {
    return { state: 'invalid-permissions' };
  }
  return { state: 'valid', mode: stat.mode & 0o777, size: stat.size };
}

export class CodexLoginTimeoutError extends Error {
  code = 'CODEX_LOGIN_TIMEOUT';

  constructor(timeoutMs) {
    super(`Codex login timed out after ${timeoutMs} ms`);
    this.name = 'CodexLoginTimeoutError';
  }
}

export class CodexLoginAbortedError extends Error {
  code = 'CODEX_LOGIN_ABORTED';

  constructor() {
    super('Codex login was aborted');
    this.name = 'CodexLoginAbortedError';
  }
}

class CodexLoginReapError extends Error {
  code = 'CODEX_LOGIN_REAP_FAILED';

  constructor(timeoutMs) {
    super(`Codex login child could not be reaped after timing out at ${timeoutMs} ms`);
    this.name = 'CodexLoginReapError';
  }
}

export async function runWorkerLogin({
  codexBin,
  codexBinSha256,
  codexHome,
  env = process.env,
  spawnImpl = defaultSpawn,
  timeoutMs,
  maxAttempts,
  signal,
}) {
  const invocation = createLoginInvocation({ codexBin, codexHome });
  const childEnvironment = createLoginEnvironment(env, codexHome);
  const boundedTimeoutMs = normalizeLoginTimeout(timeoutMs);
  const boundedAttempts = normalizeLoginAttempts(maxAttempts);

  if (signal !== undefined && typeof signal?.addEventListener !== 'function') {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (signal?.aborted) throw new CodexLoginAbortedError();

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    try {
      return await runLoginAttempt({
        invocation,
        childEnvironment,
        spawnImpl,
        timeoutMs: boundedTimeoutMs,
        abortSignal: signal,
        validateExecutable: () => validateExecutableInputs({
          CODEX_BIN: codexBin,
          CODEX_BIN_SHA256: codexBinSha256,
        }),
      });
    } catch (error) {
      if (!(error instanceof CodexLoginTimeoutError) || attempt === boundedAttempts) throw error;
    }
  }

  throw new Error('Codex login did not complete');
}

export async function validateExecutableInputs(env, currentUid = process.getuid?.()) {
  const codexBin = typeof env.CODEX_BIN === 'string' ? env.CODEX_BIN.trim() : '';
  if (!codexBin || !path.isAbsolute(codexBin)) throw new Error('CODEX_BIN must be an absolute path');
  const digest = typeof env.CODEX_BIN_SHA256 === 'string' ? env.CODEX_BIN_SHA256.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error('CODEX_BIN_SHA256 must be a 64-character hexadecimal SHA-256 digest');
  const stat = await fs.lstat(codexBin).catch(() => undefined);
  if (
    !stat?.isFile()
    || stat.nlink !== 1
    || (stat.mode & 0o111) === 0
    || (stat.mode & 0o022) !== 0
    || (currentUid !== undefined && stat.uid !== 0 && stat.uid !== currentUid)
  ) {
    throw new Error('CODEX_BIN must be a non-hardlinked private executable regular file');
  }

  let handle;
  let actualDigest;
  try {
    const real = path.normalize(await fs.realpath(codexBin));
    handle = await fs.open(real, fsConstants.O_RDONLY | NOFOLLOW);
    const opened = await handle.stat();
    if (!sameStableIdentity(stat, opened)) throw new Error('CODEX_BIN changed during validation');
    actualDigest = crypto.createHash('sha256').update(await handle.readFile()).digest('hex');
    const afterRead = await handle.stat();
    if (!sameStableIdentity(opened, afterRead)) throw new Error('CODEX_BIN changed during validation');
  } catch (error) {
    if (error instanceof Error && error.message === 'CODEX_BIN changed during validation') throw error;
    throw new Error('CODEX_BIN is unavailable');
  } finally {
    await handle?.close();
  }
  if (actualDigest !== digest) throw new Error('CODEX_BIN does not match CODEX_BIN_SHA256');
  return codexBin;
}

function assertPrivateDirectory(stat, currentUid) {
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('worker home must be a regular directory');
  if ((stat.mode & 0o077) !== 0 || (currentUid !== undefined && stat.uid !== currentUid)) {
    throw new Error('worker home must be an owner-only directory owned by the current user');
  }
}

function normalizeLoginTimeout(timeoutMs) {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_LOGIN_TIMEOUT_MS;
  }
  return Math.min(MAX_LOGIN_TIMEOUT_MS, Math.max(1, Math.floor(timeoutMs)));
}

function normalizeLoginAttempts(maxAttempts) {
  if (maxAttempts === undefined || !Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    return DEFAULT_LOGIN_ATTEMPTS;
  }
  return Math.min(MAX_LOGIN_ATTEMPTS, Math.max(1, Math.floor(maxAttempts)));
}

function signalLoginProcess(child, signal) {
  if (process.platform !== 'win32' && Number.isInteger(child?.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        // Fall back to the child handle when group signaling is unavailable.
      }
    }
  }
  child?.kill?.(signal);
}

function isLoginProcessGroupGone(child) {
  if (process.platform === 'win32' || !Number.isInteger(child?.pid) || child.pid <= 0) return true;
  try {
    process.kill(-child.pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

async function runLoginAttempt({ invocation, childEnvironment, spawnImpl, timeoutMs, abortSignal, validateExecutable }) {
  if (abortSignal?.aborted) throw new CodexLoginAbortedError();
  await validateExecutable();
  if (abortSignal?.aborted) throw new CodexLoginAbortedError();
  const controller = new AbortController();
  let child;
  let timeoutHandle;
  let abortGraceHandle;
  let reapGraceHandle;
  let settled = false;
  let childClosed = false;
  let terminationReason;
  let removeChildListeners = () => undefined;

  const timeoutError = new CodexLoginTimeoutError(timeoutMs);
  const reapError = new CodexLoginReapError(timeoutMs);
  const result = new Promise((resolve, reject) => {
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (abortGraceHandle !== undefined) clearTimeout(abortGraceHandle);
      if (reapGraceHandle !== undefined) clearTimeout(reapGraceHandle);
      abortSignal?.removeEventListener?.('abort', onAbort);
      removeChildListeners();
      callback();
    };

    const onError = (error) => {
      if (settled) {
        removeChildListeners();
        return;
      }
      if (terminationReason !== undefined) return;
      settle(() => reject(error));
    };

    const onClose = (code, signal) => {
      if (settled) {
        removeChildListeners();
        return;
      }
      if (terminationReason !== undefined) {
        childClosed = true;
        return;
      }
      settle(() => {
        resolve({ code, signal });
      });
    };

    const requestTermination = (reason) => {
      if (settled || terminationReason !== undefined) return;
      terminationReason = reason;
      controller.abort();
      if (!settled && typeof child?.kill === 'function') {
        try {
          signalLoginProcess(child, 'SIGTERM');
        } catch {
          // The abort signal remains the primary termination mechanism.
        }
      }
      if (!settled) {
        abortGraceHandle = setTimeout(() => {
          if (settled) return;
          const requiresProcessGroupKill = process.platform !== 'win32'
            && Number.isInteger(child?.pid)
            && child.pid > 0;
          if (!childClosed || requiresProcessGroupKill) {
            try {
              signalLoginProcess(child, 'SIGKILL');
            } catch {
              // Reaping below remains the final safety check before retrying.
            }
          }
          reapGraceHandle = setTimeout(() => {
            if (settled) return;
            if (!childClosed || !isLoginProcessGroupGone(child)) {
              settle(() => reject(reapError));
              return;
            }
            settle(() => {
              if (terminationReason === 'timeout') reject(timeoutError);
              else reject(new CodexLoginAbortedError());
            });
          }, LOGIN_ABORT_GRACE_MS);
        }, LOGIN_ABORT_GRACE_MS);
      }
    };

    const onTimeout = () => requestTermination('timeout');
    const onAbort = () => requestTermination('aborted');

    child = spawnImpl(invocation.command, invocation.args, {
      ...invocation.options,
      env: childEnvironment,
      signal: controller.signal,
      detached: process.platform !== 'win32',
    });
    removeChildListeners = () => {
      child?.removeListener?.('error', onError);
      child?.removeListener?.('close', onClose);
    };
    child.once('error', onError);
    child.once('close', onClose);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    timeoutHandle = setTimeout(onTimeout, timeoutMs);
    if (abortSignal?.aborted) onAbort();
  });

  return await result;
}

function printUsage() {
  console.log('Usage: npm run a2a:login -- [--worker main|1|2|3|4|5|6|7|8] [--run-login]');
  console.log('       npm run a2a:login -- --all --run-login');
  console.log('Without --run-login this performs a safe dry run and never creates credentials.');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const workerHomes = await resolveDistinctWorkerHomes(process.env, options.workers);
  const codexBin = await validateExecutableInputs(process.env);
  const codexBinSha256 = process.env.CODEX_BIN_SHA256?.trim().toLowerCase();
  for (const { worker, codexHome } of workerHomes) {
    await prepareWorkerHome(codexHome);
    const authPath = path.join(codexHome, 'auth.json');
    console.log(`${worker}: home ready (${options.runLogin ? 'login requested' : 'dry run'})`);
    if (options.runLogin) {
      const result = await runWorkerLogin({ codexBin, codexBinSha256, codexHome });
      if (result.code !== 0) {
        throw new Error(`${worker}: Codex login exited with code ${result.code ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}`);
      }
    }
    const metadata = await inspectAuthMetadata(authPath);
    console.log(`${worker}: auth.json=${metadata.state}`);
    if (options.runLogin && metadata.state !== 'valid') {
      throw new Error(`${worker}: owner-only auth.json was not created or is not valid`);
    }
  }
  if (options.runLogin) console.log('Run npm run check:codex-a2a-isolation after all workers are authenticated.');
}

function workerHomeVariable(worker) {
  return worker === 'main' ? 'AGENT_CODEX_HOME' : `AGENT_CODEX_HOME_${worker}`;
}

function stableIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    uid: stat.uid,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameStableIdentity(left, right) {
  const a = stableIdentity(left);
  const b = stableIdentity(right);
  return a.dev === b.dev
    && a.ino === b.ino
    && a.mode === b.mode
    && a.nlink === b.nlink
    && a.size === b.size
    && a.uid === b.uid
    && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs;
}

async function workerHomeIdentity(candidate, { rejectSymlink = true } = {}) {
  const normalized = path.normalize(path.resolve(candidate));
  const pathStat = await fs.lstat(normalized).catch((error) => {
    if (error?.code === 'ENOENT') return undefined;
    throw new Error('worker home is unavailable');
  });
  if (rejectSymlink && pathStat?.isSymbolicLink()) {
    throw new Error('worker home alias (symbolic link) is not allowed');
  }
  let canonical = normalized;
  try {
    canonical = path.normalize(await fs.realpath(normalized));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('worker home is unavailable');
    canonical = await canonicalizeMissingHome(normalized);
  }

  try {
    const stat = await fs.stat(normalized);
    return `inode:${String(stat.dev)}:${String(stat.ino)}`;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('worker home is unavailable');
    return `path:${canonical}`;
  }
}

async function canonicalizeMissingHome(normalized) {
  const suffix = [];
  let current = normalized;
  while (true) {
    try {
      const ancestor = path.normalize(await fs.realpath(current));
      return path.join(ancestor, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('worker home is unavailable');
      const parent = path.dirname(current);
      if (parent === current) return normalized;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`A2A auth bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
