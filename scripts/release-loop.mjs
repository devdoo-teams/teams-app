import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runWithTimeout } from './release-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surfaces = ['portal', 'installed', 'desktop', 'mobile'];
const phaseOrder = ['machine', 'package', 'public', ...surfaces];

function hashBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('artifact must be binary data');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function pngDimensions(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((byte, index) => bytes[index] === byte)) return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) < 13) return null;
  return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (frameMarkers.has(marker) && segmentLength >= 7) {
      return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset += segmentLength;
  }
  return null;
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return dimensions(1 + readUInt24LE(bytes, 24), 1 + readUInt24LE(bytes, 27));
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
    const height = 1 + (bytes[23] | ((bytes[24] & 0xf) << 8) | ((bytes[25] & 0x3f) << 12));
    return dimensions(width, height);
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return dimensions(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  }
  return null;
}

export function rasterDimensions(bytes) {
  const source = bytes instanceof Uint8Array ? Buffer.from(bytes) : null;
  if (!source) throw new Error('evidence artifact must be binary data');
  const result = pngDimensions(source) ?? jpegDimensions(source) ?? webpDimensions(source);
  if (!result) throw new Error('evidence artifact must be a valid PNG, JPEG, or WebP raster image with dimensions');
  return result;
}

function inspectArtifact(bytes) {
  const { width, height } = rasterDimensions(bytes);
  return { sha256: hashBytes(bytes), width, height };
}

function hasSurfaceEvidence(state, surface) {
  const evidence = state.evidence?.[surface];
  if (!evidence) return false;
  if (evidence.surface !== surface || evidence.commit !== state.commit || evidence.version !== state.version) return false;
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) return false;
  if (state.package?.sha256 && evidence.packageSha256 !== state.package.sha256) return false;
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

function phaseFieldName(phase) {
  return phase === 'machine' ? 'machine' : phase;
}

export function resetAfterPhaseFailure(state, phase, error, now = new Date()) {
  const field = phaseFieldName(phase);
  const start = phaseOrder.indexOf(field);
  if (start < 0) throw new Error(`unknown release phase: ${phase}`);
  const next = {
    ...state,
    evidence: { ...state.evidence },
    updatedAt: now.toISOString(),
  };
  for (const current of phaseOrder.slice(start)) {
    if (surfaces.includes(current)) next.evidence[current] = null;
    else next[current] = null;
  }
  next.status = deriveStatus(next);
  next.lastFailure = {
    phase: field,
    code: error?.code ?? 'ELOOPPHASE',
    message: String(error?.message ?? 'release phase failed')
      .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/(client[_ -]?secret|password|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]'),
  };
  return next;
}

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

export function validateEvidence(
  input,
  state,
  { fileExists = (candidate) => true, readArtifact = (candidate) => fsSync.readFileSync(candidate), now = new Date() } = {},
) {
  if (!input || typeof input !== 'object') throw new Error('evidence must be an object');
  const { surface, observedAt, commit, version, packageSha256, installedVersion, summary } = input;
  const artifactPaths = Array.isArray(input.artifactPaths)
    ? input.artifactPaths
    : Array.isArray(input.artifacts) ? input.artifacts.map((artifact) => artifact?.path) : undefined;
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
  const artifacts = artifactPaths.map((candidate) => {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
      throw new Error('evidence artifact paths must be absolute');
    }
    const normalized = path.normalize(candidate);
    if (!fileExists(normalized)) throw new Error(`evidence artifact does not exist: ${normalized}`);
    return { path: normalized, ...inspectArtifact(readArtifact(normalized)) };
  });

  return {
    surface,
    observedAt,
    commit,
    version,
    packageSha256,
    ...(surface === 'installed' ? { installedVersion } : {}),
    summary: summary.trim(),
    artifactPaths: artifacts.map(({ path: artifactPath }) => artifactPath),
    artifacts,
  };
}

export function reverifyEvidenceArtifacts(
  state,
  { fileExists = (candidate) => fsSync.existsSync(candidate), readArtifact = (candidate) => fsSync.readFileSync(candidate) } = {},
) {
  for (const surface of surfaces) {
    const evidence = state.evidence?.[surface];
    if (!evidence) continue;
    if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) {
      throw new Error(`${surface} evidence is missing artifact integrity metadata`);
    }
    for (const artifact of evidence.artifacts) {
      if (!artifact || typeof artifact.path !== 'string' || !path.isAbsolute(artifact.path)) {
        throw new Error(`${surface} evidence artifact path is invalid`);
      }
      const artifactPath = path.normalize(artifact.path);
      if (!fileExists(artifactPath)) throw new Error(`evidence artifact does not exist: ${artifactPath}`);
      const actual = inspectArtifact(readArtifact(artifactPath));
      if (actual.sha256 !== artifact.sha256) {
        throw new Error(`evidence artifact hash changed: ${artifactPath}`);
      }
      if (actual.width !== artifact.width || actual.height !== artifact.height) {
        throw new Error(`evidence artifact dimensions changed: ${artifactPath}`);
      }
    }
  }
  return true;
}

export function assertPackageIntegrity(
  state,
  { fileExists = (candidate) => fsSync.existsSync(candidate), readPackage = (candidate) => fsSync.readFileSync(candidate) } = {},
) {
  const packageEntry = state.package;
  if (!hasReady(packageEntry) || typeof packageEntry.packagePath !== 'string' || typeof packageEntry.sha256 !== 'string') {
    throw new Error('release package integrity metadata is missing');
  }
  if (!path.isAbsolute(packageEntry.packagePath)) throw new Error('release package path must be absolute');
  if (!fileExists(packageEntry.packagePath)) throw new Error(`release package does not exist: ${packageEntry.packagePath}`);
  const actual = hashBytes(readPackage(packageEntry.packagePath));
  if (actual !== packageEntry.sha256) throw new Error('release package SHA-256 changed after packaging');
  return true;
}

