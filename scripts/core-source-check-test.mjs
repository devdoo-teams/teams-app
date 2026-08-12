import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as coreSourceCheckModule from './core-source-check-lib.mjs';

const { CORE_SOURCE_CHECK_FILES, runCoreSourceCheck } = coreSourceCheckModule;

const validSource = 'export const ok = true;';

function makeAdapters(overrides = {}) {
  const calls = {
    statFile: [],
    readWorkspaceFile: [],
    getTrackedWorktreeStatus: 0,
    readCommittedSource: [],
    compileSource: [],
  };

  const adapters = {
    calls,
    statFile(relativePath) {
      calls.statFile.push(relativePath);
      return { size: 12, blocks: 8 };
    },
    readWorkspaceFile(relativePath) {
      calls.readWorkspaceFile.push(relativePath);
      return validSource;
    },
    getTrackedWorktreeStatus() {
      calls.getTrackedWorktreeStatus += 1;
      return '';
    },
    readCommittedSource(relativePath) {
      calls.readCommittedSource.push(relativePath);
      return validSource;
    },
    compileSource({ relativePath, source, loader }) {
      calls.compileSource.push({ relativePath, source, loader });
      return { code: 'const ok = true;\n' };
    },
    ...overrides,
  };

  return adapters;
}

function runWithAdapters(adapters, options = {}) {
  return runCoreSourceCheck({
    files: options.files ?? CORE_SOURCE_CHECK_FILES,
    env: options.env ?? {},
    adapters,
  });
}

