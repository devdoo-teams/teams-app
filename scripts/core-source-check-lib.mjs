import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  assertCleanTrackedWorktreeForFileProvider,
  isFullCommitOid,
  resolvePinnedCommitOid,
} from './fileprovider-git-clean.mjs';

export const CORE_SOURCE_CHECK_FILES = [
  'src/server/codex-capability.ts',
  'src/server/agent-token-usage.ts',
  'src/server/cli-agent-runner.ts',
  'src/server/provider-neutral-agent-runner.ts',
  'src/server/cli-diagnostics.ts',
  'src/server/a2a-contract.ts',
  'src/server/a2a-role-catalog.ts',
  'src/server/a2a-orchestrator.ts',
  'src/server/a2a-observability.ts',
  'src/server/a2a-execution.ts',
  'src/server/a2a-http-scope.ts',
  'src/server/a2a-jsonrpc-route.ts',
  'src/server/a2a-production-runtime.ts',
  'src/server/a2a-route.ts',
  'src/server/a2a-store.ts',
  'src/server/agent-service.ts',
  'src/server/storage/runtime-store.ts',
  'src/server/storage/cosmos-runtime-store.ts',
  'src/server/storage/runtime-store-factory.ts',
  'src/server/queue/agent-dispatch-queue.ts',
  'src/server/azure-agent-dispatch-queue.ts',
  'src/worker/index.ts',
  'src/server/index.ts',
  'src/server/genui-response.ts',
  'src/server/genui-teams.ts',
  'src/server/teams-tab-link.ts',
  'src/shared/genui.ts',
  'src/client/build-flags.ts',
  'src/client/App.tsx',
  'src/client/main.tsx',
];

const GIT_TIMEOUT_MS = 10_000;
const CORE_COMPILE_TIMEOUT_MS = 10_000;
const EXPLICIT_FILEPROVIDER_FALLBACK = 'explicit-env';
const DATALESS_FILEPROVIDER_FALLBACK = 'dataless-tracked-input';
const MODULE_REQUIRE = createRequire(import.meta.url);

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveOwnedSourcePath(root, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Checked source path must be relative: ${relativePath}`);
  }

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  if (!isPathInside(resolvedRoot, candidate)) {
    throw new Error(`Checked source path escapes the owned source root: ${relativePath}`);
  }

  const metadata = fs.lstatSync(candidate);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Checked source must not be a symbolic link: ${relativePath}`);
  }

  const realRoot = fs.realpathSync(resolvedRoot);
  const realCandidate = fs.realpathSync(candidate);
  if (!isPathInside(realRoot, realCandidate)) {
    throw new Error(`Checked source realpath escapes the owned source root: ${relativePath}`);
  }

  return { metadata, realPath: realCandidate };
}

