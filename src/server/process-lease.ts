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

/**
 * Acquire one exclusive directory lease for every file-backed store.
 *
 * mkdir is used as the cross-process compare-and-swap primitive. A stale
 * lease is first atomically renamed to a quarantine name; only the process
 * winning that rename may reclaim it. Malformed or foreign-host leases are
 * never reclaimed automatically.
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
    for (const lease of this.leases) {
      try {
        fsSync.rmSync(lease.directory, { recursive: true, force: true });
      } catch {
        // A hard crash can leave a stale lease; the next owner will reclaim
        // it only after proving that this process is no longer alive.
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
  const ownerPath = path.join(directory, OWNER_FILE_NAME);

  while (true) {
    try {
      await fs.mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE });
      await fs.chmod(directory, PRIVATE_DIRECTORY_MODE);
      return await writeOwner(directory, ownerPath, preparedStorePath);
    } catch (error) {
      if (!isFileExists(error)) throw error;
      await assertLeaseDirectory(directory);
      const owner = await readOwner(ownerPath);
      if (!owner || !isDemonstrablyStale(owner)) {
        throw new Error(`file-json store is already leased by another live process: ${preparedStorePath}`);
      }

      const quarantine = `${directory}.stale-${process.pid}-${crypto.randomUUID()}`;
      try {
        // rename is atomic within the prepared parent. If another contender
        // wins the race, its ENOENT/EEXIST result is handled by retrying.
        await fs.rename(directory, quarantine);
      } catch (renameError) {
        if (isFileNotFound(renameError) || isFileExists(renameError)) continue;
        throw renameError;
      }

      await fs.rm(quarantine, { recursive: true, force: true });
    }
  }
}

async function writeOwner(directory: string, ownerPath: string, storePath: string): Promise<AcquiredLease> {
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
    return { directory, ownerPath, owner, ownerHandle };
  } catch (error) {
    await ownerHandle?.close().catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function assertLeaseDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink()) throw new Error(`store lease path must not be a symbolic link: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`store lease path is not a directory: ${directory}`);
}

async function readOwner(ownerPath: string): Promise<LeaseOwner | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(ownerPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const raw = await handle.readFile('utf8');
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
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    if (isSymlinkError(error)) throw new Error(`store lease owner must not be a symbolic link: ${ownerPath}`);
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
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
      const current = await readOwner(lease.ownerPath);
      if (current?.token === lease.owner.token) {
        await fs.rm(lease.directory, { recursive: true, force: true });
      }
    } catch {
      // Preserve the original shutdown path; a stale lease remains reclaimable
      // only after the owner PID is proven dead.
    }
  }
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
