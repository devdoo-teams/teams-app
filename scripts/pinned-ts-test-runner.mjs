import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveCoreTestWorkspace } from './core-test-workspace.mjs';
import { runProcessWithTimeout } from './core-test-runner.mjs';
import { createChildTestEnvironment } from './child-test-environment.mjs';

export async function runPinnedTsTest(script, {
  resolveWorkspace = resolveCoreTestWorkspace,
  runProcess = runProcessWithTimeout,
  env = process.env,
} = {}) {
  if (typeof script !== 'string' || !/^scripts\/[a-zA-Z0-9_-]+\.(?:tsx?|mjs)$/.test(script)) {
    throw new Error('Pinned test requires a relative scripts/*.ts, *.tsx or *.mjs path');
  }
  const workspace = resolveWorkspace();
  try {
    const childEnv = createChildTestEnvironment(env, { overrides: { TEAMS_SOURCE_COMMIT: workspace.commitOid } });
    const result = await runProcess(process.execPath, ['--import', 'tsx/esm', 'scripts/run-module-test.mjs', script], {
      cwd: workspace.cwd, env: childEnv, timeoutMs: Number(childEnv.TEAMS_TEST_TIMEOUT_MS ?? 60_000),
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (output) process.stdout.write(`${output}\n`);
  } catch (error) {
    const output = `${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim();
    if (output) process.stdout.write(`${output}\n`);
    throw error;
  } finally { workspace.cleanup(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('usage: node scripts/pinned-ts-test-runner.mjs scripts/test.ts');
  await runPinnedTsTest(process.argv[2]);
}