function resolveEsbuildBinaryPath({
  env = process.env,
  resolveModulePath = MODULE_REQUIRE.resolve.bind(MODULE_REQUIRE),
} = {}) {
  const explicitBinaryPath = env.ESBUILD_BINARY_PATH?.trim();
  if (explicitBinaryPath) {
    if (!path.isAbsolute(explicitBinaryPath)) {
      throw new Error(`ESBUILD_BINARY_PATH must be an absolute path, got: ${explicitBinaryPath}`);
    }
    return explicitBinaryPath;
  }

  let resolvedBinaryPath;
  try {
    resolvedBinaryPath = resolveModulePath(`@esbuild/${process.platform}-${process.arch}/bin/esbuild`);
  } catch (error) {
    throw new Error(
      `Failed to resolve the platform esbuild CLI binary @esbuild/${process.platform}-${process.arch}/bin/esbuild: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }

  if (!path.isAbsolute(resolvedBinaryPath)) {
    throw new Error(`Resolved platform esbuild binary path must be absolute, got: ${resolvedBinaryPath}`);
  }

  return resolvedBinaryPath;
}

export function createDefaultAdapters(
  root,
  {
    runCommandSync = execFileSync,
    env = process.env,
    resolveModulePath = MODULE_REQUIRE.resolve.bind(MODULE_REQUIRE),
  } = {},
) {
  return {
    resolvePinnedCommitOid() {
      return resolvePinnedCommitOid(root, {
        runCommandSync,
        timeoutMs: GIT_TIMEOUT_MS,
        env,
      });
    },
    statFile(relativePath) {
      return resolveOwnedSourcePath(root, relativePath).metadata;
    },
    readWorkspaceFile(relativePath) {
      return fs.readFileSync(resolveOwnedSourcePath(root, relativePath).realPath, 'utf8');
    },
    getTrackedWorktreeStatus(commitOid) {
      return assertCleanTrackedWorktreeForFileProvider(root, {
        runCommandSync,
        timeoutMs: GIT_TIMEOUT_MS,
        env,
        commitOid,
      });
    },
    readCommittedSource(relativePath, commitOid) {
      if (!isFullCommitOid(commitOid)) {
        throw new Error(`Committed source requires a full pinned commit OID, got: ${commitOid ?? '<missing>'}`);
      }
      return runCommandSync('git', ['show', `${commitOid}:${relativePath}`], {
        cwd: root,
        encoding: 'utf8',
        env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
    },
    compileSource({ relativePath, source, loader }) {
      const binaryPath = resolveEsbuildBinaryPath({ env, resolveModulePath });
      const args = [
        `--loader=${loader}`,
        '--format=esm',
        '--target=es2022',
        '--jsx=automatic',
        '--log-level=warning',
        `--sourcefile=${relativePath}`,
        '--tsconfig-raw={}',
      ];
      const code = runCommandSync(binaryPath, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: CORE_COMPILE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        input: source,
        shell: false,
      });
      return { code };
    },
  };
}

function isNonEmptyDatalessFile(metadata) {
  return Boolean(metadata?.size > 0 && Number.isInteger(metadata.blocks) && metadata.blocks === 0);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function matchesLegacyServiceStoppedSignature(error) {
  const legacySignature = 'The service was stopped';
  const message = error?.message;
  if (typeof message === 'string' && message.trim() === legacySignature) {
    return true;
  }

  const stderr = error?.stderr;
  if (typeof stderr === 'string') {
    return stderr.trim() === legacySignature;
  }
  if (Buffer.isBuffer(stderr)) {
    return stderr.toString('utf8').trim() === legacySignature;
  }

  return false;
}

function statCheckedSource(relativePath, adapters) {
  try {
    return adapters.statFile(relativePath);
  } catch (error) {
    throw new Error(`Failed to stat checked source ${relativePath}: ${getErrorMessage(error)}`, { cause: error });
  }
}

function rethrowTimedOutGitInspection(error) {
  const wrapped = new Error(
    'Git worktree inspection timed out under FileProvider. Materialize the local source or commit from a normal local checkout before running the Core source check.',
    { cause: error },
  );
  wrapped.code = 'ETIMEDOUT';
  if (error?.signal) wrapped.signal = error.signal;
  throw wrapped;
}

function inspectTrackedWorktree(adapters, commitOid) {
  try {
    const verification = adapters.getTrackedWorktreeStatus(commitOid);
    if (!verification || !isFullCommitOid(verification.commitOid)) {
      const error = new Error('Clean-worktree verification did not return a full pinned commit OID.');
      error.code = 'EGITPROVENANCE';
      throw error;
    }
    if (verification.commitOid !== commitOid) {
      const error = new Error(
        `Clean-worktree verification changed the pinned commit OID from ${commitOid} to ${verification.commitOid}.`,
      );
      error.code = 'EGITPROVENANCE';
      throw error;
    }
    return verification;
  } catch (error) {
    if (error?.code === 'EWORKTREEDIRTY') throw error;
    if (error?.code === 'ETIMEDOUT') rethrowTimedOutGitInspection(error);
    const wrapped = new Error(
      `Failed to inspect tracked Git worktree before FileProvider fallback: ${getErrorMessage(error)}`,
      { cause: error },
    );
    if (error?.code) wrapped.code = error.code;
    if (error?.signal) wrapped.signal = error.signal;
    throw wrapped;
  }
}

function readSource(relativePath, commitOid, adapters) {
  try {
    return adapters.readCommittedSource(relativePath, commitOid);
  } catch (error) {
    if (error?.code === 'ETIMEDOUT') {
      const wrapped = new Error(
        `Reading committed source timed out for ${relativePath} during FileProvider fallback (git show ${commitOid}:${relativePath}).`,
        { cause: error },
      );
      wrapped.code = 'ETIMEDOUT';
      if (error?.signal) wrapped.signal = error.signal;
      throw wrapped;
    }
    const wrapped = new Error(
      `Failed to read committed source for ${relativePath} from git show ${commitOid}:${relativePath}: ${getErrorMessage(error)}`,
      { cause: error },
    );
    if (error?.code) wrapped.code = error.code;
    if (error?.signal) wrapped.signal = error.signal;
    throw wrapped;
  }
}

function compileSource(relativePath, source, adapters) {
  const loader = relativePath.endsWith('.tsx') ? 'tsx' : 'ts';

  try {
    let result;
    try {
      result = adapters.compileSource({ relativePath, source, loader });
    } catch (error) {
      if (error?.code === 'ETIMEDOUT' || !matchesLegacyServiceStoppedSignature(error)) {
        throw error;
      }
      result = adapters.compileSource({ relativePath, source, loader });
    }
    assert.ok(result?.code?.length > 0, `${relativePath} produced no compiled output`);
    return { loader, code: result.code };
  } catch (error) {
    const wrapped = new Error(`Core source compile check failed for ${relativePath}: ${getErrorMessage(error)}`, {
      cause: error,
    });
    if (error?.code) wrapped.code = error.code;
    if (error?.signal) wrapped.signal = error.signal;
    throw wrapped;
  }
}

export function runCoreSourceCheck({
  root = process.cwd(),
  files = CORE_SOURCE_CHECK_FILES,
  env = process.env,
  commitOid = env.TEAMS_SOURCE_COMMIT,
  adapters = createDefaultAdapters(root),
} = {}) {
  const pinnedCommitOid = commitOid ?? adapters.resolvePinnedCommitOid();
  if (!isFullCommitOid(pinnedCommitOid)) {
    const error = new Error(`Core source check requires a full pinned commit OID, got: ${pinnedCommitOid ?? '<missing>'}`);
    error.code = 'EGITPROVENANCE';
    throw error;
  }
  const explicitFallback = env.TEAMS_FILEPROVIDER_SERVER_REUSE === '1';
  const datalessTrackedFiles = explicitFallback
    ? []
    : files.filter((relativePath) => isNonEmptyDatalessFile(statCheckedSource(relativePath, adapters)));
  const fallbackReason = explicitFallback
    ? EXPLICIT_FILEPROVIDER_FALLBACK
    : datalessTrackedFiles.length > 0
      ? DATALESS_FILEPROVIDER_FALLBACK
      : null;
  const sourceMode = 'git-commit';
  const verification = inspectTrackedWorktree(adapters, pinnedCommitOid);

  for (const relativePath of files) {
    const source = readSource(relativePath, verification.commitOid, adapters);
    compileSource(relativePath, source, adapters);
  }

  return {
    checkedFileCount: files.length,
    checkedFiles: [...files],
    sourceMode,
    fallbackReason,
    verificationMode: verification.verificationMode,
    commitOid: verification.commitOid,
    datalessTrackedFiles,
  };
}
