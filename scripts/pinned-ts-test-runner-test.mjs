import assert from 'node:assert/strict';
import { runPinnedTsTest } from './pinned-ts-test-runner.mjs';
let cleaned = 0;
const workspace = { cwd: '/fixture/source', commitOid: '1'.repeat(40), cleanup() { cleaned++; } };
let invocation;
await runPinnedTsTest('scripts/synthetic-test.ts', {
  resolveWorkspace: () => workspace,
  runProcess: async (command, args, options) => { invocation = { command, args, options }; return { stdout: '', stderr: '' }; },
  env: {},
});
assert.deepEqual(invocation.args, ['--import', 'tsx/esm', 'scripts/run-module-test.mjs', 'scripts/synthetic-test.ts']);
assert.equal(invocation.command, process.execPath);
assert.equal(invocation.options.cwd, workspace.cwd);
assert.equal(invocation.options.env.TEAMS_SOURCE_COMMIT, workspace.commitOid);
assert.equal(cleaned, 1);
await assert.rejects(runPinnedTsTest('../outside.ts'), /relative scripts/);
await assert.rejects(runPinnedTsTest('scripts/synthetic-test.ts', {
  resolveWorkspace: () => workspace, runProcess: async () => { throw new Error('fixture failure'); }, env: {},
}), /fixture failure/);
assert.equal(cleaned, 2, 'failed tests clean only their own materialized source');
await runPinnedTsTest('scripts/agent-only-hub-contract-test.mjs', {
  resolveWorkspace: () => workspace,
  runProcess: async () => ({ stdout: '', stderr: '' }), env: {},
});
assert.equal(cleaned, 3, 'plain source contract also uses pinned tracked source');
console.log('PASS: pinned TypeScript test runner needs no local tsx executable and cleans source on failure');
