import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runWithTimeout } from './release-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surfaces = ['portal', 'installed', 'desktop', 'mobile'];

function hasSurfaceEvidence(state, surface) {
  const evidence = state.evidence?.[surface];
  if (!evidence) return false;
  // The portal's published version and the installed conversation's response
  // are different facts. Do not let a chat round-trip stand in for the
  // installed app-info version check.
  if (surface === 'installed' && evidence.installedVersion !== state.version) return false;
  return true;
}

const surfacePrerequisites = {
  portal: () => true,
  installed: (state) => hasSurfaceEvidence(state, 'portal'),
  desktop: (state) => hasSurfaceEvidence(state, 'installed'),
  mobile: (state) => hasSurfaceEvidence(state, 'desktop'),
};

export const RELEASE_SURFACES = [...surfaces];

export function createInitialState({ runId, commit, shortCommit, version, startedAt }) {
  for (const [name, value] of Object.entries({ runId, commit, shortCommit, version, startedAt })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`release loop requires ${name}`);
    }
  }
  return {
    schemaVersion: 1,
    runId,
    startedAt,
    updatedAt: startedAt,
    commit,
    shortCommit,
    version,
    status: 'INIT',
    machine: null,
    package: null,
    public: null,
    evidence: {
      portal: null,
      installed: null,
      desktop: null,
      mobile: null,
    },
    lastFailure: null,
  };
}

function hasReady(record) {
  return record?.status === 'READY';
}

export function deriveStatus(state) {
  if (!hasReady(state.machine)) return 'INIT';
  if (!hasReady(state.package)) return 'MACHINE_READY';
  if (!hasReady(state.public)) return 'PACKAGE_READY';
  if (!hasSurfaceEvidence(state, 'portal')) return 'PUBLIC_READY';
  if (!hasSurfaceEvidence(state, 'installed')) return 'PORTAL_READY';
  if (!hasSurfaceEvidence(state, 'desktop')) return 'INSTALLED_READY';
  if (!hasSurfaceEvidence(state, 'mobile')) return 'DESKTOP_READY';
  return 'MOBILE_READY';
}

export function missingGates(state) {
  const gates = [];
  if (!hasReady(state.machine)) gates.push('MACHINE_READY');
  if (!hasReady(state.package)) gates.push('PACKAGE_READY');
  if (!hasReady(state.public)) gates.push('PUBLIC_READY');
  if (!hasSurfaceEvidence(state, 'portal')) gates.push('PORTAL_READY');
  if (!hasSurfaceEvidence(state, 'installed')) gates.push('INSTALLED_READY');
  if (!hasSurfaceEvidence(state, 'desktop')) gates.push('DESKTOP_READY');
  if (!hasSurfaceEvidence(state, 'mobile')) gates.push('MOBILE_READY');
  return gates;
}

function assertSurface(surface) {
  if (!surfaces.includes(surface)) {
    throw new Error(`evidence surface must be one of: ${surfaces.join(', ')}`);
  }
}

function assertSafeSummary(summary) {
  if (typeof summary !== 'string' || summary.trim().length < 8 || summary.length > 1_000) {
    throw new Error('evidence summary must be between 8 and 1000 characters');
  }
  if (/(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|(?:client[_ -]?secret|password|api[_ -]?key)\s*[:=]\s*\S+)/i.test(summary)) {
    throw new Error('evidence summary contains secret or credential-like text');
  }
}

function assertObservedAt(observedAt, state, now) {
  if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) {
    throw new Error('evidence observedAt must be an ISO timestamp');
  }
  const observed = Date.parse(observedAt);
  const current = now instanceof Date ? now.getTime() : Date.now();
  if (observed > current) throw new Error('evidence observedAt cannot be in the future');
  if (Date.parse(state.startedAt) > observed) throw new Error('evidence observedAt predates the release run');
}

function isRasterImage(bytes) {
  if (!(bytes instanceof Uint8Array)) return false;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const jpeg = [0xff, 0xd8, 0xff];
  const webp = [0x52, 0x49, 0x46, 0x46, undefined, undefined, undefined, undefined, 0x57, 0x45, 0x42, 0x50];
  const startsWith = (signature) => signature.every((byte, index) => byte === undefined || bytes[index] === byte);
  return startsWith(png) || startsWith(jpeg) || startsWith(webp);
}

