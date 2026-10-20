import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
const cli = fileURLToPath(new URL('../capture-run.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ci-live-capture-fixture-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, 'repo'); const temp = join(root, 'runner'); mkdirSync(workspace); mkdirSync(temp);
  mkdirSync(join(workspace, '.github')); mkdirSync(join(workspace, '.github/workflows'));
  writeFileSync(join(workspace, '.github/workflows/core-ci.yml'), 'name: Fixture\njobs:\n  core:\n    name: Core verification\n    runs-on: ubuntu-latest\n    steps:\n      - name: Original first\n        id: ci_original_1\n        run: echo first\n      - name: Original second\n        id: ci_original_2\n        run: echo second\n');
  writeFileSync(join(workspace, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  writeFileSync(join(workspace, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
  const git = (...args) => { const value = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: workspace, encoding: 'utf8', timeout: 10000 }); assert.equal(value.status, 0, value.stderr); return value.stdout.trim(); };
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=CI Fixture', '-c', 'user.email=ci-fixture@invalid.example', 'commit', '--no-gpg-sign', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'devdoo-teams/teams-app', GITHUB_RUN_ID: '1001', GITHUB_RUN_NUMBER: '42',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'core', GITHUB_WORKFLOW_REF: 'devdoo-teams/teams-app/.github/workflows/core-ci.yml@refs/heads/main',
    GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha, GITHUB_WORKSPACE: workspace, RUNNER_TEMP: temp, RUNNER_OS: 'macOS', RUNNER_ARCH: 'ARM64', TEAMS_CI_RECEIPT_MODE: 'fixture' };
  const base = join(temp, 'teams-ci-receipts', '1001', '1', 'core');
  return { root, workspace, temp, env, sha, base };
}
test('custom shell executes unchanged Bash script once and preserves its original nonzero exit', (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'printf once >> marker\nexit 7\nprintf never >> marker\n');
  const value = spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(value.status, 7, value.stderr); assert.equal(readFileSync(join(f.workspace, 'marker'), 'utf8'), 'once');
  const result = JSON.parse(readFileSync(join(f.base, 'raw/step-1-result.json')));
  assert.equal(result.exitCode, 7); assert.equal(result.context.testedSha, f.sha); assert.equal(result.context.attempt, 1);
  assert.equal(result.evidenceKind, 'FIXTURE'); assert.equal(result.signal, null);
});

test('finalizer links actual command observations and clean Git source into the existing producer', async (t) => {
  const f = fixture(t);
  for (const index of [1, 2]) {
    const script = join(f.temp, `script-${index}.sh`); writeFileSync(script, `printf ${index} >> marker\n`);
    const result = spawnSync(process.execPath, [cli, `step-${index}`, script], { cwd: f.workspace, env: f.env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  }
  const { finalizeRunner } = await import('../lib/runner-finalize.mjs');
  const finalized = finalizeRunner({ ...f.env, CI_RECEIPT_JOB_STATUS: 'success', CI_RECEIPT_RESULTS: JSON.stringify({ 'step-1': { outcome: 'success', conclusion: 'success' }, 'step-2': { outcome: 'success', conclusion: 'success' } }) });
  assert.equal(finalized.integrity, 'PASS'); assert.equal(readFileSync(join(f.workspace, 'marker'), 'utf8'), '12');
  const { readProducerCapture } = await import('../lib/producer.mjs'); const value = readProducerCapture(finalized.captureDirectory);
  assert.equal(value.receipt.inputs.testedSha, f.sha); assert.equal(value.receipt.producer.runNumber, '42');
  assert.equal(value.receipt.exitCode, 0); assert.equal(value.receipt.tests.executed, null);
  assert.equal(value.receipt.executionBoundary, 'RUN_SCOPES'); assert.equal(value.receipt.evidenceKind, 'FIXTURE');
  assert.equal(value.scopeReport.observed.length, 2); assert.equal(value.provenance.sourceAuthenticity, 'UNVERIFIED');
  const proof = JSON.parse(readFileSync(join(finalized.exportDirectory, 'source-proof.json')));
  assert.match(proof.observerSha256, /^[a-f0-9]{64}$/); assert.equal(proof.observerSourceBinding, 'LOCAL_OBSERVER_BYTES');
  assert.ok(proof.observerFiles.some((row) => row.file === 'scripts/core-test-runner.mjs'));
  assert.deepEqual(readFileSync(join(finalized.exportDirectory, 'raw/step-1-result.json')), readFileSync(join(f.base, 'raw/step-1-result.json')));
});

test('implicit Bash pipeline semantics, environment inheritance and metadata privacy are preserved', (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh');
  writeFileSync(script, 'false | true\nprintf "%s" "$VISIBLE_FIXTURE_VALUE" >> marker\n');
  const env = { ...f.env, VISIBLE_FIXTURE_VALUE: 'inherited', GITHUB_TOKEN: 'PRIVATE_SENTINEL_NEVER_SERIALIZE' };
  const result = spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(readFileSync(join(f.workspace, 'marker'), 'utf8'), 'inherited');
  for (const file of ['session.json', 'raw/step-1-start.json', 'raw/step-1-result.json']) assert.ok(!readFileSync(join(f.base, file), 'utf8').includes('PRIVATE_SENTINEL'));
});

test('duplicate invocation never reruns a command and a new attempt gets a distinct immutable session', (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'printf x >> marker\n');
  const run = (env) => spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(run(f.env).status, 0); const original = readFileSync(join(f.base, 'raw/step-1-result.json'));
  assert.equal(run(f.env).status, 2); assert.equal(readFileSync(join(f.workspace, 'marker'), 'utf8'), 'x');
  assert.equal(run({ ...f.env, GITHUB_RUN_ATTEMPT: '2' }).status, 0);
  const next = JSON.parse(readFileSync(join(f.temp, 'teams-ci-receipts/1001/2/core/session.json')));
  const previous = JSON.parse(readFileSync(join(f.base, 'session.json')));
  assert.notEqual(next.context.invocationId, previous.context.invocationId); assert.equal(next.context.attempt, 2);
  assert.deepEqual(readFileSync(join(f.base, 'raw/step-1-result.json')), original);
});

test('dirty or contradictory source fails before executing a script', (t) => {
  for (const mode of ['dirty', 'wrong-sha']) {
    const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'printf unsafe >> marker\n');
    if (mode === 'dirty') writeFileSync(join(f.workspace, 'package.json'), '{"changed":true}\n');
    const env = mode === 'wrong-sha' ? { ...f.env, GITHUB_SHA: 'b'.repeat(40) } : f.env;
    const result = spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 2); assert.equal(existsSync(join(f.workspace, 'marker')), false);
  }
});

