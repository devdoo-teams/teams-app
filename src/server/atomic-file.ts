import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** Prepare a private JSON store directory and normalize an existing file. */
export async function prepareAtomicJsonStore(filePath: string): Promise<string> {
  const resolvedFilePath = path.resolve(filePath);
  const directory = path.dirname(resolvedFilePath);
  const safetyAnchor = rejectBroadParent(directory);

  const parentExists = await inspectParentPath(directory, safetyAnchor);

  // Inspect the final path before chmodding the parent so a symlink store is
  // rejected without changing either its target or surrounding permissions.
  const existingFile = parentExists ? await lstatIfExists(resolvedFilePath) : undefined;
  if (existingFile?.isSymbolicLink()) throw symlinkError(resolvedFilePath);
  if (existingFile && !existingFile.isFile()) {
    throw new Error(`JSON store path is not a regular file: ${resolvedFilePath}`);
  }

  await ensureParentPath(directory, safetyAnchor);
  await fs.chmod(directory, PRIVATE_DIRECTORY_MODE);

  const preparedFile = await lstatIfExists(resolvedFilePath);
  if (preparedFile?.isSymbolicLink()) throw symlinkError(resolvedFilePath);
  if (preparedFile) {
    if (!preparedFile.isFile()) throw new Error(`JSON store path is not a regular file: ${resolvedFilePath}`);
    await fs.chmod(resolvedFilePath, PRIVATE_FILE_MODE);
  }

  return resolvedFilePath;
}

/** Read an initialized store without following a symlink in the final path. */
export async function readAtomicJsonStore(filePath: string): Promise<string> {
  const resolvedFilePath = await prepareAtomicJsonStore(filePath);
  const handle = await fs.open(
    resolvedFilePath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`JSON store path is not a regular file: ${resolvedFilePath}`);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/** Persist JSON through an exclusive same-directory temp file and atomic rename. */
export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const resolvedFilePath = await prepareAtomicJsonStore(filePath);

  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new Error(`Cannot serialize JSON store: ${resolvedFilePath}`);

  const directory = path.dirname(resolvedFilePath);
  const baseName = path.basename(resolvedFilePath);
  let temporaryPath: string | undefined;
  let handle: fs.FileHandle | undefined;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = path.join(directory, `.${baseName}.${process.pid}-${crypto.randomUUID()}.tmp`);
    try {
      handle = await fs.open(candidate, 'wx', PRIVATE_FILE_MODE);
      await handle.chmod(PRIVATE_FILE_MODE);
      temporaryPath = candidate;
      break;
    } catch (error) {
      if (!isFileExists(error) || attempt === 4) throw error;
    }
  }

  if (!handle || !temporaryPath) throw new Error(`Unable to create temporary JSON store: ${resolvedFilePath}`);

  try {
    await handle.writeFile(`${serialized}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, resolvedFilePath);
    temporaryPath = undefined;
    await syncDirectory(directory);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the original write error.
    }
    if (temporaryPath) {
      try {
        await fs.rm(temporaryPath, { force: true });
      } catch {
        // Best-effort cleanup; preserve the original write error.
      }
    }
    throw error;
  }
}

function rejectBroadParent(directory: string): string {
  const broadParents = [...new Set([
    path.parse(directory).root,
    path.resolve(os.tmpdir()),
    path.resolve(process.cwd()),
    path.resolve(os.homedir()),
  ])];
  if (broadParents.includes(directory)) {
    throw new Error(`Unsafe broad JSON store parent directory: ${directory}`);
  }

  // The longest matching broad path is a trusted anchor that is never chmodded.
  // Every dedicated component beneath it is inspected with lstat so a nested
  // parent symlink cannot redirect chmod/read/write to another target.
  return broadParents
    .filter((candidate) => isWithin(directory, candidate))
    .sort((left, right) => right.length - left.length)[0] ?? path.parse(directory).root;
}

async function inspectParentPath(directory: string, anchor: string): Promise<boolean> {
  let current = anchor;
  for (const component of path.relative(anchor, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await lstatIfExists(current);
    if (!stat) return false;
    assertDirectoryWithoutSymlink(current, stat);
  }
  return true;
}

async function ensureParentPath(directory: string, anchor: string): Promise<void> {
  let current = anchor;
  for (const component of path.relative(anchor, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat = await lstatIfExists(current);
    if (!stat) {
      try {
        await fs.mkdir(current, { mode: PRIVATE_DIRECTORY_MODE });
      } catch (error) {
        if (!isFileExists(error)) throw error;
      }
      stat = await fs.lstat(current);
    }
    assertDirectoryWithoutSymlink(current, stat);
  }
}

function assertDirectoryWithoutSymlink(
  directory: string,
  stat: Awaited<ReturnType<typeof fs.lstat>>,
): void {
  if (stat.isSymbolicLink()) throw symlinkError(directory);
  if (!stat.isDirectory()) throw new Error(`JSON store parent is not a directory: ${directory}`);
}

function isWithin(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function lstatIfExists(targetPath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
}

function symlinkError(targetPath: string): Error {
  return new Error(`JSON store path must not be a symbolic link: ${targetPath}`);
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is not available on every platform/filesystem.
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isFileExists(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
