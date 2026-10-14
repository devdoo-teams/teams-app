import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { createAgentProcessTreeController, isProcessTreeControllerAvailable } from '../../src/server/agent-process-controller.js';
import { ownNodePtyProcess, type ManagedAgentPtyProcess } from '../../src/server/agent-pty-process.js';
import type { AgentIsolationPtyLaunchCapability } from '../../src/server/agent-execution-policy.js';
import type { NodePtyProcessPort, PtyExit } from '../../src/server/node-pty-read-process.js';

export interface NativePtyFixtureModule {
  spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; encoding: string }): NodePtyProcessPort;
}
export type NativePtyTreeReceipt = {
  pid: number; pgid: number; requested: number; cleanupCalls: number; rawKills: number;
  signals: Array<{ target: number; signal: string; result?: string; code?: string }>;
  exit?: PtyExit; resource?: ManagedAgentPtyProcess;
  cleanupFailure?: { name: string; message: string; groupMembers: string[] };
};

/** Test-only factory. Verify this newly spawned PTY's PGID before the existing
 * controller may signal its group; never infer ownership from a random PID. */
export function nativePtyTreeFixtureCapability(native: NativePtyFixtureModule) {
  const records: NativePtyTreeReceipt[] = [];
  let preflights = 0;
  const capability: AgentIsolationPtyLaunchCapability = {
    preflight() { preflights++; assert.equal(isProcessTreeControllerAvailable({ platform: 'posix' }), true); },
    spawn(command, args, options) {
      const pty = native.spawn(command, [...args], { name: 'xterm-256color', cwd: options.cwd, env: { ...options.env }, cols: options.cols, rows: options.rows, encoding: 'utf8' });
      const receipt: NativePtyTreeReceipt = { pid: pty.pid, pgid: 0, requested: 0, cleanupCalls: 0, rawKills: 0, signals: [] };
      records.push(receipt);
      const originalKill = pty.kill.bind(pty);
      pty.kill = () => { receipt.rawKills++; originalKill(); };
      const target = Object.assign(new EventEmitter(), { pid: pty.pid });
      const listener = pty.onExit(value => { receipt.exit = value; target.emit('close'); });
      try {
        receipt.pgid = Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(pty.pid)], { encoding: 'utf8', timeout: 1000 }).trim());
        assert.equal(receipt.pgid, pty.pid, 'a native PTY must lead its own process group before group signals are authorized');
      } catch (error) {
        // Only this positively identified direct child may be signalled here.
        // The lease classifies the failed atomic start as unverified/quarantined.
        pty.kill(); throw error;
      }
      const controller = createAgentProcessTreeController(target, {
        platform: 'posix', graceMs: 80, cleanupWaitMs: 1000, retryDelayMs: 50, maxAttempts: 20,
        groupAlive() {
          return execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8', timeout: 1000 })
            .split('\n').some(line => line.trim().split(/\s+/)[1] === String(receipt.pgid));
        },
        sendSignal(pid, signal) {
          assert.equal(pid, -receipt.pgid);
          const sent: NativePtyTreeReceipt['signals'][number] = { target: pid, signal };
          receipt.signals.push(sent);
          if (receipt.signals.some(previous => previous !== sent && previous.code === 'EPERM')) {
            sent.result = 'blocked-after-denial'; sent.code = 'EPERM';
            throw Object.assign(new Error('Prior native signal denial remains blocked.'), { code: 'EPERM' });
          }
          const members = execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8', timeout: 1000 })
            .split('\n').filter(line => line.trim().split(/\s+/)[1] === String(receipt.pgid));
          if (!members.length) { sent.result = 'already-absent-no-signal'; return; }
          try { process.kill(pid, signal); sent.result = 'sent'; }
          catch (error) {
            sent.result = 'failed'; sent.code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
            throw error;
          }
        },
      });
      assert.ok(controller);
      const resource = ownNodePtyProcess(pty, { available: true, platform: 'posix',
        requestTermination() { receipt.requested++; controller.requestTermination(); },
        async cleanup() {
          receipt.cleanupCalls++;
          try { await controller.cleanup(); }
          catch (error) {
            const members = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8', timeout: 1000 })
              .split('\n').filter(line => line.trim().split(/\s+/)[2] === String(receipt.pgid));
            receipt.cleanupFailure = { name: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : 'unknown', groupMembers: members };
            throw error;
          }
        },
      }, { cleanupTimeoutMs: 3000 });
      receipt.resource = resource;
      void resource.finished.then(() => listener.dispose(), () => { if (receipt.exit) listener.dispose(); });
      return resource;
    },
  };
  return { capability, records, preflights: () => preflights };
}