test('a failed original command retains nonzero receipt and an explicitly skipped later step', async (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'exit 9\n');
  assert.equal(spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, timeout: 10000 }).status, 9);
  const { finalizeRunner } = await import('../lib/runner-finalize.mjs');
  const result = finalizeRunner({ ...f.env, CI_RECEIPT_JOB_STATUS: 'failure', CI_RECEIPT_RESULTS: JSON.stringify({ 'step-1': { outcome: 'failure', conclusion: 'failure' }, 'step-2': { outcome: 'skipped', conclusion: 'skipped' } }) });
  assert.equal(result.integrity, 'PASS');
  const { readProducerCapture } = await import('../lib/producer.mjs'); const value = readProducerCapture(result.captureDirectory);
  assert.equal(value.receipt.exitCode, 9); assert.equal(value.receipt.coverageComplete, false);
  assert.equal(value.scopeReport.observed[1].state, 'NOT_RUN'); assert.equal(value.receipt.tests.executed, null);
});

test('missing terminal or entire run receipt is retained as missing evidence and cannot pass integrity', async (t) => {
  for (const suffix of ['result', 'both']) {
    const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'true\n');
    assert.equal(spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, timeout: 10000 }).status, 0);
    rmSync(join(f.base, 'raw/step-1-result.json'));
    if (suffix === 'both') rmSync(join(f.base, 'raw/step-1-start.json'));
    const { finalizeRunner } = await import('../lib/runner-finalize.mjs');
    const value = finalizeRunner({ ...f.env, CI_RECEIPT_JOB_STATUS: 'failure', CI_RECEIPT_RESULTS: JSON.stringify({ 'step-1': { outcome: 'failure', conclusion: 'failure' }, 'step-2': { outcome: 'skipped', conclusion: 'skipped' } }) });
    assert.equal(value.integrity, 'BLOCKED');
    assert.ok(value.issues.includes(suffix === 'both' ? 'RUN_RECEIPT_MISSING' : 'TERMINAL_RECEIPT_MISSING'));
    const evidence = JSON.parse(readFileSync(join(value.exportDirectory, 'runner-evidence.json')));
    assert.equal(evidence.observed[0].state, 'MISSING'); assert.equal(evidence.observed[0].exitCode, null);
  }
});

