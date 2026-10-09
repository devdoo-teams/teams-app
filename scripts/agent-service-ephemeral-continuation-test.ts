import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { observeTeamsCliTestCatalog, teamsCliTestSelection } from './fixtures/teams-cli-agent-policy-fixture.js';
import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import { AgentService } from '../src/server/agent-service.js';
import { AgentExecutionPolicy, AgentIsolationProvider, type AgentIsolationAcquireInput } from '../src/server/agent-execution-policy.js';
import { CodexRunner, buildCodexExecArguments } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';

class SyntheticRunner {
  readonly calls: Array<{ prompt: string; threadId?: string; mode: string }> = [];
  async run(input: { prompt: string; threadId?: string; mode: string }) {
    this.calls.push(input);
    return {
      threadId: '11111111-1111-4111-8111-111111111111',
      finalMessage: 'SYNTHETIC_FOLLOWUP_OK',
      eventCount: 1,
    };
  }
  cancel() { return true; }
  async close() {}
}

class SyntheticIsolation extends AgentIsolationProvider {
  constructor() { super('ephemeral-continuation-fixture'); }
  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({
      ...input,
      spawn: () => { throw new Error('Synthetic test never launches a CLI'); },
    });
  }
}

assert.throws(() => buildCodexExecArguments({
  prefixArgs: [], mode: 'read-only', workspace: os.tmpdir(), enrichedPrompt: 'SYNTHETIC_ONLY',
  threadId: '22222222-2222-4222-8222-222222222222',
}), /ephemeral.*cannot be resumed/i, 'native ephemeral resume must be rejected before process launch');
assert.ok(buildCodexExecArguments({
  prefixArgs: [], mode: 'read-only', workspace: os.tmpdir(), enrichedPrompt: 'SYNTHETIC_ONLY',
}).includes('--ephemeral'), 'the fix must preserve the non-persistent read-only permission contract');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-ephemeral-continuation-test-'));
const workspace = path.join(root, 'workspace');
await fs.mkdir(workspace);
await fs.mkdir(path.join(workspace, 'src'));
await fs.writeFile(path.join(workspace, 'src', 'fixture.txt'), 'SYNTHETIC_ONLY');
const scope: AgentJobScope = { tenantId: 'synthetic-tenant', requesterId: 'synthetic-user', conversationId: 'synthetic-chat' };
const store = new AgentJobStore(path.join(root, 'jobs.json'));
const runner = new SyntheticRunner();
const copilot = new SyntheticRunner();
const notifications: string[] = [];
const service = new AgentService(store, runner as unknown as CodexRunner, workspace,
  async ({ job }) => { notifications.push(job.id); }, new GitService(workspace), {
      observeCodexModelCatalog: observeTeamsCliTestCatalog,
    canReadScope: () => true,
    canMutateScope: () => true,
    executionPolicy: new AgentExecutionPolicy(workspace, {
      canReadScope: () => true, canMutateScope: () => true, isolationProvider: new SyntheticIsolation(),
    }),
    providerRunners: { copilot: copilot as unknown as CodexRunner },
  });

