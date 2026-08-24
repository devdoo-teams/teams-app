import { strict as assert } from 'node:assert';

import { CliAgentRunner } from '../src/server/cli-agent-runner.js';
import {
  probeGitHubCopilotCliCapability,
  type GhcpCliExecutableResolver,
  type GhcpCliProcessResult,
  type GhcpCliProcessRunner,
} from '../src/server/ghcp-cli-adapter.js';

type RunnerCall = Readonly<{
  command: string;
  args: readonly string[];
  timeoutMs: number;
}>;

function foundResolver(commandPath = '/usr/local/bin/copilot'): GhcpCliExecutableResolver {
  return async () => ({ state: 'resolved', command: commandPath });
}

function queueRunner(...results: readonly GhcpCliProcessResult[]): {
  calls: RunnerCall[];
  runner: GhcpCliProcessRunner;
} {
  const calls: RunnerCall[] = [];
  let index = 0;

  return {
    calls,
    runner: async (command, args, timeoutMs) => {
      calls.push({ command, args: [...args], timeoutMs });
      const result = results[index];
      index += 1;
      if (!result) throw new Error(`unexpected probe call ${command} ${args.join(' ')}`);
      return result;
    },
  };
}

async function testMissingExecutableUsesOfficialDefault(): Promise<void> {
  let resolvedCommand = '';
  const runnerCalls: RunnerCall[] = [];
  const resolveExecutable: GhcpCliExecutableResolver = async (command) => {
    resolvedCommand = command;
    return { state: 'missing', command };
  };

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable,
    runProcess: async (command, args, timeoutMs) => {
      runnerCalls.push({ command, args: [...args], timeoutMs });
      return { outcome: 'missing', elapsedMs: 1 };
    },
  });

  assert.equal(resolvedCommand, 'copilot');
  assert.equal(result.state, 'missing');
  assert.equal(result.requestedCommand, 'copilot');
  assert.equal(result.steps.length, 0);
  const dimensions = result as unknown as Record<string, unknown>;
  assert.equal(dimensions.executable, 'absent');
  assert.equal(dimensions.probe, 'not-run');
  assert.equal(dimensions.authentication, 'unknown');
  assert.equal(dimensions.entitlement, 'unknown');
  assert.deepEqual(runnerCalls, []);
}

async function testHelpOnlyProbeStaysUnknown(): Promise<void> {
  const queued = queueRunner({
    outcome: 'success',
    elapsedMs: 7,
    stdout: 'GitHub Copilot CLI help',
  });

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
    capabilityArgs: null,
    timeoutMs: 321,
  });

  assert.equal(result.state, 'unknown');
  assert.equal(result.steps.length, 1);
  const dimensions = result as unknown as Record<string, unknown>;
  assert.equal(dimensions.executable, 'present');
  assert.equal(dimensions.probe, 'not-run');
  assert.equal(dimensions.authentication, 'unknown');
  assert.equal(dimensions.entitlement, 'unknown');
  assert.deepEqual(queued.calls, [{
    command: '/usr/local/bin/copilot',
    args: ['--help'],
    timeoutMs: 321,
  }]);
}

async function testDefaultProcessRunnerAcceptsHelpOutputBeyondDiagnosticLimit(): Promise<void> {
  const result = await probeGitHubCopilotCliCapability({
    executable: process.execPath,
    prefixArgs: ['-e', "process.stdout.write('h'.repeat(12_000));"],
    resolveExecutable: foundResolver(process.execPath),
    capabilityArgs: null,
    timeoutMs: 1_000,
  });

  assert.equal(result.state, 'unknown', 'help-only discovery remains non-attesting');
  assert.equal(result.steps[0]?.outcome, 'success', 'large but valid help output must not overflow the child-process buffer');
  assert.equal(result.steps[0]?.stdout.length, 8_192, 'diagnostics remain bounded after the process buffer accepts the full output');
}

async function testInteractiveLoginProbeIsRejectedBeforeExecution(): Promise<void> {
  const queued = queueRunner({
    outcome: 'success',
    elapsedMs: 1,
    stdout: 'must not be consumed',
  });

  await assert.rejects(
    () => probeGitHubCopilotCliCapability({
      resolveExecutable: foundResolver(),
      runProcess: queued.runner,
      capabilityArgs: ['login'],
    }),
    /login.*probe|probe.*login/iu,
  );
  assert.deepEqual(queued.calls, [], 'a health probe must never execute copilot login');
}

