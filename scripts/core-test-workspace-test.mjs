import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createDefaultCoreTestWorkspaceAdapters,
  resolveCoreTestWorkspace,
} from './core-test-workspace.mjs';

const PINNED_COMMIT = 'a'.repeat(40);
const MOVED_COMMIT = 'b'.repeat(40);

// The suite runner intentionally injects TEAMS_SOURCE_COMMIT into every child.
// These adapter fixtures test the fallback pin-resolution seam, so isolate
// them from that release-level override rather than asserting against HEAD.
delete process.env.TEAMS_SOURCE_COMMIT;

function adapters({ dataless = false, cleanError, archiveError, cleanupFailures = 0 } = {}) {
  const calls = [];
  let remainingCleanupFailures = cleanupFailures;
  let observedHead = PINNED_COMMIT;
  return {
    calls,
    get observedHead() {
      return observedHead;
    },
    implementation: {
      resolvePinnedCommitOid() {
        calls.push('pin');
        return observedHead;
      },
      listTrackedInputs(commitOid) {
        calls.push(`list:${commitOid}`);
        return ['scripts/example-test.ts', 'src/server/example.ts', 'README.md'];
      },
      statFile(relativePath) {
        calls.push(`stat:${relativePath}`);
        return {
          size: relativePath.endsWith('.ts') ? 10 : 20,
          blocks: dataless && relativePath === 'src/server/example.ts' ? 0 : 8,
        };
      },
      assertCleanTrackedWorktree(commitOid) {
        calls.push(`clean:${commitOid ?? '<resolve>'}`);
        if (cleanError) throw cleanError;
        return { verificationMode: 'worktree-index-commit', commitOid: commitOid ?? observedHead };
      },
      createTempDirectory() {
        calls.push('temp');
        return '/private/tmp/teams-core-tests-fixed';
      },
      archiveCommit({ commitOid }) {
        calls.push(`archive:${commitOid}`);
        observedHead = MOVED_COMMIT;
        if (archiveError) throw archiveError;
      },
      extractArchive() {
        calls.push('extract');
      },
      validateMaterializedArchive({ commitOid }) {
        calls.push(`validate:${commitOid}`);
      },
      linkNodeModules() {
        calls.push('link');
      },
      removeTempDirectory() {
        calls.push('remove');
        if (remainingCleanupFailures > 0) {
          remainingCleanupFailures -= 1;
          throw new Error('cleanup denied');
        }
      },
    },
  };
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

function createRealGitWorkspaceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-core-real-git-'));
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.name', 'Teams Test']);
  runGit(root, ['config', 'user.email', 'teams-test@example.invalid']);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}\n');
  fs.writeFileSync(path.join(root, 'scripts', 'example-test.mjs'), 'export {};\n');
  fs.writeFileSync(path.join(root, 'src', 'server', 'example.ts'), 'export const example = true;\n');
  runGit(root, ['add', '--', 'package.json', 'scripts/example-test.mjs', 'src/server/example.ts']);
  runGit(root, ['commit', '-q', '-m', 'pinned source']);
  return root;
}

const workspace = adapters();
const direct = resolveCoreTestWorkspace({
  root: '/repo',
  adapters: workspace.implementation,
});
assert.equal(direct.cwd, '/private/tmp/teams-core-tests-fixed');
assert.equal(direct.sourceMode, 'git-commit-materialized');
assert.equal(direct.commitOid, PINNED_COMMIT);
assert.deepEqual(direct.datalessTrackedFiles, []);
assert.deepEqual(
  workspace.calls.filter((call) => /^(clean:|list:|temp|archive:|extract|validate:|link)/.test(call)),
  [`clean:${PINNED_COMMIT}`, `list:${PINNED_COMMIT}`, 'temp', `archive:${PINNED_COMMIT}`, 'extract', `validate:${PINNED_COMMIT}`, 'link'],
  'hydrated input must use the same immutable commit materialization path',
);
assert.equal(workspace.calls.filter((call) => call === 'pin').length, 1);
direct.cleanup();

