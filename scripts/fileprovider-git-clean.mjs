import { execFileSync } from 'node:child_process';

const DEFAULT_GIT_TIMEOUT_MS = 10_000;

function commandErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isTimedOutGitCommand(error) {
  return error?.code === 'ETIMEDOUT';
}

export function isFullCommitOid(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function dirtyWorktreeError() {
  const error = new Error(
    'FileProvider fallback requires a clean tracked Git worktree. Commit tracked source changes before building or packaging.',
  );
  error.code = 'EWORKTREEDIRTY';
  return error;
}

function runGit(root, args, runCommandSync, timeoutMs, env) {
  return runCommandSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  }).trim();
}

export function resolvePinnedCommitOid(
  root,
  {
    runCommandSync = execFileSync,
    timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
    env = process.env,
  } = {},
) {
  let commitOid;
  try {
    commitOid = runGit(
      root,
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      runCommandSync,
      timeoutMs,
      env,
    );
  } catch (error) {
    throw verificationError('Failed to resolve pinned Git commit before FileProvider fallback', error);
  }

  if (!isFullCommitOid(commitOid)) {
    const error = new Error(`Git rev-parse did not return a full commit OID: ${commitOid || '<empty>'}`);
    error.code = 'EGITPROVENANCE';
    throw error;
  }

  return commitOid;
}

function verificationError(message, error) {
  const wrapped = new Error(`${message}: ${commandErrorMessage(error)}`, { cause: error });
  wrapped.code = isTimedOutGitCommand(error) ? 'ETIMEDOUT' : (error?.code ?? 'EGITVERIFY');
  if (error?.signal) wrapped.signal = error.signal;
  return wrapped;
}

export function assertCleanTrackedWorktreeForFileProvider(
  root,
  {
    runCommandSync = execFileSync,
    timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
    env = process.env,
    commitOid: requestedCommitOid,
  } = {},
) {
  const commitOid = requestedCommitOid;
  if (!isFullCommitOid(commitOid)) {
    const error = new Error(`Git clean verification requires a full pinned commit OID: ${commitOid || '<empty>'}`);
    error.code = 'EGITPROVENANCE';
    throw error;
  }

  try {
    runGit(
      root,
      ['diff-index', '--cached', '--quiet', commitOid, '--'],
      runCommandSync,
      timeoutMs,
      env,
    );
    runGit(root, ['diff-files', '--quiet', '--'], runCommandSync, timeoutMs, env);
  } catch (error) {
    if (error?.status === 1 && !error?.signal) throw dirtyWorktreeError();
    throw verificationError(
      'Git worktree/index inspection could not verify a clean tracked worktree against the pinned commit',
      error,
    );
  }

  return { verificationMode: 'worktree-index-commit', commitOid };
}