export function assertCurrentReleaseArtifacts(state, options = {}) {
  if (hasReady(state.package)) assertPackageIntegrity(state, options);
  reverifyEvidenceArtifacts(state, options);
  return true;
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
        artifacts: evidence.artifacts.map((artifact) => ({ ...artifact })),
      },
    },
  };
  next.status = deriveStatus(next);
  return next;
}

function originAndPath(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${parsed.origin}${pathname}`;
}

export function assertPublicProbeMatches(state, currentPublic) {
  if (
    currentPublic?.version !== state.version
    || (currentPublic?.health?.version !== undefined && currentPublic.health.version !== currentPublic.version)
    || state.public?.version !== state.version
    || (state.public?.health?.version !== undefined && state.public.health.version !== state.public.version)
  ) {
    throw new Error('current public health version does not match the recorded release version');
  }
  if (currentPublic?.packageSha256 !== state.package?.sha256) {
    throw new Error('current public package SHA does not match the recorded package');
  }
  const packagedUrl = state.package?.manifest?.contentUrl;
  const recordedUrl = state.public?.tab?.finalUrl;
  const currentUrl = currentPublic?.tab?.finalUrl;
  if (!packagedUrl || !recordedUrl || !currentUrl) {
    throw new Error('public probe is missing the packaged or recorded tab URL');
  }
  const expected = originAndPath(packagedUrl, 'packaged tab URL');
  if (originAndPath(recordedUrl, 'recorded tab URL') !== expected) {
    throw new Error('recorded public tab URL does not match the packaged host and path');
  }
  if (originAndPath(currentUrl, 'current tab URL') !== expected) {
    throw new Error('current public tab URL does not match the packaged host and path');
  }
  return true;
}

export function completionMessage(state) {
  if (state.lastFailure) throw new Error('release is blocked by a last phase failure; retry the failed phase before completing');
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
  const packageEntry = payload.evidence?.find((entry) => typeof entry.package === 'string');
  if (!health || !tab || !packageEntry) throw new Error('public gate returned incomplete public evidence');
  return {
    status: 'READY',
    completedAt,
    version: health.version,
    health,
    tab,
    packagePath: packageEntry.package,
    packageSha256: packageEntry.sha256,
  };
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

export async function completeReleaseState(
  state,
  {
    probePublic = async () => summarizePhase('public', await runGatePhase('public')),
    verifyPackage = () => assertPackageIntegrity(state),
    verifyEvidence = () => reverifyEvidenceArtifacts(state),
    now = new Date(),
  } = {},
) {
  if (state.lastFailure) {
    const error = new Error('release is blocked by a last phase failure; retry the failed phase before completing');
    error.code = 'ELOOPBLOCKED';
    throw error;
  }
  const missing = missingGates(state);
  if (missing.length > 0) {
    const error = new Error(`release is blocked by: ${missing.join(', ')}`);
    error.code = 'ELOOPBLOCKED';
    error.missing = missing;
    throw error;
  }
  verifyPackage();
  verifyEvidence();
  const probe = await probePublic();
  const currentPublic = probe?.evidence ? summarizePhase('public', probe) : probe;
  assertPublicProbeMatches(state, currentPublic);
  verifyPackage();
  verifyEvidence();
  const timestamp = now instanceof Date ? now.toISOString() : new Date().toISOString();
  return {
    ...state,
    status: 'COMPLETE',
    completedAt: timestamp,
    updatedAt: timestamp,
  };
}

function nextAction(state) {
  return missingGates(state)[0] ?? 'COMPLETE';
}

function publicResult(state) {
  const currentStatus = deriveStatus(state);
  return {
    status: state.lastFailure ? 'BLOCKED' : 'READY',
    phase: 'status',
    runId: state.runId,
    state: currentStatus,
    nextAction: nextAction(state),
    missingGates: missingGates(state),
    commit: state.shortCommit,
    version: state.version,
    lastFailure: state.lastFailure,
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
    if (phase === 'public') assertPackageIntegrity(state);
    const payload = await runGatePhase(phase);
    const summarized = summarizePhase(phase, payload);
    if (phase === 'package' && summarized.version !== state.version) throw new Error('package version does not match the release run');
    if (phase === 'public') {
      if (summarized.version !== state.version) throw new Error('public health version does not match the release run');
      if (summarized.packageSha256 !== state.package.sha256) throw new Error('public package SHA does not match the release run');
      assertPackageIntegrity(state);
    }
    const next = { ...state, [phaseField(phase)]: summarized, status: deriveStatus({ ...state, [phaseField(phase)]: summarized }), updatedAt: new Date().toISOString(), lastFailure: null };
    await writeState(next, statePath);
    jsonLog({ status: 'READY', phase, runId: next.runId, state: next.status, nextAction: nextAction(next) });
  } catch (error) {
    const failed = resetAfterPhaseFailure(state, phase, error);
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
  const completed = await completeReleaseState(state);
  assertCurrentGit(state);
  const message = completionMessage(completed);
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
    assertCurrentReleaseArtifacts(state);
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
    const blocked = ['ELOOPBLOCKED', 'ELOOPACTIVE', 'ELOOPINTEGRITY', 'ETIMEDOUT'].includes(error.code);
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
