import assert from 'node:assert/strict';

const { normalizeCliCapability, probeCliCapabilities } = await import('../src/server/codex-capability.ts');

const GHCP_CAPABILITY_ARGS = [
  '--prompt', 'Respond with exactly GHCP_CAPABILITY_OK.',
  '--output-format', 'json',
  '--stream', 'off',
  '--no-color', '--no-auto-update', '--no-ask-user',
  '--allow-tool=read',
  '--secret-env-vars=COPILOT_GITHUB_TOKEN,GH_TOKEN,GITHUB_TOKEN',
];

function commandKey(command, args) {
  return JSON.stringify([command, args]);
}

function createFixtureRunner(fixtures) {
  const calls = [];

  return {
    calls,
    runCommand: async (command, args, timeoutMs) => {
      const call = { command, args: [...args], timeoutMs };
      calls.push(call);

      const fixture = fixtures.get(commandKey(command, call.args));
      assert.ok(fixture, `unexpected command runner call: ${command} ${call.args.join(' ')}`);
      return { ...fixture };
    },
  };
}

function fixture(command, args, result) {
  return [commandKey(command, args), result];
}

function sortCalls(calls) {
  return calls
    .map(({ command, args, timeoutMs }) => ({ command, args, timeoutMs }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

async function testGhcpCapabilityProbeRequiresExplicitFeatureFlag() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'Logged in using ChatGPT' }),
  ]));

  const capabilities = await probeCliCapabilities({
    environment: {},
    runCommand: runner.runCommand,
    timeoutMs: 777,
  });

  assert.deepEqual(capabilities.ghcp, {
    state: 'unknown',
    executable: 'unknown',
    probe: 'not-run',
    authentication: 'unknown',
    login: 'unknown',
    entitlement: 'unknown',
    reason: 'unknown',
  }, 'a GHCP capability turn must remain opt-in behind the runtime feature flag');
  assert.deepEqual(runner.calls.filter(({ command }) => command === 'copilot'), [], 'normal Core health must not invoke GHCP');
}

async function testCodexAuthRequiresOfficialStatusText() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'command completed successfully' }),
  ]));

  const capabilities = await probeCliCapabilities({
    environment: {},
    runCommand: runner.runCommand,
  });

  assert.deepEqual(capabilities.codex, {
    state: 'unknown',
    executable: 'present',
    probe: 'not-run',
    authentication: 'unknown',
    login: 'unknown',
    entitlement: 'unknown',
    reason: 'unknown',
  }, 'a successful but unrecognized Codex status must not claim authentication');
}

async function testCodexNotLoggedInStatusIsRecognizedWithoutLoginAutomation() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'exit', exitCode: 1, stdout: 'Not logged in' }),
  ]));

  const capabilities = await probeCliCapabilities({
    environment: {},
    runCommand: runner.runCommand,
  });

  assert.deepEqual(capabilities.codex, {
    state: 'unavailable',
    executable: 'present',
    probe: 'failed',
    authentication: 'not-authenticated',
    login: 'not-authenticated',
    entitlement: 'unknown',
    reason: 'auth-required',
  });
  assert.equal(runner.calls.some(({ args }) => args.includes('login') && args.at(-1) !== 'status'), false);
}

async function testExplicitCapabilityProbeUsesOfficialCopilotCli() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'Logged in using ChatGPT' }),
    fixture('copilot', ['--help'], { outcome: 'success', stdout: 'GitHub Copilot CLI help' }),
    fixture('copilot', GHCP_CAPABILITY_ARGS, {
      outcome: 'success',
      stdout: [
        JSON.stringify({ type: 'session.start', data: { sessionId: '019fd700-51cd-7862-a4ef-74ccae0f2b4e' } }),
        JSON.stringify({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'GHCP_CAPABILITY_OK' } }),
        JSON.stringify({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } }),
      ].join('\n'),
    }),
  ]));

  const capabilities = await probeCliCapabilities({
    environment: { TEAMS_GHCP_CAPABILITY_PROBE: 'true' },
    runCommand: runner.runCommand,
    timeoutMs: 777,
  });

  assert.deepEqual(capabilities.codex, {
    state: 'unknown',
    executable: 'present',
    probe: 'not-run',
    authentication: 'authenticated',
    login: 'authenticated',
    entitlement: 'unknown',
    reason: 'unknown',
  }, 'Codex login status proves authentication only, not bounded capability or entitlement');
  assert.deepEqual(capabilities.ghcp, {
    state: 'available',
    executable: 'present',
    probe: 'passed',
    authentication: 'authenticated',
    login: 'authenticated',
    entitlement: 'allowed',
    reason: 'verified',
  }, 'only the explicit bounded capability probe may attest GHCP access');
  assert.deepEqual(sortCalls(runner.calls), sortCalls([
    { command: 'codex', args: ['login', 'status'], timeoutMs: 777 },
    { command: 'copilot', args: ['--help'], timeoutMs: 777 },
    { command: 'copilot', args: GHCP_CAPABILITY_ARGS, timeoutMs: 777 },
  ]));
  assert.equal(
    runner.calls.some(({ command, args }) => command === 'copilot' && args.some((arg) => /login|auth|device|browser/iu.test(arg))),
    false,
    'official Copilot health probing must not start an interactive login or browser flow',
  );
}

