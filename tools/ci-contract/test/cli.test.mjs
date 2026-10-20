import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { complete } from '../fixtures/factory.mjs';
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000, env: { LANG: 'C.UTF-8' } });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-contract-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
test('CLI writes a deterministic checksummed packet without claiming live success', (t) => {
  const dir = sandbox(t); const input = join(dir, 'input.json'); writeFileSync(input, JSON.stringify(complete()));
  for (const name of ['first', 'second']) {
    const r = run('--input', input, '--output-dir', join(dir, name)); assert.equal(r.status, 0, r.stderr);
    const summary = JSON.parse(r.stdout); assert.equal(summary.releaseAdmission, 'UNVERIFIED');
    const sums = readFileSync(join(dir, name, 'SHA256SUMS'), 'utf8').trim().split('\n'); assert.equal(sums.length, 3);
    for (const line of sums) {
      const [digest, file] = line.split('  '); assert.equal(sha256(readFileSync(join(dir, name, file))), digest);
      assert.equal(readFileSync(join(dir, 'first', file), 'utf8'), readFileSync(join(dir, name, file), 'utf8'));
    }
  }
  const again = run('--input', input, '--output-dir', join(dir, 'first')); assert.equal(again.status, 2);
});
for (const [name, content] of [
  ['malformed JSON', '{'], ['ZIP bytes', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ['oversized JSON', ' '.repeat(2 * 1024 * 1024 + 1)],
  ['unknown command field', JSON.stringify({ ...complete(), command: 'touch /tmp/CI_CONTRACT_MUST_NOT_RUN' })],
]) {
  test(`CLI rejects ${name} before creating output`, (t) => {
    const dir = sandbox(t); const input = join(dir, 'input'); writeFileSync(input, content);
    const output = join(dir, 'output'); const r = run('--input', input, '--output-dir', output);
    assert.equal(r.status, 2); assert.equal(existsSync(output), false); assert.ok(!r.stderr.includes('touch'));
  });
}
test('CLI rejects a symlink input and unknown arguments', (t) => {
  const dir = sandbox(t); const input = join(dir, 'input.json'); writeFileSync(input, JSON.stringify(complete()));
  const link = join(dir, 'link.json'); symlinkSync(input, link);
  assert.equal(run('--input', link, '--output-dir', join(dir, 'output')).status, 2);
  assert.equal(run('--input', input, '--output-dir', join(dir, 'output'), '--execute', 'bad').status, 2);
});