test('engine action outcomes preserve unknown exit and timing instead of inventing success evidence', async (t) => {
  const f = fixture(t); const workflow = join(f.workspace, '.github/workflows/core-ci.yml');
  writeFileSync(workflow, readFileSync(workflow, 'utf8').replace('run: echo first', 'uses: actions/checkout@' + 'a'.repeat(40)));
  const git = (...args) => spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: f.workspace, encoding: 'utf8', timeout: 10000 });
  git('add', '.'); assert.equal(git('-c', 'user.name=CI Fixture', '-c', 'user.email=ci-fixture@invalid.example', 'commit', '--no-gpg-sign', '-qm', 'action fixture').status, 0);
  const sha = git('rev-parse', 'HEAD').stdout.trim(); const env = { ...f.env, GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha };
  const script = join(f.temp, 'script.sh'); writeFileSync(script, 'true\n');
  assert.equal(spawnSync(process.execPath, [cli, 'step-2', script], { cwd: f.workspace, env, timeout: 10000 }).status, 0);
  const { finalizeRunner } = await import('../lib/runner-finalize.mjs');
  const result = finalizeRunner({ ...env, CI_RECEIPT_JOB_STATUS: 'success', CI_RECEIPT_RESULTS: JSON.stringify({ 'step-1': { outcome: 'success', conclusion: 'success' }, 'step-2': { outcome: 'success', conclusion: 'success' } }) });
  assert.equal(result.integrity, 'PASS');
  const { readProducerCapture } = await import('../lib/producer.mjs'); const value = readProducerCapture(result.captureDirectory);
  assert.equal(value.scopeReport.observed[0].state, 'OUTCOME_ONLY'); assert.equal(value.scopeReport.observed[0].startedAt, null);
  assert.equal(value.scopeReport.observed[0].exitCode, null); assert.equal(value.receipt.coverageComplete, false);
});

test('termination produces a signal observation without inventing a child exit code', async (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'node -e "setTimeout(() => {}, 10000)"\n');
  const child = spawn(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, stdio: 'ignore' });
  const end = Date.now() + 5000;
  while (!existsSync(join(f.base, 'raw/step-1-start.json')) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(existsSync(join(f.base, 'raw/step-1-start.json')), true);
  await new Promise((resolve) => setTimeout(resolve, 100)); child.kill('SIGTERM');
  const outcome = await Promise.race([new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal }))), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('termination timeout')), 5000); timer.unref(); })]);
  assert.notEqual(outcome.code, 0);
  const result = JSON.parse(readFileSync(join(f.base, 'raw/step-1-result.json')));
  assert.equal(result.exitCode, null); assert.equal(result.signal, 'SIGTERM'); assert.equal(result.requestedSignal, 'SIGTERM');
});

