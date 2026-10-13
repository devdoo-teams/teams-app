import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChildTestEnvironment } from './child-test-environment.mjs';
import { createCoreTestInvocations, runProcessWithTimeout } from './core-test-runner.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-module-runner-test-'));
const runner = fileURLToPath(new URL('./run-module-test.mjs', import.meta.url));
const failures = [];
const cases = [
  { name: 'success', source: "console.log('COMPLETE');", status: 0, output: /COMPLETE/ },
  { name: 'exit-code', source: 'process.exitCode = 7;', status: 7 },
  { name: 'sync-throw', source: "throw new Error('EXPECTED_SYNC_FAILURE');", status: 1, output: /EXPECTED_SYNC_FAILURE/ },
  { name: 'awaited-rejection', source: "await Promise.reject(new Error('EXPECTED_AWAITED_FAILURE'));", status: 1, output: /EXPECTED_AWAITED_FAILURE/ },
  {
    name: 'unawaited-main-failure', status: 9, output: /EXPECTED_ASYNC_FAILURE/,
    source: `void (async () => {
      await new Promise(resolve => setTimeout(resolve, 40));
      throw new Error('EXPECTED_ASYNC_FAILURE');
    })().catch(error => { console.error(error.message); process.exitCode = 9; });`,
  },
  {
    name: 'unhandled-rejection', status: 1, output: /EXPECTED_UNHANDLED_FAILURE/,
    source: "setTimeout(() => { void Promise.reject(new Error('EXPECTED_UNHANDLED_FAILURE')); }, 40);",
  },
  { name: 'delayed-exit', source: 'setTimeout(() => process.exit(19), 40);', status: 19 },
  {
    name: 'failing-child', status: 23,
    source: `import { spawn } from 'node:child_process';
      import { once } from 'node:events';
      const child = spawn(process.execPath, ['-e', 'process.exit(23)'], { stdio: 'ignore' });
      const [code, signal] = await once(child, 'exit');
      if (signal) throw new Error('unexpected child signal');
      process.exitCode = code;`,
  },
  {
    name: 'delayed-success', status: 0, output: /ASYNC_COMPLETE/,
    source: "void (async () => { await new Promise(resolve => setTimeout(resolve, 40)); console.log('ASYNC_COMPLETE'); })();",
  },
  {
    name: 'main-entrypoint', status: 17, output: /ENTRYPOINT_RAN/,
    source: `import { pathToFileURL } from 'node:url';
      if (import.meta.url === pathToFileURL(process.argv[1]).href) {
        if (process.argv[2] !== 'fixture-argument') throw new Error('argument lost');
        console.log('ENTRYPOINT_RAN'); process.exitCode = 17;
      }`,
  },
  {
    name: 'signal-exit', status: null, signal: 'SIGTERM',
    source: "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 40);",
  },
];

try {
  for (const fixture of cases) {
    const filename = path.join(root, `${fixture.name}.mjs`);
    await fs.writeFile(filename, fixture.source, { mode: 0o600 });
    let result;
    try {
      result = await runProcessWithTimeout(process.execPath, [runner, filename, 'fixture-argument'], {
        env: createChildTestEnvironment(), timeoutMs: 5_000,
      });
    } catch (error) {
      result = error;
    }
    try {
      assert.equal(result.status, fixture.status, `${fixture.name}: exit status`);
      assert.equal(result.signal, fixture.signal ?? null, `${fixture.name}: signal`);
      if (fixture.status !== 0) assert.equal(result.code, 'ETESTFAILED', 'supervisor must reject failed child');
      if (fixture.output) assert.match(`${result.stdout}${result.stderr}`, fixture.output);
      console.log(`PASS: module runner ${fixture.name}`);
    } catch (error) {
      failures.push(error);
      console.error(`FAIL: module runner ${fixture.name}: ${error.message}`);
    }
  }
  const invocations = createCoreTestInvocations({ sourceCwd: process.cwd(), sourceCommit: '1'.repeat(40) });
  assert.ok(invocations.some(({ args }) => args.includes('scripts/run-module-test-test.mjs')),
    'Core must run the real module-runner regressions');
  if (failures.length) throw new AggregateError(failures, `${failures.length} module runner regression(s) failed`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('PASS: module runner preserves completion, entrypoint arguments, child failures, exceptions, and signals');