export function validateEvidence(
  input,
  state,
  { fileExists = (candidate) => true, readArtifact = (candidate) => fsSync.readFileSync(candidate), now = new Date() } = {},
) {
  if (!input || typeof input !== 'object') throw new Error('evidence must be an object');
  const { surface, observedAt, commit, version, packageSha256, installedVersion, summary, artifactPaths } = input;
  assertSurface(surface);
  if (state.status === 'COMPLETE') throw new Error('cannot add evidence to a completed release run');
  if (!hasReady(state.package) || !state.package.sha256) throw new Error('package must be READY before evidence is registered');
  if (!surfacePrerequisites[surface](state)) throw new Error(`evidence is out of order for ${surface}`);
  if (commit !== state.commit) throw new Error('evidence commit does not match the release run');
  if (version !== state.version) throw new Error('evidence version does not match the release run');
  if (packageSha256 !== state.package.sha256) throw new Error('evidence package SHA does not match the release run');
  if (surface === 'installed' && installedVersion !== state.version) {
    throw new Error('installed evidence requires installedVersion equal to the release version');
  }
  assertObservedAt(observedAt, state, now);
  assertSafeSummary(summary);
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    throw new Error('evidence requires at least one artifact path');
  }
  const normalizedPaths = artifactPaths.map((candidate) => {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
      throw new Error('evidence artifact paths must be absolute');
    }
    const normalized = path.normalize(candidate);
    if (!fileExists(normalized)) throw new Error(`evidence artifact does not exist: ${normalized}`);
    return normalized;
  });
  if (!normalizedPaths.some((candidate) => isRasterImage(readArtifact(candidate)))) {
    throw new Error('evidence artifact must be a real PNG, JPEG, or WebP image');
  }

  return {
    surface,
    observedAt,
    commit,
    version,
    packageSha256,
    ...(surface === 'installed' ? { installedVersion } : {}),
    summary: summary.trim(),
    artifactPaths: normalizedPaths,
  };
}

export function applyEvidence(state, evidence) {
  assertSurface(evidence?.surface);
  if (state.status === 'COMPLETE') throw new Error('cannot add evidence to a completed release run');
  if (!surfacePrerequisites[evidence.surface](state)) {
    throw new Error(`evidence is out of order for ${evidence.surface}`);
  }
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
    evidence: {
      ...state.evidence,
      [evidence.surface]: {
        surface: evidence.surface,
        observedAt: evidence.observedAt,
        commit: evidence.commit,
        version: evidence.version,
        packageSha256: evidence.packageSha256,
        ...(evidence.surface === 'installed' ? { installedVersion: evidence.installedVersion } : {}),
        summary: evidence.summary,
        artifactPaths: [...evidence.artifactPaths],
      },
    },
  };
  next.status = deriveStatus(next);
  return next;
}

export function completionMessage(state) {
  const missing = missingGates(state);
  if (missing.length > 0) throw new Error(`release is not complete; missing gates: ${missing.join(', ')}`);
  return [
    '✅ Teams 앱 릴리스 완료',
    `버전: ${state.version}`,
    `커밋: ${state.shortCommit}`,
    `패키지 SHA-256: ${state.package.sha256}`,
    `공개 health: ${state.public.health.environment} / ${state.public.health.auth} / ${state.public.health.bot} / ${state.public.health.outbound}`,
    'UI 증거: 포털 업로드, 설치 버전, 데스크톱, 모바일 확인 완료',
  ].join('\n');
}

export function statePathFromEnv(env = process.env) {
  return path.resolve(env.RELEASE_LOOP_STATE_PATH || path.join(root, '.release', 'current.json'));
}

export async function readState(statePath = statePathFromEnv()) {
  return JSON.parse(await fs.readFile(statePath, 'utf8'));
}

