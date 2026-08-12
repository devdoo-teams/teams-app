import { execFileSync } from 'node:child_process';

const DEFAULT_GIT_TIMEOUT_MS = 10_000;

function commandErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isTimedOutGitCommand(error) {
  return error?.code === 'ETIMEDOUT' || error?.killed === true || Boolean(error?.signal);
}

function dirtyWorktreeError() {
  const error = new Error(
    'FileProvider fallback requires a clean tracked Git worktree. Commit tracked source changes before building or packaging.',
  );
  error.code = 'EWORKTREEDIRTY';
  return error;
}

function runGit(root, args, runCommandSync, timeoutMs) {
  return runCommandSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
  }).trim();
}

export function assertCleanTrackedWorktreeForFileProvider(
  root,
  {
    runCommandSync = execFileSync,
    timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
  } = {},
) {
  try {
    const porcelain = runGit(
      root,
      ['status', '--porcelain', '--untracked-files=no'],
      runCommandSync,
      timeoutMs,
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
    headTree = runGit(root, ['rev-parse', 'HEAD^{tree}'], runCommandSync, timeoutMs);
    indexTree = runGit(root, ['write-tree'], runCommandSync, timeoutMs);
  } catch (error) {
    const wrapped = new Error(
      `Git worktree inspection timed out and the HEAD/index tree fallback could not verify a clean tracked worktree: ${commandErrorMessage(error)}`,
      { cause: error },
    );
    wrapped.code = isTimedOutGitCommand(error) ? 'ETIMEDOUT' : (error?.code ?? 'EGITVERIFY');
    throw wrapped;
  }

  if (!headTree || headTree !== indexTree) throw dirtyWorktreeError();
  return { verificationMode: 'head-index-tree' };
}