function assertThrowsMessage(callback, pattern) {
  assert.throws(callback, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
}

{
  const adapters = makeAdapters();
  const result = runWithAdapters(adapters);

  assert.equal(result.sourceMode, 'workspace');
  assert.equal(result.fallbackReason, null);
  assert.equal(result.checkedFileCount, 9);
  assert.deepEqual(adapters.calls.readWorkspaceFile, CORE_SOURCE_CHECK_FILES);
  assert.deepEqual(adapters.calls.readCommittedSource, []);
  assert.equal(adapters.calls.getTrackedWorktreeStatus, 0);
  assert.equal(adapters.calls.compileSource.length, 9);
}

{
  const adapters = makeAdapters({
    statFile(relativePath) {
      adapters.calls.statFile.push(relativePath);
      return relativePath === CORE_SOURCE_CHECK_FILES[3] ? { size: 42, blocks: 0 } : { size: 42, blocks: 8 };
    },
  });
  const result = runWithAdapters(adapters);

  assert.equal(result.sourceMode, 'fallback');
  assert.equal(result.fallbackReason, 'dataless-tracked-input');
  assert.deepEqual(result.datalessTrackedFiles, [CORE_SOURCE_CHECK_FILES[3]]);
  assert.equal(adapters.calls.getTrackedWorktreeStatus, 1);
  assert.deepEqual(adapters.calls.readWorkspaceFile, []);
  assert.deepEqual(adapters.calls.readCommittedSource, CORE_SOURCE_CHECK_FILES);
}

{
  const adapters = makeAdapters();
  const result = runWithAdapters(adapters, { env: { TEAMS_FILEPROVIDER_SERVER_REUSE: '1' } });

  assert.equal(result.sourceMode, 'fallback');
  assert.equal(result.fallbackReason, 'explicit-env');
  assert.equal(adapters.calls.getTrackedWorktreeStatus, 1);
  assert.deepEqual(adapters.calls.readCommittedSource, CORE_SOURCE_CHECK_FILES);
}

{
  const adapters = makeAdapters({
    statFile(relativePath) {
      adapters.calls.statFile.push(relativePath);
      throw new Error(`cannot stat ${relativePath}`);
    },
  });
  const result = runWithAdapters(adapters, { env: { TEAMS_FILEPROVIDER_SERVER_REUSE: '1' } });

  assert.equal(result.sourceMode, 'fallback');
  assert.equal(result.fallbackReason, 'explicit-env');
  assert.deepEqual(adapters.calls.statFile, []);
  assert.deepEqual(adapters.calls.readWorkspaceFile, []);
  assert.equal(adapters.calls.getTrackedWorktreeStatus, 1);
  assert.deepEqual(adapters.calls.readCommittedSource, CORE_SOURCE_CHECK_FILES);
}

{
  const adapters = makeAdapters({
    statFile(relativePath) {
      adapters.calls.statFile.push(relativePath);
      return relativePath === CORE_SOURCE_CHECK_FILES[0] ? { size: 42, blocks: 0 } : { size: 42, blocks: 8 };
    },
    getTrackedWorktreeStatus() {
      adapters.calls.getTrackedWorktreeStatus += 1;
      return ' M src/server/index.ts';
    },
  });

  assertThrowsMessage(
    () => runWithAdapters(adapters),
    /FileProvider fallback requires a clean tracked Git worktree/,
  );
  assert.deepEqual(adapters.calls.readCommittedSource, []);
  assert.equal(adapters.calls.compileSource.length, 0);
}

{
  const adapters = makeAdapters({
    statFile(relativePath) {
      adapters.calls.statFile.push(relativePath);
      return relativePath === CORE_SOURCE_CHECK_FILES[0] ? { size: 42, blocks: 0 } : { size: 42, blocks: 8 };
    },
    getTrackedWorktreeStatus() {
      adapters.calls.getTrackedWorktreeStatus += 1;
      const error = new Error('git status failed');
      error.status = 128;
      throw error;
    },
  });

  assertThrowsMessage(
    () => runWithAdapters(adapters),
    /Failed to inspect tracked Git worktree before FileProvider fallback: git status failed/,
  );
}

{
  const adapters = makeAdapters({
    statFile(relativePath) {
      adapters.calls.statFile.push(relativePath);
      return relativePath === CORE_SOURCE_CHECK_FILES[0] ? { size: 42, blocks: 0 } : { size: 42, blocks: 8 };
    },
    getTrackedWorktreeStatus() {
      adapters.calls.getTrackedWorktreeStatus += 1;
      const error = new Error('spawn timed out');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  });

  assertThrowsMessage(
    () => runWithAdapters(adapters),
    /Git worktree inspection timed out under FileProvider/,
  );
}

{
  const adapters = makeAdapters({
    readWorkspaceFile(relativePath) {
      adapters.calls.readWorkspaceFile.push(relativePath);
      throw new Error('read failed');
    },
  });

  assertThrowsMessage(
    () => runWithAdapters(adapters),
    /Failed to read workspace source for src\/server\/codex-capability\.ts: read failed/,
  );
}

{
  const adapters = makeAdapters({
    statFile(relativePath) {
      adapters.calls.statFile.push(relativePath);
      return relativePath === CORE_SOURCE_CHECK_FILES[0] ? { size: 42, blocks: 0 } : { size: 42, blocks: 8 };
    },
    readCommittedSource(relativePath) {
      adapters.calls.readCommittedSource.push(relativePath);
      const error = new Error('git show failed');
      error.status = 128;
      throw error;
    },
  });

  assertThrowsMessage(
    () => runWithAdapters(adapters),
    /Failed to read committed source for src\/server\/codex-capability\.ts from git show HEAD:src\/server\/codex-capability\.ts: git show failed/,
  );
}

{
  const adapters = makeAdapters({
    statFile(relativePath) {
      adapters.calls.statFile.push(relativePath);
      return relativePath === CORE_SOURCE_CHECK_FILES[0] ? { size: 42, blocks: 0 } : { size: 42, blocks: 8 };
    },
    readCommittedSource(relativePath) {
      adapters.calls.readCommittedSource.push(relativePath);
      const error = new Error('git show timed out');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  });

  assertThrowsMessage(
    () => runWithAdapters(adapters),
    /Reading committed source timed out for src\/server\/codex-capability\.ts during FileProvider fallback/,
  );
}

{
  const adapters = makeAdapters({
    compileSource({ relativePath, source, loader }) {
      adapters.calls.compileSource.push({ relativePath, source, loader });
      throw new Error('Expected ";" but found "}"');
    },
  });

  assertThrowsMessage(
    () => runWithAdapters(adapters),
    /Core source compile check failed for src\/server\/codex-capability\.ts: Expected ";" but found "}"/,
  );
}

{
  const adapters = makeAdapters({
    compileSource({ relativePath, source, loader }) {
      adapters.calls.compileSource.push({ relativePath, source, loader });
      if (adapters.calls.compileSource.length === 1) {
        throw new Error('The service was stopped');
      }
      return { code: 'const ok = true;\n' };
    },
  });

  const result = runWithAdapters(adapters, { files: ['src/server/index.ts'] });

  assert.equal(result.checkedFileCount, 1);
  assert.equal(adapters.calls.compileSource.length, 2);
}

{
  const adapters = makeAdapters({
    compileSource({ relativePath, source, loader }) {
      adapters.calls.compileSource.push({ relativePath, source, loader });
      throw new Error('The service was stopped');
    },
  });

  assertThrowsMessage(
    () => runWithAdapters(adapters, { files: ['src/server/index.ts'] }),
    /Core source compile check failed for src\/server\/index\.ts: The service was stopped/,
  );
  assert.equal(adapters.calls.compileSource.length, 2);
}

{
  const adapters = makeAdapters({
    compileSource({ relativePath, source, loader }) {
      adapters.calls.compileSource.push({ relativePath, source, loader });
      const error = new Error('spawn timed out');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  });

  assert.throws(
    () => runWithAdapters(adapters, { files: ['src/server/index.ts'] }),
    (error) => {
      assert.match(error.message, /Core source compile check failed for src\/server\/index\.ts: spawn timed out/);
      assert.equal(error.code, 'ETIMEDOUT');
      return true;
    },
  );
  assert.equal(adapters.calls.compileSource.length, 1);
}

{
  const captured = {};
  const adapters = coreSourceCheckModule.createDefaultAdapters('/tmp/core-source-check-root', {
    runCommandSync(command, args, options) {
      captured.command = command;
      captured.args = args;
      captured.options = options;
      return 'const ok = true;\n';
    },
  });

  const result = adapters.compileSource({
    relativePath: 'src/client/App.tsx',
    source: 'export const ok = <div />;',
    loader: 'tsx',
  });

  const expectedBinary = createRequire(import.meta.url).resolve(
    `@esbuild/${process.platform}-${process.arch}/bin/esbuild`,
  );

  assert.equal(result.code, 'const ok = true;\n');
  assert.equal(captured.command, expectedBinary);
  assert.equal(path.isAbsolute(captured.command), true);
  assert.deepEqual(captured.args, [
    '--loader=tsx',
    '--format=esm',
    '--target=es2022',
    '--jsx=automatic',
    '--log-level=warning',
    '--sourcefile=src/client/App.tsx',
  ]);
  assert.equal(captured.options.cwd, '/tmp/core-source-check-root');
  assert.equal(captured.options.encoding, 'utf8');
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.input, 'export const ok = <div />;');
  assert.equal(captured.options.timeout, 10_000);
  assert.ok(!captured.args.includes('--service'));
}

{
  const captured = {};
  const adapters = coreSourceCheckModule.createDefaultAdapters('/tmp/core-source-check-root', {
    env: { ESBUILD_BINARY_PATH: '/tmp/custom-esbuild' },
    runCommandSync(command, args, options) {
      captured.command = command;
      captured.args = args;
      captured.options = options;
      return 'const ok = true;\n';
    },
  });

  const result = adapters.compileSource({
    relativePath: 'src/server/index.ts',
    source: 'export const ok = true;',
    loader: 'ts',
  });

  assert.equal(result.code, 'const ok = true;\n');
  assert.equal(captured.command, '/tmp/custom-esbuild');
  assert.equal(path.isAbsolute(captured.command), true);
  assert.deepEqual(captured.args, [
    '--loader=ts',
    '--format=esm',
    '--target=es2022',
    '--jsx=automatic',
    '--log-level=warning',
    '--sourcefile=src/server/index.ts',
  ]);
  assert.equal(captured.options.input, 'export const ok = true;');
}

{
  const adapters = coreSourceCheckModule.createDefaultAdapters('/tmp/core-source-check-root', {
    env: { ESBUILD_BINARY_PATH: 'relative/esbuild' },
    runCommandSync() {
      throw new Error('should not spawn with relative binary path');
    },
  });

  assertThrowsMessage(
    () =>
      adapters.compileSource({
        relativePath: 'src/server/index.ts',
        source: 'export const ok = true;',
        loader: 'ts',
      }),
    /ESBUILD_BINARY_PATH must be an absolute path/,
  );
}

{
  const adapters = makeAdapters({
    statFile(relativePath) {
      adapters.calls.statFile.push(relativePath);
      throw new Error(`cannot stat ${relativePath}`);
    },
  });

  assertThrowsMessage(
    () => runWithAdapters(adapters),
    /Failed to stat checked source src\/server\/codex-capability\.ts: cannot stat src\/server\/codex-capability\.ts/,
  );
}

console.log('Core source-check behavior test passed');