async function testDefaultProbeNeverGuessesAuthenticationFromHelp(): Promise<void> {
  const queued = queueRunner({
    outcome: 'success',
    elapsedMs: 3,
    stdout: 'GitHub Copilot CLI help; logged in',
  }, {
    outcome: 'success',
    elapsedMs: 4,
    stdout: 'not JSONL capability output',
  });

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver('/opt/copilot'),
    runProcess: queued.runner,
  });

  assert.equal(result.state, 'unknown', 'an unvalidated capability response never proves authentication');
  assert.deepEqual(queued.calls, [{
    command: '/opt/copilot',
    args: ['--help'],
    timeoutMs: 1500,
  }, {
    command: '/opt/copilot',
    args: ['--prompt', 'Respond with exactly GHCP_CAPABILITY_OK.', '--output-format', 'json', '--stream', 'off', '--no-color', '--no-auto-update', '--no-ask-user', '--allow-tool=read', '--secret-env-vars=COPILOT_GITHUB_TOKEN,GH_TOKEN,GITHUB_TOKEN'],
    timeoutMs: 1500,
  }]);
}

async function testValidJsonlWithoutCapabilitySentinelStaysUnknown(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 3,
      stdout: 'help output',
    },
    {
      outcome: 'success',
      elapsedMs: 6,
      stdout: [
        JSON.stringify({ type: 'session.start', data: { sessionId: 'session-1' } }),
        JSON.stringify({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'GHCP_CAPABILITY_NOT_OK' } }),
        JSON.stringify({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } }),
      ].join('\n'),
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
  });

  assert.equal(result.state, 'unknown', 'valid JSONL without the exact sentinel must not claim availability');
  const dimensions = result as unknown as Record<string, unknown>;
  assert.equal(dimensions.executable, 'present');
  assert.equal(dimensions.probe, 'unknown');
  assert.equal(dimensions.authentication, 'unknown');
  assert.equal(dimensions.entitlement, 'unknown');
}

async function testExactSentinelProvesOnlyTheBoundedCapability(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 3,
      stdout: 'help output',
    },
    {
      outcome: 'success',
      elapsedMs: 6,
      stdout: [
        JSON.stringify({ type: 'session.start', data: { sessionId: 'session-1' } }),
        JSON.stringify({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'GHCP_CAPABILITY_OK' } }),
        JSON.stringify({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } }),
      ].join('\n'),
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
  });

  assert.equal(result.state, 'available');
  const dimensions = result as unknown as Record<string, unknown>;
  assert.equal(dimensions.executable, 'present');
  assert.equal(dimensions.probe, 'passed');
  assert.equal(dimensions.authentication, 'authenticated');
  assert.equal(dimensions.entitlement, 'allowed');
}

async function testOfficialPostTerminalMetadataKeepsCapabilityProbeValid(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 3,
      stdout: 'help output',
    },
    {
      outcome: 'success',
      elapsedMs: 6,
      stdout: [
        JSON.stringify({ type: 'session.start', data: { sessionId: 'session-1' } }),
        JSON.stringify({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'GHCP_CAPABILITY_OK' } }),
        JSON.stringify({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } }),
        JSON.stringify({ type: 'session.info', data: { model: 'fixture-model' } }),
      ].join('\n'),
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
  });

  assert.equal(result.state, 'available', 'runner-tolerated post-terminal metadata must not break health discovery');
  assert.equal(result.probe, 'passed');
  assert.equal(result.authentication, 'authenticated');
  assert.equal(result.entitlement, 'allowed');
}

async function testValidJsonlAuthAndPolicyTextCannotClaimAvailability(): Promise<void> {
  for (const [message, expectedState] of [
    ['Authentication required for GitHub Copilot CLI.', 'auth-required'],
    ['Organization policy blocks GitHub Copilot for this account.', 'policy-blocked'],
  ] as const) {
    const queued = queueRunner(
      {
        outcome: 'success',
        elapsedMs: 3,
        stdout: 'help output',
      },
      {
        outcome: 'success',
        elapsedMs: 6,
        stdout: [
          JSON.stringify({ type: 'session.start', data: { sessionId: 'session-1' } }),
          JSON.stringify({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } }),
          JSON.stringify({ type: 'assistant.message', data: { content: message } }),
          JSON.stringify({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } }),
        ].join('\n'),
      },
    );

    const result = await probeGitHubCopilotCliCapability({
      resolveExecutable: foundResolver(),
      runProcess: queued.runner,
    });

    assert.equal(result.state, expectedState, `JSONL ${expectedState} text must not claim availability`);
    const dimensions = result as unknown as Record<string, unknown>;
    assert.equal(dimensions.executable, 'present');
    assert.equal(dimensions.probe, 'failed');
    assert.equal(dimensions.authentication, expectedState === 'auth-required' ? 'not-authenticated' : 'unknown');
    assert.equal(dimensions.entitlement, expectedState === 'policy-blocked' ? 'blocked' : 'unknown');
  }
}

