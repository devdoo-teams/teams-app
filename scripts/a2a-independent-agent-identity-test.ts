import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { A2AScope } from '../src/server/a2a-contract.js';
import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { AgentJobStore } from '../src/server/agent-job-store.js';
import {
  AgentExecutionPolicy,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
} from '../src/server/agent-execution-policy.js';
import { AgentService } from '../src/server/agent-service.js';
import { CodexRunner, type CodexRunResult } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';
import {
  createA2AProductionRuntime,
  type A2AProductionChildExecutionInput,
  type A2AProductionAgent,
  type A2AProductionRuntimeOptions,
} from '../src/server/a2a-production-runtime.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-agent-identity-'));
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};

async function testProductionRegistryRoutesIndependentProviderRunners(): Promise<void> {
  const store = await createStore('production-provider-routing');
  const parent = await createParent(store, 'production-provider-routing');
  const workspace = path.join(root, 'production-provider-routing-workspace');
  const jobsPath = path.join(root, 'production-provider-routing-jobs.json');
  await fs.mkdir(workspace, { recursive: true });

  const codexRunner = new RecordingRunner('codex');
  const ghcpRunner = new RecordingRunner('ghcp');
  const service = new AgentService(
    new AgentJobStore(jobsPath),
    codexRunner,
    workspace,
    async () => undefined,
    new GitService(workspace),
    {
      canReadScope: () => true,
      canMutateScope: () => true,
      executionPolicy: new AgentExecutionPolicy(workspace, {
        canReadScope: () => true,
        canMutateScope: () => true,
        isolationProvider: new TestIsolationProvider(),
      }),
      admissionController: new AgentAdmissionController({
        globalLimit: 4,
        perTenantLimit: 2,
        perRequesterLimit: 2,
      }, { journalPath: path.join(root, 'production-provider-routing-admission.json') }),
      defaultProvider: 'codex',
      providerRunners: { codex: codexRunner, copilot: ghcpRunner },
    },
  );
  await service.initialize();

  try {
    const agents: readonly A2AProductionAgent[] = [
      createServiceBackedAgent('codex-reviewer', 'codex-cli', service, 'codex'),
      createServiceBackedAgent('ghcp-tester', 'official-copilot-cli', service, 'copilot'),
    ];
    const runtime = createRuntime(store, { agents });
    const result = await runtime.dispatchChildren({
      parentTask: parent,
      scope,
      requests: [
        {
          key: 'review',
          role: 'reviewer',
          capabilities: ['source.read'],
          prompt: 'Review the bounded change.',
          agentId: 'codex-reviewer',
        },
        {
          key: 'tests',
          role: 'test-runner',
          capabilities: ['tests.run'],
          prompt: 'Run the bounded tests.',
          agentId: 'ghcp-tester',
        },
      ],
      deadlineMs: 5_000,
      parallelism: 2,
    });

    assert.deepEqual(codexRunner.prompts, ['Review the bounded change.']);
    assert.deepEqual(ghcpRunner.prompts, ['Run the bounded tests.']);
    assert.deepEqual(result.childResults.map((child) => ({
      childKey: child.childKey,
      agentId: child.agentId,
      providerId: child.providerId,
      result: child.result,
    })).sort(byChildKey), [
      {
        childKey: 'review',
        agentId: 'codex-reviewer',
        providerId: 'codex-cli',
        result: 'codex result',
      },
      {
        childKey: 'tests',
        agentId: 'ghcp-tester',
        providerId: 'official-copilot-cli',
        result: 'ghcp result',
      },
    ]);
    const persistedJobs = JSON.parse(await fs.readFile(jobsPath, 'utf8')) as Array<{ provider?: string }>;
    assert.deepEqual(
      persistedJobs.map((job) => job.provider).sort(),
      ['codex', 'copilot'],
      'provider identity is persisted with each child job for restart-safe routing',
    );
  } finally {
    await service.close();
  }
}

function createServiceBackedAgent(
  agentId: string,
  providerId: string,
  service: AgentService,
  provider: 'codex' | 'copilot',
): A2AProductionAgent {
  return {
    agentId,
    providerId,
    authorize: () => true,
    executeChild: (input) => executeServiceChild(service, provider, input),
  };
}

async function executeServiceChild(
  service: AgentService,
  provider: 'codex' | 'copilot',
  input: A2AProductionChildExecutionInput,
) {
  let agentJobId: string | undefined;
  const cancelChild = (): void => {
    if (!agentJobId) return;
    void service.cancelStrict(agentJobId, input.scope, { notify: false, provider }).catch(() => undefined);
  };
  input.signal.addEventListener('abort', cancelChild, { once: true });
  try {
    const job = await service.runForCopilot({
      provider,
      prompt: input.prompt,
      scope: input.scope,
      notify: false,
      timeoutMs: Math.max(1, input.deadlineAtMs - Date.now()),
      onSubmitted: async (submitted) => {
        agentJobId = submitted.id;
        await input.bindChild(submitted.id);
        if (input.signal.aborted) cancelChild();
      },
    });
    if (job.status === 'completed') return { taskId: job.id, status: 'completed' as const, result: job.result };
    if (job.status === 'cancelled') return { taskId: job.id, status: 'canceled' as const, error: job.error };
    return { taskId: job.id, status: 'failed' as const, error: job.error ?? 'provider execution failed' };
  } finally {
    input.signal.removeEventListener('abort', cancelChild);
  }
}

