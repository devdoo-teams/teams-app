import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prepareAtomicJsonStore, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from './atomic-file.js';

const LEASE_DIRECTORY_SUFFIX = 'teams-sdk-store-lease';
const OWNER_FILE_NAME = 'owner.json';

type LeaseOwner = {
  version: 1;
  pid: number;
  hostname: string;
  token: string;
  storePath: string;
  startedAt: string;
};

type AcquiredLease = {
  directory: string;
  ownerPath: string;
  owner: LeaseOwner;
  ownerHandle: fs.FileHandle;
};

type StagedLease = AcquiredLease;

/**
 * Acquire one exclusive directory lease for every file-backed store.
 *
 * A unique private sibling directory is fully initialized first. Renaming it
 * to the final path is the cross-process compare-and-swap primitive. A stale
 * final lease may be reclaimed only after a valid same-host owner is proven
 * dead. Foreign-host and malformed owners fail closed by design.
 *
 * PID liveness is necessarily subject to PID reuse, so a stale owner is only
 * reclaimed when it is on this host and its PID is demonstrably absent. A
 * foreign-host owner is never judged from this process and must be cleared by
 * its owning host/operator.
 */
export async function acquireStoreProcessLease(storePaths: string[]): Promise<StoreProcessLease> {
  const resolvedPaths = [...new Set(storePaths.map((storePath) => path.resolve(storePath)))].sort();
  const acquired: AcquiredLease[] = [];

  try {
    for (const storePath of resolvedPaths) {
      acquired.push(await acquireOne(storePath));
    }
    return new StoreProcessLease(acquired);
  } catch (error) {
    await releaseLeases(acquired);
    throw error;
  }
}

export class StoreProcessLease {
  private released = false;

  constructor(private readonly leases: AcquiredLease[]) {}

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await releaseLeases(this.leases);
  }

  /** Best-effort synchronous cleanup for process exit after an uncaught failure. */
  releaseSync(): void {
    if (this.released) return;
    this.released = true;

    for (const lease of [...this.leases].reverse()) {
      try {
        // File descriptors do not prevent directory rename on the supported
        // Unix hosts. The synchronous path intentionally uses only sync fs
        // operations because it is called from process exit handlers.
        releaseOneSync(lease);
      } catch {
        // A hard crash can leave a stale lease; the next owner will reclaim it
        // only after this process PID is proven absent.
      }
    }
  }
}

async function acquireOne(storePath: string): Promise<AcquiredLease> {
  // This prepares and validates the store's real parent before the lease is
  // created. It does not initialize or write the store contents.
  const preparedStorePath = await prepareAtomicJsonStore(storePath);
  const parent = path.dirname(preparedStorePath);
  const baseName = path.basename(preparedStorePath);
  const directory = path.join(parent, `.${baseName}.${LEASE_DIRECTORY_SUFFIX}`);

  while (true) {
    let staged: StagedLease | undefined;
    let committed = false;

    try {
      staged = await createStagedLease(parent, preparedStorePath);
      await fs.rename(staged.directory, directory);
      committed = true;
      await syncDirectory(parent);

      return {
        ...staged,
        directory,
        ownerPath: path.join(directory, OWNER_FILE_NAME),
      };
    } catch (error) {
      if (committed) throw error;
      if (staged) await abandonStagedLease(staged);
      if (!isTargetExists(error)) throw error;

      const result = await tryReclaimStaleLease(directory, preparedStorePath);
      if (result === 'retry') continue;
      if (result === 'reclaimed') continue;
      throw leaseConflict(preparedStorePath);
    }
  }
}

async function createStagedLease(parent: string, storePath: string): Promise<StagedLease> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const directory = path.join(
      parent,
      `.${path.basename(storePath)}.${LEASE_DIRECTORY_SUFFIX}.staging-${process.pid}-${crypto.randomUUID()}`,
    );

    try {
      await fs.mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE });
      await fs.chmod(directory, PRIVATE_DIRECTORY_MODE);
      await assertLeaseDirectory(directory);
      return await writeOwner(directory, path.join(directory, OWNER_FILE_NAME), storePath);
    } catch (error) {
      if (isFileExists(error) && attempt < 7) continue;
      throw error;
    }
  }

  throw new Error(`Unable to create a unique staging directory for store: ${storePath}`);
}