async function testAuthRequiredOutputIsRedacted(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 2,
      stdout: 'help output',
    },
    {
      outcome: 'exit',
      exitCode: 1,
      elapsedMs: 9,
      stderr: 'Authorization: Bearer secret-token\nUse this one-time code ABCD-EFGH\n/Users/doosansmacbookpro/.config/copilot\u0007\nPlease run copilot login',
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
    homeDirectory: '/Users/doosansmacbookpro',
    capabilityArgs: ['--version'],
  });

  assert.equal(result.state, 'auth-required');
  assert.match(result.steps[1]?.stderr ?? '', /Authorization: <redacted>/);
  assert.match(result.steps[1]?.stderr ?? '', /<redacted-device-code>/);
  assert.doesNotMatch(result.steps[1]?.stderr ?? '', /secret-token/);
  assert.doesNotMatch(result.steps[1]?.stderr ?? '', /ABCD-EFGH/);
  assert.doesNotMatch(result.steps[1]?.stderr ?? '', /\/Users\/doosansmacbookpro/);
  assert.doesNotMatch(result.steps[1]?.stderr ?? '', /\u0007/);
}

async function testPolicyBlockedOutputIsDistinct(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 3,
      stdout: 'help output',
    },
    {
      outcome: 'exit',
      exitCode: 1,
      elapsedMs: 6,
      stderr: 'Organization policy blocks GitHub Copilot for this account.',
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
    capabilityArgs: ['--version'],
  });

  assert.equal(result.state, 'policy-blocked');
}

async function testExitZeroNotAuthenticatedIsAuthRequired(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 3,
      stdout: 'help output',
    },
    {
      outcome: 'success',
      elapsedMs: 6,
      stdout: 'Not authenticated. Please run copilot login.',
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
    capabilityArgs: ['--version'],
  });

  assert.equal(result.state, 'auth-required');
}

async function testExitZeroLicensePolicyOutputIsPolicyBlocked(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 3,
      stdout: 'help output',
    },
    {
      outcome: 'success',
      elapsedMs: 6,
      stderr: 'GitHub Copilot license required; this account is not entitled.',
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
    capabilityArgs: ['--version'],
  });

  assert.equal(result.state, 'policy-blocked');
}

async function testExitZeroArbitraryTextCannotProveAuthentication(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 3,
      stdout: 'help output',
    },
    {
      outcome: 'success',
      elapsedMs: 6,
      stdout: 'GitHub Copilot authenticated and ready; status: ok',
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
    capabilityArgs: ['--version'],
  });

  assert.equal(result.state, 'unknown', 'arbitrary successful text is not an authentication or license attestation');
}

async function testTimeoutStaysUnknown(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 4,
      stdout: 'help output',
    },
    {
      outcome: 'timeout',
      elapsedMs: 1500,
      stderr: 'deadline exceeded',
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
    capabilityArgs: ['--version'],
  });

  assert.equal(result.state, 'unknown');
  assert.equal(result.steps[1]?.outcome, 'timeout');
}

async function testUnexpectedNonZeroExitIsExecutionFailed(): Promise<void> {
  const queued = queueRunner(
    {
      outcome: 'success',
      elapsedMs: 5,
      stdout: 'help output',
    },
    {
      outcome: 'exit',
      exitCode: 2,
      elapsedMs: 8,
      stderr: 'unexpected failure while checking capability',
    },
  );

  const result = await probeGitHubCopilotCliCapability({
    resolveExecutable: foundResolver(),
    runProcess: queued.runner,
    capabilityArgs: ['--version'],
  });

  assert.equal(result.state, 'execution-failed');
  assert.equal(result.steps[1]?.exitStatus, 2);
}

