import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { acquireStoreProcessLease } from '../src/server/process-lease.js';

type Owner = {
  version: 1;
  pid: number;
  hostname: string;
  token: string;
  storePath: string;
  startedAt: string;
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-lease-hardening-'));
const storePath = path.join(root, 'items.json');
const leaseDirectory = path.join(root, '.items.json.teams-sdk-store-lease');
const stagingPrefix = `${leaseDirectory}.staging-`;

function owner(overrides: Partial<Owner> = {}): Owner {
  return {
    version: 1,
    pid: process.pid,
    hostname: os.hostname(),
    token: `token-${Math.random().toString(36).slice(2)}`,
    storePath,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function writeOwnerDirectory(directory: string, value: Owner | string): Promise<void> {
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(
    path.join(directory, 'owner.json'),
    typeof value === 'string' ? value : `${JSON.stringify(value)}\n`,
    { mode: 0o600 },
  );
}

async function readOwnerToken(directory = leaseDirectory): Promise<string> {
  const parsed = JSON.parse(await fs.readFile(path.join(directory, 'owner.json'), 'utf8')) as Owner;
  return parsed.token;
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = child.pid;
  assert.ok(pid, 'child process must have a pid');
  await once(child, 'exit');
  return pid;
}

async function removeLeaseDirectory(): Promise<void> {
  await fs.rm(leaseDirectory, { recursive: true, force: true });
}

async function assertNoStagingDirectories(): Promise<void> {
  const entries = await fs.readdir(root);
  assert.deepEqual(entries.filter((entry) => path.join(root, entry).startsWith(stagingPrefix)), []);
}

async function testLiveConflict(): Promise<void> {
  const lease = await acquireStoreProcessLease([storePath]);
  await assert.rejects(
    acquireStoreProcessLease([storePath]),
    /already leased by another live process/,
  );
  await lease.release();
}

async function testAbandonedStagingDoesNotBlock(): Promise<void> {
  const abandoned = `${stagingPrefix}abandoned`;
  await writeOwnerDirectory(abandoned, owner());

  const lease = await acquireStoreProcessLease([storePath]);
  await lease.release();

  assert.equal(await fs.stat(abandoned).then(() => true, () => false), true);
  await fs.rm(abandoned, { recursive: true, force: true });
}

async function testDeadStaleReclaim(): Promise<void> {
  const stalePid = await deadPid();
  await writeOwnerDirectory(leaseDirectory, owner({ pid: stalePid }));

  const lease = await acquireStoreProcessLease([storePath]);
  await lease.release();
}

async function testMalformedFinalFailsClosed(): Promise<void> {
  await writeOwnerDirectory(leaseDirectory, '{"version":1,"pid":');

  await assert.rejects(
    acquireStoreProcessLease([storePath]),
    /already leased by another live process/,
  );
  assert.equal(await fs.stat(leaseDirectory).then(() => true, () => false), true);

  await removeLeaseDirectory();
  const abandoned = `${stagingPrefix}after-malformed`;
  await writeOwnerDirectory(abandoned, owner());
  const lease = await acquireStoreProcessLease([storePath]);
  await lease.release();
  await fs.rm(abandoned, { recursive: true, force: true });
}

async function testTokenMismatchReplacementPreserved(): Promise<void> {
  const lease = await acquireStoreProcessLease([storePath]);
  const displaced = path.join(root, '.displaced-lease');
  await fs.rename(leaseDirectory, displaced);
  const replacement = owner({ token: 'replacement-token' });
  await writeOwnerDirectory(leaseDirectory, replacement);

  await lease.release();

  assert.equal(await readOwnerToken(), replacement.token);
  await fs.rm(displaced, { recursive: true, force: true });
  await removeLeaseDirectory();
}

async function testTokenMismatchReplacementPreservedSync(): Promise<void> {
  const lease = await acquireStoreProcessLease([storePath]);
  const displaced = path.join(root, '.displaced-sync-lease');
  await fs.rename(leaseDirectory, displaced);
  const replacement = owner({ token: 'replacement-sync-token' });
  await writeOwnerDirectory(leaseDirectory, replacement);

  lease.releaseSync();

  assert.equal(await readOwnerToken(), replacement.token);
  await fs.rm(displaced, { recursive: true, force: true });
  await removeLeaseDirectory();
}

async function testSymlinkRejected(): Promise<void> {
  await fs.symlink(root, leaseDirectory, 'dir');
  await assert.rejects(
    acquireStoreProcessLease([storePath]),
    /symbolic link/,
  );
  const stat = await fs.lstat(leaseDirectory);
  assert.equal(stat.isSymbolicLink(), true);
  await fs.unlink(leaseDirectory);
  await assertNoStagingDirectories();
}

try {
  await testLiveConflict();
  await testAbandonedStagingDoesNotBlock();
  await testDeadStaleReclaim();
  await testMalformedFinalFailsClosed();
  await testTokenMismatchReplacementPreserved();
  await testTokenMismatchReplacementPreservedSync();
  await testSymlinkRejected();
  console.log('process lease hardening tests passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
  assert.equal(fsSync.existsSync(root), false);
}