async function testGhcpEnvironmentIdentityIsSharedWithExecutionConfiguration() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'Logged in using ChatGPT' }),
    fixture('/opt/copilot', ['node', '--help'], { outcome: 'success', stdout: 'GitHub Copilot CLI help' }),
    fixture('/opt/copilot', ['node', ...GHCP_CAPABILITY_ARGS], {
      outcome: 'success',
      stdout: [
        JSON.stringify({ type: 'session.start', data: { sessionId: '019fd700-51cd-7862-a4ef-74ccae0f2b4e' } }),
        JSON.stringify({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'GHCP_CAPABILITY_OK' } }),
        JSON.stringify({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } }),
      ].join('\n'),
    }),
  ]));

  const capabilities = await probeCliCapabilities({
    environment: { GHCP_BIN: '/opt/copilot', GHCP_SCRIPT: 'node', TEAMS_GHCP_CAPABILITY_PROBE: 'true' },
    runCommand: runner.runCommand,
  });

  assert.deepEqual(capabilities.ghcp, {
    state: 'available',
    executable: 'present',
    probe: 'passed',
    authentication: 'authenticated',
    login: 'authenticated',
    entitlement: 'allowed',
    reason: 'verified',
  });
  assert.deepEqual(runner.calls.find(({ command, args }) => command === '/opt/copilot' && args.includes('--prompt'))?.args, [
    'node', ...GHCP_CAPABILITY_ARGS,
  ]);
}

async function testExplicitGhcpCommandUsesOfficialProbe() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'Logged in using ChatGPT' }),
    fixture('/opt/copilot', ['--help'], { outcome: 'success', stdout: 'GitHub Copilot CLI help' }),
    fixture('/opt/copilot', GHCP_CAPABILITY_ARGS, {
      outcome: 'success',
      stdout: [
        JSON.stringify({ type: 'session.start', data: { sessionId: '019fd700-51cd-7862-a4ef-74ccae0f2b4e' } }),
        JSON.stringify({ type: 'assistant.turn_start', data: {} }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'GHCP_CAPABILITY_OK' } }),
        JSON.stringify({ type: 'assistant.turn_end', data: {} }),
      ].join('\n'),
    }),
  ]));

  const capabilities = await probeCliCapabilities({
    environment: { TEAMS_GHCP_CAPABILITY_PROBE: 'true' },
    ghcpCommand: { command: '/opt/copilot' },
    runCommand: runner.runCommand,
    timeoutMs: 1_250,
  });

  assert.deepEqual(capabilities.ghcp, {
    state: 'available',
    executable: 'present',
    probe: 'passed',
    authentication: 'authenticated',
    login: 'authenticated',
    entitlement: 'allowed',
    reason: 'verified',
  });
  assert.deepEqual(sortCalls(runner.calls), sortCalls([
    { command: 'codex', args: ['login', 'status'], timeoutMs: 1_250 },
    { command: '/opt/copilot', args: ['--help'], timeoutMs: 1_250 },
    { command: '/opt/copilot', args: GHCP_CAPABILITY_ARGS, timeoutMs: 1_250 },
  ]));
}