async function testConfiguredCopilotModelReachesChildProcess(): Promise<void> {
  const sessionId = '019fd700-51cd-7862-a4ef-74ccae0f2b4e';
  const fakeCli = [
    `console.log(JSON.stringify({ type: 'session.start', data: { sessionId: ${JSON.stringify(sessionId)} } }));`,
    "console.log(JSON.stringify({ type: 'assistant.turn_start', data: {} }));",
    "console.log(JSON.stringify({ type: 'assistant.message', data: { content: 'model=' + (process.env.COPILOT_MODEL || '<missing>') } }));",
    "console.log(JSON.stringify({ type: 'assistant.turn_end', data: {} }));",
  ].join('');
  const runner = new CliAgentRunner({
    commands: { copilot: { executable: process.execPath, prefixArgs: ['-e', fakeCli, '--'] } },
    resolveGhcpExecutable: async (command) => ({ state: 'resolved', command }),
    processControllerOptions: { graceMs: 20, cleanupWaitMs: 200 },
  });

  const result = await runner.run({
    provider: 'copilot',
    jobId: 'copilot-model-forwarding',
    prompt: 'bounded model forwarding check',
    workspace: process.cwd(),
    mode: 'workspace-write',
    timeoutMs: 1_000,
    environmentOverrides: { COPILOT_MODEL: 'gpt-5.4' },
  });

  assert.equal(
    result.finalResult,
    'model=gpt-5.4',
    'official COPILOT_MODEL configuration must reach the Copilot child process',
  );
  runner.close();
}

async function testConfiguredCopilotHostsReachChildProcess(): Promise<void> {
  const sessionId = '019fd700-51cd-7862-a4ef-74ccae0f2b4e';
  const fakeCli = [
    `console.log(JSON.stringify({ type: 'session.start', data: { sessionId: ${JSON.stringify(sessionId)} } }));`,
    "console.log(JSON.stringify({ type: 'assistant.turn_start', data: {} }));",
    "console.log(JSON.stringify({ type: 'assistant.message', data: { content: 'copilot=' + (process.env.COPILOT_GH_HOST || '<missing>') + ';gh=' + (process.env.GH_HOST || '<missing>') } }));",
    "console.log(JSON.stringify({ type: 'assistant.turn_end', data: {} }));",
  ].join('');
  const runner = new CliAgentRunner({
    commands: { copilot: { executable: process.execPath, prefixArgs: ['-e', fakeCli, '--'] } },
    resolveGhcpExecutable: async (command) => ({ state: 'resolved', command }),
    processControllerOptions: { graceMs: 20, cleanupWaitMs: 200 },
  });

  const result = await runner.run({
    provider: 'copilot',
    jobId: 'copilot-host-forwarding',
    prompt: 'bounded host forwarding check',
    workspace: process.cwd(),
    mode: 'workspace-write',
    timeoutMs: 1_000,
    environmentOverrides: {
      COPILOT_GH_HOST: 'https://copilot.example.ghe.com',
      GH_HOST: 'https://shared.example.ghe.com',
    },
  });

  assert.equal(
    result.finalResult,
    'copilot=https://copilot.example.ghe.com;gh=https://shared.example.ghe.com',
    'official Copilot host-selection environment variables must reach the child process',
  );
  runner.close();
}

await testMissingExecutableUsesOfficialDefault();
await testHelpOnlyProbeStaysUnknown();
await testDefaultProcessRunnerAcceptsHelpOutputBeyondDiagnosticLimit();
await testInteractiveLoginProbeIsRejectedBeforeExecution();
await testDefaultProbeNeverGuessesAuthenticationFromHelp();
await testValidJsonlWithoutCapabilitySentinelStaysUnknown();
await testExactSentinelProvesOnlyTheBoundedCapability();
await testOfficialPostTerminalMetadataKeepsCapabilityProbeValid();
await testValidJsonlAuthAndPolicyTextCannotClaimAvailability();
await testAuthRequiredOutputIsRedacted();
await testPolicyBlockedOutputIsDistinct();
await testExitZeroNotAuthenticatedIsAuthRequired();
await testExitZeroLicensePolicyOutputIsPolicyBlocked();
await testExitZeroArbitraryTextCannotProveAuthentication();
await testTimeoutStaysUnknown();
await testUnexpectedNonZeroExitIsExecutionFailed();
await testConfiguredCopilotModelReachesChildProcess();
await testConfiguredCopilotHostsReachChildProcess();

console.log('GHCP CLI adapter tests passed');
