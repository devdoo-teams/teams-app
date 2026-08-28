#!/usr/bin/env node

import { spawn as defaultSpawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_AUTH_FILE_BYTES = 1024 * 1024;
const WORKERS = Object.freeze(['main', '1', '2']);

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
      if (!WORKERS.includes(worker)) throw new Error('worker must be main, 1, or 2');
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
  const variable = worker === 'main' ? 'AGENT_CODEX_HOME' : `AGENT_CODEX_HOME_${worker}`;
  const value = typeof env?.[variable] === 'string' ? env[variable].trim() : '';
  if (!value) throw new Error(`${variable} is required`);
  if (!path.isAbsolute(value) || value.includes('\u0000')) {
    throw new Error(`${variable} must be an absolute path`);
  }
  return value;
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
  if (!stat.isFile() || stat.size > MAX_AUTH_FILE_BYTES) return { state: 'invalid-file' };
  if ((stat.mode & 0o077) !== 0 || (currentUid !== undefined && stat.uid !== currentUid)) {
    return { state: 'invalid-permissions' };
  }
  return { state: 'valid', mode: stat.mode & 0o777, size: stat.size };
}

export async function runWorkerLogin({ codexBin, codexHome, spawnImpl = defaultSpawn }) {
  const invocation = createLoginInvocation({ codexBin, codexHome });
  const child = spawnImpl(invocation.command, invocation.args, {
    ...invocation.options,
    env: { ...process.env, ...invocation.options.env },
  });
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

async function validateExecutableInputs(env) {
  const codexBin = typeof env.CODEX_BIN === 'string' ? env.CODEX_BIN.trim() : '';
  if (!codexBin || !path.isAbsolute(codexBin)) throw new Error('CODEX_BIN must be an absolute path');
  const digest = typeof env.CODEX_BIN_SHA256 === 'string' ? env.CODEX_BIN_SHA256.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error('CODEX_BIN_SHA256 must be a 64-character hexadecimal SHA-256 digest');
  const stat = await fs.lstat(codexBin).catch(() => undefined);
  if (!stat?.isFile() || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0) {
    throw new Error('CODEX_BIN must be a private executable regular file');
  }
  return codexBin;
}

function assertPrivateDirectory(stat, currentUid) {
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('worker home must be a regular directory');
  if ((stat.mode & 0o077) !== 0 || (currentUid !== undefined && stat.uid !== currentUid)) {
    throw new Error('worker home must be an owner-only directory owned by the current user');
  }
}

function printUsage() {
  console.log('Usage: npm run a2a:login -- [--worker main|1|2] [--run-login]');
  console.log('       npm run a2a:login -- --all --run-login');
  console.log('Without --run-login this performs a safe dry run and never creates credentials.');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const codexBin = await validateExecutableInputs(process.env);
  for (const worker of options.workers) {
    const codexHome = resolveWorkerHome(process.env, worker);
    await prepareWorkerHome(codexHome);
    const authPath = path.join(codexHome, 'auth.json');
    console.log(`${worker}: home ready (${options.runLogin ? 'login requested' : 'dry run'})`);
    if (options.runLogin) {
      const result = await runWorkerLogin({ codexBin, codexHome });
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`A2A auth bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