async function writeOwner(directory: string, ownerPath: string, storePath: string): Promise<StagedLease> {
  const owner: LeaseOwner = {
    version: 1,
    pid: process.pid,
    hostname: os.hostname(),
    token: crypto.randomUUID(),
    storePath,
    startedAt: new Date().toISOString(),
  };

  let ownerHandle: fs.FileHandle | undefined;
  try {
    ownerHandle = await fs.open(
      ownerPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      PRIVATE_FILE_MODE,
    );
    await ownerHandle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
    await ownerHandle.sync();
    await ownerHandle.chmod(PRIVATE_FILE_MODE);
    await ownerHandle.sync();
    await syncDirectory(directory);
    return { directory, ownerPath, owner, ownerHandle };
  } catch (error) {
    await ownerHandle?.close().catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function abandonStagedLease(staged: StagedLease): Promise<void> {
  try {
    await staged.ownerHandle.close();
  } catch {
    // Preserve the acquisition error.
  }
  await fs.rm(staged.directory, { recursive: true, force: true }).catch(() => undefined);
}

async function tryReclaimStaleLease(
  directory: string,
  storePath: string,
): Promise<'retry' | 'reclaimed' | 'conflict'> {
  try {
    await assertLeaseDirectory(directory);
  } catch (error) {
    if (isFileNotFound(error)) return 'retry';
    throw error;
  }

  const ownerPath = path.join(directory, OWNER_FILE_NAME);
  const observed = await readOwner(ownerPath);
  if (!observed || observed.storePath !== storePath || !isDemonstrablyStale(observed)) {
    return 'conflict';
  }

  const quarantine = uniqueQuarantinePath(directory, 'stale');
  try {
    await fs.rename(directory, quarantine);
  } catch (error) {
    if (isFileNotFound(error)) return 'retry';
    if (isTargetExists(error)) return 'retry';
    throw error;
  }

  const quarantinedOwner = await readOwner(path.join(quarantine, OWNER_FILE_NAME));
  if (
    quarantinedOwner?.token === observed.token
    && quarantinedOwner.storePath === storePath
    && isDemonstrablyStale(quarantinedOwner)
  ) {
    await fs.rm(quarantine, { recursive: true, force: true });
    await syncDirectory(path.dirname(directory));
    return 'reclaimed';
  }

  await restoreQuarantine(directory, quarantine);
  return 'conflict';
}

async function assertLeaseDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink()) throw new Error(`store lease path must not be a symbolic link: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`store lease path is not a directory: ${directory}`);
}

async function readOwner(ownerPath: string): Promise<LeaseOwner | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    const linkStat = await fs.lstat(ownerPath);
    if (linkStat.isSymbolicLink()) {
      throw new Error(`store lease owner must not be a symbolic link: ${ownerPath}`);
    }
    if (!linkStat.isFile()) return undefined;

    handle = await fs.open(ownerPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const raw = await handle.readFile('utf8');
    return parseOwner(raw);
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    if (isSymlinkError(error)) throw new Error(`store lease owner must not be a symbolic link: ${ownerPath}`);
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseOwner(raw: string): LeaseOwner | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<LeaseOwner>;
    if (
      parsed.version !== 1
      || typeof parsed.pid !== 'number'
      || !Number.isSafeInteger(parsed.pid)
      || parsed.pid <= 0
      || typeof parsed.hostname !== 'string'
      || !parsed.hostname
      || typeof parsed.token !== 'string'
      || !parsed.token
      || typeof parsed.storePath !== 'string'
      || !parsed.storePath
      || typeof parsed.startedAt !== 'string'
      || !parsed.startedAt
    ) {
      return undefined;
    }
    return parsed as LeaseOwner;
  } catch {
    return undefined;
  }
}

function isDemonstrablyStale(owner: LeaseOwner): boolean {
  // A lease created on another host cannot be safely judged from this host.
  if (owner.hostname !== os.hostname()) return false;

  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === 'ESRCH';
  }
}

async function releaseLeases(leases: AcquiredLease[]): Promise<void> {
  for (const lease of [...leases].reverse()) {
    try {
      await lease.ownerHandle.close();
    } catch {
      // The descriptor may already have been closed during shutdown.
    }
    try {
      await releaseOne(lease);
    } catch {
      // Preserve the original shutdown path. An unverified quarantine is left
      // in place and is never recursively deleted by this release attempt.
    }
  }
}

async function releaseOne(lease: AcquiredLease): Promise<void> {
  await assertLeaseDirectory(lease.directory);
  const quarantine = uniqueQuarantinePath(lease.directory, 'release');
  try {
    await fs.rename(lease.directory, quarantine);
  } catch (error) {
    if (isFileNotFound(error)) return;
    throw error;
  }

  let current: LeaseOwner | undefined;
  try {
    current = await readOwner(path.join(quarantine, OWNER_FILE_NAME));
  } catch {
    // A symlinked or otherwise unreadable owner is unverified and must be
    // preserved, just like malformed JSON or a token mismatch.
    await restoreQuarantine(lease.directory, quarantine);
    return;
  }
  if (current?.token === lease.owner.token && current.storePath === lease.owner.storePath) {
    await fs.rm(quarantine, { recursive: true, force: true });
    await syncDirectory(path.dirname(lease.directory));
    return;
  }

  await restoreQuarantine(lease.directory, quarantine);
}

function releaseOneSync(lease: AcquiredLease): void {
  assertLeaseDirectorySync(lease.directory);
  const quarantine = uniqueQuarantinePath(lease.directory, 'release');
  try {
    fsSync.renameSync(lease.directory, quarantine);
  } catch (error) {
    if (isFileNotFound(error)) return;
    throw error;
  }

  let current: LeaseOwner | undefined;
  try {
    current = readOwnerSync(path.join(quarantine, OWNER_FILE_NAME));
  } catch {
    restoreQuarantineSync(lease.directory, quarantine);
    return;
  }
  if (current?.token === lease.owner.token && current.storePath === lease.owner.storePath) {
    fsSync.rmSync(quarantine, { recursive: true, force: true });
    syncDirectorySync(path.dirname(lease.directory));
    return;
  }

  restoreQuarantineSync(lease.directory, quarantine);
}

async function restoreQuarantine(directory: string, quarantine: string): Promise<void> {
  try {
    const target = await lstatIfExists(directory);
    if (target) return;
    await fs.rename(quarantine, directory);
    await syncDirectory(path.dirname(directory));
  } catch {
    // If another process now owns the final path, leave quarantine intact so
    // the unverified directory cannot be deleted by this release attempt.
  }
}

function restoreQuarantineSync(directory: string, quarantine: string): void {
  try {
    if (lstatIfExistsSync(directory)) return;
    fsSync.renameSync(quarantine, directory);
    syncDirectorySync(path.dirname(directory));
  } catch {
    // Preserve an unverified quarantine when restoration loses its CAS race.
  }
}

function readOwnerSync(ownerPath: string): LeaseOwner | undefined {
  let descriptor: number | undefined;
  try {
    const linkStat = fsSync.lstatSync(ownerPath);
    if (linkStat.isSymbolicLink()) {
      throw new Error(`store lease owner must not be a symbolic link: ${ownerPath}`);
    }
    if (!linkStat.isFile()) return undefined;

    descriptor = fsSync.openSync(ownerPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    return parseOwner(fsSync.readFileSync(descriptor, 'utf8'));
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    if (isSymlinkError(error)) throw new Error(`store lease owner must not be a symbolic link: ${ownerPath}`);
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      try {
        fsSync.closeSync(descriptor);
      } catch {
        // Preserve the parsed owner or original filesystem error.
      }
    }
  }
}

function assertLeaseDirectorySync(directory: string): void {
  const stat = fsSync.lstatSync(directory);
  if (stat.isSymbolicLink()) throw new Error(`store lease path must not be a symbolic link: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`store lease path is not a directory: ${directory}`);
}

function uniqueQuarantinePath(directory: string, reason: string): string {
  return `${directory}.${reason}-${process.pid}-${crypto.randomUUID()}`;
}

async function lstatIfExists(targetPath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
}

function lstatIfExistsSync(targetPath: string): fsSync.Stats | undefined {
  try {
    return fsSync.lstatSync(targetPath);
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, fsConstants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is not available on every platform/filesystem.
  }
}

function syncDirectorySync(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fsSync.openSync(directory, fsConstants.O_RDONLY);
    fsSync.fsyncSync(descriptor);
  } catch {
    // Directory fsync is not available on every platform/filesystem.
  } finally {
    if (descriptor !== undefined) {
      try {
        fsSync.closeSync(descriptor);
      } catch {
        // Best effort only.
      }
    }
  }
}

function leaseConflict(storePath: string): Error {
  return new Error(`file-json store is already leased by another live process: ${storePath}`);
}

function isTargetExists(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY' || error.code === 'ENOTDIR'),
  );
}

function isFileExists(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isSymlinkError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ELOOP');
}
