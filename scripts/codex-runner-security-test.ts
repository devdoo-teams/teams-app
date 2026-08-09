import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CodexRunner } from '../src/server/codex-runner.js';

type Capture = {
  args: string[];
  env: Record<string, string | undefined>;
  envKeys: string[];
  grandchildPid?: number;
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-runner-security-'));
const fakeCodexPath = path.join(root, 'fake-codex.mjs');
const homePath = path.join(root, 'home');
const codexHomePath = path.join(root, 'codex-home');
const failures: Array<{ name: string; error: unknown }> = [];

const fakeCodexSource = `
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = ${JSON.stringify(root)};
const args = process.argv.slice(2);
const prompt = args.at(-1) ?? '';
const caseName = /CASE:([a-z0-9-]+)/i.exec(prompt)?.[1] ?? 'unknown';
const selectedEnvKeys = [
  'PATH',
  'HOME',
  'CODEX_HOME',
  'CI',
  'CLIENT_SECRET',
  'OPENAI_API_KEY',
  'LOCAL_MODEL_API_KEY',
  'TEAMS_LOCAL_ACCESS_TOKEN',
  'AZURE_CLIENT_SECRET',
  'CODEX_BIN',
  'CODEX_SCRIPT',
  'CODEX_TIMEOUT_MS',
  'UNRELATED_SECRET',
];
const selectedEnv = Object.fromEntries(selectedEnvKeys.map((key) => [key, process.env[key]]));

let grandchild;
if (['cancel-group', 'timeout-group', 'overflow-group'].includes(caseName)) {
  grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
}

if (caseName.startsWith('callback-hang')) {
  console.log(JSON.stringify({ type: 'turn.started' }));
}

await fs.writeFile(path.join(root, caseName + '.json'), JSON.stringify({
  args,
  env: selectedEnv,
  envKeys: Object.keys(process.env).sort(),
  grandchildPid: grandchild?.pid,
}), 'utf8');

const emitSuccess = () => {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'security-thread' }));
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'SECURITY_FAKE_OK' },
  }));
};
const lingerThenExit = () => setTimeout(() => process.exit(0), 750);

if (caseName === 'initial-option' || caseName === 'resume-option') {
  const terminatorIndex = args.lastIndexOf('--');
  if (terminatorIndex < 0 || terminatorIndex !== args.length - 2) {
    console.error('missing option terminator');
    process.exit(64);
  }
  emitSuccess();
} else if (caseName === 'stdout-overflow' || caseName === 'overflow-group') {
  process.stdout.write('x'.repeat(2_000_000));
  lingerThenExit();
} else if (caseName === 'stderr-overflow') {
  process.stderr.write('e'.repeat(2_000_000));
  lingerThenExit();
} else if (caseName === 'event-overflow') {
  for (let index = 0; index < 20_000; index += 1) {
    process.stdout.write(JSON.stringify({ type: 'turn.started', index }) + '\\n');
  }
  lingerThenExit();
} else if (caseName === 'final-message-overflow') {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'm'.repeat(50_000) },
  }));
  lingerThenExit();
} else if (caseName === 'callback-failure') {
  console.log(JSON.stringify({ type: 'turn.started' }));
} else if (caseName.startsWith('callback-hang')) {
  lingerThenExit();
} else if (caseName === 'exit-failure') {
  console.error('expected fake child failure');
  process.exit(7);
} else if (caseName === 'cancel-group' || caseName === 'timeout-group') {
  lingerThenExit();
} else {
  emitSuccess();
}
`;

const baseEnvironment: Record<string, string> = {
  CODEX_BIN: process.execPath,
  CODEX_SCRIPT: fakeCodexPath,
  CODEX_TIMEOUT_MS: '1500',
  PATH: '/security-test/bin:/usr/bin:/bin',
  HOME: homePath,
  CODEX_HOME: codexHomePath,
  CLIENT_SECRET: 'teams-client-secret-canary',
  OPENAI_API_KEY: 'openai-secret-canary',
  LOCAL_MODEL_API_KEY: 'local-provider-secret-canary',
  TEAMS_LOCAL_ACCESS_TOKEN: 'teams-local-token-canary',
  AZURE_CLIENT_SECRET: 'azure-secret-canary',
  UNRELATED_SECRET: 'ambient-secret-canary',
};

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runCase(
  runner: CodexRunner,
  caseName: string,
  options: { prompt?: string; threadId?: string; timeoutMs?: number; guardMs?: number; onEvent?: () => Promise<void> } = {},
) {
  const jobId = `job-${caseName}`;
  const execution = withEnvironment({
    ...baseEnvironment,
    CODEX_TIMEOUT_MS: String(options.timeoutMs ?? 1500),
  }, () => runner.run({
    jobId,
    prompt: options.prompt ?? `security test CASE:${caseName}`,
    workspace: root,
    mode: 'read-only',
    threadId: options.threadId,
    onEvent: options.onEvent,
  }));

  let guardHandle: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    guardHandle = setTimeout(() => reject(new Error(`security test timed out: ${caseName}`)), options.guardMs ?? 4_000);
  });
  try {
    return await Promise.race([execution, guard]);
  } finally {
    if (guardHandle) clearTimeout(guardHandle);
  }
}