try {
  await service.initialize();
  const parent = await store.create({ ...teamsCliTestSelection, prompt: 'Synthetic prior request: what is 17+25?', provider: 'codex', mode: 'read-only', scope,
    threadId: '22222222-2222-4222-8222-222222222222', durableNotifications: { enabled: false, delivered: [] } });
  await store.update(parent.id, scope, { status: 'running' });
  await store.update(parent.id, scope, { status: 'completed', result: 'SYNTHETIC_PRIOR_RESULT: 42', finishedAt: new Date().toISOString() });

  const followup = await service.continue(parent.id, 'Synthetic follow-up: repeat the previous answer.', scope, { notify: true });
  assert.ok(followup);
  const completed = await service.waitForTerminal(followup.id, scope, 5_000);
  assert.equal(completed.status, 'completed');
  assert.equal(runner.calls[0].threadId, undefined, 'ephemeral Codex read-only follow-up must never issue native resume');
  assert.ok(runner.calls[0].prompt.includes('SYNTHETIC_PRIOR_RESULT: 42'), 'fresh follow-up carries only the scoped prior result');
  assert.ok(runner.calls[0].prompt.includes('Synthetic prior request: what is 17+25?'));
  assert.ok(runner.calls[0].prompt.includes('Synthetic follow-up: repeat the previous answer.'));
  assert.equal(completed.prompt, 'Synthetic follow-up: repeat the previous answer.', 'persist user input without rewriting it as generated context');
  assert.equal(completed.parentJobId, parent.id, 'retain authoritative conversation linkage');
  assert.equal(completed.durableNotifications?.enabled, false, 'private delivery intent survives the stateless follow-up');
  assert.deepEqual(notifications, []);
  assert.equal(service.latestCompletedForConversation(scope), undefined, 'private A2A/job results are not implicit personal-chat context');

  const beforeForeign = runner.calls.length;
  assert.equal(await service.continue(parent.id, 'foreign attempt', { ...scope, requesterId: 'other-user' }), undefined);
  assert.equal(runner.calls.length, beforeForeign, 'scoped foreign context cannot reach the runner');

  const personal = await store.create({ ...teamsCliTestSelection, prompt: 'Personal synthetic context', provider: 'codex', mode: 'read-only', scope,
    threadId: '33333333-3333-4333-8333-333333333333', durableNotifications: { enabled: true, delivered: [] } });
  await store.update(personal.id, scope, { status: 'running' });
  await store.update(personal.id, scope, { status: 'completed', result: 'PERSONAL_OK', finishedAt: new Date().toISOString() });
  const foreignProvider = await store.create({ prompt: 'Other provider context', provider: 'copilot', mode: 'read-only', scope,
    threadId: '44444444-4444-4444-8444-444444444444', durableNotifications: { enabled: true, delivered: [] } });
  await store.update(foreignProvider.id, scope, { status: 'running' });
  await store.update(foreignProvider.id, scope, { status: 'completed', result: 'COPILOT_OK', finishedAt: new Date().toISOString() });
  assert.equal(service.latestCompletedForConversation(scope)?.id, personal.id, 'implicit continuation stays with the configured personal provider');
  const beforeCopilot = store.listLocalOnly(100).length;
  await assert.rejects(service.continue(foreignProvider.id, 'Persistent provider follow-up', scope, { notify: false }), /Teams CLI policy.*unverified/u);
  assert.equal(copilot.calls.length, 0, 'unverified provider cannot resume using its default model');
  assert.equal(store.listLocalOnly(100).length, beforeCopilot, 'Copilot rejection creates no replacement job');

  const failed = await store.create({ ...teamsCliTestSelection, prompt: 'Synthetic retry request', provider: 'codex', mode: 'read-only', scope,
    threadId: parent.threadId, parentJobId: parent.id, durableNotifications: { enabled: false, delivered: [] } });
  await store.update(failed.id, scope, { status: 'running' });
  await store.update(failed.id, scope, { status: 'failed', error: 'synthetic missing rollout', finishedAt: new Date().toISOString() });
  const retry = await service.retry(failed.id, scope, { notify: true });
  assert.ok(retry);
  assert.equal((await service.waitForTerminal(retry.id, scope, 5_000)).status, 'completed');
  assert.equal(runner.calls.at(-1)?.threadId, undefined, 'retry cannot reintroduce stale ephemeral resume');
  assert.ok(runner.calls.at(-1)?.prompt.includes('SYNTHETIC_PRIOR_RESULT: 42'), 'retry follows scoped parent linkage to completed context');

  const large = await store.create({ ...teamsCliTestSelection, prompt: 'Large synthetic context', provider: 'codex', mode: 'read-only', scope,
    durableNotifications: { enabled: false, delivered: [] } });
  await store.update(large.id, scope, { status: 'running' });
  await store.update(large.id, scope, { status: 'completed', result: 'SYNTHETIC_LONG_START' + '한'.repeat(19_900), finishedAt: new Date().toISOString() });
  const bounded = await service.continue(large.id, 'Synthetic bounded follow-up', scope);
  assert.ok(bounded, 'stateless continuation does not require a native session ID');
  assert.equal((await service.waitForTerminal(bounded.id, scope, 5_000)).status, 'completed');
  const boundedPrompt = runner.calls.at(-1)!.prompt;
  assert.ok(Buffer.byteLength(boundedPrompt, 'utf8') < 32_768, 'large prior results cannot exceed CLI argument bounds');
  assert.ok(boundedPrompt.includes('SYNTHETIC_LONG_START'));
  assert.ok(boundedPrompt.includes('"resultTruncated":true'), 'context truncation is explicit');

  console.log('PASS: ephemeral Codex continuation, scoped context, private delivery and provider separation');
} finally {
  await service.close();
  await fs.rm(root, { recursive: true, force: true });
}
