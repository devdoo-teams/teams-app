import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ACCOUNT_NAME = /^[a-z0-9]{3,24}$/u;
const CONTAINER_NAME = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

const AUTHORIZATION_ERROR = /AuthorizationPermissionMismatch|AuthorizationFailure|You do not have the required permissions needed to perform this operation|This request is not authorized to perform this operation/iu;

function fail(message) {
  throw new Error(`Azure worker Blob staging failed: ${message}`);
}

function validateInputs({ accountName, containerName, blobName, archivePath, sha256, maxAttempts, retryDelayMs }) {
  if (!ACCOUNT_NAME.test(String(accountName ?? ''))) fail('storage account name is invalid');
  if (!CONTAINER_NAME.test(String(containerName ?? ''))) fail('container name is invalid');
  const [commit, fileName, ...extra] = String(blobName ?? '').split('/');
  if (extra.length > 0 || !COMMIT.test(commit ?? '') || fileName !== `worker-runtime-${commit}.tar`) {
    fail('blob name must bind one immutable worker archive to its full commit');
  }
  if (typeof archivePath !== 'string' || !path.isAbsolute(archivePath)) fail('archive path must be absolute');
  if (!SHA256.test(String(sha256 ?? ''))) fail('archive SHA-256 is invalid');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 30) {
    fail('max attempts must be an integer from 1 to 30');
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30_000) {
    fail('retry delay must be an integer from 0 to 30000 milliseconds');
  }
}

function diagnostic(error) {
  const raw = typeof error?.stderr === 'string' && error.stderr.trim()
    ? error.stderr
    : error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(Bearer\s+)[^\s]+/giu, '$1[REDACTED]')
    .replace(/((?:password|secret|token|sas-token|account-key)\s*[=:]\s*)[^\s&]+/giu, '$1[REDACTED]')
    .replace(/(sig=)[^&\s]+/giu, '$1[REDACTED]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .trim()
    .slice(0, 4096);
}

function isAuthorizationError(error) {
  return AUTHORIZATION_ERROR.test(diagnostic(error));
}

async function defaultRunAz(args) {
  return execFileAsync('az', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 900_000,
  });
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function existsArgs({ accountName, containerName, blobName }) {
  return [
    'storage', 'blob', 'exists',
    '--auth-mode', 'login',
    '--account-name', accountName,
    '--container-name', containerName,
    '--name', blobName,
    '--query', 'exists',
    '--output', 'tsv',
    '--only-show-errors',
  ];
}

function metadataArgs({ accountName, containerName, blobName }) {
  return [
    'storage', 'blob', 'metadata', 'show',
    '--auth-mode', 'login',
    '--account-name', accountName,
    '--container-name', containerName,
    '--name', blobName,
    '--query', 'sha256',
    '--output', 'tsv',
    '--only-show-errors',
  ];
}

function uploadArgs({ accountName, containerName, blobName, archivePath, sha256 }) {
  return [
    'storage', 'blob', 'upload',
    '--auth-mode', 'login',
    '--account-name', accountName,
    '--container-name', containerName,
    '--name', blobName,
    '--file', archivePath,
    '--metadata', `sha256=${sha256}`,
    '--if-none-match', '*',
    '--overwrite', 'false',
    '--no-progress',
    '--only-show-errors',
    '--output', 'none',
  ];
}

async function readExists({ runAz, accountName, containerName, blobName }) {
  const { stdout } = await runAz(existsArgs({ accountName, containerName, blobName }));
  const value = String(stdout ?? '').trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(`unexpected Blob existence result: ${value || '<empty>'}`);
}

async function readMetadata({ runAz, accountName, containerName, blobName, sha256 }) {
  const { stdout } = await runAz(metadataArgs({ accountName, containerName, blobName }));
  const observed = String(stdout ?? '').trim().toLowerCase();
  if (observed !== sha256) {
    fail(`immutable Blob metadata SHA-256 mismatch: expected ${sha256}, observed ${observed || '<empty>'}`);
  }
  return { status: 'existing', sha256 };
}

