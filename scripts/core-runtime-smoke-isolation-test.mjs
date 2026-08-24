import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { runProcessWithTimeout } from './core-test-runner.mjs';

const root = await fs.realpath(process.cwd());
const defaultStorePath = path.join(root, 'data', 'a2a.json');
const leaseDirectory = path.join(path.dirname(defaultStorePath), '.a2a.json.teams-sdk-store-lease');
const ownerPath = path.join(leaseDirectory, 'owner.json');
const holderModule = path.join(root, 'src/server/process-lease.ts');
const HOLDER_READY_TIMEOUT_MS = 10_000;
const HOLDER_TERMINATION_GRACE_MS = 1_000;
const HOLDER_REAP_TIMEOUT_MS = 3_000;
const SMOKE_TIMEOUT_MS = 60_000;
const SMOKE_TERMINATION_GRACE_MS = 1_000;
const SMOKE_REAP_TIMEOUT_MS = 3_000;

async function listSmokeTempDirectories() {
  return (await fs.readdir(root))
    .filter((entry) => entry.startsWith('.teams-core-runtime-'))
    .sort();
}

const tempDirectoriesBeforeSetupFailure = await listSmokeTempDirectories();
let setupFailureOutput = '';
await assert.rejects(
  runProcessWithTimeout(process.execPath, ['scripts/core-runtime-smoke.mjs'], {
    cwd: root,
    env: { ...process.env, TEAMS_TEST_CORE_RUNTIME_SMOKE_FAIL_AFTER_MKDTEMP: 'true' },
    timeoutMs: 10_000,
    terminationGraceMs: 1_000,
    reapTimeoutMs: 3_000,
  }),
  (error) => {
    setupFailureOutput = `${error?.stdout ?? ''}${error?.stderr ?? ''}`;
    assert.equal(error?.code, 'ETESTFAILED');
    assert.match(setupFailureOutput, /SMOKE_SETUP_TEMP_DIR=(.+)/);
    assert.match(setupFailureOutput, /SMOKE_SETUP_CLEANUP=removed/);
    return true;
  },
);
const setupTempMatch = setupFailureOutput.match(/SMOKE_SETUP_TEMP_DIR=(.+)/);
assert.ok(setupTempMatch);
assert.equal((await fs.lstat(setupTempMatch[1].trim()).catch((error) => error)).code, 'ENOENT');
assert.deepEqual(await listSmokeTempDirectories(), tempDirectoriesBeforeSetupFailure);

async function readOwnerRecord(ownerFile = ownerPath) {
  try {
    return JSON.parse(await fs.readFile(ownerFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) throw new Error(`default A2A lease owner is malformed: ${ownerFile}`);
    throw error;
  }
}

async function readLiveOwner() {
  try {
    const owner = await readOwnerRecord();
    if (!owner) return undefined;
    process.kill(owner.pid, 0);
    return owner;
  } catch (error) {
    if (error?.code === 'ESRCH') return undefined;
    if (error?.code === 'EPERM') throw new Error(`default A2A lease owner is not inspectable: ${ownerPath}`);
    throw error;
  }
}

function sameLeaseOwner(left, right) {
  return Boolean(
    left
    && right
    && left.pid === right.pid
    && left.token === right.token
    && left.storePath === right.storePath,
  );
}

function isChildExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForChildReap(child, timeoutMs, label) {
  if (isChildExited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('close', onClose);
      reject(new Error(`${label} did not reap within ${timeoutMs}ms`));
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once('close', onClose);
  });
}

async function waitForHolder(child, output, timeoutMs = HOLDER_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isChildExited(child)) {
      throw new Error(`A2A holder exited before acquiring the default lease: ${output.join('')}`);
    }
    if (/HOLDER_READY/.test(output.join(''))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`A2A holder did not acquire the default lease within ${timeoutMs}ms: ${output.join('')}`);
}

async function stopOwnedHolder(child, output) {
  if (!child) return;
  if (!isChildExited(child)) {
    child.kill('SIGTERM');
    try {
      await waitForChildReap(child, HOLDER_TERMINATION_GRACE_MS, 'A2A holder after SIGTERM');
    } catch {
      if (!isChildExited(child)) child.kill('SIGKILL');
      await waitForChildReap(child, HOLDER_REAP_TIMEOUT_MS, 'A2A holder after SIGKILL');
    }
  }
  return output.join('');
}

async function reclaimOwnedHolderLease(owner) {
  const current = await readOwnerRecord();
  if (!current) return 'released';
  if (!sameLeaseOwner(current, owner)) {
    throw new Error('refusing default A2A lease cleanup because ownership changed');
  }

  try {
    process.kill(current.pid, 0);
    throw new Error(`refusing default A2A lease cleanup while holder pid ${current.pid} is live`);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }

  const quarantine = `${leaseDirectory}.test-reclaim-${process.pid}-${randomUUID()}`;
  try {
    await fs.rename(leaseDirectory, quarantine);
  } catch (error) {
    if (error?.code === 'ENOENT') return 'released';
    throw error;
  }

  try {
    const quarantinedOwner = await readOwnerRecord(path.join(quarantine, 'owner.json'));
    if (!sameLeaseOwner(quarantinedOwner, owner)) {
      throw new Error('refusing default A2A lease cleanup because quarantined ownership changed');
    }
    await fs.rm(quarantine, { recursive: true, force: true });
    return 'reclaimed';
  } catch (error) {
    await fs.rename(quarantine, leaseDirectory).catch(() => undefined);
    throw error;
  }
}