const fallback = adapters({ dataless: true });
const materialized = resolveCoreTestWorkspace({
  root: '/repo',
  adapters: fallback.implementation,
});
assert.equal(materialized.cwd, '/private/tmp/teams-core-tests-fixed');
assert.equal(materialized.sourceMode, 'git-commit-materialized');
assert.equal(materialized.verificationMode, 'worktree-index-commit');
assert.equal(materialized.commitOid, PINNED_COMMIT);
assert.equal(fallback.observedHead, MOVED_COMMIT, 'fixture must simulate HEAD moving after verification');
assert.deepEqual(materialized.datalessTrackedFiles, ['src/server/example.ts']);
assert.deepEqual(
  fallback.calls.filter((call) => /^(clean:|list:|temp|archive:|extract|validate:|link)/.test(call)),
  [`clean:${PINNED_COMMIT}`, `list:${PINNED_COMMIT}`, 'temp', `archive:${PINNED_COMMIT}`, 'extract', `validate:${PINNED_COMMIT}`, 'link'],
);
assert.equal(fallback.calls.filter((call) => call === 'pin').length, 1);
materialized.cleanup();
assert.equal(fallback.calls.at(-1), 'remove');

const dirty = new Error('tracked worktree is dirty');
dirty.code = 'EWORKTREEDIRTY';
const dirtyFallback = adapters({ dataless: true, cleanError: dirty });
assert.throws(
  () => resolveCoreTestWorkspace({ root: '/repo', adapters: dirtyFallback.implementation }),
  (error) => error === dirty,
);
assert.ok(!dirtyFallback.calls.some((call) => call.startsWith('archive:')));

const timedOut = new Error('git archive timed out');
timedOut.code = 'ETIMEDOUT';
const stalledArchive = adapters({ dataless: true, archiveError: timedOut });
assert.throws(
  () => resolveCoreTestWorkspace({ root: '/repo', adapters: stalledArchive.implementation }),
  (error) => error?.code === 'SOURCE_IO_UNSTABLE' && /git archive/i.test(error.message),
);
assert.equal(stalledArchive.calls.at(-1), 'remove');