export async function ensureAzureWorkerBlob({
  accountName,
  containerName,
  blobName,
  archivePath,
  sha256,
  maxAttempts = 20,
  retryDelayMs = 15_000,
  runAz = defaultRunAz,
  sleep = defaultSleep,
}) {
  validateInputs({ accountName, containerName, blobName, archivePath, sha256, maxAttempts, retryDelayMs });
  const context = { accountName, containerName, blobName, archivePath, sha256 };
  let lastAuthorizationDiagnostic = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let exists;
    try {
      exists = await readExists({ runAz, ...context });
    } catch (error) {
      if (!isAuthorizationError(error)) throw new Error(`Blob existence probe failed: ${diagnostic(error)}`);
      lastAuthorizationDiagnostic = diagnostic(error);
      if (attempt === maxAttempts) break;
      await sleep(retryDelayMs);
      continue;
    }

    if (exists) {
      try {
        return await readMetadata({ runAz, ...context });
      } catch (error) {
        if (!isAuthorizationError(error)) throw error;
        lastAuthorizationDiagnostic = diagnostic(error);
        if (attempt === maxAttempts) break;
        await sleep(retryDelayMs);
        continue;
      }
    }

    let uploadError;
    try {
      await runAz(uploadArgs(context));
      try {
        const verified = await readMetadata({ runAz, ...context });
        return { ...verified, status: 'uploaded' };
      } catch (error) {
        if (!isAuthorizationError(error)) throw error;
        uploadError = error;
      }
    } catch (error) {
      uploadError = error;
    }

    let existsAfterUpload;
    try {
      existsAfterUpload = await readExists({ runAz, ...context });
    } catch (error) {
      if (!isAuthorizationError(error)) {
        throw new Error(`Blob upload failed: ${diagnostic(uploadError)}; post-upload probe failed: ${diagnostic(error)}`);
      }
      lastAuthorizationDiagnostic = diagnostic(error);
      existsAfterUpload = undefined;
    }

    if (existsAfterUpload === true) {
      try {
        const verified = await readMetadata({ runAz, ...context });
        return { ...verified, status: 'existing-after-upload-race' };
      } catch (error) {
        if (!isAuthorizationError(error)) {
          throw new Error(`Blob upload failed: ${diagnostic(uploadError)}; existing Blob verification failed: ${diagnostic(error)}`);
        }
        lastAuthorizationDiagnostic = diagnostic(error);
      }
    } else if (existsAfterUpload === false && !isAuthorizationError(uploadError)) {
      throw new Error(`Blob upload failed: ${diagnostic(uploadError)}`);
    } else if (existsAfterUpload === false) {
      lastAuthorizationDiagnostic = diagnostic(uploadError);
    }

    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }

  fail(`Entra Blob data-plane authorization did not stabilize after ${maxAttempts} attempts: ${lastAuthorizationDiagnostic || 'unknown authorization error'}`);
}

function parseArguments(args) {
  const allowed = new Set([
    '--account-name',
    '--container-name',
    '--blob-name',
    '--archive',
    '--sha256',
    '--max-attempts',
    '--retry-delay-ms',
  ]);
  if (args.length % 2 !== 0) fail('arguments must be --name value pairs');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!allowed.has(name)) fail(`unknown argument: ${name}`);
    if (values.has(name)) fail(`duplicate argument: ${name}`);
    values.set(name, args[index + 1]);
  }
  for (const name of ['--account-name', '--container-name', '--blob-name', '--archive', '--sha256']) {
    if (!values.has(name)) fail(`${name} is required`);
  }
  return values;
}

async function runCli() {
  const values = parseArguments(process.argv.slice(2));
  const result = await ensureAzureWorkerBlob({
    accountName: values.get('--account-name'),
    containerName: values.get('--container-name'),
    blobName: values.get('--blob-name'),
    archivePath: values.get('--archive'),
    sha256: values.get('--sha256'),
    maxAttempts: values.has('--max-attempts') ? Number(values.get('--max-attempts')) : undefined,
    retryDelayMs: values.has('--retry-delay-ms') ? Number(values.get('--retry-delay-ms')) : undefined,
  });
  process.stdout.write(`Azure worker Blob staging: ${result.status}; sha256=${result.sha256}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Azure worker Blob staging failed');
    process.exitCode = 1;
  }
}
