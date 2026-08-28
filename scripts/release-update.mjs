import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packageGateTimeoutMs, runWithTimeout, parseDotEnv, resolvePublicUrl } from './release-gate.mjs';
import {
  RELEASE_SURFACES,
  applyPhaseSuccess,
  createInitialState,
  missingGates,
  readState as readReleaseLoopState,
  resetAfterPhaseFailure,
  runGatePhase,
  splitBrowserEvidenceInput,
  summarizePhase,
} from './release-loop.mjs';
import { verifyTeamsRegistration } from './teams-registration.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultStatePath = path.join(root, '.release', 'update-current.json');
const defaultPackagePath = path.join(root, 'appPackage', 'build', 'teams-sdk-mvp.zip');
const loopScriptPath = path.join(root, 'scripts', 'release-loop.mjs');
const phaseTimeoutMs = {
  start: 60_000,
  // Includes the bounded two-build FileProvider determinism gate in
  // release:preflight, followed by Core build/test and deployment checks.
  machine: 1_200_000,
  // Leave a small boundary after the internal release-loop package timeout
  // for JSON parsing and atomic state persistence.
  package: packageGateTimeoutMs() + 30_000,
  public: 60_000,
  browser: 45_000,
  complete: 60_000,
  status: 45_000,
};

export const RELEASE_UPDATE_PHASES = [
  'machine',
  'package',
  'public',
  ...RELEASE_SURFACES,
  'jira',
];

const automatedPhases = new Set(['machine', 'package', 'public']);
const browserPhases = new Set(RELEASE_SURFACES);
const terminalStatuses = new Set(['COMPLETE', 'SUPERSEDED']);
const STALE_LOCK_MIN_AGE_MS = 60_000;

export const RELEASE_UPDATE_BLOCKER_CODES = new Set([
  'ETIMEDOUT',
  'EUPDATEACTIVE',
  'EUPDATEMISSING',
  'EUPDATESTATE',
  'EPACKAGEPATH',
  'EORIGINMISMATCH',
  'EUPDATEPHASE',
  'ELOOPPHASE',
  'ELOOPBLOCKED',
  'ELOOPCOMPLETE',
  'ESTALERELEASE',
  'ELOOPINTEGRITY',
  'ESOURCEIOBLOCKED',
  'EUNTRACKEDSTARTMUTATED',
  'EUNTRACKEDBASELINEINVALID',
  'EUNTRACKEDBASELINEUNAVAILABLE',
  'EVERSIONNOTBUMPED',
  'EWORKTREEDIRTY',
  'EUPDATEOUTPUT',
  'EPROCESSREAPTIMEOUT',
  'ECOMMAND',
  'ETEAMSREGISTRATIONMISMATCH',
  'ETEAMSCLIMISSING',
  'ETEAMSCLI',
  'ETEAMSCLITIMEOUT',
]);

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`release:update requires ${label}`);
  return value;
}

function assertPhase(phase) {
  if (!RELEASE_UPDATE_PHASES.includes(phase)) {
    throw new Error(`release:update phase must be one of: ${RELEASE_UPDATE_PHASES.join(', ')}`);
  }
}

function phaseRecord(state, phase) {
  if (phase === 'machine') return state?.machine;
  if (phase === 'package') return state?.package;
  if (phase === 'public') return state?.public;
  if (phase === 'jira') return state?.releaseUpdate?.jira;
  return state?.evidence?.[phase];
}

function phaseReady(state, phase) {
  const status = phaseRecord(state, phase)?.status;
  return phase === 'jira' ? status === 'VERIFIED' || status === 'READY' : status === 'READY';
}

export function hasVerifiedTeamsRegistration(state) {
  const registration = state?.releaseUpdate?.registration;
  const publicOrigin = state?.releaseUpdate?.publicOrigin;
  const expectedAppId = state?.package?.manifest?.appId ?? state?.package?.manifest?.id;
  const expectedEndpoint = publicOrigin ? `${publicOrigin.replace(/\/$/, '')}/api/messages` : '';
  return Boolean(
    registration?.status === 'VERIFIED'
      && registration.appId === expectedAppId
      && registration.version === state?.version
      && registration.packageSha256 === state?.package?.sha256
      && registration.endpoint === expectedEndpoint,
  );
}

function phaseForGateName(gate) {
  return String(gate ?? '').replace(/_READY$/, '').toLowerCase();
}

export function nextAction(state) {
  if (state?.status === 'SUPERSEDED') return 'start';
  if (state?.status === 'COMPLETE') return 'complete';
  // Public phase writes its package/health evidence before the resumable
  // driver attaches releaseUpdate.identity. Treat that narrow crash window as
  // a public retry, never as permission to hand an unbound identity to Portal
  // or Jira.
  if (phaseReady(state, 'public') && !state.releaseUpdate?.identity) return 'public';
  if (phaseReady(state, 'portal') && !hasVerifiedTeamsRegistration(state)) return 'portal';
  const missing = missingGates(state);
  if (missing.length > 0) return phaseForGateName(missing[0]);
  return phaseReady(state, 'jira') ? 'complete' : 'jira';
}

function resolvePath(value) {
  return path.resolve(root, value ?? defaultPackagePath);
}

function updateMetadata(state, overrides = {}) {
  const previous = state.releaseUpdate ?? {};
  return {
    schemaVersion: 1,
    statePath: previous.statePath,
    packagePath: previous.packagePath ?? defaultPackagePath,
    publicOrigin: previous.publicOrigin ?? null,
    identity: previous.identity ?? null,
    jira: previous.jira ?? null,
    registration: previous.registration ?? null,
    attestations: { ...(previous.attestations ?? {}) },
    attempts: { ...(previous.attempts ?? {}) },
    lastActivity: new Date().toISOString(),
    ...overrides,
  };
}

/** Pure test seam; the persisted state remains the release-loop state shape. */
export function createUpdateState({
  runId,
  commit,
  version,
  packagePath,
  startedAt,
  statePath = defaultStatePath,
  untrackedAtStart = [],
  untrackedAtStartBaseline = [],
  sourceIoMode = 'normal',
}) {
  assertNonEmptyString(runId, 'runId');
  assertNonEmptyString(commit, 'commit');
  assertNonEmptyString(version, 'version');
  assertNonEmptyString(startedAt, 'startedAt');
  const base = createInitialState({
    runId,
    commit,
    shortCommit: commit.slice(0, 7),
    version,
    startedAt,
    untrackedAtStart,
    untrackedAtStartBaseline,
    sourceIoMode,
  });
  return {
    ...base,
    releaseUpdate: updateMetadata({ releaseUpdate: { statePath: path.resolve(statePath), packagePath: resolvePath(packagePath) } }),
  };
}

