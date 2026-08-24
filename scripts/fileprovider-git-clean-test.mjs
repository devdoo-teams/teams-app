import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertCleanTrackedWorktreeForFileProvider,
  resolvePinnedCommitOid,
} from './fileprovider-git-clean.mjs';

const PINNED_COMMIT = 'a'.repeat(40);

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

function runGit(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    timeout: 5_000,
    killSignal: 'SIGKILL',
  }).trim();
}

function createGitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-git-clean-fixture-'));
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.name', 'Teams Test']);
  runGit(root, ['config', 'user.email', 'teams-test@example.invalid']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'pinned source\n');
  runGit(root, ['add', '--', 'tracked.txt']);
  runGit(root, ['commit', '-q', '-m', 'pinned']);
  return root;
}

function gitStorageSnapshot(root) {
  const gitDirectory = path.join(root, '.git');
  const selected = ['HEAD', 'index', 'packed-refs', 'refs', 'objects'];
  const entries = [];
  const visit = (relativePath) => {
    const absolutePath = path.join(gitDirectory, relativePath);
    if (!fs.existsSync(absolutePath)) return;
    const metadata = fs.lstatSync(absolutePath);
    if (metadata.isDirectory()) {
      for (const name of fs.readdirSync(absolutePath).sort()) {
        visit(path.join(relativePath, name));
      }
      return;
    }
    assert.equal(metadata.isFile(), true, `Git fixture storage must contain regular files: ${relativePath}`);
    entries.push([
      relativePath.split(path.sep).join('/'),
      crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex'),
    ]);
  };
  for (const relativePath of selected) visit(relativePath);
  return entries;
}

{
  const runner = commandRunner(['', '']);
  const result = assertCleanTrackedWorktreeForFileProvider('/repo', {
    ...runner,
    commitOid: PINNED_COMMIT,
  });
  assert.equal(result.verificationMode, 'worktree-index-commit');
  assert.equal(result.commitOid, PINNED_COMMIT);
  assert.deepEqual(runner.calls.map(({ args }) => args), [
    ['diff-index', '--cached', '--quiet', PINNED_COMMIT, '--'],
    ['diff-files', '--quiet', '--'],
  ]);
  for (const call of runner.calls) {
    assert.equal(
      call.options.env.GIT_OPTIONAL_LOCKS,
      '0',
      'clean verification must not refresh and lock the index as a side effect',
    );
    assert.equal(call.options.killSignal, 'SIGKILL', 'synchronous Git inspection must have a hard kill signal');
  }
  assert.equal(
    runner.calls.some(({ args }) => args.includes('write-tree')),
    false,
    'a read-only provenance gate must never create Git objects',
  );
}

{
  const runner = commandRunner([]);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', runner),
    (error) => error?.code === 'EGITPROVENANCE' && /full pinned commit OID/i.test(error.message),
    'the clean checker must require an exact caller-provided commit OID',
  );
  assert.equal(runner.calls.length, 0, 'missing provenance must fail before reading HEAD or the index');
}

{
  const runner = commandRunner(['', '']);
  const result = assertCleanTrackedWorktreeForFileProvider('/repo', {
    ...runner,
    commitOid: PINNED_COMMIT,
  });
  assert.equal(result.commitOid, PINNED_COMMIT);
  assert.deepEqual(runner.calls.map(({ args }) => args), [
    ['diff-index', '--cached', '--quiet', PINNED_COMMIT, '--'],
    ['diff-files', '--quiet', '--'],
  ], 'an explicitly pinned source OID must eliminate every internal HEAD reread');
}

{
  const dirtyIndex = new Error('index differs from pinned commit');
  dirtyIndex.status = 1;
  const runner = commandRunner([dirtyIndex]);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', { ...runner, commitOid: PINNED_COMMIT }),
    /requires a clean tracked Git worktree/,
  );
  assert.equal(runner.calls.length, 1, 'a dirty index must stop before worktree comparison');
}

{
  const unstagedDirty = new Error('worktree differs from index');
  unstagedDirty.status = 1;
  const runner = commandRunner(['', unstagedDirty]);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', { ...runner, commitOid: PINNED_COMMIT }),
    /requires a clean tracked Git worktree/,
  );
  assert.equal(runner.calls.length, 2);
}

{
  const runner = commandRunner([]);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', { ...runner, commitOid: 'short-oid' }),
    /full pinned commit OID/,
  );
  assert.equal(runner.calls.length, 0, 'invalid provenance must fail before diff inspection');
}

{
  const failure = new Error('not a repository');
  failure.code = 'ENOTGIT';
  const runner = commandRunner([failure]);
  assert.throws(
    () => resolvePinnedCommitOid('/repo', runner),
    /Failed to resolve pinned Git commit.*not a repository/,
  );
  assert.equal(runner.calls.length, 1, 'an unavailable commit must fail closed');
}

{
  const interrupted = new Error('git status interrupted');
  interrupted.signal = 'SIGINT';
  const runner = commandRunner([interrupted]);
  assert.throws(
    () => resolvePinnedCommitOid('/repo', runner),
    /Failed to resolve pinned Git commit.*interrupted/,
  );
  assert.equal(runner.calls.length, 1, 'an abnormal signal must fail closed');
}

{
  const timeout = new Error('git diff-index timed out');
  timeout.code = 'ETIMEDOUT';
  const runner = commandRunner([timeout]);
  assert.throws(
    () => assertCleanTrackedWorktreeForFileProvider('/repo', { ...runner, commitOid: PINNED_COMMIT }),
    /could not verify a clean tracked worktree.*timed out/,
  );
  assert.equal(runner.calls.some(({ args }) => args.includes('write-tree')), false);
}

{
  const root = createGitFixture();
  try {
    const before = gitStorageSnapshot(root);
    const pinnedCommit = runGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
    const result = assertCleanTrackedWorktreeForFileProvider(root, { commitOid: pinnedCommit });
    const after = gitStorageSnapshot(root);
    assert.match(result.commitOid, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
    assert.deepEqual(after, before, 'clean verification must not mutate index, refs, or Git objects');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = createGitFixture();
  try {
    const pinnedCommit = runGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
    let movedCommit;
    let moved = false;
    const runCommandSync = (command, args, options) => {
      const output = execFileSync(command, args, options);
      if (!moved && args[0] === 'diff-files') {
        moved = true;
        runGit(root, ['commit', '--allow-empty', '-q', '-m', 'move head without changing the tree']);
        movedCommit = runGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
      }
      return output;
    };
    const result = assertCleanTrackedWorktreeForFileProvider(root, {
      runCommandSync,
      commitOid: pinnedCommit,
    });
    assert.notEqual(movedCommit, pinnedCommit, 'fixture must move HEAD after the resolver returns');
    assert.equal(result.commitOid, pinnedCommit, 'the clean gate must retain the first immutable OID');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('PASS: FileProvider clean-worktree verification pins one commit without writing Git objects');
