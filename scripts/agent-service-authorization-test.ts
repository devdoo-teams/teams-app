import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import {
  AgentMutationAuthorizationError,
  AgentService,
} from '../src/server/agent-service.js';
import {
  AgentExecutionPolicy,
  AgentExecutionUnavailableError,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
} from '../src/server/agent-execution-policy.js';
import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { CodexRunner } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';

class NoopRunner {
  runs = 0;

  async run(): Promise<{ threadId: string; finalMessage: string; eventCount: number }> {
    this.runs += 1;
    return { threadId: 'thread-noop', finalMessage: 'noop', eventCount: 1 };
  }

  cancel(): boolean { return true; }
}

class ProjectionRunner {
  runs = 0;
  observedWorkspace?: string;
  sourceText?: string;
  exposedCanaries: string[] = [];

  async run(options: { workspace: string }): Promise<{ threadId: string; finalMessage: string; eventCount: number }> {
    this.runs += 1;
    this.observedWorkspace = options.workspace;
    this.sourceText = await fs.readFile(path.join(options.workspace, 'src', 'visible.ts'), 'utf8');
    for (const relativePath of ['.env', '.git/config', 'data/secret.json', 'private.key']) {
      try {
        await fs.access(path.join(options.workspace, relativePath));
        this.exposedCanaries.push(relativePath);
      } catch {
        // The projection must not contain canaries.
      }
    }
    return { threadId: 'thread-projection', finalMessage: 'projection inspected', eventCount: 1 };
  }

  cancel(): boolean { return true; }
}

class TestIsolationProvider extends AgentIsolationProvider {
  constructor() { super('authorization-test-provider'); }

  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({
      subject: input.subject,
      workspace: input.workspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: () => { throw new Error('authorization tests use a fake runner'); },
    });
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

async function waitForRemoved(target: string): Promise<void> {
  await waitFor(async () => {
    try {
      await fs.access(target);
      return false;
    } catch {
      return true;
    }
  }, `projection was not removed: ${target}`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-authz-'));
try {
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'data'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'src', 'visible.ts'), 'export const visible = true;\n', 'utf8');
  await fs.writeFile(path.join(workspace, '.env'), 'TOKEN=env-canary\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'data', 'secret.json'), '{"secret":"data-canary"}\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'private.key'), 'key-canary\n', 'utf8');

  const allowed: AgentJobScope = { requesterId: 'allowed-user', conversationId: 'conversation-a', tenantId: 'tenant-a' };
  const blocked: AgentJobScope = { requesterId: 'blocked-user', conversationId: 'conversation-b', tenantId: 'tenant-a' };
  const gitService = new GitService(workspace);

  const blockedStore = new AgentJobStore(path.join(root, 'blocked-jobs.json'));
  const blockedRunner = new NoopRunner();
  const blockedService = new AgentService(
    blockedStore,
    blockedRunner as unknown as CodexRunner,
    workspace,
    async () => undefined,
    gitService,
    { canMutateScope: (scope) => scope.requesterId === allowed.requesterId, admissionJournalPath: path.join(root, 'blocked-admission.json') },
  );
  await blockedService.initialize();
  await assert.rejects(
    () => blockedService.submit({ prompt: 'read forbidden', mode: 'read-only', scope: blocked }),
    AgentMutationAuthorizationError,
  );
  assert.equal(blockedStore.listLocalOnly(20).length, 0);
  assert.equal(blockedRunner.runs, 0);
  await assert.rejects(
    () => blockedService.runForCopilot({ prompt: 'natural language read', scope: blocked, timeoutMs: 100 }),
    AgentMutationAuthorizationError,
  );

  const unavailableStore = new AgentJobStore(path.join(root, 'unavailable-jobs.json'));
  const unavailableRunner = new NoopRunner();
  const unavailableService = new AgentService(
    unavailableStore,
    unavailableRunner as unknown as CodexRunner,
    workspace,
    async () => undefined,
    gitService,
    { canMutateScope: () => true, canReadScope: () => true, admissionJournalPath: path.join(root, 'unavailable-admission.json') },
  );
  await unavailableService.initialize();
  await assert.rejects(
    () => unavailableService.submit({ prompt: 'read without provider', mode: 'read-only', scope: allowed }),
    (error: unknown) => error instanceof AgentExecutionUnavailableError && error.code === 'UNAVAILABLE',
  );
  assert.equal(unavailableStore.listLocalOnly(20).length, 0, 'missing production provider rejects before persistence');
  assert.equal(unavailableRunner.runs, 0, 'missing production provider rejects before spawn');