function assertPhasePrerequisite(state, phase) {
  const expected = nextAction(state);
  if (expected !== phase) {
    const error = new Error(`${expected} phase must be READY before ${phase}`);
    error.code = 'EUPDATEPHASE';
    error.releasePhase = phase;
    throw error;
  }
}

function assertResultIdentity(state, phase, result) {
  if (!result || result.status !== 'READY') throw new Error(`${phase} phase did not return READY`);
  if (result.sourceCommit && result.sourceCommit !== state.commit) {
    throw new Error(`${phase} source commit does not match the release identity`);
  }
  if (phase === 'package' && result.version !== state.version) {
    throw new Error('package version does not match the release identity');
  }
  if (phase === 'package' && result.packagePath && resolvePath(result.packagePath) !== resolvePath(state.releaseUpdate?.packagePath)) {
    throw new Error('package path does not match the release identity');
  }
  if (phase === 'public') {
    if (result.version !== state.version) throw new Error('public version does not match the release identity');
    if (result.packageSha256 !== state.package?.sha256) {
      throw new Error('public package SHA does not match the packaged identity');
    }
  }
}

export function applyPhaseResult(state, phase, result, now = new Date()) {
  assertPhase(phase);
  if (!automatedPhases.has(phase)) throw new Error('UI evidence must be registered through release-loop');
  assertPhasePrerequisite(state, phase);
  assertResultIdentity(state, phase, result);
  const summary = { ...result, completedAt: result.completedAt ?? now.toISOString() };
  const next = applyPhaseSuccess(state, phase, summary, now);
  if (phase === 'public') {
    const publicOrigin = result.publicOrigin ?? state.releaseUpdate?.publicOrigin ?? null;
    next.releaseUpdate = updateMetadata(next, {
      publicOrigin,
      identity: createReleaseIdentity(next, publicOrigin),
    });
  } else {
    next.releaseUpdate = updateMetadata(next);
  }
  return next;
}

