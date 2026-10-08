import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import { AgentService, type AgentNotification } from '../src/server/agent-service.js';
import { AgentExecutionPolicy, AgentIsolationProvider, type AgentIsolationAcquireInput } from '../src/server/agent-execution-policy.js';
import { CodexRunner, type CodexRunEvent, type CodexRunResult } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';
import { CoreOrchestrationService, createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import { CoreJobCardPages } from '../src/server/core-job-card-pages.js';
import { loadJobConversation } from '../src/client/job-conversation.js';

class TestIsolation extends AgentIsolationProvider {
  constructor() { super('blocked-evidence-test'); }
  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({ ...input, spawn: () => { throw Error('No real CLI in this fixture'); } });
  }
}

class ControlledRunner {
  outcome: string | Error = '';
  pending?: { resolve: (value: CodexRunResult) => void };
  deferred = false;
  starts = 0;
  async run(input: { onEvent?: (event: CodexRunEvent) => Promise<void> | void }): Promise<CodexRunResult> {
    this.starts++;
    await input.onEvent?.({ type: 'item.started', item: { type: 'command_execution', command: '/usr/bin/awk BEGIN{print50}' } });
    if (this.outcome instanceof Error) throw this.outcome;
    if (this.deferred) return new Promise(resolve => { this.pending = { resolve }; });
    return this.resolved(this.outcome);
  }
  resolved(finalMessage: string): CodexRunResult {
    return { threadId: '01922bb7-2085-7000-8000-000000000009', finalMessage, eventCount: 2,
      tokenUsage: { source: 'codex.exec.jsonl.turn.completed.usage', inputTokens: 2, cachedInputTokens: 0, outputTokens: 3, reasoningOutputTokens: 0 },
      executionReceipt: { source: 'worker-observation', observedAt: '2026-10-08T00:00:00.000Z', platform: 'darwin', model: 'synthetic-model' } };
  }
  cancel() { return true; }
}

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teams-blocked-evidence-')));
const workspace = path.join(root, 'workspace');
await fs.mkdir(path.join(workspace, 'scripts'), { recursive: true });
await fs.writeFile(path.join(workspace, 'scripts', 'synthetic.txt'), 'Synthetic only.');
const store = new AgentJobStore(path.join(root, 'jobs.json'));
const runner = new ControlledRunner();
const scope: AgentJobScope = { tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner', conversationId: 'synthetic-private' };
const notifications: AgentNotification[] = [];
const service = new AgentService(store, runner as unknown as CodexRunner, workspace,
  async notification => { notifications.push(notification); }, new GitService(workspace), {
    canReadScope: () => true,
    canMutateScope: candidate => candidate.tenantId === scope.tenantId
      && candidate.requesterId === scope.requesterId && candidate.conversationId === scope.conversationId,
    executionPolicy: new AgentExecutionPolicy(workspace, {
      canReadScope: () => true,
      canMutateScope: candidate => candidate.tenantId === scope.tenantId
        && candidate.requesterId === scope.requesterId && candidate.conversationId === scope.conversationId,
      isolationProvider: new TestIsolation(),
    }),
    admissionJournalPath: path.join(root, 'admission.json'),
  });
const core = new CoreOrchestrationService({ agentService: service, jobStore: store });
const serverScope = createServerDerivedCoreScope(scope);
async function submit(outcome: string | Error, notify = false) {
  runner.outcome = outcome;
  const job = await service.submit({ prompt: 'Synthetic blocked evidence check', mode: 'read-only', scope, notify });
  return service.waitForTerminal(job.id, scope, 5_000);
}

try {
  await service.initialize();
  const safe = 'STATUS: BLOCKED\nEVIDENCE: synthetic awk output 50.\nBLOCKER: MCP unavailable; network disabled by profile. No request attempted.\nNEXT ACTION: record unsupported MCP without expanding access.';
  const blocked = await submit(safe, true);
  assert.equal(blocked.status, 'failed');
  assert.equal(blocked.result, safe, 'MP-362 safe structured blocked report must be retained');
  assert.match(blocked.error!, /모델 응답 기반.*원인 미확인/u, 'classification is not claimed as an observed transport failure');
  assert.doesNotMatch(blocked.error!, /네트워크 오류로 끝났습니다/u);
  assert.deepEqual(blocked.tokenUsage, runner.resolved(safe).tokenUsage);
  assert.deepEqual(blocked.executionReceipt, runner.resolved(safe).executionReceipt);
  assert.equal(blocked.threadId, undefined, 'failed resolved output does not introduce a resume identifier');
  assert.deepEqual(blocked.tools?.map(({ category, name }) => ({ category, name })), [{ category: 'cli', name: 'awk' }]);
  assert.ok(blocked.tools?.every(tool => !('status' in tool) && !('output' in tool)), 'reports cannot infer tool completion or skill/MCP provenance');

  const unsafeFragments = ['quoted-synthetic-secret', 'synthetic-device-123', 'synthetic-key-body', 'synthetic-command-argument', '/Users/synthetic', '/tmp/private-output', 'eyJsynthetic.abcdefghijk.abcdefghijkl', 'synthetic-basic-header', 'synthetic-business-data'];
  const unsafe = `STATUS: FAILED\nBLOCKER: network is disabled.\nEVIDENCE: {"client_secret":"quoted-synthetic-secret"}\nEVIDENCE: {"Authorization":"Basic synthetic-basic-header"}\nEVIDENCE: awk 'BEGIN { print "synthetic-command-argument" }'\nSTDOUT:\nsynthetic-business-data\nAuthorization: Bearer quoted-synthetic-secret\ndevice code: synthetic-device-123\n-----BEGIN PRIVATE KEY-----\nsynthetic-key-body\n-----END PRIVATE KEY-----\nhttps://user:quoted-synthetic-secret@example.test/path?token=quoted-synthetic-secret\n/Users/synthetic/.codex/auth.json\n/tmp/private-output\nCOMMAND: /usr/bin/awk synthetic-command-argument\n\`/usr/bin/awk synthetic-command-argument\`\neyJsynthetic.abcdefghijk.abcdefghijkl\n${workspace}\ncontrol:\u0001\u0085`;
  const sanitized = await submit(unsafe, true);
  assert.equal(sanitized.status, 'failed');
  assert.match(sanitized.result!, /STATUS: FAILED/u);
  assert.match(sanitized.result!, /BLOCKER: network is disabled/u);
  assert.doesNotMatch(sanitized.result!, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u);
  const restarted = new AgentJobStore(path.join(root, 'jobs.json')); await restarted.initialize();
  assert.equal(restarted.get(sanitized.id, scope)?.result, sanitized.result);
  const visible = core.get(serverScope, { jobId: sanitized.id })!;
  assert.equal(visible.result, sanitized.result);
  for (const key of ['tenantId', 'requesterId'] as const) {
    assert.equal(core.get(createServerDerivedCoreScope({ ...scope, [key]: 'foreign' }), { jobId: sanitized.id }), undefined);
  }
  const conversation = await loadJobConversation(sanitized.id, async id => core.get(serverScope, { jobId: id })!);
  assert.equal(conversation.conversation.turns[0].status, 'failed');
  assert.match(conversation.conversation.turns[0].response!, /BLOCKER: network is disabled/u);
  const pages = new CoreJobCardPages(path.join(root, 'pages.json'), { getJob: (id, authenticated) => core.get(createServerDerivedCoreScope(authenticated), { jobId: id }), update: async () => {} });
  await pages.initialize();
  const card = await pages.create(sanitized.id, scope, true, 'https://example.test/tabs/home/');
  assert.ok(card); assert.match(JSON.stringify(card.activity.attachments[3]), /BLOCKER: network is disabled/u);
  const persisted = await fs.readFile(path.join(root, 'jobs.json'), 'utf8');
  const exposed = JSON.stringify([visible, conversation, card, notifications]);
  for (const fragment of unsafeFragments) {
    assert.equal(persisted.includes(fragment), false, `persisted evidence masks ${fragment}`);
    assert.equal(exposed.includes(fragment), false, `API/cards/conversation/notifications mask ${fragment}`);
  }
  const incompleteKey = await submit('STATUS: BLOCKED\nBLOCKER: network disabled.\nEVIDENCE: -----BEGIN PRIVATE KEY-----\nsynthetic-key-body');
  assert.doesNotMatch(incompleteKey.result!, /synthetic-key-body/u);
  const bareCommand = await submit("STATUS: BLOCKED\nBLOCKER: unavailable capability.\nEVIDENCE: printf 'synthetic-printf-argument'\nCOMPLETED: printenv SYNTHETIC_PRIVATE_NAME\nNEXT ACTION: env SYNTHETIC_PRIVATE_NAME=synthetic-printf-argument");
  assert.doesNotMatch(bareCommand.result!, /synthetic-printf-argument|SYNTHETIC_PRIVATE_NAME/u);
  const descriptive = await submit('STATUS: BLOCKED\nBLOCKER: codex CLI is not logged in.\nEVIDENCE: curl could not resolve host.');
  assert.match(descriptive.result!, /codex CLI is not logged in/u);
  assert.match(descriptive.result!, /curl could not resolve host/u);

  const long = await submit('STATUS: BLOCKED\nBLOCKER: network disabled\nEVIDENCE: ' + '가'.repeat(6_000) + '\npassword=quoted-synthetic-secret');
  assert.ok(long.result && long.result.length <= 4_000);
  assert.match(long.result, /일부 생략/u);
  assert.doesNotMatch(long.result, /quoted-synthetic-secret/u);
  const unknown = await submit('STATUS: BLOCKED\nBLOCKER: synthetic capability unavailable.');
  assert.equal(unknown.status, 'failed', 'unknown structured blocker must not become successful completion');
  assert.match(unknown.result!, /synthetic capability unavailable/u);
  const none = await submit('STATUS: BLOCKED\nBLOCKER: NONE\nEVIDENCE: synthetic harmless status quote.');
  assert.equal(none.status, 'completed', 'preserve existing explicit no-blocker exception');
  const quoted = await submit('STATUS: READY\nEVIDENCE: sample report\nSTATUS: BLOCKED\nBLOCKER: network is disabled.');
  assert.equal(quoted.status, 'completed', 'quoted blocked example cannot override authoritative leading READY status');
  const quotedNone = await submit('STATUS: BLOCKED\nEVIDENCE: quoted example\n```\nBLOCKER: NONE\n```\nBLOCKER: network is disabled.\npassword=quoted-synthetic-secret');
  assert.equal(quotedNone.status, 'failed', 'quoted NONE must not bypass the blocked sanitization boundary');
  assert.doesNotMatch(quotedNone.result!, /quoted-synthetic-secret/u);
  const multilineQuote = await submit('STATUS: BLOCKED\nEVIDENCE: quoted example\n`\nBLOCKER: NONE\n`\nBLOCKER: network disabled.\npassword=quoted-synthetic-secret');
  assert.equal(multilineQuote.status, 'failed');
  assert.doesNotMatch(multilineQuote.result!, /quoted-synthetic-secret/u);
  for (const width of [2, 7, 17]) {
    const delimiter = '`'.repeat(width);
    const quotedDelimiter = await submit(`STATUS: BLOCKED\nEVIDENCE: quoted example\n${delimiter}\nBLOCKER: NONE\n${delimiter}\nBLOCKER: network disabled.\npassword=quoted-synthetic-secret`);
    assert.equal(quotedDelimiter.status, 'failed', `quote delimiter width ${width} cannot bypass failure`);
    assert.doesNotMatch(quotedDelimiter.result!, /quoted-synthetic-secret/u);
  }
  const completed = await submit('Synthetic completed output 50'); assert.equal(completed.status, 'completed'); assert.equal(completed.result, 'Synthetic completed output 50');
  const thrown = await submit(new Error('synthetic runner failure token=quoted-synthetic-secret'));
  assert.equal(thrown.status, 'failed'); assert.equal(thrown.result, undefined); assert.doesNotMatch(thrown.error!, /quoted-synthetic-secret/u);
  runner.deferred = true; runner.outcome = safe;
  const late = await service.submit({ prompt: 'Synthetic late cancel', mode: 'read-only', scope, notify: false });
  const deadline = Date.now() + 5_000;
  while (!runner.pending && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(runner.pending);
  const cancellation = service.cancelStrict(late.id, scope);
  const cancelDeadline = Date.now() + 5_000;
  while (store.get(late.id, scope)?.status !== 'cancelled' && Date.now() < cancelDeadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(store.get(late.id, scope)?.status, 'cancelled');
  runner.pending.resolve(runner.resolved(safe));
  await cancellation;
  runner.deferred = false;
  await service.close();
  assert.equal(store.get(late.id, scope)?.status, 'cancelled');
  assert.equal(store.get(late.id, scope)?.result, undefined);
  assert.equal(notifications.filter(n => n.job.id === blocked.id && n.phase === 'completed').length, 0);
  console.log('PASS: safe blocked evidence, classification, privacy, restart/scope, card/conversation, bounds and terminal invariants');
} finally {
  await service.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