test('signal forwarding leaves the existing runner cancellation deadline in control', async (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh');
  writeFileSync(script, 'exec node -e \'require("fs").writeFileSync("ready", String(process.pid)); process.on("SIGTERM", () => setTimeout(() => process.exit(23), 1800)); setInterval(() => {}, 1000)\'\n');
  const child = spawn(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, stdio: 'ignore' });
  const closed = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  t.after(() => child.kill('SIGKILL'));
  const end = Date.now() + 5000;
  while (!existsSync(join(f.workspace, 'ready')) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(existsSync(join(f.workspace, 'ready')), true);
  child.kill('SIGTERM'); assert.equal(await closed, 23);
});

test('a script signal is preserved without labeling it an engine cancellation', async (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'kill -TERM $$\n');
  const run = spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, timeout: 10000 });
  assert.equal(run.status, 143);
  const { finalizeRunner } = await import('../lib/runner-finalize.mjs');
  const result = finalizeRunner({ ...f.env, CI_RECEIPT_JOB_STATUS: 'failure', CI_RECEIPT_RESULTS: JSON.stringify({ 'step-1': { outcome: 'failure', conclusion: 'failure' }, 'step-2': { outcome: 'skipped', conclusion: 'skipped' } }) });
  assert.equal(result.integrity, 'PASS');
  const { readProducerCapture } = await import('../lib/producer.mjs'); const value = readProducerCapture(result.captureDirectory);
  assert.equal(value.scopeReport.observed[0].state, 'SIGNALLED'); assert.equal(value.scopeReport.observed[0].runner.signal, 'SIGTERM');
  assert.equal(value.receipt.exitCode, null); assert.equal(value.receipt.coverageComplete, false);
});

test('an existing fixture session cannot be promoted into an observation session', (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'printf x >> marker\n');
  assert.equal(spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, timeout: 10000 }).status, 0);
  assert.equal(spawnSync(process.execPath, [cli, 'step-2', script], { cwd: f.workspace, env: { ...f.env, TEAMS_CI_RECEIPT_MODE: 'observation' }, timeout: 10000 }).status, 2);
  assert.equal(readFileSync(join(f.workspace, 'marker'), 'utf8'), 'x');
});

test('an actual abrupt observer exit leaves a start-only receipt and blocks integrity', async (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'printf "%s" "$$" > owned-pid\nsleep 10\nprintf never > after\n');
  const child = spawn(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, stdio: 'ignore' });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  let group;
  t.after(() => { if (group) { try { process.kill(-group, 'SIGKILL'); } catch {} } child.kill('SIGKILL'); });
  const end = Date.now() + 5000;
  while (!existsSync(join(f.workspace, 'owned-pid')) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(existsSync(join(f.workspace, 'owned-pid')), true);
  group = Number(readFileSync(join(f.workspace, 'owned-pid'), 'utf8')); assert.ok(Number.isSafeInteger(group) && group > 1);
  child.kill('SIGKILL'); process.kill(-group, 'SIGKILL');
  const outcome = await closed; assert.equal(outcome.signal, 'SIGKILL');
  assert.equal(existsSync(join(f.base, 'raw/step-1-result.json')), false);
  const { finalizeRunner } = await import('../lib/runner-finalize.mjs');
  const value = finalizeRunner({ ...f.env, CI_RECEIPT_JOB_STATUS: 'failure', CI_RECEIPT_RESULTS: JSON.stringify({ 'step-1': { outcome: 'failure', conclusion: 'failure' }, 'step-2': { outcome: 'skipped', conclusion: 'skipped' } }) });
  assert.equal(value.integrity, 'BLOCKED'); assert.ok(value.issues.includes('TERMINAL_RECEIPT_MISSING'));
  assert.equal(existsSync(join(f.workspace, 'after')), false);
});