class RecordingRunner extends CodexRunner {
  readonly prompts: string[] = [];

  constructor(private readonly provider: string) {
    super();
  }

  override async run(_options: Parameters<CodexRunner['run']>[0]): Promise<CodexRunResult> {
    this.prompts.push(_options.prompt);
    return {
      threadId: `${this.provider}-thread`,
      finalMessage: `${this.provider} result`,
      eventCount: 1,
    };
  }

  override cancel(_jobId: string): boolean {
    return true;
  }

  override close(): void {}
}

class TestIsolationProvider extends AgentIsolationProvider {
  constructor() {
    super('a2a-registry-test-provider');
  }

  override async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({
      subject: input.subject,
      workspace: input.workspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: () => { throw new Error('the integration test must not spawn a CLI process'); },
    });
  }
}

async function testTrustedIndependentAgentSelectionAndPropagation(): Promise<void> {
  const store = await createStore('independent-routing');
  const parent = await createParent(store, 'independent-routing');
  const calls: Array<{ agentId: string; providerId: string; childKey: string }> = [];
  const authorizationCalls: Array<{ agentId: string; requesterId: string; role: string }> = [];
  const agents: readonly A2AProductionAgent[] = [
    {
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      authorize: (input) => {
        authorizationCalls.push({ agentId: 'codex-reviewer', requesterId: input.scope.requesterId, role: input.role });
        return input.scope.requesterId === 'requester-a' && input.role === 'reviewer';
      },
      executeChild: async (input) => {
        calls.push({ agentId: input.agentId, providerId: input.providerId, childKey: input.childKey });
        return { taskId: 'codex-review-job', status: 'completed', result: 'codex review result' };
      },
    },
    {
      agentId: 'copilot-tester',
      providerId: 'official-copilot-cli',
      authorize: (input) => {
        authorizationCalls.push({ agentId: 'copilot-tester', requesterId: input.scope.requesterId, role: input.role });
        return input.scope.requesterId === 'requester-a' && input.role === 'test-runner';
      },
      executeChild: async (input) => {
        calls.push({ agentId: input.agentId, providerId: input.providerId, childKey: input.childKey });
        return { taskId: 'copilot-test-job', status: 'completed', result: 'copilot test result' };
      },
    },
  ];
  const runtime = createRuntime(store, {
    agents,
    defaultAgentId: 'codex-reviewer',
  });

  const result = await runtime.dispatchChildren({
    parentTask: parent,
    scope,
    requests: [
      {
        key: 'review',
        role: 'reviewer',
        capabilities: ['source.read'],
        prompt: 'Review the bounded change.',
        agentId: 'codex-reviewer',
        providerId: 'untrusted-spoof',
      } as never,
      {
        key: 'tests',
        role: 'test-runner',
        capabilities: ['tests.run'],
        prompt: 'Run the bounded tests.',
        agentId: 'copilot-tester',
      },
    ],
    deadlineMs: 1_000,
    parallelism: 2,
  });

  assert.deepEqual(calls.sort(byChildKey), [
    { agentId: 'codex-reviewer', providerId: 'codex-cli', childKey: 'review' },
    { agentId: 'copilot-tester', providerId: 'official-copilot-cli', childKey: 'tests' },
  ]);
  assert.deepEqual(authorizationCalls.sort((left, right) => left.agentId.localeCompare(right.agentId)), [
    { agentId: 'codex-reviewer', requesterId: 'requester-a', role: 'reviewer' },
    { agentId: 'copilot-tester', requesterId: 'requester-a', role: 'test-runner' },
  ]);
  assert.deepEqual(result.childResults.map(identityRecord).sort(byChildKey), [
    { childKey: 'review', agentId: 'codex-reviewer', providerId: 'codex-cli' },
    { childKey: 'tests', agentId: 'copilot-tester', providerId: 'official-copilot-cli' },
  ]);
  assert.deepEqual(result.audit.entries.map(identityRecord).sort(byChildKey), [
    { childKey: 'review', agentId: 'codex-reviewer', providerId: 'codex-cli' },
    { childKey: 'tests', agentId: 'copilot-tester', providerId: 'official-copilot-cli' },
  ]);
}