async function testGhcpEnvironmentBinSelectsOfficialProbe() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'Logged in using ChatGPT' }),
    fixture('copilot', ['--help'], { outcome: 'success', stdout: 'GitHub Copilot CLI help' }),
    fixture('copilot', GHCP_CAPABILITY_ARGS, { outcome: 'timeout' }),
  ]));

  const capabilities = await probeCliCapabilities({
    environment: { GHCP_BIN: 'copilot', TEAMS_GHCP_CAPABILITY_PROBE: 'true' },
    runCommand: runner.runCommand,
  });

  assert.equal(capabilities.ghcp.state, 'unknown');
  assert.deepEqual(
    runner.calls.filter(({ command }) => command === 'copilot').map(({ args }) => args),
    [
      ['--help'],
      GHCP_CAPABILITY_ARGS,
    ],
  );
}

async function testCapabilityProbesAreCoalescedWithinTheRateWindow() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'Logged in using ChatGPT' }),
    fixture('copilot', ['--help'], { outcome: 'success', stdout: 'GitHub Copilot CLI help' }),
    fixture('copilot', GHCP_CAPABILITY_ARGS, {
      outcome: 'success',
      stdout: [
        JSON.stringify({ type: 'session.start', data: { sessionId: '019fd700-51cd-7862-a4ef-74ccae0f2b4e' } }),
        JSON.stringify({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'GHCP_CAPABILITY_OK' } }),
        JSON.stringify({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } }),
      ].join('\n'),
    }),
  ]));
  let now = 10_000;
  const options = {
    environment: { TEAMS_GHCP_CAPABILITY_PROBE: 'true' },
    runCommand: runner.runCommand,
    now: () => now,
  };

  await Promise.all([probeCliCapabilities(options), probeCliCapabilities(options)]);
  now += 1;
  await probeCliCapabilities(options);

  assert.equal(runner.calls.filter(({ command }) => command === 'codex').length, 1, 'repeated health reads share one Codex probe');
  assert.equal(runner.calls.filter(({ command }) => command === 'copilot').length, 2, 'repeated health reads share one bounded GHCP probe');
}

async function testCanonicalExecutableResolutionIsExplicitlyInjectable() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'Logged in using ChatGPT' }),
    fixture('/canonical/copilot', ['--help'], { outcome: 'success', stdout: 'GitHub Copilot CLI help' }),
    fixture('/canonical/copilot', GHCP_CAPABILITY_ARGS, {
      outcome: 'success',
      stdout: [
        JSON.stringify({ type: 'session.start', data: { sessionId: '019fd700-51cd-7862-a4ef-74ccae0f2b4e' } }),
        JSON.stringify({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'GHCP_CAPABILITY_OK' } }),
        JSON.stringify({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } }),
      ].join('\n'),
    }),
  ]));
  const resolvedRequests = [];

  const capabilities = await probeCliCapabilities({
    environment: { TEAMS_GHCP_CAPABILITY_PROBE: 'true' },
    ghcpCommand: { command: 'copilot' },
    resolveExecutable: async (command) => {
      resolvedRequests.push(command);
      return { state: 'resolved', command: '/canonical/copilot' };
    },
    runCommand: runner.runCommand,
  });

  assert.equal(capabilities.ghcp.state, 'available');
  assert.deepEqual(resolvedRequests, ['copilot']);
  assert.deepEqual(runner.calls.filter(({ command }) => command === '/canonical/copilot').map(({ args }) => args), [
    ['--help'],
    GHCP_CAPABILITY_ARGS,
  ], 'a proven resolver may canonicalize the executable while preserving injected runner arguments');
}

async function testProbeTimeoutIsBoundedBeforeRunner() {
  for (const [requestedTimeout, expectedTimeout] of [[99_999, 2_000], [1, 100]]) {
    const runner = createFixtureRunner(new Map([
      fixture('codex', ['login', 'status'], { outcome: 'timeout' }),
      fixture('copilot', ['--help'], { outcome: 'timeout' }),
    ]));

    const capabilities = await probeCliCapabilities({
      environment: { TEAMS_GHCP_CAPABILITY_PROBE: 'true' },
      runCommand: runner.runCommand,
      timeoutMs: requestedTimeout,
    });

    assert.deepEqual(capabilities, {
      codex: {
        state: 'unknown',
        executable: 'present',
        probe: 'unknown',
        authentication: 'unknown',
        login: 'unknown',
        entitlement: 'unknown',
        reason: 'unknown',
      },
      ghcp: {
        state: 'unknown',
        executable: 'present',
        probe: 'not-run',
        authentication: 'unknown',
        login: 'unknown',
        entitlement: 'unknown',
        reason: 'unknown',
      },
    });
    assert.ok(runner.calls.length > 0);
    assert.ok(runner.calls.every(({ timeoutMs }) => timeoutMs === expectedTimeout));
    assert.ok(runner.calls.every(({ timeoutMs }) => timeoutMs >= 100 && timeoutMs <= 2_000));
  }
}