test('engine contradictions and replayed attempt metadata cannot become successful evidence', async (t) => {
  for (const mode of ['engine', 'replay']) {
    const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'true\n');
    assert.equal(spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, timeout: 10000 }).status, 0);
    if (mode === 'replay') {
      const path = join(f.base, 'raw/step-1-result.json'); const raw = JSON.parse(readFileSync(path)); raw.context.attempt = 2; writeFileSync(path, JSON.stringify(raw));
    }
    const { finalizeRunner } = await import('../lib/runner-finalize.mjs');
    const env = { ...f.env, CI_RECEIPT_JOB_STATUS: 'failure', CI_RECEIPT_RESULTS: JSON.stringify({ 'step-1': { outcome: 'failure', conclusion: 'failure' }, 'step-2': { outcome: 'skipped', conclusion: 'skipped' } }) };
    if (mode === 'replay') assert.throws(() => finalizeRunner(env), /RAW_IDENTITY_MISMATCH/);
    else { const value = finalizeRunner(env); assert.equal(value.integrity, 'BLOCKED'); assert.ok(value.issues.includes('ENGINE_RUN_RESULT_CONFLICT')); }
  }
});

test('source changes after a failed command block admission while retaining original safe failure bytes', (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'printf changed > package.json\nexit 19\n');
  assert.equal(spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, timeout: 10000 }).status, 19);
  const original = readFileSync(join(f.base, 'raw/step-1-result.json'));
  const finalizeCli = fileURLToPath(new URL('../finalize-run.mjs', import.meta.url));
  const value = spawnSync(process.execPath, [finalizeCli], { cwd: f.workspace, env: { ...f.env, CI_RECEIPT_JOB_STATUS: 'failure', CI_RECEIPT_RESULTS: JSON.stringify({}) }, encoding: 'utf8', timeout: 10000 });
  assert.equal(value.status, 2);
  const failure = JSON.parse(readFileSync(join(f.base, 'export/capture-failure.json')));
  assert.equal(failure.integrity, 'BLOCKED'); assert.equal(failure.context.testedSha, f.sha);
  assert.equal(failure.releaseAdmission, 'UNVERIFIED'); assert.equal(failure.sourceAuthenticity, 'UNVERIFIED');
  assert.deepEqual(readFileSync(join(f.base, 'export/raw/step-1-result.json')), original);
  assert.equal(JSON.parse(original).exitCode, 19); assert.equal(existsSync(join(f.base, 'capture/producer.json')), false);
});

test('failure retention excludes unrecognized raw fields instead of exporting supplied secrets', (t) => {
  const f = fixture(t); const script = join(f.temp, 'script.sh'); writeFileSync(script, 'true\n');
  assert.equal(spawnSync(process.execPath, [cli, 'step-1', script], { cwd: f.workspace, env: f.env, timeout: 10000 }).status, 0);
  const path = join(f.base, 'raw/step-1-result.json'); const raw = JSON.parse(readFileSync(path)); raw.secret = 'PRIVATE_SENTINEL_NEVER_EXPORT'; writeFileSync(path, JSON.stringify(raw));
  const finalizeCli = fileURLToPath(new URL('../finalize-run.mjs', import.meta.url));
  const value = spawnSync(process.execPath, [finalizeCli], { cwd: f.workspace, env: { ...f.env, CI_RECEIPT_JOB_STATUS: 'success', CI_RECEIPT_RESULTS: JSON.stringify({ 'step-1': { outcome: 'success', conclusion: 'success' }, 'step-2': { outcome: 'skipped', conclusion: 'skipped' } }) }, encoding: 'utf8', timeout: 10000 });
  assert.equal(value.status, 2); assert.equal(existsSync(join(f.base, 'export/raw/step-1-result.json')), false);
  const failure = readFileSync(join(f.base, 'export/capture-failure.json'), 'utf8');
  assert.ok(!failure.includes('PRIVATE_SENTINEL')); assert.ok(JSON.parse(failure).issues.includes('RAW_METADATA_REJECTED'));
});
