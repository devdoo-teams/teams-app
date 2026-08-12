import { execFileSync } from 'node:child_process';

const DEFAULT_GIT_TIMEOUT_MS = 10_000;

function commandErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isTimedOutGitCommand(error) {
  return error?.code === 'ETIMEDOUT';
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
  }).trim();
}

export function assertCleanTrackedWorktreeForFileProvider(
  root,
  {
    runCommandSync = execFileSync,
    timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
    env = process.env,
  } = {},
) {
  try {
    const porcelain = runGit(
      root,
      ['status', '--porcelain', '--untracked-files=no'],
      runCommandSync,
      timeoutMs,
      env,
    );
    if (porcelain) throw dirtyWorktreeError();
    return { verificationMode: 'git-status' };
  } catch (error) {
    if (error?.code === 'EWORKTREEDIRTY') throw error;
    if (!isTimedOutGitCommand(error)) {
      const wrapped = new Error(
        `Failed to inspect tracked Git worktree before FileProvider fallback: ${commandErrorMessage(error)}`,
        { cause: error },
      );
      if (error?.code) wrapped.code = error.code;
      throw wrapped;
    }
  }

  let headTree;
  let indexTree;
  try {
    runGit(root, ['diff-files', '--quiet', '--'], runCommandSync, timeoutMs, env);
    headTree = runGit(root, ['rev-parse', 'HEAD^{tree}'], runCommandSync, timeoutMs, env);
    indexTree = runGit(root, ['write-tree'], runCommandSync, timeoutMs, env);
  } catch (error) {
    if (error?.status === 1 && !error?.signal) throw dirtyWorktreeError();
    const wrapped = new Error(
      `Git worktree inspection timed out and the worktree/index/HEAD fallback could not verify a clean tracked worktree: ${commandErrorMessage(error)}`,
      { cause: error },
    );
    wrapped.code = isTimedOutGitCommand(error) ? 'ETIMEDOUT' : (error?.code ?? 'EGITVERIFY');
    throw wrapped;
  }

  if (!headTree || headTree !== indexTree) throw dirtyWorktreeError();
  return { verificationMode: 'worktree-index-head' };
}
