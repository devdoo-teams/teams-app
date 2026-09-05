import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ACCOUNT_NAME = /^[a-z0-9]{3,24}$/u;
const CONTAINER_NAME = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const AUTHORIZATION_PROPAGATION_ERROR = /AuthorizationPermissionMismatch|AuthorizationFailure|You do not have the required permissions needed to perform this operation|This request is not authorized to perform this operation/iu;

function fail(message) {
  throw new Error(`Azure Blob RBAC probe failed: ${message}`);
}

function validateInputs({ accountName, containerName, blobName, maxAttempts, retryDelayMs }) {
  if (!ACCOUNT_NAME.test(String(accountName ?? ''))) fail('storage account name is invalid');
  if (!CONTAINER_NAME.test(String(containerName ?? ''))) fail('container name is invalid');
  const [commit, fileName, ...extra] = String(blobName ?? '').split('/');
  if (extra.length > 0 || !COMMIT.test(commit ?? '') || fileName !== `worker-runtime-${commit}.tar`) {
    fail('blob name must bind one immutable worker archive to its full commit');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 30) fail('max attempts must be an integer from 1 to 30');
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30_000) fail('retry delay must be an integer from 0 to 30000 milliseconds');
}

function diagnostic(error) {
  const raw = typeof error?.stderr === 'string' && error.stderr.trim()
    ? error.stderr
    : error instanceof Error ? error.message : String(error);
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '').trim().slice(0, 4096);
}

async function defaultRunAz(args) {
  return execFileAsync('az', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 60_000,
  });
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function probeAzureStorageBlobAccess({
  accountName,
  containerName,
  blobName,
  maxAttempts = 20,
  retryDelayMs = 15_000,
  runAz = defaultRunAz,
  sleep = defaultSleep,
}) {
  validateInputs({ accountName, containerName, blobName, maxAttempts, retryDelayMs });
  const args = [
    'storage', 'blob', 'exists',
    '--auth-mode', 'login',
    '--account-name', accountName,
    '--container-name', containerName,
    '--name', blobName,
    '--query', 'exists',
    '--output', 'tsv',
    '--only-show-errors',
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { stdout } = await runAz(args);
      const result = String(stdout ?? '').trim().toLowerCase();
      if (result === 'true') return true;
      if (result === 'false') return false;
      fail(`unexpected exists result: ${result || '<empty>'}`);
    } catch (error) {
      const message = diagnostic(error);
      if (!AUTHORIZATION_PROPAGATION_ERROR.test(message)) fail(message || 'Azure CLI returned an unknown error');
      if (attempt === maxAttempts) {
        fail(`Entra data-plane authorization did not propagate after ${maxAttempts} attempts: ${message}`);
      }
      await sleep(retryDelayMs);
    }
  }
  fail('unreachable retry state');
}

function parseArguments(args) {
  const allowed = new Set(['--account-name', '--container-name', '--blob-name', '--max-attempts', '--retry-delay-ms']);
  const required = new Set(['--account-name', '--container-name', '--blob-name']);
  if (args.length % 2 !== 0) fail('arguments must be --name value pairs');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!allowed.has(name)) fail('unknown argument');
    if (values.has(name)) fail('duplicate argument');
    values.set(name, args[index + 1]);
  }
  for (const name of required) if (!values.has(name)) fail(`${name} is required`);
  return values;
}

async function runCli() {
  const values = parseArguments(process.argv.slice(2));
  const result = await probeAzureStorageBlobAccess({
    accountName: values.get('--account-name'),
    containerName: values.get('--container-name'),
    blobName: values.get('--blob-name'),
    maxAttempts: values.has('--max-attempts') ? Number(values.get('--max-attempts')) : undefined,
    retryDelayMs: values.has('--retry-delay-ms') ? Number(values.get('--retry-delay-ms')) : undefined,
  });
  process.stdout.write(`${result}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Azure Blob RBAC probe failed');
    process.exitCode = 1;
  }
}