{
  const captured = {};
  const defaultAdapters = createDefaultCoreTestWorkspaceAdapters('/repo', {
    runCommandSync(command, args, options) {
      captured.command = command;
      captured.args = args;
      captured.options = options;
      return '';
    },
  });
  defaultAdapters.archiveCommit({ archivePath: '/tmp/pinned-source.tar', commitOid: PINNED_COMMIT });
  assert.equal(captured.command, 'git');
  assert.deepEqual(captured.args, [
    'archive',
    '--format=tar',
    '--output',
    '/tmp/pinned-source.tar',
    PINNED_COMMIT,
  ]);
  assert.equal(captured.options.env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(captured.options.killSignal, 'SIGKILL');
}

const retryCleanup = adapters({ dataless: true, cleanupFailures: 1 });
const retryableWorkspace = resolveCoreTestWorkspace({
  root: '/repo',
  adapters: retryCleanup.implementation,
});
retryableWorkspace.cleanup();
assert.equal(
  retryCleanup.calls.filter((call) => call === 'remove').length,
  2,
  'cleanup must automatically retry a bounded transient failure',
);

{
  const originalArchiveError = new Error('archive source became unreadable');
  originalArchiveError.code = 'ESOURCEORIGINAL';
  const cleanupFailure = adapters({
    dataless: true,
    archiveError: originalArchiveError,
    cleanupFailures: 3,
  });
  assert.throws(
    () => resolveCoreTestWorkspace({ root: '/repo', adapters: cleanupFailure.implementation }),
    (error) => {
      assert.equal(error?.code, 'SOURCE_IO_UNSTABLE');
      assert.ok(error instanceof AggregateError, 'cleanup failure must remain distinguishable from the original failure');
      assert.equal(error.cause?.cause, originalArchiveError, 'the original archive error must remain reachable as cause');
      assert.equal(error.errors?.[0], error.cause, 'the aggregate must preserve the original wrapped failure first');
      return true;
    },
  );
  assert.equal(
    cleanupFailure.calls.filter((call) => call === 'remove').length,
    3,
    'cleanup must stop after the bounded retry limit while retaining the original error',
  );
}

{
  const captured = {};
  const defaultAdapters = createDefaultCoreTestWorkspaceAdapters('/repo', {
    runCommandSync(command, args, options) {
      captured.command = command;
      captured.args = args;
      captured.options = options;
      return 'src/server/index.ts\0README.md\0';
    },
  });
  assert.deepEqual(defaultAdapters.listTrackedInputs(PINNED_COMMIT), ['src/server/index.ts', 'README.md']);
  assert.equal(captured.command, 'git');
  assert.deepEqual(captured.args, [
    'ls-tree',
    '-r',
    '--name-only',
    '-z',
    PINNED_COMMIT,
    '--',
  ]);
  assert.equal(captured.options.env.GIT_OPTIONAL_LOCKS, '0');
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-core-source-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-core-source-outside-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'escaped.ts'), 'export const escaped = true;');
    fs.symlinkSync(path.join(outside, 'escaped.ts'), path.join(root, 'src', 'escaped.ts'));
    const defaultAdapters = createDefaultCoreTestWorkspaceAdapters(root);
    assert.throws(
      () => defaultAdapters.statFile('src/escaped.ts'),
      /symbolic link|owned source root|escape/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-core-modules-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-core-modules-outside-'));
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-core-tests-'));
  try {
    fs.symlinkSync(outside, path.join(root, 'node_modules'), 'dir');
    const defaultAdapters = createDefaultCoreTestWorkspaceAdapters(root);
    assert.throws(
      () => defaultAdapters.linkNodeModules({ tempDirectory: destination }),
      /node_modules.*symbolic link|owned source root|escape/i,
    );
    assert.equal(fs.existsSync(path.join(destination, 'node_modules')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
}

{
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-core-archive-source-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-core-archive-outside-'));
  try {
    fs.mkdirSync(path.join(sourceRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'docs', 'inside.txt'), 'inside');
    fs.symlinkSync('inside.txt', path.join(sourceRoot, 'docs', 'inside-link'));
    const defaultAdapters = createDefaultCoreTestWorkspaceAdapters('/repo');
    assert.doesNotThrow(() => defaultAdapters.validateMaterializedArchive({
      tempDirectory: sourceRoot,
      trackedInputs: ['docs/inside.txt', 'docs/inside-link'],
      commitOid: PINNED_COMMIT,
    }));

    fs.writeFileSync(path.join(outside, 'escaped.txt'), 'outside');
    fs.symlinkSync(path.join(outside, 'escaped.txt'), path.join(sourceRoot, 'docs', 'unfiltered-escape'));
    assert.throws(
      () => defaultAdapters.validateMaterializedArchive({
        tempDirectory: sourceRoot,
        trackedInputs: ['docs/inside.txt', 'docs/inside-link'],
        commitOid: PINNED_COMMIT,
      }),
      /symlink|escape|owned archive root/i,
      'the whole extracted archive must reject an escaping symlink outside the Core input filter',
    );
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

{
  const root = createRealGitWorkspaceFixture();
  let movedHead = false;
  try {
    const adapters = createDefaultCoreTestWorkspaceAdapters(root, {
      runCommandSync(command, args, options) {
        if (command === 'git' && args[0] === 'archive' && !movedHead) {
          movedHead = true;
          runGit(root, ['commit', '--allow-empty', '-q', '-m', 'move HEAD after pin']);
        }
        return execFileSync(command, args, options);
      },
    });
    const workspace = resolveCoreTestWorkspace({ root, adapters });
    const currentHead = runGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
    assert.equal(movedHead, true, 'fixture must move HEAD during archive materialization');
    assert.notEqual(currentHead, workspace.commitOid, 'fixture must leave HEAD different from the pinned source OID');
    assert.equal(workspace.sourceMode, 'git-commit-materialized');
    assert.ok(fs.existsSync(path.join(workspace.cwd, 'scripts', 'example-test.mjs')));
    workspace.cleanup();
    assert.equal(fs.existsSync(workspace.cwd), false, 'real pinned workspace must be removable after verification');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('PASS: core TS tests pin one commit, reject path escapes, and retry failed cleanup');