async function testFailedOfficialProbeDoesNotGuessLoginState() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'Logged in using ChatGPT' }),
    fixture('copilot', ['--help'], { outcome: 'success', stdout: 'GitHub Copilot CLI help' }),
    fixture('copilot', GHCP_CAPABILITY_ARGS, { outcome: 'timeout' }),
  ]));

  const capabilities = await probeCliCapabilities({
    environment: { TEAMS_GHCP_CAPABILITY_PROBE: 'true' },
    runCommand: runner.runCommand,
  });

  assert.deepEqual(capabilities.ghcp, {
    state: 'unknown',
    executable: 'present',
    probe: 'unknown',
    authentication: 'unknown',
    login: 'unknown',
    entitlement: 'unknown',
    reason: 'unknown',
  });
}

async function testOnlyExplicitNotAuthenticatedEvidenceSetsLoginState() {
  const runner = createFixtureRunner(new Map([
    fixture('codex', ['login', 'status'], { outcome: 'success', stdout: 'Logged in using ChatGPT' }),
    fixture('copilot', ['--help'], { outcome: 'success', stdout: 'GitHub Copilot CLI help' }),
    fixture('copilot', GHCP_CAPABILITY_ARGS, {
      outcome: 'exit',
      exitCode: 1,
      stderr: 'Not authenticated. Please run copilot login.',
    }),
  ]));

  const capabilities = await probeCliCapabilities({
    environment: { TEAMS_GHCP_CAPABILITY_PROBE: 'true' },
    runCommand: runner.runCommand,
  });

  assert.deepEqual(capabilities.ghcp, {
    state: 'unavailable',
    executable: 'present',
    probe: 'failed',
    authentication: 'not-authenticated',
    login: 'not-authenticated',
    entitlement: 'unknown',
    reason: 'auth-required',
  });
  assert.equal(
    runner.calls.some(({ command, args }) => command === 'copilot' && args.includes('login')),
    false,
    'official GHCP capability probing must never invoke copilot login',
  );
}

async function testNormalizerDoesNotPromoteUnknownLogin() {
  assert.deepEqual(
    normalizeCliCapability({ state: 'available', executable: 'present', login: 'unknown' }),
    {
      state: 'unknown',
      executable: 'present',
      probe: 'unknown',
      authentication: 'unknown',
      login: 'unknown',
      entitlement: 'unknown',
      reason: 'unknown',
    },
  );
}

async function testNormalizerDoesNotPromoteUnknownEntitlement() {
  assert.deepEqual(
    normalizeCliCapability({
      state: 'available',
      executable: 'present',
      probe: 'passed',
      authentication: 'authenticated',
      entitlement: 'unknown',
    }),
    {
      state: 'unknown',
      executable: 'present',
      probe: 'passed',
      authentication: 'authenticated',
      login: 'authenticated',
      entitlement: 'unknown',
      reason: 'unknown',
    },
    'available requires an explicitly allowed entitlement',
  );
}

const tests = [
  testGhcpCapabilityProbeRequiresExplicitFeatureFlag,
  testCodexAuthRequiresOfficialStatusText,
  testCodexNotLoggedInStatusIsRecognizedWithoutLoginAutomation,
  testExplicitCapabilityProbeUsesOfficialCopilotCli,
  testGhcpEnvironmentIdentityIsSharedWithExecutionConfiguration,
  testExplicitGhcpCommandUsesOfficialProbe,
  testGhcpEnvironmentBinSelectsOfficialProbe,
  testCapabilityProbesAreCoalescedWithinTheRateWindow,
  testCanonicalExecutableResolutionIsExplicitlyInjectable,
  testProbeTimeoutIsBoundedBeforeRunner,
  testFailedOfficialProbeDoesNotGuessLoginState,
  testOnlyExplicitNotAuthenticatedEvidenceSetsLoginState,
  testNormalizerDoesNotPromoteUnknownLogin,
  testNormalizerDoesNotPromoteUnknownEntitlement,
];

for (const test of tests) {
  await test();
}

console.log(`PASS: ${tests.length} Codex/GHCP capability regression tests`);
