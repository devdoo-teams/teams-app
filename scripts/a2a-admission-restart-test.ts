import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { acquireStoreProcessLease } from '../src/server/process-lease.js';

const CHILD_MODE = process.argv[2];

if (CHILD_MODE === '--close' || CHILD_MODE === '--restart') {
  await runChild(CHILD_MODE, process.argv[3]);
} else {
  await runRestartRegression();
}

async function runChild(mode: '--close' | '--restart', journalPath: string | undefined): Promise<void> {
  assert.ok(journalPath, 'child requires an admission journal path');
  const processLease = await acquireStoreProcessLease([journalPath]);
  try {
    const controller = new AgentAdmissionController(
      { globalLimit: 1, perTenantLimit: 1, perRequesterLimit: 1 },
      { journalPath },
    );
    await controller.initialize();

    if (mode === '--close') {
      const result = await controller.tryAcquire({ tenantId: 'tenant-restart', requesterId: 'requester-restart' });
      assert.equal(result.ok, true, 'the first process admits work before shutdown');
      if (result.ok) await result.lease.bindJob('restart-active-job');
      await controller.close();
      const closed = await controller.tryAcquire({ tenantId: 'tenant-restart', requesterId: 'requester-restart' });
      assert.deepEqual(closed, {
        ok: false,
        code: 'AGENT_ADMISSION_CLOSED',
        dimension: 'closing',
        limit: 0,
        retryable: false,
      }, 'the current process remains closed after close()');
      return;
    }

    assert.equal(controller.snapshot().global, 1, 'restart preserves active admission reservations');
    const occupied = await controller.tryAcquire({ tenantId: 'tenant-restart', requesterId: 'requester-restart' });
    assert.deepEqual(occupied, {
      ok: false,
      code: 'AGENT_CAPACITY_EXCEEDED',
      dimension: 'requester',
      limit: 1,
      retryable: true,
    }, 'reopening admission must not discard active capacity');
    await controller.releaseJob('restart-active-job');
    const result = await controller.tryAcquire({ tenantId: 'tenant-restart', requesterId: 'requester-restart' });
    assert.equal(result.ok, true, 'a new process must reopen admission after a graceful restart');
    if (result.ok) await result.lease.release();
  } finally {
    await processLease.release();
  }
}

async function runRestartRegression(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-admission-restart-'));
  const journalPath = path.join(root, 'agent-admission.json');
  try {
    const first = await runChildProcess('--close', journalPath);
    assert.equal(first.code, 0, `initial process failed:\n${first.output}`);

    const persisted = JSON.parse(await fs.readFile(journalPath, 'utf8')) as { closing?: unknown };
    assert.equal(persisted.closing, true, 'the first process must persist its shutdown gate');

    const second = await runChildProcess('--restart', journalPath);
    assert.equal(
      second.code,
      0,
      `restart process inherited AGENT_ADMISSION_CLOSED instead of reopening admission:\n${second.output}`,
    );

    const reopened = JSON.parse(await fs.readFile(journalPath, 'utf8')) as { closing?: unknown };
    assert.equal(reopened.closing, false, 'restart must persist the reopened admission state');
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

async function runChildProcess(mode: '--close' | '--restart', journalPath: string): Promise<{ code: number | null; output: string }> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx/esm', fileURLToPath(import.meta.url), mode, journalPath],
    { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
  const [code] = await onceExit(child);
  return { code, output: Buffer.concat(chunks).toString('utf8') };
}

function onceExit(child: ReturnType<typeof spawn>): Promise<[number | null]> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve([code]));
  });
}

console.log('PASS: admission restart semantics reopen a persisted journal after process shutdown');