const existingOwner = await readLiveOwner();
let holder;
let holderCreated = false;
let defaultLeaseCreatedByTest = false;
let holderOwner;
const holderOutput = [];

try {
  if (!existingOwner) {
    holder = spawn(
      process.execPath,
      ['--import', 'tsx/esm', '--input-type=module', '-e', `
        import { acquireStoreProcessLease } from ${JSON.stringify(holderModule)};
        let lease;
        let shutdownRequested = false;
        async function shutdown() {
          shutdownRequested = true;
          if (!lease) return;
          await lease.release();
          console.log('HOLDER_RELEASED');
          process.exit(0);
        }
        process.once('SIGTERM', () => {
          shutdown().catch((error) => {
            console.error(error);
            process.exitCode = 1;
          });
        });
        lease = await acquireStoreProcessLease([process.env.DEFAULT_A2A_STORE_PATH]);
        if (shutdownRequested) {
          await shutdown();
        }
        console.log('HOLDER_READY');
        await new Promise(() => {});
      `],
      {
        cwd: root,
        env: { ...process.env, DEFAULT_A2A_STORE_PATH: defaultStorePath },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    holderCreated = true;
    holder.stdout.on('data', (chunk) => holderOutput.push(String(chunk)));
    holder.stderr.on('data', (chunk) => holderOutput.push(String(chunk)));
    await waitForHolder(holder, holderOutput);
  }

  const owner = await readLiveOwner();
  assert.ok(owner, 'the repository default A2A store must be held by another process');
  assert.notEqual(owner.pid, process.pid);
  if (holderCreated) {
    assert.equal(owner.pid, holder.pid, 'the test-created holder must own the default A2A lease');
    holderOwner = owner;
    defaultLeaseCreatedByTest = true;
  }

  let result;
  try {
    result = await runProcessWithTimeout(process.execPath, ['scripts/core-runtime-smoke.mjs'], {
      cwd: root,
      env: process.env,
      timeoutMs: SMOKE_TIMEOUT_MS,
      terminationGraceMs: SMOKE_TERMINATION_GRACE_MS,
      reapTimeoutMs: SMOKE_REAP_TIMEOUT_MS,
    });
  } catch (error) {
    const output = `${error?.stdout ?? ''}${error?.stderr ?? ''}`;
    throw new Error(`core runtime smoke failed while default A2A store was held:\n${output}`, { cause: error });
  }
  const output = `${result.stdout}${result.stderr}`;
  const { status, signal } = result;
  assert.equal(status, 0, `core runtime smoke failed while default A2A store was held:\n${output}`);
  assert.equal(signal, null);

  const tempMatch = output.match(/SMOKE_TEMP_DIR=(.+)/);
  const a2aMatch = output.match(/SMOKE_A2A_STORE_PATH=(.+)/);
  assert.ok(tempMatch, `smoke must report its temporary directory:\n${output}`);
  assert.ok(a2aMatch, `smoke must report its A2A store path:\n${output}`);
  const tempDir = tempMatch[1].trim();
  const a2aStorePath = a2aMatch[1].trim();
  assert.equal(a2aStorePath, path.join(tempDir, 'a2a.json'));
  assert.equal(path.dirname(tempDir), root);
  assert.equal((await fs.lstat(tempDir).catch((error) => error)).code, 'ENOENT');
  assert.match(output, /SMOKE_CLEANUP=removed/);

  console.log(`PASS: core runtime smoke used isolated ${a2aStorePath} while default lease was held by pid ${owner.pid}`);
  console.log(`DEFAULT_A2A_LEASE_OWNER_PID=${owner.pid}`);
  console.log(`SMOKE_A2A_STORE_PATH=${a2aStorePath}`);
  console.log('SMOKE_CLEANUP=removed');
} finally {
  if (holderCreated && !holderOwner) {
    const owner = await readOwnerRecord();
    if (owner?.pid === holder.pid && owner.storePath === defaultStorePath) {
      holderOwner = owner;
      defaultLeaseCreatedByTest = true;
    }
  }
  const holderOutputText = await stopOwnedHolder(holder, holderOutput);
  if (defaultLeaseCreatedByTest) {
    await reclaimOwnedHolderLease(holderOwner);
  }
  if (holderCreated && holderOwner) assert.match(holderOutputText, /HOLDER_RELEASED/);
  const finalOwnerRecord = await readOwnerRecord();
  if (existingOwner) {
    assert.deepEqual(finalOwnerRecord, existingOwner, 'the test must not alter a pre-existing default A2A lease');
  } else {
    assert.equal(finalOwnerRecord, undefined, 'the test must release or reclaim its default A2A lease');
  }
  assert.deepEqual(await readLiveOwner(), existingOwner, 'the test must not alter a pre-existing default A2A lease');
}
