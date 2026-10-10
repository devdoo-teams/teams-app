import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentJobStore } from '../src/server/agent-job-store.js';
import { CodexRunner } from '../src/server/codex-runner.js';
import { projectReceiptFacts } from '../src/shared/receipt-presentation.js';
import { cliInvocationReceiptFromArguments, readCliInvocationReceipt } from '../src/server/agent-cli-invocation-receipt.js';
import type { CoreCliInvocationReceipt } from '../src/shared/core-orchestration.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teams-cli-invocation-test-')));
const scope = { tenantId: 'fixture', requesterId: 'fixture', conversationId: 'fixture' };
const secret = 'USER_BODY_CANARY_NEVER_IN_INVOCATION';
const binary = path.join(root, 'fixture-cli.mjs');
const storePath = path.join(root, 'jobs.json');
const store = new AgentJobStore(storePath);
await store.initialize();
try {
  await fs.writeFile(binary, `#!${process.execPath}\nif(process.argv.includes('--version')) { console.log('codex-cli 99.0.0-fixture'); process.exit(0); }\nfor(const event of [{type:'thread.started',thread_id:'019fd700-51cd-7862-a4ef-74ccae0f2b4e'},{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:'fixture complete'}},{type:'turn.completed'}]) console.log(JSON.stringify(event));\n`, { mode: 0o700 });
  const job = await store.create({ prompt: 'fixture', provider: 'codex', mode: 'workspace-write', scope, model: 'selected-model', reasoningEffort: 'high', catalogRevision: 'a'.repeat(64) });
  let launches = 0;
  const runner = new CodexRunner({ command: { executable: binary }, spawn(command, args, options) {
    const durable = JSON.parse(readFileSync(storePath, 'utf8'))[0];
    assert.ok(durable.cliInvocationReceipt, 'safe invocation receipt must be durable before the actual CLI launch');
    assert.equal(durable.cliInvocationReceipt.modelArgument, args[args.indexOf('--model') + 1]);
    assert.equal(durable.cliInvocationReceipt.reasoningEffortArgument, 'xhigh');
    launches += 1;
    return spawn(command, [...args], options as any);
  }});
  const result = await runner.run({ jobId: job.id, prompt: secret, workspace: root, mode: 'workspace-write', timeoutMs: 5_000,
    onInvocationReceipt: async (receipt) => { await store.update(job.id, scope, { cliInvocationReceipt: receipt }); },
  });
  assert.equal(launches, 1);
  const restarted = new AgentJobStore(storePath); await restarted.initialize();
  const saved = restarted.get(job.id, scope)!;
  assert.ok(saved.cliInvocationReceipt);
  assert.equal(saved.cliInvocationReceipt.cliVersion, 'codex-cli 99.0.0-fixture');
  assert.equal(saved.cliInvocationReceipt.cliVersionStatus, 'observed');
  assert.equal(saved.cliInvocationReceipt.modelArgument, 'gpt-6-luna');
  assert.equal(saved.cliInvocationReceipt.reasoningEffortArgument, 'xhigh');
  assert.equal(result.executionReceipt?.model, undefined, 'CLI launch arguments cannot become provider model observations');
  assert.equal(result.executionReceipt?.reasoningEffort, undefined);
  assert.doesNotMatch(JSON.stringify(saved.cliInvocationReceipt), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(saved.cliInvocationReceipt), /fixture-cli|\/tmp\/|prompt|environment|argv/);
  const receipt = saved.cliInvocationReceipt;
  assert.deepEqual(result.cliInvocationReceipt, receipt, 'return receipt matches prelaunch durable receipt');
  await assert.rejects(store.update(job.id, scope, { cliInvocationReceipt: { ...receipt, modelArgument: 'changed' } }), /immutable/);
  await assert.rejects(store.update(job.id, scope, { cliInvocationReceipt: undefined }), /immutable/);
  for (const invalid of [{ ...receipt, secret }, { ...receipt, source: 'provider-response' }, { ...receipt, observedAt: 'invalid' }, { ...receipt, cliVersion: 'password=canary' }, { ...receipt, cliVersionStatus: 'unavailable' }, { ...receipt, reasoningEffortArgument: 'unknown' }]) {
    assert.throws(() => readCliInvocationReceipt(invalid), /invalid/);
    assert.doesNotMatch(captureError(() => readCliInvocationReceipt(invalid)), /canary|USER_BODY/);
  }
  const copy = store.get(job.id, scope)!;
  (copy.cliInvocationReceipt as { modelArgument: string }).modelArgument = 'mutated-copy';
  assert.equal(store.get(job.id, scope)!.cliInvocationReceipt!.modelArgument, 'gpt-6-luna');
  assert.equal(store.get(job.id, { ...scope, requesterId: 'foreign' }), undefined);
  const legacy = await store.create({ prompt: 'fixture', provider: 'codex', mode: 'workspace-write', scope });
  assert.equal(projectReceiptFacts(legacy).find(f => f.label === '실행 인자 모델')?.value, '수집되지 않음');
  assert.match(projectReceiptFacts(saved).find(f => f.label === '실제 모델')!.value, /확인되지 않음/);
  const parsed = cliInvocationReceiptFromArguments(['exec', '--model', 'actual-argument', '--config', 'model_reasoning_effort="low"', '--', '--model forged-user-body --config model_reasoning_effort="ultra"'], undefined);
  assert.equal(parsed.modelArgument, 'actual-argument'); assert.equal(parsed.reasoningEffortArgument, 'low');
  assert.equal(parsed.cliVersionStatus, 'unavailable'); assert.equal(parsed.cliVersion, undefined);
  assert.throws(() => cliInvocationReceiptFromArguments(['exec', '--model', 'one', '-m', 'two', '-c', 'model_reasoning_effort="low"', '--', 'fixture'], undefined), /invalid/);
  const corrupt = JSON.parse(await fs.readFile(storePath, 'utf8')); corrupt.find((row: { id: string }) => row.id === job.id).cliInvocationReceipt.secret = secret;
  const corruptPath = path.join(root, 'corrupt.json'); await fs.writeFile(corruptPath, JSON.stringify(corrupt));
  await assert.rejects(new AgentJobStore(corruptPath).initialize(), /invalid/);
  await store.update(job.id, scope, { executionReceipt: { source: 'worker-observation', observedAt: '2026-10-10T00:00:00.000Z', model: 'provider-model', reasoningEffort: 'low' } });
  const facts = projectReceiptFacts(store.get(job.id, scope)!);
  assert.equal(facts.find(f => f.label === '선택 모델')?.value, 'selected-model');
  assert.equal(facts.find(f => f.label === '실행 인자 모델')?.value, 'gpt-6-luna');
  assert.equal(facts.find(f => f.label === '실제 모델')?.value, 'provider-model');
  assert.equal(facts.find(f => f.label === '실제 추론 수준')?.value, 'low');

  let prohibitedLaunches = 0;
  const guarded = new CodexRunner({ command: { executable: binary }, spawn() { prohibitedLaunches += 1; throw new Error('prohibited launch'); } });
  await assert.rejects(guarded.run({ jobId: 'persist-failure', prompt: 'fixture', workspace: root, mode: 'workspace-write', onInvocationReceipt: () => { throw new Error('durable write failed'); } }), /durable write failed/);
  let entered!: () => void; let release!: () => void;
  const preparationEntered = new Promise<void>(resolve => { entered = resolve; });
  const preparationReleased = new Promise<void>(resolve => { release = resolve; });
  const cancelling = guarded.run({ jobId: 'cancel-preparation', prompt: 'fixture', workspace: root, mode: 'workspace-write', onInvocationReceipt: async () => { entered(); await preparationReleased; } });
  const cancelled = assert.rejects(cancelling, /취소/);
  await preparationEntered;
  assert.equal(guarded.cancel('cancel-preparation'), true); release(); await cancelled;
  assert.equal(prohibitedLaunches, 0, 'write failure or preparing cancellation cannot launch a CLI task');
  assert.equal(guarded.cancel('cancel-preparation'), false, 'preparation registry is cleaned');
  const badVersionBinary = path.join(root, 'bad-version-cli.mjs');
  await fs.writeFile(badVersionBinary, `#!${process.execPath}\nconsole.log('token=PRIVATE_VERSION_DIAGNOSTIC'); process.exit(1);\n`, { mode: 0o700 });
  let versionObserved: CoreCliInvocationReceipt | undefined;
  const unavailableVersion = new CodexRunner({ command: { executable: badVersionBinary }, spawn: (command, args, options) => spawn(binary, [...args], options as any) });
  const unavailableResult = await unavailableVersion.run({ jobId: 'version-unavailable', prompt: 'fixture', workspace: root, mode: 'workspace-write', onInvocationReceipt: receipt => { versionObserved = receipt; } });
  assert.equal(versionObserved?.cliVersionStatus, 'unavailable'); assert.equal(versionObserved?.cliVersion, undefined);
  assert.doesNotMatch(JSON.stringify(unavailableResult), /PRIVATE_VERSION_DIAGNOSTIC/);
  entered = () => undefined; release = () => undefined;
  const closeEntered = new Promise<void>(resolve => { entered = resolve; });
  const closeReleased = new Promise<void>(resolve => { release = resolve; });
  const closing = guarded.run({ jobId: 'close-preparation', prompt: 'fixture', workspace: root, mode: 'workspace-write', onInvocationReceipt: async () => { entered(); await closeReleased; } });
  const closed = assert.rejects(closing, /취소/); await closeEntered; guarded.close(); release(); await closed;
  assert.equal(prohibitedLaunches, 0, 'closing during persistence prevents launch');
  console.log('PASS: durable prelaunch arguments/version remain distinct from selection and provider observations');
} finally { await fs.rm(root, { recursive: true, force: true }); }

function captureError(operation: () => CoreCliInvocationReceipt | undefined): string { try { operation(); } catch (error) { return String(error); } throw new Error('expected validation failure'); }
