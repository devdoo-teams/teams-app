import assert from 'node:assert/strict';

import { assertCleanTrackedWorktreeForFileProvider } from './fileprovider-git-clean.mjs';

function commandRunner(responses) {
  const calls = [];
  const runCommandSync = (command, args, options) => {
    calls.push({ command, args, options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, runCommandSync };
}

{
  const runner = commandRunner(['']);
  const result = assertCleanTrackedWorktreeForFileProvider('/repo', runner);
  assert.equal(result.verificationMode, 'git-status');
  assert.deepEqual(runner.calls.map(({ args }) => args), [
    ['status', '--porcelain', '--untracked-files=no'],
  ]);
  assert.equal(
    runner.calls[0].options.env.GIT_OPTIONAL_LOCKS,
    '0',
    'background clean verification must not refresh and lock the index as a status side effect',
  );
}

{
  const runner = commandRunner([' M src/server/index.ts']);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', runner),
    /requires a clean tracked Git worktree/,
  );
  assert.equal(runner.calls.length, 1, 'a known dirty status must not use the tree fallback');
}

{
  const timeout = new Error('git status timed out');
  timeout.code = 'ETIMEDOUT';
  const runner = commandRunner([timeout, '', 'tree-a\n', 'tree-a\n']);
  const result = assertCleanTrackedWorktreeForFileProvider('/repo', runner);
  assert.equal(result.verificationMode, 'worktree-index-head');
  assert.deepEqual(runner.calls.map(({ args }) => args), [
    ['status', '--porcelain', '--untracked-files=no'],
    ['diff-files', '--quiet', '--'],
    ['rev-parse', 'HEAD^{tree}'],
    ['write-tree'],
  ]);
}

{
  const timeout = new Error('git status timed out');
  timeout.code = 'ETIMEDOUT';
  const unstagedDirty = new Error('worktree differs from index');
  unstagedDirty.status = 1;
  const runner = commandRunner([timeout, unstagedDirty]);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', runner),
    /requires a clean tracked Git worktree/,
  );
  assert.equal(runner.calls.length, 2, 'unstaged changes must stop before HEAD/index comparison');
}

{
  const timeout = new Error('git status timed out');
  timeout.code = 'ETIMEDOUT';
  const runner = commandRunner([timeout, '', 'head-tree', 'dirty-index-tree']);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', runner),
    /requires a clean tracked Git worktree/,
  );
}

{
  const failure = new Error('not a repository');
  failure.code = 'ENOTGIT';
  const runner = commandRunner([failure]);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', runner),
    /Failed to inspect tracked Git worktree.*not a repository/,
  );
  assert.equal(runner.calls.length, 1, 'a non-timeout status error must fail closed');
}

{
  const interrupted = new Error('git status interrupted');
  interrupted.signal = 'SIGINT';
  const runner = commandRunner([interrupted]);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', runner),
    /Failed to inspect tracked Git worktree.*interrupted/,
  );
  assert.equal(runner.calls.length, 1, 'an abnormal signal must not enter the timeout fallback');
}

{
  const timeout = new Error('git status timed out');
  timeout.code = 'ETIMEDOUT';
  const treeFailure = new Error('write tree failed');
  treeFailure.code = 'EIO';
  const runner = commandRunner([timeout, '', 'head-tree', treeFailure]);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', runner),
    /worktree\/index\/HEAD fallback could not verify/,
  );
}

console.log('PASS: FileProvider clean-worktree verification is fail-closed with bounded worktree/index/HEAD checks');
