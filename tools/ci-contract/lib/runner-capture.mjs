// Bootstrap must work before either root or helper npm dependencies are installed.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { constants as signals } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJsonFile, readTextFile } from './io.mjs';
import { workflowJobPlan } from './workflow-plan.mjs';
import { createProcessTreeTerminator } from '../../../scripts/core-test-runner.mjs';
const requireValue = (value, code = 'RUNNER_CAPTURE_REJECTED') => { if (!value) throw new Error(code); };
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const jsonBytes = (value) => JSON.stringify(value, null, 2) + '\n';
export const writeNewJson = (file, value) => writeFileSync(file, jsonBytes(value), { flag: 'wx', mode: 0o600 });
function observerManifest(workspace, git, mode) {
  const files = ['tools/ci-contract/capture-run.mjs', 'tools/ci-contract/finalize-run.mjs',
    'tools/ci-contract/lib/runner-capture.mjs', 'tools/ci-contract/lib/runner-finalize.mjs',
    'tools/ci-contract/lib/workflow-plan.mjs', 'tools/ci-contract/lib/io.mjs',
    'scripts/core-test-runner.mjs', 'scripts/core-test-workspace.mjs', 'scripts/fileprovider-git-clean.mjs', 'scripts/child-test-environment.mjs'];
  const manifest = files.sort().map((file) => {
    const path = fileURLToPath(new URL('../../../' + file, import.meta.url)); const source = readTextFile(path);
    if (mode === 'observation') requireValue(realpathSync(path) === realpathSync(join(workspace, file))
      && sha256(git(['show', `HEAD:${file}`])) === source.sha256, 'OBSERVER_SOURCE_MISMATCH');
    return { file, sha256: source.sha256 };
  });
  return { observerFiles: manifest, observerSha256: sha256(jsonBytes(manifest)),
    observerSourceBinding: mode === 'observation' ? 'GIT_OBJECT_AND_WORKTREE_BYTES' : 'LOCAL_OBSERVER_BYTES' };
}
export function runnerLocation(env) {
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER']) requireValue(/^[1-9][0-9]{0,19}$/.test(env[key] ?? ''));
  requireValue(/^[1-9][0-9]{0,3}$/.test(env.GITHUB_RUN_ATTEMPT ?? ''));
  requireValue(['core', 'a2a', 'continuity', 'azure', 'optional', 'copilot_ui', 'container', 'artifact'].includes(env.GITHUB_JOB));
  requireValue(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === 'devdoo-teams/teams-app');
  requireValue(['fixture', 'observation'].includes(env.TEAMS_CI_RECEIPT_MODE));
  requireValue(['Linux', 'macOS'].includes(env.RUNNER_OS) && ['X64', 'ARM64'].includes(env.RUNNER_ARCH));
  requireValue((env.GITHUB_WORKFLOW_REF ?? '').startsWith('devdoo-teams/teams-app/.github/workflows/core-ci.yml@'));
  requireValue(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') && /^[a-f0-9]{40}$/.test(env.GITHUB_WORKFLOW_SHA ?? ''));
  const workspace = realpathSync(env.GITHUB_WORKSPACE); const temp = realpathSync(env.RUNNER_TEMP);
  const parts = ['teams-ci-receipts', env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT, env.GITHUB_JOB]; let base = temp;
  for (const part of parts) {
    base = join(base, part); if (!existsSync(base)) mkdirSync(base, { mode: 0o700 });
    const stat = lstatSync(base); requireValue(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  }
  return { workspace, temp, base };
}
function sourceSnapshot(location, env) {
  const git = (args) => execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args], {
    cwd: location.workspace, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: env.PATH, LANG: 'C.UTF-8', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const testedSha = git(['rev-parse', '--verify', 'HEAD']).trim(); requireValue(testedSha === env.GITHUB_SHA, 'CHECKOUT_SOURCE_MISMATCH');
  git(['diff', '--quiet', '--no-ext-diff', testedSha, '--']);
  const files = {};
  for (const path of ['.github/workflows/core-ci.yml', 'package.json', 'package-lock.json']) {
    const value = readTextFile(join(location.workspace, path)); const committed = git(['show', `${testedSha}:${path}`]);
    requireValue(sha256(committed) === value.sha256, 'SOURCE_BYTES_MISMATCH'); files[path] = value;
  }
  return { testedSha, treeSha: git(['rev-parse', `${testedSha}^{tree}`]).trim(), files,
    gitVersion: git(['--version']).trim().replace(/^git version /, ''), ...observerManifest(location.workspace, git, env.TEAMS_CI_RECEIPT_MODE) };
}
export function ensureSession(env) {
  const location = runnerLocation(env); const source = sourceSnapshot(location, env); const path = join(location.base, 'session.json');
  if (existsSync(path)) {
    const session = readJsonFile(path).value;
    requireValue(session.schemaVersion === 'ci-runner-session/1'
      && session.evidenceKind === (env.TEAMS_CI_RECEIPT_MODE === 'fixture' ? 'FIXTURE' : 'OBSERVATION')
      && session.context.runId === env.GITHUB_RUN_ID && session.context.runNumber === env.GITHUB_RUN_NUMBER
      && session.context.attempt === Number(env.GITHUB_RUN_ATTEMPT) && session.context.jobKey === env.GITHUB_JOB
      && session.context.testedSha === source.testedSha && session.sourceTreeSha === source.treeSha
      && session.workflowSourceSha === env.GITHUB_WORKFLOW_SHA
      && session.workflowSha256 === source.files['.github/workflows/core-ci.yml'].sha256
      && session.observerSha256 === source.observerSha256 && session.observerSourceBinding === source.observerSourceBinding
      && session.toolchain.matrix.os === env.RUNNER_OS && session.toolchain.matrix.arch === env.RUNNER_ARCH
      && session.toolchain.matrix.node === process.versions.node
      && JSON.stringify(session.planned) === JSON.stringify(workflowJobPlan(source.files['.github/workflows/core-ci.yml'].value, env.GITHUB_JOB)), 'SESSION_IDENTITY_MISMATCH');
    const raw = lstatSync(join(location.base, 'raw')); requireValue(raw.isDirectory() && !raw.isSymbolicLink() && (raw.mode & 0o077) === 0);
    return { ...location, session, source };
  }
  const session = { schemaVersion: 'ci-runner-session/1', evidenceKind: env.TEAMS_CI_RECEIPT_MODE === 'fixture' ? 'FIXTURE' : 'OBSERVATION',
    context: { repository: env.GITHUB_REPOSITORY, workflow: '.github/workflows/core-ci.yml', runId: env.GITHUB_RUN_ID, runNumber: env.GITHUB_RUN_NUMBER,
      attempt: Number(env.GITHUB_RUN_ATTEMPT), jobKey: env.GITHUB_JOB, invocationId: randomUUID(), testedSha: source.testedSha },
    createdAt: new Date().toISOString(), sourceTreeSha: source.treeSha, workflowSourceSha: env.GITHUB_WORKFLOW_SHA,
    workflowSha256: source.files['.github/workflows/core-ci.yml'].sha256,
    observerSha256: source.observerSha256, observerSourceBinding: source.observerSourceBinding,
    toolchain: { schemaVersion: 'ci-toolchain/1', matrix: { os: env.RUNNER_OS, arch: env.RUNNER_ARCH, node: process.versions.node, variant: env.GITHUB_JOB }, tools: [{ name: 'node', version: process.versions.node }, { name: 'git', version: source.gitVersion }] },
    planned: workflowJobPlan(source.files['.github/workflows/core-ci.yml'].value, env.GITHUB_JOB) };
  writeNewJson(path, session); mkdirSync(join(location.base, 'raw'), { mode: 0o700 }); return { ...location, session, source };
}
export async function captureRun(scopeId, scriptPath, env = process.env) {
  const state = ensureSession(env); const planned = state.session.planned.find((row) => row.id === scopeId);
  requireValue(planned?.type === 'RUN' && /^step-[1-9][0-9]?$/.test(scopeId));
  const script = realpathSync(scriptPath); const within = relative(state.temp, script);
  requireValue(within !== '' && !within.startsWith('..') && !isAbsolute(within) && !lstatSync(scriptPath).isSymbolicLink());
  const source = readTextFile(script);
  const start = { schemaVersion: 'ci-runner-command/1', evidenceKind: state.session.evidenceKind, context: state.session.context, scopeId,
    definitionDigest: planned.definitionDigest, scriptSha256: source.sha256, shell: 'bash -e', startedAt: new Date().toISOString() };
  writeNewJson(join(state.base, 'raw', `${scopeId}-start.json`), start);
  return await new Promise((resolve, reject) => {
    const child = spawn('bash', ['-e', script], { cwd: state.workspace, env, stdio: 'inherit', detached: true });
    const terminate = createProcessTreeTerminator(); let requestedSignal = null;
    const stop = (signal) => { if (requestedSignal) return; requestedSignal = signal;
      if (signal === 'SIGINT') { try { process.kill(-child.pid, signal); } catch {} } else terminate(child); };
    const interrupt = () => stop('SIGINT'); const term = () => stop('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', term);
    const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', term); };
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('close', (exitCode, signal) => {
      cleanup(); const result = { ...start, completedAt: new Date().toISOString(), exitCode, signal, requestedSignal };
      try { writeNewJson(join(state.base, 'raw', `${scopeId}-result.json`), result); }
      catch { process.stderr.write('CI_RUNNER_TERMINAL_RECEIPT_MISSING\n'); }
      resolve({ exitCode, signal, transportExitCode: exitCode ?? 128 + (signals.signals[signal] ?? 1) });
    });
  });
}