function redactText(value) {
  return String(value ?? '')
    .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(client[_ -]?secret|password|api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
}

export function redactReleaseError(error) {
  const redacted = new Error(redactText(error?.message ?? error));
  redacted.code = error?.code;
  redacted.releasePhase = error?.releasePhase;
  return redacted;
}

/**
 * A resumable update must revalidate the canonical release-loop state before
 * handing an old UI phase back to the operator. A phase-local last failure is
 * retryable, but a blocker returned by the status command means the recorded
 * release no longer describes this checkout (for example a changed HEAD).
 */
export function assertResumableStatus(payload) {
  if (payload?.status === 'BLOCKED' && payload?.blocker) {
    const failure = new Error(
      `${payload.blocker.message ?? 'release status validation failed'}${payload.blocker.detail ? `: ${payload.blocker.detail}` : ''}`,
    );
    failure.code = payload.blocker.code ?? 'EUPDATEPHASE';
    failure.releasePhase = 'status';
    throw failure;
  }
  return payload;
}

function normalizeOrigin(value) {
  assertNonEmptyString(value, 'public URL');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('public URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('public URL must be an absolute HTTP(S) URL without embedded credentials');
  }
  return parsed.origin;
}

async function resolveConfiguredPublicOrigin(explicit) {
  if (explicit) return normalizeOrigin(explicit);
  let fileValues = {};
  try {
    fileValues = parseDotEnv(await fs.readFile(path.join(root, '.env.runtime'), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const resolved = resolvePublicUrl({ ...fileValues, ...process.env });
  return resolved ? normalizeOrigin(resolved) : undefined;
}

function packagedAppId(state) {
  return state?.package?.manifest?.appId ?? state?.package?.manifest?.id ?? null;
}

export function summarizeBrowserHandoff(state, surface) {
  assertPhase(surface);
  if (!browserPhases.has(surface)) throw new Error(`browser handoff requires a UI surface, not ${surface}`);
  if (!phaseReady(state, surface)) {
    const expected = nextAction(state);
    if (expected !== surface) throw new Error(`${expected} phase must be READY before ${surface} handoff`);
  }
  const packageEntry = state.package;
  const manifestAppId = packagedAppId(state);
  const publicOrigin = state.releaseUpdate?.publicOrigin ?? '<recorded-public-origin>';
  return {
    surface,
    runId: state.runId,
    tabId: '<existing-in-app-browser-tab-id>',
    requiresParentBrowserObservation: true,
    commit: state.commit,
    version: state.version,
    appId: manifestAppId ?? null,
    packagePath: packageEntry?.packagePath ?? state.releaseUpdate?.packagePath,
    packageSha256: packageEntry?.sha256,
    publicOrigin,
    instructions: [
      `Reuse the existing in-app browser tab for ${surface}; do not create a new tab or login session.`,
      `Verify app ID ${manifestAppId ?? '<from ZIP manifest>'}, version ${state.version}, commit ${state.commit}, and package SHA ${packageEntry?.sha256 ?? '<recorded package SHA>'}.`,
      surface === 'portal'
        ? 'Import/replace the existing app package, validate it, then submit only the matching version. The registered Teams app package must also be read back and match before portal evidence is accepted.'
        : 'Verify the installed release identity before capturing the required before/after evidence.',
      'Leave credential entry, MFA, Authenticator, and security prompts to the user.',
      `Record PASS, FAIL, or BLOCKED evidence for ${surface}; never infer success from a spinner or HTTP 200 alone.`,
    ].join('\n'),
  };
}

export function summarizeJiraHandoff(state) {
  if (nextAction(state) !== 'jira' && !phaseReady(state, 'jira')) {
    throw new Error('Jira reconciliation is available only after the public and UI evidence gates are READY');
  }
  return {
    surface: 'jira',
    runId: state.runId,
    identity: state.releaseUpdate?.identity ?? null,
    instructions: [
      'Use the existing Jira/Atlassian login context; do not create a new browser session.',
      'Search each finding by its stable teams-core idempotency key before creating anything.',
      'Record the Jira key, URL, type, assignee, status, discovery evidence, fix commit, and acceptance evidence.',
      'Leave credentials, MFA, and security prompts to the user.',
      'Submit a reconciliation JSON only when no release blocker or unmapped finding remains.',
    ].join('\n'),
  };
}

function assertAttestationText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`browser attestation requires ${label}`);
  if (/(?:bearer\s+\S+|password\s*[:=]|api[_ -]?key\s*[:=]|secret\s*[:=])/i.test(value)) {
    throw new Error(`browser attestation ${label} contains credential-like text`);
  }
  return value.trim();
}

function assertAttestationUrl(value, label) {
  const text = assertAttestationText(value, label);
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error(`browser attestation ${label} must be an absolute HTTP(S) URL`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`browser attestation ${label} must be an absolute HTTP(S) URL without credentials`);
  }
  return parsed.href;
}

export function validateBrowserAttestation(input, state, surface, now = new Date()) {
  assertPhase(surface);
  if (!browserPhases.has(surface)) throw new Error('browser attestation requires a UI surface');
  if (!input || typeof input !== 'object') throw new Error('browser attestation must be a JSON object');
  if (input.runId !== state.runId) throw new Error('browser attestation run ID does not match the release run');
  if (input.surface !== surface) throw new Error(`browser attestation surface must be ${surface}`);
  const appId = packagedAppId(state);
  if (!appId || input.appId !== appId) throw new Error('browser attestation app ID does not match the package manifest');
  if (input.version !== state.version) throw new Error('browser attestation version does not match the release run');
  if (input.packageSha256 !== state.package?.sha256) throw new Error('browser attestation package SHA does not match the release run');
  const observedAt = assertAttestationText(input.observedAt, 'observedAt');
  const observedTime = Date.parse(observedAt);
  if (Number.isNaN(observedTime) || observedTime > now.getTime()) throw new Error('browser attestation observedAt must be a current ISO timestamp');
  const required = ['titleBefore', 'titleAfter', 'observedAction', 'observedResult'];
  const normalized = { surface, runId: state.runId, appId, version: state.version, packageSha256: state.package?.sha256, observedAt };
  for (const field of required) normalized[field] = assertAttestationText(input[field], field);
  const nativeSurface = surface === 'desktop' || surface === 'mobile';
  if (nativeSurface) {
    const expectedMode = surface === 'desktop' ? 'computer-use' : 'user-confirmed-mobile';
    const verificationMode = assertAttestationText(input.verificationMode, 'verificationMode');
    if (verificationMode !== expectedMode) {
      throw new Error(`${surface} attestation verificationMode must be ${expectedMode}`);
    }
    normalized.verificationMode = verificationMode;
    if (surface === 'desktop') normalized.applicationId = assertAttestationText(input.applicationId, 'applicationId');
    if (surface === 'mobile') {
      if (input.userConfirmed !== true) throw new Error('mobile attestation requires current user confirmation');
      normalized.userConfirmed = true;
    }
  } else {
    const tabIdBefore = assertAttestationText(input.tabIdBefore ?? input.tabId, 'tabIdBefore');
    const tabIdAfter = assertAttestationText(input.tabIdAfter ?? input.tabId, 'tabIdAfter');
    if (tabIdBefore !== tabIdAfter) throw new Error('browser attestation must stay on the same in-app browser tab');
    if (/^<[^>]+>$/.test(tabIdBefore) || /existing-in-app-browser-tab-id/i.test(tabIdBefore)) {
      throw new Error('browser attestation requires a real existing in-app browser tab ID');
    }
    normalized.tabId = tabIdBefore;
    normalized.tabIdBefore = tabIdBefore;
    normalized.tabIdAfter = tabIdAfter;
    normalized.urlBefore = assertAttestationUrl(input.urlBefore, 'urlBefore');
    normalized.urlAfter = assertAttestationUrl(input.urlAfter, 'urlAfter');
    if (surface === 'portal') {
      const allowedHosts = new Set(['dev.teams.microsoft.com', 'admin.teams.microsoft.com', 'teams.microsoft.com']);
      for (const url of [normalized.urlBefore, normalized.urlAfter]) {
        const hostname = new URL(url).hostname.toLowerCase();
        if (!allowedHosts.has(hostname) && !hostname.endsWith('.teams.microsoft.com')) {
          throw new Error('portal browser attestation URL must remain on a Teams portal/Admin Center host');
        }
      }
    }
  }
  if (surface === 'portal') {
    normalized.submissionStatus = assertAttestationText(input.submissionStatus, 'submissionStatus');
    const operationId = typeof input.remoteOperationId === 'string' ? input.remoteOperationId.trim() : '';
    const unavailableReason = typeof input.remoteOperationIdUnavailableReason === 'string'
      ? input.remoteOperationIdUnavailableReason.trim()
      : '';
    if (!operationId && !unavailableReason) {
      throw new Error('portal attestation requires remoteOperationId or remoteOperationIdUnavailableReason');
    }
    normalized.remoteOperationId = operationId || null;
    normalized.remoteOperationIdUnavailableReason = unavailableReason || null;
  }
  if (surface === 'installed') normalized.installedVersion = assertAttestationText(input.installedVersion, 'installedVersion');
  return normalized;
}

export function parseReleaseUpdateArgs(argv) {
  const args = [...argv];
  const first = args[0];
  const knownCommands = new Set(['run', 'start', 'machine', 'package', 'public', 'browser', 'status', 'supersede', 'reconcile', 'complete']);
  const command = first && !first.startsWith('--') ? first : 'run';
  if (!knownCommands.has(command)) throw new Error(`unknown release:update command: ${command}`);
  let index = first && !first.startsWith('--') ? 1 : 0;
  const options = {
    command,
    url: undefined,
    packagePath: undefined,
    surface: undefined,
    evidencePath: undefined,
    reason: undefined,
    statePath: undefined,
  };
  while (index < args.length) {
    const arg = args[index++];
    const value = () => {
      if (index >= args.length) throw new Error(`${arg} requires a value`);
      return args[index++];
    };
    if (arg === '--url') options.url = value();
    else if (arg === '--package' || arg === '--zip') options.packagePath = value();
    else if (arg === '--surface') options.surface = value();
    else if (arg === '--evidence' || arg === '--file') options.evidencePath = value();
    else if (arg === '--reason') options.reason = value();
    else if (arg === '--state') options.statePath = value();
    else throw new Error(`unknown release:update argument: ${arg}`);
  }
  if (options.surface !== undefined) assertPhase(options.surface);
  if (command === 'browser' && !options.surface) throw new Error('browser requires --surface');
  if (command === 'browser' && options.surface && automatedPhases.has(options.surface)) {
    throw new Error('browser --surface must be portal, installed, desktop, or mobile');
  }
  return options;
}

function statePathFromOptions(options) {
  return path.resolve(options.statePath ?? process.env.RELEASE_UPDATE_STATE_PATH ?? defaultStatePath);
}

async function writeCanonicalState(state, statePath) {
  const directory = path.dirname(statePath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${statePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const handle = await fs.open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tempPath, statePath);
  try {
    const directoryHandle = await fs.open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch {
    // Directory fsync is not available on every supported filesystem.
  }
}

async function readCanonicalState(statePath) {
  let state;
  try {
    state = await readReleaseLoopState(statePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const missing = new Error(`no active release:update run at ${statePath}`);
      missing.code = 'EUPDATEMISSING';
      throw missing;
    }
    const invalid = new Error(`release:update state cannot be read: ${error?.message ?? error}`);
    invalid.code = 'EUPDATESTATE';
    throw invalid;
  }
  if (state?.releaseUpdate?.statePath !== path.resolve(statePath)) {
    const invalid = new Error('release:update state belongs to a different state path; supersede it explicitly or start a new run');
    invalid.code = 'EUPDATESTATE';
    throw invalid;
  }
  return state;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export async function acquireStateLock(statePath, retry = 0) {
  const lockPath = `${statePath}.lock`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const lockOwner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: crypto.randomUUID(),
  };
  const lockContents = JSON.stringify(lockOwner);
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx', 0o600);
    await handle.writeFile(lockContents);
    await handle.sync();
  } catch (error) {
    if (handle) await handle.close();
    if (error?.code !== 'EEXIST') throw error;
    let owner;
    try {
      owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    } catch {
      const blocker = new Error(`release:update lock ${lockPath} is corrupt; preserve it and inspect before retrying`);
      blocker.code = 'EUPDATEACTIVE';
      throw blocker;
    }
    if (processIsAlive(owner?.pid)) {
      const blocker = new Error(`another release:update process owns ${lockPath}`);
      blocker.code = 'EUPDATEACTIVE';
      throw blocker;
    }
    const lockAge = Date.now() - Date.parse(owner?.startedAt ?? '');
    if (!Number.isFinite(lockAge) || lockAge < STALE_LOCK_MIN_AGE_MS) {
      const blocker = new Error(`release:update lock ${lockPath} has no live owner but is too recent to recover safely`);
      blocker.code = 'EUPDATEACTIVE';
      throw blocker;
    }
    if (retry > 0) {
      const blocker = new Error(`release:update lock ${lockPath} changed during stale-lock recovery`);
      blocker.code = 'EUPDATEACTIVE';
      throw blocker;
    }
    if (typeof owner.token === 'string' && owner.token !== '') {
      let currentContents;
      try {
        currentContents = await fs.readFile(lockPath, 'utf8');
      } catch {
        const blocker = new Error(`release:update lock ${lockPath} changed during stale-lock recovery`);
        blocker.code = 'EUPDATEACTIVE';
        throw blocker;
      }
      if (currentContents !== JSON.stringify(owner)) {
        const blocker = new Error(`release:update lock ${lockPath} changed during stale-lock recovery`);
        blocker.code = 'EUPDATEACTIVE';
        throw blocker;
      }
    }
    // Reclaim the stale owner with an atomic rename. A plain unlink leaves a
    // window where two stale-lock recoverers can both delete a newly-created
    // lock and proceed concurrently.
    const reclaimPath = `${lockPath}.reclaim-${process.pid}-${crypto.randomUUID()}`;
    try {
      await fs.rename(lockPath, reclaimPath);
    } catch (renameError) {
      if (renameError?.code === 'ENOENT') return acquireStateLock(statePath, retry + 1);
      throw renameError;
    }
    try {
      const reclaimedContents = await fs.readFile(reclaimPath, 'utf8');
      if (reclaimedContents !== JSON.stringify(owner)) {
        const blocker = new Error(`release:update lock ${lockPath} changed during stale-lock recovery`);
        blocker.code = 'EUPDATEACTIVE';
        throw blocker;
      }
    } finally {
      try { await fs.unlink(reclaimPath); } catch {}
    }
    return acquireStateLock(statePath, retry + 1);
  }
  return async () => {
    try { await handle.close(); } catch {}
    try {
      const currentContents = await fs.readFile(lockPath, 'utf8');
      if (currentContents === lockContents) await fs.unlink(lockPath);
    } catch {
      // Preserve a missing, replaced, or corrupt lock for the next run to inspect.
    }
  };
}

function outputJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

export function normalizeChildBlockerCode(value, fallback) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value) ? value : fallback;
}