export async function writeState(state, statePath = statePathFromEnv()) {
  const directory = path.dirname(statePath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${statePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, statePath);
}

function gitSnapshot() {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const porcelain = run(['status', '--porcelain']);
  return {
    commit: run(['rev-parse', 'HEAD']),
    shortCommit: run(['rev-parse', '--short=7', 'HEAD']),
    dirty: porcelain.length > 0,
    porcelain,
  };
}

function sourceVersion() {
  const manifest = JSON.parse(fsSync.readFileSync(path.join(root, 'appPackage', 'manifest.json'), 'utf8'));
  return manifest.version;
}

function assertCurrentGit(state, { requireClean = true } = {}) {
  const current = gitSnapshot();
  if (current.commit !== state.commit) throw new Error('current Git commit does not match the release run');
  if (requireClean && current.dirty) throw new Error('release loop requires a clean Git worktree');
  return current;
}

async function requireState(statePath) {
  try {
    return await readState(statePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`no active release run at ${statePath}`);
    throw error;
  }
}

function phaseField(phase) {
  return phase === 'machine' ? 'machine' : phase;
}

export function summarizePhase(phase, payload) {
  const completedAt = new Date().toISOString();
  if (phase === 'machine') {
    return { status: 'READY', completedAt, commands: payload.evidence?.map(({ command, exitCode }) => ({ command, exitCode })) ?? [] };
  }
  if (phase === 'package') {
    const packageEntry = payload.evidence?.find((entry) => typeof entry.package === 'string');
    const manifestEvidence = payload.evidence?.find((entry) => entry.manifest)?.manifest;
    if (!packageEntry || !manifestEvidence) throw new Error('package gate returned incomplete package evidence');
    return {
      status: 'READY',
      completedAt,
      packagePath: packageEntry.package,
      version: packageEntry.version,
      sha256: packageEntry.sha256,
      manifest: manifestEvidence,
    };
  }
  const health = payload.evidence?.find((entry) => entry.health)?.health;
  const tab = payload.evidence?.find((entry) => entry.tab)?.tab;
  if (!health || !tab) throw new Error('public gate returned incomplete public evidence');
  return { status: 'READY', completedAt, version: health.version, health, tab };
}

const phaseTimeouts = {
  machine: 330_000,
  package: 60_000,
  public: 30_000,
};

export function gatePhaseForLoop(phase) {
  return phase === 'machine' ? 'preflight' : phase;
}

export function parseGatePayload(stdout, stderr) {
  const source = String(stdout || stderr || '').trim();
  if (!source) throw new Error('release gate returned no JSON evidence');
  return JSON.parse(source);
}

async function runGatePhase(phase) {
  const gatePath = path.join(root, 'scripts', 'release-gate.mjs');
  const result = await runWithTimeout(process.execPath, [gatePath, gatePhaseForLoop(phase)], {
    cwd: root,
    timeoutMs: phaseTimeouts[phase],
    maxOutputChars: 20_000,
  });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  let payload;
  try {
    payload = parseGatePayload(result.stdout, result.stderr);
  } catch {
    const error = new Error(`release gate ${phase} did not return JSON evidence`);
    error.code = 'ELOOPPHASE';
    error.output = output.slice(-4_000);
    throw error;
  }
  if (result.code !== 0 || payload.status !== 'READY') {
    const error = new Error(`release gate ${phase} is ${payload.status ?? 'FAILED'}`);
    error.code = result.code === null ? 'ETIMEDOUT' : 'ELOOPPHASE';
    error.output = output.slice(-4_000);
    throw error;
  }
  return payload;
}

function nextAction(state) {
  return missingGates(state)[0] ?? 'COMPLETE';
}

function publicResult(state) {
  const currentStatus = deriveStatus(state);
  return {
    status: 'READY',
    phase: 'status',
    runId: state.runId,
    state: currentStatus,
    nextAction: nextAction(state),
    missingGates: missingGates(state),
    commit: state.shortCommit,
    version: state.version,
  };
}

function jsonLog(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

async function startRun(statePath) {
  if (fsSync.existsSync(statePath)) {
    const existing = await readState(statePath);
    if (existing.status !== 'COMPLETE') {
      const error = new Error(`an active release run already exists: ${existing.runId}`);
      error.code = 'ELOOPACTIVE';
      throw error;
    }
  }
  const git = gitSnapshot();
  if (git.dirty) throw new Error('release loop requires a clean Git worktree at start');
  const startedAt = new Date().toISOString();
  const state = createInitialState({
    runId: crypto.randomUUID(),
    commit: git.commit,
    shortCommit: git.shortCommit,
    version: sourceVersion(),
    startedAt,
  });
  await writeState(state, statePath);
  jsonLog({ status: 'READY', phase: 'start', runId: state.runId, state: state.status, nextAction: nextAction(state) });
}

async function executePhase(phase, statePath) {
  const state = await requireState(statePath);
  try {
    assertCurrentGit(state);
    if (phase === 'package' && !hasReady(state.machine)) throw new Error('machine phase must be READY before package');
    if (phase === 'public' && !hasReady(state.package)) throw new Error('package phase must be READY before public');
    const payload = await runGatePhase(phase);
    const summarized = summarizePhase(phase, payload);
    if (phase === 'package' && summarized.version !== state.version) throw new Error('package version does not match the release run');
    if (phase === 'public' && summarized.version !== state.version) throw new Error('public health version does not match the release run');
    const next = { ...state, [phaseField(phase)]: summarized, status: deriveStatus({ ...state, [phaseField(phase)]: summarized }), updatedAt: new Date().toISOString(), lastFailure: null };
    await writeState(next, statePath);
    jsonLog({ status: 'READY', phase, runId: next.runId, state: next.status, nextAction: nextAction(next) });
  } catch (error) {
    const failed = { ...state, updatedAt: new Date().toISOString(), lastFailure: { phase, code: error.code ?? 'ELOOPPHASE', message: error.message } };
    await writeState(failed, statePath);
    throw error;
  }
}

async function addEvidence(statePath, evidencePath) {
  if (!evidencePath) throw new Error('evidence requires --file <path>');
  const state = await requireState(statePath);
  assertCurrentGit(state);
  const input = JSON.parse(await fs.readFile(path.resolve(evidencePath), 'utf8'));
  const normalized = validateEvidence(input, state, { fileExists: (candidate) => fsSync.existsSync(candidate) });
  const next = applyEvidence(state, normalized);
  await writeState(next, statePath);
  jsonLog({ status: 'READY', phase: 'evidence', surface: normalized.surface, runId: next.runId, state: next.status, nextAction: nextAction(next) });
}

async function completeRun(statePath) {
  const state = await requireState(statePath);
  assertCurrentGit(state);
  const missing = missingGates(state);
  if (missing.length > 0) {
    const error = new Error(`release is blocked by: ${missing.join(', ')}`);
    error.code = 'ELOOPBLOCKED';
    error.missing = missing;
    throw error;
  }
  assertCurrentGit(state);
  const message = completionMessage(state);
  const completed = { ...state, status: 'COMPLETE', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await writeState(completed, statePath);
  jsonLog({ status: 'READY', phase: 'complete', runId: completed.runId, state: completed.status, message });
}

function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const options = { command, file: undefined };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--file') options.file = rest[++index];
    else throw new Error(`unknown release loop argument: ${rest[index]}`);
  }
  return options;
}

async function runCli(argv) {
  const { command, file } = parseArgs(argv);
  const statePath = statePathFromEnv();
  if (command === 'start') return startRun(statePath);
  if (command === 'machine' || command === 'package' || command === 'public') return executePhase(command, statePath);
  if (command === 'status') {
    const state = await requireState(statePath);
    assertCurrentGit(state);
    return jsonLog(publicResult(state));
  }
  if (command === 'evidence') return addEvidence(statePath, file);
  if (command === 'complete') return completeRun(statePath);
  throw new Error(`unknown release loop command: ${command}`);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const blocked = ['ELOOPBLOCKED', 'ELOOPACTIVE', 'ETIMEDOUT'].includes(error.code);
    const result = {
      status: blocked ? 'BLOCKED' : 'FAILED',
      phase: process.argv[2] ?? 'status',
      blocker: { code: error.code ?? 'EUNKNOWN', message: error.message },
      missingGates: error.missing ?? undefined,
      nextAction: error.missing?.[0] ?? 'Inspect the reported release loop failure.',
    };
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}
