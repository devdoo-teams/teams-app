import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseRunCommandResponse,
  renderWorkerRuntimeProbeScript,
  verifyWorkerRuntimeProbe,
} from './azure-worker-runtime-probe.mjs';

const root = path.resolve(import.meta.dirname, '..');
const commit = 'a'.repeat(40);
const codexBinSha256 = 'b'.repeat(64);

function validProbeOutput(overrides = {}) {
  const fields = {
    probe_version: '1',
    observed_at: '2026-09-07T01:00:00Z',
    service_enabled: 'enabled',
    service_active: 'active',
    service_substate: 'running',
    service_main_pid: '3483',
    service_exec_main_status: '0',
    current_release_commit: commit,
    release_commit: commit,
    manifest_commit: commit,
    codex_bin: '/opt/teamsapp/current/codex-runtime/bin/codex',
    codex_bin_type: 'regular',
    codex_bin_executable: '1',
    codex_sha256: codexBinSha256,
    codex_actual_sha256: codexBinSha256,
    auth_file: 'present',
    auth_type: 'regular',
    auth_mode: '600',
    auth_nlink: '1',
    auth_owner: 'teamsworker',
    codex_login: 'authenticated',
    overall: 'ready',
    ...overrides,
  };
  return Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n');
}

function runCommandResponse(output) {
  return {
    value: [{
      code: 'ComponentStatus/StdOut/succeeded',
      message: `Enable succeeded:\n[stdout]\n${output}\n[stderr]\n`,
    }],
  };
}

const response = runCommandResponse(validProbeOutput());
const parsed = parseRunCommandResponse(response);
assert.equal(parsed.release_commit, commit);
assert.equal(parsed.codex_login, 'authenticated');
const receipt = verifyWorkerRuntimeProbe(response, { expectedCommit: commit, expectedCodexBinSha256: codexBinSha256 });
assert.deepEqual(receipt, {
  schemaVersion: 1,
  kind: 'azure-worker-runtime-probe',
  status: 'READY',
  sourceCommit: commit,
  observedAt: '2026-09-07T01:00:00Z',
  service: {
    enabled: 'enabled',
    active: 'active',
    substate: 'running',
    mainPid: 3483,
    execMainStatus: 0,
  },
  worker: {
    currentReleaseCommit: commit,
    manifestCommit: commit,
    codexBinSha256,
  },
  authentication: {
    file: 'present',
    type: 'regular',
    mode: '600',
    nlink: 1,
    owner: 'teamsworker',
    login: 'authenticated',
  },
});

for (const [name, value, expectedError] of [
  ['missing auth', validProbeOutput({ auth_file: 'missing', overall: 'blocked' }), /auth_file/i],
  ['wrong manifest commit', validProbeOutput({ manifest_commit: 'c'.repeat(40), overall: 'blocked' }), /manifest_commit/i],
  ['wrong Codex digest', validProbeOutput({ codex_actual_sha256: 'c'.repeat(64), overall: 'blocked' }), /codex_actual_sha256/i],
  ['login unavailable', validProbeOutput({ codex_login: 'unavailable', overall: 'blocked' }), /codex_login/i],
]) {
  assert.throws(
    () => verifyWorkerRuntimeProbe(runCommandResponse(value), { expectedCommit: commit, expectedCodexBinSha256: codexBinSha256 }),
    expectedError,
    `${name} must fail closed`,
  );
}

assert.throws(
  () => parseRunCommandResponse(runCommandResponse(`${validProbeOutput()}\nservice_active=active`)),
  /duplicate/i,
  'duplicate probe fields must fail closed',
);
assert.throws(
  () => parseRunCommandResponse(runCommandResponse(`${validProbeOutput()}\nsecret=value`)),
  /unexpected/i,
  'unexpected probe fields must fail closed',
);

const remoteScript = renderWorkerRuntimeProbeScript({ commit, codexBinSha256 });
assert.match(remoteScript, /systemctl is-enabled teamsapp-worker\.service/);
assert.match(remoteScript, /systemctl is-active teamsapp-worker\.service/);
assert.match(remoteScript, /auth\.json/);
assert.match(remoteScript, /login status/);
assert.doesNotMatch(remoteScript, /cat\s+['"]?\$?auth_file/iu, 'probe must not read auth.json contents');
assert.doesNotMatch(remoteScript, /Bearer\s+|sk-[A-Za-z0-9]/u, 'probe must not embed credential-like values');
const syntax = spawnSync('bash', ['-n'], { input: remoteScript, encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-worker-runtime-probe-'));
try {
  const inputPath = path.join(temporaryDirectory, 'run-command.json');
  const outputPath = path.join(temporaryDirectory, 'probe-receipt.json');
  fs.writeFileSync(inputPath, `${JSON.stringify(response)}\n`, { mode: 0o600 });
  const cli = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'azure-worker-runtime-probe.mjs'),
    'verify',
    '--input', inputPath,
    '--expected-commit', commit,
    '--expected-codex-bin-sha256', codexBinSha256,
    '--output', outputPath,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), receipt);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  const overwrite = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'azure-worker-runtime-probe.mjs'),
    'verify',
    '--input', inputPath,
    '--expected-commit', commit,
    '--expected-codex-bin-sha256', codexBinSha256,
    '--output', outputPath,
  ], { cwd: root, encoding: 'utf8' });
  assert.notEqual(overwrite.status, 0, 'probe receipt must not be overwritten');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('azure-worker-runtime-probe-test: PASS');