async function readCapture(caseName: string): Promise<Capture> {
  const filePath = path.join(root, `${caseName}.json`);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as Capture;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`fake child did not capture ${caseName}`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EPERM');
  }
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return !isProcessAlive(pid);
}

async function terminateLeftover(pid: number | undefined): Promise<void> {
  if (!pid || !isProcessAlive(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // The process may exit between the liveness check and cleanup.
  }
}

async function test(name: string, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL: ${name}`);
    console.error(error);
  }
}

await fs.mkdir(homePath, { recursive: true });
await fs.mkdir(codexHomePath, { recursive: true });
await fs.writeFile(fakeCodexPath, fakeCodexSource, { mode: 0o700 });

try {
  await test('rejects non-UUID resume thread IDs before spawning Codex', async () => {
    const runner = new CodexRunner();
    await assert.rejects(
      () => withEnvironment(baseEnvironment, () => runner.run({
        jobId: 'job-invalid-resume-id',
        prompt: 'security test CASE:invalid-resume-id',
        workspace: root,
        mode: 'read-only',
        threadId: '--dangerously-bypass-approvals-and-sandbox',
      })),
      /invalid.*thread/i,
    );
    assert.equal(runner.cancel('job-invalid-resume-id'), false);
  });

  await test('initial prompt is after the POSIX option terminator', async () => {
    const runner = new CodexRunner();
    const result = await runCase(runner, 'initial-option', {
      prompt: '--dangerously-bypass-approvals-and-sandbox CASE:initial-option',
    });
    const capture = await readCapture('initial-option');
    assert.deepEqual(capture.args.slice(0, 7), [
      'exec', '--json', '--sandbox', 'read-only', '--cd', root, '--',
    ]);
    assert.equal(capture.args.length, 8);
    assert.match(capture.args[7] ?? '', /USER REQUEST:\n--dangerously-bypass-approvals-and-sandbox/);
    assert.equal(result.finalMessage, 'SECURITY_FAKE_OK');
    assert.equal(runner.cancel('job-initial-option'), false, 'successful process is removed from the process map');
  });

  await test('resume prompt is after the POSIX option terminator', async () => {
    const runner = new CodexRunner();
    await runCase(runner, 'resume-option', {
      prompt: '--version CASE:resume-option',
      threadId: '019fd700-51cd-7862-a4ef-74ccae0f2b4e',
    });
    const capture = await readCapture('resume-option');
    assert.deepEqual(capture.args.slice(0, 5), [
      'exec', 'resume', '019fd700-51cd-7862-a4ef-74ccae0f2b4e', '--json', '--',
    ]);
    assert.equal(capture.args.length, 6);
    assert.match(capture.args[5] ?? '', /USER REQUEST:\n--version/);
    assert.equal(runner.cancel('job-resume-option'), false);
  });

  await test('child receives only the Codex login and executable environment allowlist', async () => {
    const runner = new CodexRunner();
    await runCase(runner, 'environment');
    const capture = await readCapture('environment');
    assert.equal(capture.env.PATH, baseEnvironment.PATH);
    assert.equal(capture.env.HOME, homePath);
    assert.equal(capture.env.CODEX_HOME, codexHomePath);
    assert.equal(capture.env.CI, '1');
    for (const key of [
      'CLIENT_SECRET',
      'OPENAI_API_KEY',
      'LOCAL_MODEL_API_KEY',
      'TEAMS_LOCAL_ACCESS_TOKEN',
      'AZURE_CLIENT_SECRET',
      'CODEX_BIN',
      'CODEX_SCRIPT',
      'CODEX_TIMEOUT_MS',
      'UNRELATED_SECRET',
    ]) {
      assert.equal(capture.env[key], undefined, `${key} is omitted from the child environment`);
    }
    const allowedKeys = new Set([
      'PATH', 'HOME', 'CODEX_HOME', 'CI',
      'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA',
      'SYSTEMROOT', 'WINDIR', 'PATHEXT',
      'TMPDIR', 'TMP', 'TEMP',
      'LANG', 'LC_ALL', 'LC_CTYPE',
      'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
      // macOS launch services injects this locale metadata even when spawn
      // receives an explicit environment object.
      '__CF_USER_TEXT_ENCODING',
    ]);
    assert.ok(capture.envKeys.every((key) => allowedKeys.has(key)), `unexpected child env keys: ${capture.envKeys.join(', ')}`);
  });

  for (const [caseName, expected] of [
    ['stdout-overflow', /stdout.*limit/i],
    ['stderr-overflow', /stderr.*limit/i],
    ['event-overflow', /event.*limit/i],
    ['final-message-overflow', /final message.*limit/i],
  ] as const) {
    await test(`${caseName} terminates with a bounded-output error`, async () => {
      const runner = new CodexRunner();
      await assert.rejects(() => runCase(runner, caseName), expected);
      assert.equal(runner.cancel(`job-${caseName}`), false, 'overflowed process is removed from the process map');
    });
  }

  await test('spawn errors remove the process from the process map', async () => {
    const runner = new CodexRunner();
    await assert.rejects(
      () => withEnvironment({
        ...baseEnvironment,
        CODEX_BIN: path.join(root, 'missing-codex-executable'),
        CODEX_SCRIPT: undefined,
      }, () => runner.run({
        jobId: 'job-spawn-error',
        prompt: 'spawn failure',
        workspace: root,
        mode: 'read-only',
      })),
      /ENOENT/,
    );
    assert.equal(runner.cancel('job-spawn-error'), false);
  });

  await test('child exit errors remove the process from the process map', async () => {
    const runner = new CodexRunner();
    await assert.rejects(() => runCase(runner, 'exit-failure'), /expected fake child failure/);
    assert.equal(runner.cancel('job-exit-failure'), false);
  });

  if (process.platform !== 'win32') {
    await test('cancel terminates the isolated process group', async () => {
      const runner = new CodexRunner();
      const runPromise = runCase(runner, 'cancel-group');
      const capture = await readCapture('cancel-group');
      assert.ok(capture.grandchildPid);
      try {
        assert.equal(runner.cancel('job-cancel-group'), true);
        await assert.rejects(() => runPromise);
        assert.equal(await waitForProcessExit(capture.grandchildPid), true, 'cancel kills the descendant process');
        assert.equal(runner.cancel('job-cancel-group'), false, 'cancelled process is removed from the process map');
      } finally {
        await terminateLeftover(capture.grandchildPid);
      }
    });

    await test('timeout terminates the isolated process group', async () => {
      const runner = new CodexRunner();
      await assert.rejects(() => runCase(runner, 'timeout-group', { timeoutMs: 100 }), /시간 제한/);
      const capture = await readCapture('timeout-group');
      assert.ok(capture.grandchildPid);
      try {
        assert.equal(await waitForProcessExit(capture.grandchildPid), true, 'timeout kills the descendant process');
        assert.equal(runner.cancel('job-timeout-group'), false);
      } finally {
        await terminateLeftover(capture.grandchildPid);
      }
    });

    await test('overflow terminates the isolated process group', async () => {
      const runner = new CodexRunner();
      await assert.rejects(() => runCase(runner, 'overflow-group'), /stdout.*limit/i);
      const capture = await readCapture('overflow-group');
      assert.ok(capture.grandchildPid);
      try {
        assert.equal(await waitForProcessExit(capture.grandchildPid), true, 'overflow kills the descendant process');
        assert.equal(runner.cancel('job-overflow-group'), false);
      } finally {
        await terminateLeftover(capture.grandchildPid);
      }
    });
  }

  await test('event callback errors terminate and remove the process', async () => {
    const runner = new CodexRunner();
    await assert.rejects(
      () => runCase(runner, 'callback-failure', {
        onEvent: async () => { throw new Error('expected callback failure'); },
      }),
      /expected callback failure/,
    );
    assert.equal(runner.cancel('job-callback-failure'), false);
  });

  await test('a never-settling event callback cannot defeat timeout cleanup', async () => {
    let callbackStarted = false;
    const runner = new CodexRunner();
    const runPromise = runCase(runner, 'callback-hang-timeout', {
      timeoutMs: 500,
      guardMs: 1_500,
      onEvent: async () => {
        callbackStarted = true;
        await new Promise<never>(() => {});
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(callbackStarted, true, 'the hanging callback started before the deadline');
    await assert.rejects(() => runPromise, /시간 제한/);
    assert.equal(runner.cancel('job-callback-hang-timeout'), false);
  });

  await test('a never-settling event callback cannot defeat cancellation cleanup', async () => {
    let callbackStarted = false;
    const runner = new CodexRunner();
    const runPromise = runCase(runner, 'callback-hang-cancel', {
      guardMs: 500,
      onEvent: async () => {
        callbackStarted = true;
        await new Promise<never>(() => {});
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(callbackStarted, true, 'the hanging callback started before cancellation');
    assert.equal(runner.cancel('job-callback-hang-cancel'), true);
    await assert.rejects(() => runPromise, /취소되었습니다/);
    assert.equal(runner.cancel('job-callback-hang-cancel'), false);
  });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  throw new AggregateError(
    failures.map((failure) => failure.error),
    `${failures.length} Codex runner security test(s) failed: ${failures.map((failure) => failure.name).join(', ')}`,
  );
}

console.log('CodexRunner security tests passed: argv boundary, minimal environment, bounded output, process-group termination, and lifecycle cleanup');