export function createReleaseFailurePayload(error, {
  statePath = defaultStatePath,
  state = null,
  phase = error?.releasePhase ?? 'run',
} = {}) {
  const normalizedStatePath = path.resolve(statePath);
  const startedAt = Date.parse(state?.startedAt ?? '');
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : null;
  const blocker = {
    code: error?.code ?? 'EUNKNOWN',
    message: redactText(error?.message ?? error),
  };
  return {
    status: RELEASE_UPDATE_BLOCKER_CODES.has(blocker.code) ? 'BLOCKED' : 'FAILED',
    phase,
    runId: state?.runId ?? null,
    statePath: normalizedStatePath,
    state: state?.status ?? null,
    blocker,
    nextAction: state ? nextAction(state) : 'Inspect the recorded state and retry the same bounded phase; do not create a new login session.',
    missingGates: state ? missingGates(state) : [],
    identity: state?.releaseUpdate?.identity ?? null,
    attempts: state?.releaseUpdate?.attempts ?? {},
    lastFailure: state?.lastFailure ?? null,
    lastActivity: state?.releaseUpdate?.lastActivity ?? null,
    process: {
      name: 'release:update',
      pid: process.pid,
      elapsedMs,
    },
  };
}

function parseChildJson(result, phase, { allowBlocked = false } = {}) {
  const output = String(result.stdout || result.stderr || '').trim();
  let payload;
  try {
    payload = JSON.parse(output);
  } catch (error) {
    const failure = new Error(`${phase} release-loop command did not return JSON evidence`, { cause: error });
    failure.code = result.code === null ? 'ETIMEDOUT' : 'EUPDATEOUTPUT';
    failure.releasePhase = phase;
    throw failure;
  }
  if (result.code !== 0 || payload.status === 'FAILED' || (payload.status === 'BLOCKED' && !allowBlocked)) {
    const detail = payload.blocker?.detail ? `: ${payload.blocker.detail}` : '';
    const failure = new Error(`${payload.blocker?.message ?? `${phase} release-loop command failed`}${detail}`);
    failure.code = normalizeChildBlockerCode(
      payload.blocker?.code,
      result.code === null ? 'ETIMEDOUT' : 'ELOOPPHASE',
    );
    failure.releasePhase = phase;
    throw failure;
  }
  return payload;
}

