import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const root = process.cwd();
const execFileAsync = promisify(execFile);

async function resolveHead() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return stdout.trim();
}

function runBuild(runtimeDir, sourceCommit) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/build-server.mjs', '--core'], {
      cwd: root,
      env: {
        ...process.env,
        TEAMS_FILEPROVIDER_SERVER_REUSE: '1',
        TEAMS_RUNTIME_DIST_DIR: runtimeDir,
        TEAMS_SOURCE_COMMIT: sourceCommit,
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        // The process may have exited during timeout cleanup.
      }
      reject(new Error(`determinism build timed out after 180000ms\n${output.slice(-12_000)}`));
    }, 180_000);
    child.stdout.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
    });
    child.stderr.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`determinism build exited with code=${code} signal=${signal}\n${output}`));
        return;
      }
      resolve(output);
    });
  });
}

const sourceCommit = await resolveHead();
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-server-determinism-'));
try {
  const runtimeDirs = [
    path.join(testRoot, 'first'),
    path.join(testRoot, 'second'),
  ];
  for (const runtimeDir of runtimeDirs) {
    // The production runtime root already exists before the server build
    // creates its dependency link. Mirror that invariant in the isolated
    // harness so a missing parent cannot mask the determinism assertion.
    await fs.mkdir(path.join(runtimeDir, 'server'), { recursive: true });
  }

  const outputs = [];
  for (const runtimeDir of runtimeDirs) {
    await runBuild(runtimeDir, sourceCommit);
    const entryPath = path.join(runtimeDir, 'server', 'index.js');
    const markerPath = path.join(runtimeDir, 'server', '.teams-server-build-commit');
    const bytes = await fs.readFile(entryPath);
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    const bundleSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(marker.bundleSha256, bundleSha256, 'server marker must attest the emitted bundle');
    outputs.push({ bytes, bundleSha256, marker });
  }

  assert.deepEqual(outputs[1].bytes, outputs[0].bytes, 'same source commit must emit identical server bytes');
  assert.equal(outputs[1].bundleSha256, outputs[0].bundleSha256, 'same source commit must emit identical server SHA-256');
  assert.deepEqual(
    outputs[1].marker,
    outputs[0].marker,
    'same source commit must emit identical server build markers',
  );
} finally {
  await fs.rm(testRoot, { recursive: true, force: true });
}

console.log(`PASS: FileProvider fallback server build is deterministic for ${sourceCommit}`);