async function testUnknownAndUnauthorizedAgentsFailBeforeDispatch(): Promise<void> {
  const store = await createStore('authorization');
  let executionCalls = 0;
  const runtime = createRuntime(store, {
    agents: [{
      agentId: 'restricted-reviewer',
      providerId: 'codex-cli',
      authorize: () => false,
      executeChild: async () => {
        executionCalls += 1;
        return { taskId: 'must-not-run', status: 'completed', result: 'must not run' };
      },
    }],
  });

  const unknownParent = await createParent(store, 'unknown-agent');
  await assert.rejects(
    runtime.dispatchChildren({
      parentTask: unknownParent,
      scope,
      requests: [{ key: 'review', role: 'reviewer', prompt: 'Review.', agentId: 'not-registered' }],
      deadlineMs: 1_000,
      parallelism: 1,
    }),
    /allowlist|registered agent|unknown agent/i,
  );
  assert.equal(store.getTask(unknownParent.id, scope)?.status, 'submitted');

  const deniedParent = await createParent(store, 'denied-agent');
  await assert.rejects(
    runtime.dispatchChildren({
      parentTask: deniedParent,
      scope,
      requests: [{ key: 'review', role: 'reviewer', prompt: 'Review.', agentId: 'restricted-reviewer' }],
      deadlineMs: 1_000,
      parallelism: 1,
    }),
    /not authorized|authorization/i,
  );
  assert.equal(store.getTask(deniedParent.id, scope)?.status, 'submitted');
  assert.equal(executionCalls, 0, 'unauthorized agent selection must fail before child execution');
}

async function testAgentsWithoutAuthorizationPolicyFailClosed(): Promise<void> {
  const store = await createStore('missing-authorization-policy');
  let executionCalls = 0;
  const runtime = createRuntime(store, {
    agents: [{
      agentId: 'unscoped-reviewer',
      providerId: 'unscoped-provider',
      executeChild: async () => {
        executionCalls += 1;
        return { taskId: 'must-not-run', status: 'completed', result: 'must not run' };
      },
    } as unknown as A2AProductionAgent],
    defaultAgentId: 'unscoped-reviewer',
  });

  const parent = await createParent(store, 'missing-authorization-policy');
  await assert.rejects(
    runtime.dispatchChildren({
      parentTask: parent,
      scope,
      requests: [{
        key: 'review',
        role: 'reviewer',
        capabilities: ['source.read'],
        prompt: 'Review the bounded change.',
      }],
      deadlineMs: 1_000,
      parallelism: 1,
    }),
    /authorization policy|not authorized/i,
    'a registered multi-agent entry without an authorization policy must fail closed',
  );
  assert.equal(executionCalls, 0, 'an unscoped agent must not receive a child execution');
  assert.equal(store.getTask(parent.id, scope)?.status, 'submitted');
}

async function testLegacyExecutorUsesStableDefaultIdentity(): Promise<void> {
  const store = await createStore('legacy-default');
  const parent = await createParent(store, 'legacy-default');
  const observed: Array<{ agentId: string; providerId: string }> = [];
  const runtime = createRuntime(store, {
    executeChild: async (input) => {
      observed.push({ agentId: input.agentId, providerId: input.providerId });
      return { taskId: 'legacy-job', status: 'completed', result: 'legacy result' };
    },
  });

  const result = await runtime.dispatchChildren({
    parentTask: parent,
    scope,
    requests: [{ key: 'review', role: 'reviewer', prompt: 'Review.' }],
    deadlineMs: 1_000,
    parallelism: 1,
  });

  assert.deepEqual(observed, [{ agentId: 'teams-core', providerId: 'core-default' }]);
  assert.deepEqual(identityRecord(result.childResults[0]!), {
    childKey: 'review',
    agentId: 'teams-core',
    providerId: 'core-default',
  });
  assert.deepEqual(identityRecord(result.audit.entries[0]!), {
    childKey: 'review',
    agentId: 'teams-core',
    providerId: 'core-default',
  });
}

function createRuntime(
  store: A2AStore,
  coreA2A: A2AProductionRuntimeOptions['coreA2A'],
) {
  return createA2AProductionRuntime({
    publicOrigin: 'https://runtime.example.test',
    appVersion: '1.0.51',
    store,
    authenticate: (_request, _response, next) => next(),
    resolveScope: () => scope,
    v026Execution: {
      submit: () => undefined,
      cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    },
    legacyOnTaskSubmitted: () => undefined,
    legacyOnTaskCancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    coreA2A,
  });
}

async function createStore(suffix: string): Promise<A2AStore> {
  const store = new A2AStore(path.join(root, `${suffix}.json`));
  await store.initialize();
  return store;
}

async function createParent(store: A2AStore, suffix: string) {
  return store.createOrGetTask({
    scope,
    contextId: `context-${suffix}`,
    idempotencyKey: `parent-${suffix}`,
    fingerprint: `parent-${suffix}-fingerprint`,
    message: {
      messageId: `message-${suffix}`,
      role: 'user',
      parts: [{ text: 'Run bounded children.' }],
    },
  });
}

function identityRecord(value: { childKey: string; agentId: string; providerId: string }) {
  return {
    childKey: value.childKey,
    agentId: value.agentId,
    providerId: value.providerId,
  };
}

function byChildKey(left: { childKey: string }, right: { childKey: string }): number {
  return left.childKey.localeCompare(right.childKey);
}

try {
  await testProductionRegistryRoutesIndependentProviderRunners();
  await testTrustedIndependentAgentSelectionAndPropagation();
  await testUnknownAndUnauthorizedAgentsFailBeforeDispatch();
  await testAgentsWithoutAuthorizationPolicyFailClosed();
  await testLegacyExecutorUsesStableDefaultIdentity();
  console.log('a2a-independent-agent-identity-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