async function runLoopCommand(statePath, args, phase, state, options = {}) {
  const result = await runWithTimeout(process.execPath, [loopScriptPath, ...args], {
    cwd: root,
    timeoutMs: phaseTimeoutMs[phase] ?? 60_000,
    maxOutputChars: 30_000,
    env: {
      ...process.env,
      RELEASE_UPDATE_DRIVER: '1',
      RELEASE_LOOP_STATE_PATH: statePath,
      ...(state?.commit ? { TEAMS_SOURCE_COMMIT: state.commit } : {}),
      ...(state?.sourceIoMode === 'index-tree-fileprovider-fallback'
        ? { TEAMS_FILEPROVIDER_SERVER_REUSE: '1' }
        : {}),
    },
  });
  return parseChildJson(result, phase, options);
}

function createReleaseIdentity(state, publicOrigin) {
  const appId = packagedAppId(state);
  const serverBundleSha256 = state.public?.health?.serverBundleSha256;
  const assetSha256 = state.public?.asset?.sha256;
  if (
    !appId
    || !publicOrigin
    || !/^[a-f0-9]{64}$/.test(state.package?.sha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(serverBundleSha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(assetSha256 ?? '')
  ) return null;
  return {
    appId,
    sourceCommit: state.commit,
    version: state.version,
    packageSha256: state.package?.sha256,
    publicOrigin,
    serverBundleSha256,
    assetSha256,
  };
}

function assertPackagePath(state, requestedPath) {
  const expected = resolvePath(state?.releaseUpdate?.packagePath ?? defaultPackagePath);
  const requested = requestedPath ? resolvePath(requestedPath) : expected;
  if (requested !== expected) {
    const error = new Error(`release:update only accepts the package generated at ${expected}; requested ${requested}`);
    error.code = 'EPACKAGEPATH';
    throw error;
  }
  return expected;
}

async function annotateStartedState(statePath, state, packagePath, publicOrigin = null) {
  const metadata = updateMetadata(state, {
    statePath: path.resolve(statePath),
    packagePath: assertPackagePath({ releaseUpdate: { packagePath } }),
    publicOrigin: publicOrigin ?? state.releaseUpdate?.publicOrigin ?? null,
  });
  const next = { ...state, releaseUpdate: metadata };
  await writeCanonicalState(next, statePath);
  return next;
}

async function startRun(statePath, packagePath, explicitUrl) {
  if (fsSync.existsSync(statePath)) {
    const existing = await readReleaseLoopState(statePath);
    if (!terminalStatuses.has(existing.status)) {
      const error = new Error(`an active release:update run already exists: ${existing.runId}`);
      error.code = 'EUPDATEACTIVE';
      throw error;
    }
  }
  assertPackagePath({ releaseUpdate: { packagePath: defaultPackagePath } }, packagePath);
  const publicOrigin = await resolveConfiguredPublicOrigin(explicitUrl);
  await runLoopCommand(statePath, ['start'], 'start');
  const state = await readReleaseLoopState(statePath);
  const generatedPackagePath = state.package?.packagePath ?? defaultPackagePath;
  return annotateStartedState(statePath, state, generatedPackagePath, publicOrigin);
}

function recordAttempt(state, phase) {
  const attempts = { ...(state.releaseUpdate?.attempts ?? {}) };
  const previous = attempts[phase] ?? { count: 0 };
  attempts[phase] = {
    count: Number(previous.count ?? 0) + 1,
    startedAt: new Date().toISOString(),
  };
  return { ...state, releaseUpdate: updateMetadata(state, { attempts }) };
}

async function saveFailure(statePath, state, phase, error) {
  let current = state;
  try { current = await readReleaseLoopState(statePath); } catch {}
  const failure = redactReleaseError(error);
  const failed = resetAfterPhaseFailure(current, phase, failure);
  failed.releaseUpdate = updateMetadata(failed, phase === 'portal' ? { registration: null } : {});
  await writeCanonicalState(failed, statePath);
  return failed;
}

async function expectedOriginForState(state, explicitUrl) {
  const configured = await resolveConfiguredPublicOrigin(explicitUrl);
  const recorded = state.releaseUpdate?.publicOrigin;
  if (recorded && configured && recorded !== configured) {
    const error = new Error(`public origin differs from the recorded release identity: ${recorded} vs ${configured}`);
    error.code = 'EORIGINMISMATCH';
    throw error;
  }
  return configured ?? recorded;
}

function assertSamePublicIdentity(recorded, current) {
  const fields = ['appId', 'sourceCommit', 'version', 'packageSha256', 'publicOrigin'];
  for (const field of fields) {
    if (recorded?.[field] !== current?.[field]) throw new Error(`public identity ${field} changed while resuming the release`);
  }
  if (recorded?.serverBundleSha256 !== current?.health?.serverBundleSha256) {
    throw new Error('public identity serverBundleSha256 changed while resuming the release');
  }
  if (!/^[a-f0-9]{64}$/.test(recorded?.assetSha256 ?? '') || recorded.assetSha256 !== current?.asset?.sha256) {
    throw new Error('public asset SHA changed while resuming the release');
  }
}

async function verifyReadyPhaseIdentity(statePath, state, phase) {
  // release-loop status rechecks the pinned HEAD, package path, ZIP digest,
  // and all persisted evidence before a READY phase can be treated as a
  // no-op.
  await runLoopCommand(statePath, ['status'], 'status', state);
  const current = await readCanonicalState(statePath);
  if (phase !== 'public') return current;
  const publicOrigin = await expectedOriginForState(current);
  if (!publicOrigin || !current.releaseUpdate?.identity) {
    throw new Error('READY public phase has no recorded public identity');
  }
  if (packagedAppId(current) !== current.releaseUpdate.identity.appId) {
    throw new Error('recorded public identity appId no longer matches the packaged manifest');
  }
  const payload = await runGatePhase('public', {
    url: publicOrigin,
    env: {
      TEAMS_SOURCE_COMMIT: current.commit,
      ...(current.sourceIoMode === 'index-tree-fileprovider-fallback'
        ? { TEAMS_FILEPROVIDER_SERVER_REUSE: '1' }
        : {}),
    },
  });
  const summary = summarizePhase('public', payload);
  assertSamePublicIdentity(current.releaseUpdate.identity, {
    appId: packagedAppId(current),
    sourceCommit: summary.sourceCommit,
    version: summary.version,
    packageSha256: summary.packageSha256,
    publicOrigin,
    health: summary.health,
    asset: summary.asset,
  });
  return current;
}

function assertSafeJiraText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Jira reconciliation requires ${label}`);
  if (/(?:bearer\s+\S+|password\s*[:=]|api[_ -]?key\s*[:=]|secret\s*[:=])/i.test(value)) {
    throw new Error(`Jira reconciliation ${label} contains credential-like text`);
  }
  return value.trim();
}

export function validateJiraReconciliation(input, state, now = new Date()) {
  if (!input || typeof input !== 'object') throw new Error('Jira reconciliation must be a JSON object');
  if (input.runId !== state.runId) throw new Error('Jira reconciliation run ID does not match the release run');
  const expectedIdentity = state.releaseUpdate?.identity;
  if (!expectedIdentity || JSON.stringify(input.identity) !== JSON.stringify(expectedIdentity)) {
    throw new Error('Jira reconciliation release identity does not match the recorded package/public identity');
  }
  const verifiedAt = assertSafeJiraText(input.verifiedAt, 'verifiedAt');
  const verifiedTime = Date.parse(verifiedAt);
  if (Number.isNaN(verifiedTime) || verifiedTime > now.getTime()) {
    throw new Error('Jira reconciliation verifiedAt must be a current ISO timestamp');
  }
  if (!Array.isArray(input.issues)) throw new Error('Jira reconciliation requires an issues array');
  const remoteVerification = input.remoteVerification;
  if (!remoteVerification || remoteVerification.provider !== 'jira-cloud' || remoteVerification.readBack !== true) {
    throw new Error('Jira reconciliation requires a jira-cloud read-back attestation');
  }
  const remoteVerifiedAt = assertSafeJiraText(remoteVerification.verifiedAt, 'remoteVerification.verifiedAt');
  if (Number.isNaN(Date.parse(remoteVerifiedAt)) || Date.parse(remoteVerifiedAt) > now.getTime()) {
    throw new Error('Jira reconciliation remoteVerification.verifiedAt must be a current ISO timestamp');
  }
  if (!Array.isArray(remoteVerification.responses)) {
    throw new Error('Jira reconciliation requires remoteVerification.responses');
  }
  if (!Array.isArray(input.unresolvedBlockers) || input.unresolvedBlockers.length !== 0) {
    throw new Error('Jira reconciliation cannot complete with unresolved blockers');
  }
  if (!Array.isArray(input.unmappedFindings) || input.unmappedFindings.length !== 0) {
    throw new Error('Jira reconciliation cannot complete with unmapped findings');
  }
  if (input.issues.length === 0 && input.noFindingsConfirmed !== true) {
    throw new Error('Jira reconciliation must confirm noFindingsConfirmed when the issue list is empty');
  }
  if (remoteVerification.responses.length !== input.issues.length) {
    throw new Error('Jira reconciliation remote response count must match the issue count');
  }
  const remoteResponses = remoteVerification.responses.map((response, index) => {
    if (!response || typeof response !== 'object') {
      throw new Error(`Jira remote response ${index + 1} is invalid`);
    }
    const key = assertSafeJiraText(response.key, `remote response ${index + 1} key`);
    if (response.readBack !== true) {
      throw new Error(`Jira remote response ${index + 1} is not a read-back`);
    }
    return { ...response, key };
  });
  if (new Set(remoteResponses.map((response) => response.key)).size !== remoteResponses.length) {
    throw new Error('Jira remote responses must contain unique issue keys');
  }
  const remoteByKey = new Map(remoteResponses.map((response) => [response.key, response]));
  const issueKeys = new Set();
  const issues = input.issues.map((issue, index) => {
    if (!issue || typeof issue !== 'object') throw new Error(`Jira issue ${index + 1} is invalid`);
    const normalized = {
      key: assertSafeJiraText(issue.key, `issue ${index + 1} key`),
      url: assertSafeJiraText(issue.url, `issue ${index + 1} URL`),
      type: assertSafeJiraText(issue.type, `issue ${index + 1} type`),
      assignee: assertSafeJiraText(issue.assignee, `issue ${index + 1} assignee`),
      status: assertSafeJiraText(issue.status, `issue ${index + 1} status`),
      idempotencyKey: assertSafeJiraText(issue.idempotencyKey, `issue ${index + 1} idempotencyKey`),
      discoveryEvidence: assertSafeJiraText(issue.discoveryEvidence, `issue ${index + 1} discoveryEvidence`),
      acceptanceEvidence: assertSafeJiraText(issue.acceptanceEvidence, `issue ${index + 1} acceptanceEvidence`),
      fixCommit: issue.fixCommit == null ? null : assertSafeJiraText(issue.fixCommit, `issue ${index + 1} fixCommit`),
      blocking: issue.blocking === true,
      releaseDisposition: assertSafeJiraText(issue.releaseDisposition, `issue ${index + 1} releaseDisposition`),
    };
    if (issueKeys.has(normalized.key)) {
      throw new Error(`Jira issue ${index + 1} duplicates issue key ${normalized.key}`);
    }
    issueKeys.add(normalized.key);
    if (!normalized.idempotencyKey.startsWith('teams-core:')) {
      throw new Error(`Jira issue ${index + 1} idempotencyKey must start with teams-core:`);
    }
    if (!['fixed', 'deferred'].includes(normalized.releaseDisposition)) {
      throw new Error(`Jira issue ${index + 1} releaseDisposition must be fixed or deferred`);
    }
    if (normalized.releaseDisposition === 'deferred' && normalized.type.toLowerCase() !== 'improvement') {
      throw new Error(`Jira issue ${index + 1} only an Improvement may be deferred`);
    }
    const remote = remoteByKey.get(normalized.key);
    if (!remote || remote.url !== normalized.url || remote.status !== normalized.status) {
      throw new Error(`Jira issue ${index + 1} is missing an exact remote read-back response`);
    }
    if (normalized.blocking && !/^(done|closed|resolved|complete|completed)$/i.test(normalized.status)) {
      throw new Error(`Jira issue ${index + 1} remains blocking in status ${normalized.status}`);
    }
    return normalized;
  });
  return {
    status: 'VERIFIED',
    runId: state.runId,
    verifiedAt,
    identity: expectedIdentity,
    remoteVerification: {
      provider: 'jira-cloud',
      readBack: true,
      verifiedAt: remoteVerifiedAt,
      responseCount: remoteVerification.responses.length,
    },
    issues,
    unresolvedBlockers: [],
    unmappedFindings: [],
  };
}

async function reconcileJira(statePath, state, evidencePath) {
  if (!evidencePath) throw new Error('reconcile requires --evidence <path>');
  await runLoopCommand(statePath, ['status'], 'status', state);
  const current = await readCanonicalState(statePath);
  if (!current.releaseUpdate?.identity) throw new Error('Jira reconciliation requires a recorded package/public identity');
  if (missingGates(current).length > 0) throw new Error(`Jira reconciliation requires all release/UI gates: ${missingGates(current).join(', ')}`);
  const input = JSON.parse(await fs.readFile(path.resolve(evidencePath), 'utf8'));
  const reconciliation = validateJiraReconciliation(input, current);
  const next = {
    ...current,
    releaseUpdate: updateMetadata(current, { jira: reconciliation }),
  };
  await writeCanonicalState(next, statePath);
  return next;
}

function assertCompletionContract(state) {
  if (!state.releaseUpdate?.identity) throw new Error('release completion requires a recorded package/public identity');
  if (!hasVerifiedTeamsRegistration(state)) throw new Error('release completion requires a matching Teams registered package read-back');
  if (!phaseReady(state, 'jira')) throw new Error('release completion requires Jira reconciliation');
  const attestations = state.releaseUpdate?.attestations ?? {};
  const missing = RELEASE_SURFACES.filter((surface) => !attestations[surface]);
  if (missing.length > 0) throw new Error(`release completion requires browser attestations: ${missing.join(', ')}`);
}

function completionReport(state) {
  return {
    runId: state.runId,
    version: state.version,
    commit: state.commit,
    packagePath: state.package?.packagePath,
    packageSha256: state.package?.sha256,
    identity: state.releaseUpdate?.identity ?? null,
    publicHealth: state.public?.health ?? null,
    evidence: Object.fromEntries(RELEASE_SURFACES.map((surface) => [surface, {
      observedAt: state.evidence?.[surface]?.observedAt,
      summary: state.evidence?.[surface]?.summary,
      screenshotBeforePath: state.evidence?.[surface]?.screenshotBeforePath,
      screenshotAfterPath: state.evidence?.[surface]?.screenshotAfterPath,
      accessibilityPath: state.evidence?.[surface]?.accessibilityPath,
      runtimeLogPath: state.evidence?.[surface]?.runtimeLogPath,
      attestation: state.releaseUpdate?.attestations?.[surface] ?? null,
    }])),
    jira: state.releaseUpdate?.jira ?? null,
  };
}

async function executeAutomatedPhase(statePath, state, phase, options) {
  assertPhase(phase);
  if (!automatedPhases.has(phase)) throw new Error(`${phase} is a browser/UI phase`);
  assertPackagePath(state, options.packagePath);
  if (phase === 'public') await expectedOriginForState(state, options.url);
  if (phaseReady(state, phase)) {
    try {
      const verified = await verifyReadyPhaseIdentity(statePath, state, phase);
      return { state: verified, noOp: true };
    } catch (error) {
      const failed = await saveFailure(statePath, state, phase, error);
      error.releasePhase = error.releasePhase ?? phase;
      error.recordedState = failed;
      throw error;
    }
  }
  assertPhasePrerequisite(state, phase);
  const attempted = recordAttempt(state, phase);
  await writeCanonicalState(attempted, statePath);
  const commandArgs = [phase];
  if (phase === 'public') {
    const origin = await expectedOriginForState(attempted, options.url);
    if (origin) commandArgs.push('--url', origin);
  }
  try {
    await runLoopCommand(statePath, commandArgs, phase, attempted);
    const after = await readCanonicalState(statePath);
    if (!phaseReady(after, phase)) throw new Error(`${phase} release-loop command returned without a READY phase`);
    if (phase === 'public') {
      const publicOrigin = await expectedOriginForState(after, options.url);
      const identity = createReleaseIdentity(after, publicOrigin);
      if (!identity) throw new Error('public release identity is incomplete; app ID, origin, or server bundle SHA is missing');
      after.releaseUpdate = updateMetadata(after, { publicOrigin, identity });
      await writeCanonicalState(after, statePath);
      return { state: after, noOp: false };
    }
    const publicOrigin = await expectedOriginForState(after, options.url);
    after.releaseUpdate = updateMetadata(after, {
      packagePath: phase === 'package' ? after.package.packagePath : after.releaseUpdate?.packagePath,
      publicOrigin: publicOrigin ?? state.releaseUpdate?.publicOrigin ?? null,
    });
    await writeCanonicalState(after, statePath);
    return { state: after, noOp: false };
  } catch (error) {
    const failed = await saveFailure(statePath, attempted, phase, error);
    error.releasePhase = error.releasePhase ?? phase;
    error.recordedState = failed;
    throw error;
  }
}

async function executeBrowserEvidence(statePath, state, options) {
  const surface = options.surface;
  assertPhase(surface);
  if (!browserPhases.has(surface)) throw new Error('browser evidence requires a UI surface');
  if (!options.evidencePath) return { state, handoff: summarizeBrowserHandoff(state, surface) };
  const attempted = recordAttempt(state, surface);
  await writeCanonicalState(attempted, statePath);
  try {
    const evidencePath = path.resolve(options.evidencePath);
    const evidenceInput = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
    const { attestation: attestationInput } = splitBrowserEvidenceInput(evidenceInput, { requireFullEvidence: true });
    const attestation = validateBrowserAttestation(attestationInput, attempted, surface);
    let registration;
    if (surface === 'portal') {
      const publicOrigin = await expectedOriginForState(attempted);
      if (!publicOrigin) throw new Error('portal evidence requires a recorded public origin for Teams messaging endpoint verification');
      registration = await verifyTeamsRegistration({
        appId: packagedAppId(attempted),
        expectedVersion: attempted.version,
        expectedEndpoint: `${publicOrigin}/api/messages`,
        expectedPackagePath: attempted.releaseUpdate?.packagePath ?? defaultPackagePath,
        expectedPackageSha256: attempted.package?.sha256,
      });
    }
    await runLoopCommand(statePath, ['evidence', '--file', evidencePath], 'browser', attempted);
    const after = await readCanonicalState(statePath);
    if (!phaseReady(after, surface)) throw new Error(`${surface} evidence was not recorded as READY`);
    after.releaseUpdate = updateMetadata(after, {
      ...(registration ? { registration } : {}),
      attestations: { ...(after.releaseUpdate?.attestations ?? {}), [surface]: attestation },
    });
    await writeCanonicalState(after, statePath);
    return { state: after };
  } catch (error) {
    const failed = await saveFailure(statePath, attempted, surface, error);
    error.releasePhase = error.releasePhase ?? surface;
    error.recordedState = failed;
    throw error;
  }
}

async function runCommand(options) {
  const statePath = statePathFromOptions(options);
  let state;
  if (fsSync.existsSync(statePath)) state = await readCanonicalState(statePath);
  else state = await startRun(statePath, options.packagePath, options.url);
  assertPackagePath(state, options.packagePath);
  if (state.status === 'SUPERSEDED') {
    return outputJson({ status: 'SUPERSEDED', phase: 'run', runId: state.runId, nextAction: 'start' });
  }
  // Do not silently resume a portal handoff after the checkout changed. The
  // release-loop status command verifies the full Git OID, clean tracked
  // worktree, and preserved untracked baseline. A phase-local failure is
  // intentionally allowed so the same bounded phase can be retried.
  if (!terminalStatuses.has(state.status)) {
    const statusPayload = await runLoopCommand(statePath, ['status'], 'status', state, { allowBlocked: true });
    assertResumableStatus(statusPayload);
    state = await readCanonicalState(statePath);
  }
  while (automatedPhases.has(nextAction(state))) {
    const phase = nextAction(state);
    ({ state } = await executeAutomatedPhase(statePath, state, phase, options));
  }
  const action = nextAction(state);
  outputJson({
    status: state.lastFailure ? 'BLOCKED' : 'READY',
    phase: 'run',
    runId: state.runId,
    state: state.status,
    nextAction: action,
    handoff: browserPhases.has(action)
      ? summarizeBrowserHandoff(state, action)
      : action === 'jira' ? summarizeJiraHandoff(state) : undefined,
  });
}

async function supersedeCommand(statePath, reason) {
  if (!reason || reason.trim().length < 8) throw new Error('supersede requires --reason of at least 8 characters');
  const state = await readCanonicalState(statePath);
  const payload = await runLoopCommand(statePath, ['supersede', '--reason', reason], 'complete', state);
  outputJson({ ...payload, phase: 'supersede' });
}

async function executeCli(argv) {
  const options = parseReleaseUpdateArgs(argv);
  const statePath = statePathFromOptions(options);
  const releaseLock = await acquireStateLock(statePath);
  try {
    if (options.command === 'run') return await runCommand(options);
    if (options.command === 'start') {
      const state = await startRun(statePath, options.packagePath, options.url);
      return outputJson({ status: 'READY', phase: 'start', runId: state.runId, state: state.status, nextAction: nextAction(state) });
    }
    if (options.command === 'supersede') return await supersedeCommand(statePath, options.reason);
    const state = await readCanonicalState(statePath);
    assertPackagePath(state, options.packagePath);
    if (options.command === 'status') {
      const payload = await runLoopCommand(statePath, ['status'], 'status', state, { allowBlocked: true });
      const current = await readCanonicalState(statePath);
      return outputJson({
        ...payload,
        phase: 'status',
        nextAction: nextAction(current),
        identity: current.releaseUpdate?.identity ?? null,
        publicOrigin: current.releaseUpdate?.publicOrigin ?? null,
        lastActivity: current.releaseUpdate?.lastActivity ?? null,
      });
    }
    if (options.command === 'reconcile') {
      const next = await reconcileJira(statePath, state, options.evidencePath);
      return outputJson({ status: 'READY', phase: 'jira', runId: next.runId, state: next.status, nextAction: nextAction(next) });
    }
    if (automatedPhases.has(options.command)) {
      const result = await executeAutomatedPhase(statePath, state, options.command, options);
      return outputJson({
        status: 'READY',
        phase: options.command,
        runId: result.state.runId,
        state: result.state.status,
        nextAction: nextAction(result.state),
        noOp: result.noOp,
      });
    }
    if (options.command === 'browser') {
      const result = await executeBrowserEvidence(statePath, state, options);
      if (result.handoff) return outputJson({ status: 'READY', phase: 'browser-handoff', handoff: result.handoff });
      return outputJson({ status: 'READY', phase: options.surface, runId: result.state.runId, state: result.state.status, nextAction: nextAction(result.state) });
    }
    if (options.command === 'complete') {
      if (nextAction(state) !== 'complete') throw new Error(`release:update is not complete; next action is ${nextAction(state)}`);
      assertCompletionContract(state);
      const payload = await runLoopCommand(statePath, ['complete'], 'complete', state);
      const completed = await readCanonicalState(statePath);
      return outputJson({
        ...payload,
        phase: 'complete',
        identity: completed.releaseUpdate?.identity ?? null,
        jira: completed.releaseUpdate?.jira ?? null,
        attestations: completed.releaseUpdate?.attestations ?? {},
        releaseReport: completionReport(completed),
      });
    }
    throw new Error(`unsupported release:update command: ${options.command}`);
  } finally {
    await releaseLock();
  }
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    await executeCli(process.argv.slice(2));
  } catch (error) {
    const failure = redactReleaseError(error);
    let state = null;
    const statePath = statePathFromOptions({ statePath: process.env.RELEASE_UPDATE_STATE_PATH });
    try { state = await readCanonicalState(statePath); } catch {}
    console.error(JSON.stringify(createReleaseFailurePayload(failure, {
      statePath,
      state,
      phase: error.releasePhase ?? process.argv[2] ?? 'run',
    }), null, 2));
    process.exitCode = 1;
  }
}
