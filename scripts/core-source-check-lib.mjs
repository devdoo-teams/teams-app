import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const CORE_SOURCE_CHECK_FILES = [
  'src/server/codex-capability.ts',
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

const CORE_COMPILE_WORKER_SOURCE = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(chunks.join(''));
process.env.ESBUILD_WORKER_THREADS = '0';
const { transformSync } = await import('esbuild');
const result = transformSync(payload.source, {
  loader: payload.loader,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: false,
});
process.stdout.write(result.code ?? '');
`;

export function createDefaultAdapters(root, { runCommandSync = execFileSync } = {}) {
  return {
    statFile(relativePath) {
      return fs.statSync(path.join(root, relativePath));
    },
    readWorkspaceFile(relativePath) {
      return fs.readFileSync(path.join(root, relativePath), 'utf8');
    },
    getTrackedWorktreeStatus() {
      return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: root,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
      }).trim();
    },
    readCommittedSource(relativePath) {
      return execFileSync('git', ['show', `HEAD:${relativePath}`], {
        cwd: root,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
      });
    },
    compileSource({ source, loader }) {
      const code = runCommandSync(process.execPath, ['--input-type=module', '-e', CORE_COMPILE_WORKER_SOURCE], {
        cwd: root,
        encoding: 'utf8',
        timeout: CORE_COMPILE_TIMEOUT_MS,
        input: JSON.stringify({ source, loader }),
        env: { ...process.env, ESBUILD_WORKER_THREADS: '0' },
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

function inspectTrackedWorktree(adapters) {
  try {
    return adapters.getTrackedWorktreeStatus();
  } catch (error) {
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

function readSource(relativePath, useFallback, adapters) {
  if (!useFallback) {
    try {
      return adapters.readWorkspaceFile(relativePath);
    } catch (error) {
      throw new Error(`Failed to read workspace source for ${relativePath}: ${getErrorMessage(error)}`, { cause: error });
    }
  }

  try {
    return adapters.readCommittedSource(relativePath);
  } catch (error) {
    if (error?.code === 'ETIMEDOUT') {
      const wrapped = new Error(
        `Reading committed source timed out for ${relativePath} during FileProvider fallback (git show HEAD:${relativePath}).`,
        { cause: error },
      );
      wrapped.code = 'ETIMEDOUT';
      if (error?.signal) wrapped.signal = error.signal;
      throw wrapped;
    }
    const wrapped = new Error(
      `Failed to read committed source for ${relativePath} from git show HEAD:${relativePath}: ${getErrorMessage(error)}`,
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
      if (error?.code === 'ETIMEDOUT' || !getErrorMessage(error).includes('The service was stopped')) {
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
  adapters = createDefaultAdapters(root),
} = {}) {
  const explicitFallback = env.TEAMS_FILEPROVIDER_SERVER_REUSE === '1';
  const datalessTrackedFiles = explicitFallback
    ? []
    : files.filter((relativePath) => isNonEmptyDatalessFile(statCheckedSource(relativePath, adapters)));
  const fallbackReason = explicitFallback
    ? EXPLICIT_FILEPROVIDER_FALLBACK
    : datalessTrackedFiles.length > 0
      ? DATALESS_FILEPROVIDER_FALLBACK
      : null;
  const sourceMode = fallbackReason ? 'fallback' : 'workspace';

  if (fallbackReason) {
    const trackedWorktreeStatus = inspectTrackedWorktree(adapters);
    if (trackedWorktreeStatus.length > 0) {
      throw new Error(
        'FileProvider fallback requires a clean tracked Git worktree. Commit tracked source changes before running the Core source check.',
      );
    }
  }

  for (const relativePath of files) {
    const source = readSource(relativePath, Boolean(fallbackReason), adapters);
    compileSource(relativePath, source, adapters);
  }

  return {
    checkedFileCount: files.length,
    checkedFiles: [...files],
    sourceMode,
    fallbackReason,
    datalessTrackedFiles,
  };
}