  const provider = new TestIsolationProvider();
  const projectionStorePath = path.join(root, 'projection-jobs.json');
  const projectionStore = new AgentJobStore(projectionStorePath);
  const projectionRunner = new ProjectionRunner();
  const projectionPolicy = new AgentExecutionPolicy(workspace, {
    canMutateScope: () => true,
    canReadScope: () => true,
    isolationProvider: provider,
  });
  const projectionController = new AgentAdmissionController(
    { globalLimit: 2, perTenantLimit: 2, perRequesterLimit: 1 },
    { journalPath: path.join(root, 'projection-admission.json') },
  );
  const projectionService = new AgentService(
    projectionStore,
    projectionRunner as unknown as CodexRunner,
    workspace,
    async () => undefined,
    gitService,
    { canMutateScope: () => true, canReadScope: () => true, executionPolicy: projectionPolicy, admissionController: projectionController },
  );
  await projectionService.initialize();
  const projected = await projectionService.submit({ prompt: 'inspect allowlisted source', mode: 'read-only', scope: allowed });
  await waitFor(() => projectionStore.get(projected.id, allowed)?.status === 'completed', 'projection job did not complete');
  assert.notEqual(projectionRunner.observedWorkspace, workspace);
  assert.equal(projectionRunner.sourceText, 'export const visible = true;\n');
  assert.deepEqual(projectionRunner.exposedCanaries, []);
  assert.equal(projectionRunner.runs, 1);
  await waitForRemoved(projectionRunner.observedWorkspace!);

  const persistedBeforeAbsolute = projectionStore.listLocalOnly(20).length;
  await assert.rejects(
    () => projectionService.submit({ prompt: `inspect ${workspace}/owned.txt`, mode: 'read-only', scope: allowed }),
    (error: unknown) => error instanceof AgentExecutionUnavailableError && error.code === 'UNAVAILABLE',
  );
  assert.equal(projectionStore.listLocalOnly(20).length, persistedBeforeAbsolute, 'absolute source path has persistence=0');
  assert.equal(projectionRunner.runs, 1, 'absolute source path has spawn=0');

  const unstableStore = new AgentJobStore(path.join(root, 'unstable-jobs.json'));
  const unstablePolicy = new AgentExecutionPolicy(workspace, {
    canMutateScope: () => true,
    canReadScope: () => true,
    isolationProvider: provider,
    projectionHooks: { afterCopy: async () => fs.writeFile(path.join(workspace, 'src', 'visible.ts'), 'changed during projection\n', 'utf8') },
  });
  const unstableService = new AgentService(
    unstableStore,
    new NoopRunner() as unknown as CodexRunner,
    workspace,
    async () => undefined,
    gitService,
    { canMutateScope: () => true, canReadScope: () => true, executionPolicy: unstablePolicy, admissionJournalPath: path.join(root, 'unstable-admission.json') },
  );
  await unstableService.initialize();
  await assert.rejects(
    () => unstableService.submit({ prompt: 'detect source mutation', mode: 'read-only', scope: allowed }),
    /작업공간을 안전하게 준비하지 못했습니다/,
  );
  assert.equal(unstableStore.listLocalOnly(20).length, 0);
  await fs.writeFile(path.join(workspace, 'src', 'visible.ts'), 'export const visible = true;\n', 'utf8');

  await fs.symlink(path.join(root, 'outside'), path.join(workspace, 'src', 'escape-link'));
  await assert.rejects(
    () => projectionService.submit({ prompt: 'unsafe symlink', mode: 'read-only', scope: allowed }),
    /작업공간을 안전하게 준비하지 못했습니다/,
  );
  assert.equal(projectionStore.listLocalOnly(20).length, persistedBeforeAbsolute);
  await fs.unlink(path.join(workspace, 'src', 'escape-link'));

  await fs.link(path.join(workspace, '.env'), path.join(workspace, 'src', 'hardlink-canary.ts'));
  await assert.rejects(
    () => projectionService.submit({ prompt: 'unsafe hardlink', mode: 'read-only', scope: allowed }),
    /작업공간을 안전하게 준비하지 못했습니다/,
  );
  assert.equal(projectionStore.listLocalOnly(20).length, persistedBeforeAbsolute);
  await fs.unlink(path.join(workspace, 'src', 'hardlink-canary.ts'));

  const failedRead = await blockedStore.create({ prompt: 'retry policy', provider: 'codex', mode: 'read-only', scope: blocked });
  await blockedStore.update(failedRead.id, blocked, { status: 'failed', error: 'expected', finishedAt: new Date().toISOString() });
  await assert.rejects(() => blockedService.retry(failedRead.id, blocked), AgentMutationAuthorizationError);
  const completedRead = await blockedStore.create({ prompt: 'continue policy', provider: 'codex', mode: 'read-only', scope: blocked });
  await blockedStore.update(completedRead.id, blocked, { status: 'completed', threadId: 'thread-forbidden', result: 'done', finishedAt: new Date().toISOString() });
  await assert.rejects(() => blockedService.continue(completedRead.id, 'continue', blocked), AgentMutationAuthorizationError);
  await assert.rejects(() => blockedService.submit({ prompt: 'write forbidden', mode: 'workspace-write', scope: blocked }), AgentMutationAuthorizationError);

  await Promise.all([blockedService.close(), unavailableService.close(), projectionService.close(), unstableService.close()]);
  console.log('PASS: AgentService central policy blocks unauthorized/missing-provider/absolute-path read-only work before persistence or spawn and verifies projection canaries/TOCTOU/symlink/hardlink rejection');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
