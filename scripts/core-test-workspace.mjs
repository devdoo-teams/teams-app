import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertCleanTrackedWorktreeForFileProvider,
  isFullCommitOid,
  resolvePinnedCommitOid,
} from './fileprovider-git-clean.mjs';

const GIT_INSPECTION_TIMEOUT_MS = 10_000;
const MATERIALIZATION_TIMEOUT_MS = 30_000;
const TEMP_DIRECTORY_PREFIX = 'teams-core-tests-';
const CLEANUP_ATTEMPTS = 3;
const MAX_ARCHIVE_ENTRIES = 100_000;
const ROOT_INPUTS = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
]);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isCoreTestInput(relativePath) {
  return (
    relativePath.startsWith('src/') ||
    relativePath.startsWith('scripts/') ||
    relativePath.startsWith('types/') ||
    ROOT_INPUTS.has(relativePath)
  );
}

function isNonEmptyDatalessFile(metadata) {
  return Boolean(metadata?.size > 0 && Number.isInteger(metadata.blocks) && metadata.blocks === 0);
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function inspectOwnedPath(root, relativePath, { kind = 'source', requireDirectory = false } = {}) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${kind} path must be relative: ${relativePath}`);
  }

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  if (!isPathInside(resolvedRoot, candidate)) {
    throw new Error(`${kind} path escapes the owned source root: ${relativePath}`);
  }

  const metadata = fs.lstatSync(candidate);
  if (metadata.isSymbolicLink()) {
    throw new Error(`${kind} must not be a symbolic link: ${candidate}`);
  }
  if (requireDirectory ? !metadata.isDirectory() : !metadata.isFile()) {
    throw new Error(`${kind} has an unexpected file type: ${candidate}`);
  }

  const realRoot = fs.realpathSync(resolvedRoot);
  const realCandidate = fs.realpathSync(candidate);
  if (!isPathInside(realRoot, realCandidate)) {
    throw new Error(`${kind} realpath escapes the owned source root: ${candidate}`);
  }

  return { metadata, realPath: realCandidate, rootRealPath: realRoot };
}

function sourceIoError(operation, error) {
  const wrapped = new Error(
    `SOURCE_IO_UNSTABLE: ${operation} failed while materializing a pinned clean Git commit for Core TypeScript tests: ${errorMessage(error)}`,
    { cause: error },
  );
  wrapped.code = 'SOURCE_IO_UNSTABLE';
  if (error?.signal) wrapped.signal = error.signal;
  return wrapped;
}

function assertOwnedTempDirectory(tempDirectory) {
  const resolved = path.resolve(tempDirectory);
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith(TEMP_DIRECTORY_PREFIX)) {
    throw new Error(`Refusing to remove an unowned Core test directory: ${resolved}`);
  }
  return resolved;
}

function validateMaterializedArchiveClosure(tempDirectory, trackedInputs, commitOid) {
  if (!isFullCommitOid(commitOid)) {
    throw new Error(`Materialized source validation requires a full pinned commit OID, got: ${commitOid ?? '<missing>'}`);
  }
  const resolvedRoot = path.resolve(tempDirectory);
  const rootMetadata = fs.lstatSync(resolvedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`Materialized archive root must be a real directory: ${resolvedRoot}`);
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  let visitedEntries = 0;
  const visitedRelativePaths = new Set();

  const assertInsideArchive = (candidate, label) => {
    if (!isPathInside(resolvedRoot, candidate)) {
      throw new Error(`${label} escapes the owned archive root: ${candidate}`);
    }
  };

  const visit = (candidate) => {
    visitedEntries += 1;
    if (visitedEntries > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`Materialized archive exceeds the ${MAX_ARCHIVE_ENTRIES} entry safety limit`);
    }
    assertInsideArchive(candidate, 'Materialized archive entry');
    const relativeEntry = path.relative(resolvedRoot, candidate);
    if (!relativeEntry || relativeEntry.startsWith(`..${path.sep}`) || path.isAbsolute(relativeEntry)) {
      throw new Error(`Materialized archive entry has an invalid owned-root path: ${candidate}`);
    }
    const normalizedEntry = relativeEntry.split(path.sep).join('/');
    if (visitedRelativePaths.has(normalizedEntry)) {
      throw new Error(`Materialized archive entry was visited more than once: ${normalizedEntry}`);
    }
    visitedRelativePaths.add(normalizedEntry);
    const metadata = fs.lstatSync(candidate);
    if (metadata.isSymbolicLink()) {
      const target = fs.readlinkSync(candidate);
      if (path.isAbsolute(target)) {
        throw new Error(`Materialized archive symlink must be relative to the owned archive root: ${candidate}`);
      }
      const lexicalTarget = path.resolve(path.dirname(candidate), target);
      assertInsideArchive(lexicalTarget, 'Materialized archive symlink target');
      let realTarget;
      try {
        realTarget = fs.realpathSync(candidate);
      } catch (error) {
        throw new Error(`Materialized archive symlink target is missing or cyclic: ${candidate}`, { cause: error });
      }
      if (!isPathInside(realRoot, realTarget)) {
        throw new Error(`Materialized archive symlink target escapes the owned archive root: ${candidate}`);
      }
      const targetMetadata = fs.statSync(candidate);
      if (!targetMetadata.isFile() && !targetMetadata.isDirectory()) {
        throw new Error(`Materialized archive symlink has an unsupported target type: ${candidate}`);
      }
      return;
    }
    if (metadata.isDirectory()) {
      const realDirectory = fs.realpathSync(candidate);
      if (!isPathInside(realRoot, realDirectory)) {
        throw new Error(`Materialized archive directory escapes the owned archive root: ${candidate}`);
      }
      for (const name of fs.readdirSync(candidate).sort()) visit(path.join(candidate, name));
      return;
    }
    if (!metadata.isFile()) {
      throw new Error(`Materialized archive contains an unsupported file type: ${candidate}`);
    }
    const realFile = fs.realpathSync(candidate);
    if (!isPathInside(realRoot, realFile)) {
      throw new Error(`Materialized archive file escapes the owned archive root: ${candidate}`);
    }
  };

  for (const name of fs.readdirSync(resolvedRoot).sort()) visit(path.join(resolvedRoot, name));
  for (const relativePath of trackedInputs) {
    if (path.isAbsolute(relativePath)) {
      throw new Error(`Tracked archive path must be relative: ${relativePath}`);
    }
    const candidate = path.resolve(resolvedRoot, relativePath);
    assertInsideArchive(candidate, 'Tracked archive path');
    const normalizedTrackedPath = path.relative(resolvedRoot, candidate).split(path.sep).join('/');
    if (!visitedRelativePaths.has(normalizedTrackedPath)) {
      throw new Error(`Tracked archive path was not present in the complete archive closure: ${relativePath}`);
    }
  }
  return { visitedEntries, trackedEntryCount: trackedInputs.length };
}

export function createDefaultCoreTestWorkspaceAdapters(
  root,
  { runCommandSync = execFileSync, env = process.env } = {},
) {
  return {
    resolvePinnedCommitOid() {
      return resolvePinnedCommitOid(root, {
        runCommandSync,
        timeoutMs: GIT_INSPECTION_TIMEOUT_MS,
        env,
      });
    },
    listTrackedInputs(commitOid) {
      if (!isFullCommitOid(commitOid)) {
        throw new Error(`Tracked input listing requires a full pinned commit OID, got: ${commitOid ?? '<missing>'}`);
      }
      const output = runCommandSync('git', ['ls-tree', '-r', '--name-only', '-z', commitOid, '--'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
        timeout: GIT_INSPECTION_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
      return output.split('\0').filter(Boolean);
    },
    statFile(relativePath) {
      return inspectOwnedPath(root, relativePath, { kind: 'Tracked Core source' }).metadata;
    },
    assertCleanTrackedWorktree(commitOid) {
      return assertCleanTrackedWorktreeForFileProvider(root, {
        runCommandSync,
        timeoutMs: GIT_INSPECTION_TIMEOUT_MS,
        env,
        commitOid,
      });
    },
    createTempDirectory() {
      return fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIRECTORY_PREFIX));
    },
    archiveCommit({ archivePath, commitOid }) {
      if (!isFullCommitOid(commitOid)) {
        throw new Error(`Core test archive requires a full pinned commit OID, got: ${commitOid ?? '<missing>'}`);
      }
      runCommandSync('git', ['archive', '--format=tar', '--output', archivePath, commitOid], {
        cwd: root,
        encoding: 'utf8',
        env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
        timeout: MATERIALIZATION_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
    },
    extractArchive({ archivePath, tempDirectory }) {
      runCommandSync('tar', ['-xf', archivePath, '-C', tempDirectory], {
        cwd: tempDirectory,
        encoding: 'utf8',
        env,
        timeout: MATERIALIZATION_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
      fs.rmSync(archivePath, { force: true });
    },
    validateMaterializedArchive({ tempDirectory, trackedInputs, commitOid }) {
      return validateMaterializedArchiveClosure(tempDirectory, trackedInputs, commitOid);
    },
    linkNodeModules({ tempDirectory }) {
      const dependency = inspectOwnedPath(root, 'node_modules', {
        kind: 'Core test node_modules',
        requireDirectory: true,
      });
      const ownedRoot = fs.realpathSync(path.resolve(root));
      const expectedDependencyPath = path.join(ownedRoot, 'node_modules');
      if (dependency.realPath !== expectedDependencyPath) {
        throw new Error(
          `Core test node_modules must be an owned, non-symlink directory at ${expectedDependencyPath}; got ${dependency.realPath}`,
        );
      }

      const ownedTempDirectory = assertOwnedTempDirectory(tempDirectory);
      const tempMetadata = fs.lstatSync(ownedTempDirectory);
      if (tempMetadata.isSymbolicLink() || !tempMetadata.isDirectory()) {
        throw new Error(`Core test destination must be an owned real directory: ${ownedTempDirectory}`);
      }
      const destination = path.join(ownedTempDirectory, 'node_modules');
      if (fs.existsSync(destination)) {
        throw new Error(`Core test node_modules destination already exists: ${destination}`);
      }
      fs.symlinkSync(dependency.realPath, destination, 'dir');
      return { dependencyRealPath: dependency.realPath };
    },
    removeTempDirectory(tempDirectory) {
      fs.rmSync(assertOwnedTempDirectory(tempDirectory), { recursive: true, force: true });
    },
  };
}

export function resolveCoreTestWorkspace({
  root = process.cwd(),
  commitOid = process.env.TEAMS_SOURCE_COMMIT,
  adapters = createDefaultCoreTestWorkspaceAdapters(root),
} = {}) {
  const pinnedCommitOid = commitOid ?? adapters.resolvePinnedCommitOid();
  if (!isFullCommitOid(pinnedCommitOid)) {
    const error = new Error(`Core test workspace requires a full pinned commit OID, got: ${pinnedCommitOid ?? '<missing>'}`);
    error.code = 'SOURCE_IO_UNSTABLE';
    throw error;
  }
  const verification = adapters.assertCleanTrackedWorktree(pinnedCommitOid);
  if (!verification || !isFullCommitOid(verification.commitOid)) {
    const error = new Error('Clean-worktree verification did not return a full pinned commit OID.');
    error.code = 'SOURCE_IO_UNSTABLE';
    throw error;
  }
  if (verification.commitOid !== pinnedCommitOid) {
    const error = new Error(
      `Clean-worktree verification changed the pinned commit OID from ${pinnedCommitOid} to ${verification.commitOid}`,
    );
    error.code = 'SOURCE_IO_UNSTABLE';
    throw error;
  }

  let trackedInputs;
  try {
    trackedInputs = adapters.listTrackedInputs(verification.commitOid);
  } catch (error) {
    throw sourceIoError(`git ls-tree ${verification.commitOid}`, error);
  }

  const coreTrackedInputs = trackedInputs.filter(isCoreTestInput);

  const datalessTrackedFiles = [];
  for (const relativePath of coreTrackedInputs) {
    let metadata;
    try {
      metadata = adapters.statFile(relativePath);
    } catch (error) {
      throw sourceIoError(`stat ${relativePath}`, error);
    }
    if (isNonEmptyDatalessFile(metadata)) datalessTrackedFiles.push(relativePath);
  }

  let tempDirectory;
  let cleaned = false;
  const cleanup = () => {
    if (!tempDirectory || cleaned) return;
    let lastError;
    for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt += 1) {
      try {
        adapters.removeTempDirectory(tempDirectory);
        cleaned = true;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw sourceIoError(`temporary workspace cleanup after ${CLEANUP_ATTEMPTS} attempts`, lastError);
  };

  try {
    tempDirectory = adapters.createTempDirectory();
    const archivePath = path.join(tempDirectory, 'source.tar');
    try {
      adapters.archiveCommit({
        root,
        archivePath,
        tempDirectory,
        commitOid: verification.commitOid,
      });
    } catch (error) {
      throw sourceIoError(`git archive ${verification.commitOid}`, error);
    }
    try {
      adapters.extractArchive({ archivePath, tempDirectory });
    } catch (error) {
      throw sourceIoError('tar extraction', error);
    }
    try {
      adapters.validateMaterializedArchive({
        root,
        tempDirectory,
        trackedInputs,
        commitOid: verification.commitOid,
      });
    } catch (error) {
      throw sourceIoError(`materialized source validation at ${verification.commitOid}`, error);
    }
    try {
      adapters.linkNodeModules({ root, tempDirectory });
    } catch (error) {
      throw sourceIoError('node_modules link', error);
    }
  } catch (error) {
    try {
      cleanup();
    } catch (cleanupError) {
      const combined = new AggregateError(
        [error, cleanupError],
        `${errorMessage(error)}; additionally failed to clean the temporary workspace: ${errorMessage(cleanupError)}`,
      );
      combined.cause = error;
      combined.code = 'SOURCE_IO_UNSTABLE';
      throw combined;
    }
    throw error;
  }

  return {
    cwd: tempDirectory,
    sourceMode: 'git-commit-materialized',
    verificationMode: verification.verificationMode,
    commitOid: verification.commitOid,
    datalessTrackedFiles,
    cleanup,
  };
}
