import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MATRIX_SCHEMA_VERSION = 1;

// PASS/FAIL rows use this explicit paired schema for accessibility evidence:
// { schema: ACCESSIBILITY_EVIDENCE_SCHEMA, before: Evidence, after: Evidence }.
// BLOCKED/N/A rows keep the legacy single-slot accessibilityEvidence shape so
// the current matrix remains structurally compatible without treating it as proof.
export const ACCESSIBILITY_EVIDENCE_SCHEMA = 'paired-before-after-v1';

export const REQUIRED_COVERAGE_KEYS = Object.freeze([
  'chat.commands.help',
  'chat.commands.mode',
  'chat.commands.weather.no-coordinate',
  'chat.commands.weather.valid-coordinate',
  'chat.commands.weather.invalid-coordinate',
  'chat.commands.weather.server-error',
  'chat.commands.status.summary',
  'chat.commands.status.job',
  'chat.commands.status.scope-missing',
  'chat.commands.list.populated',
  'chat.commands.list.empty',
  'chat.commands.run.read-only',
  'chat.commands.run.invalid-prompt',
  'chat.commands.write.approval',
  'chat.commands.approve.success',
  'chat.commands.approve.conflict',
  'chat.commands.approve.forbidden',
  'chat.commands.continue.retry',
  'chat.commands.continue.missing',
  'chat.commands.continue.invalid-prompt',
  'chat.commands.commit.success',
  'chat.commands.commit.pending',
  'chat.commands.commit.missing',
  'chat.commands.cancel.success',
  'chat.commands.cancel.conflict',
  'chat.commands.cancel.missing',
  'chat.commands.natural-language.success',
  'chat.commands.natural-language.invalid',
  'chat.commands.empty',
  'chat.scopes.personal',
  'chat.scopes.group',
  'chat.scopes.channel',
  'chat.card.no-top-level-duplicate',
  'chat.card.prompt-view',
  'chat.card.tab-link',
  'chat.card.command.help',
  'chat.card.command.weather',
  'chat.card.command.status',
  'chat.card.command.list',
  'chat.card.approval.approve',
  'chat.card.approval.cancel',
  'chat.card.action.expired',
  'chat.card.action.consumed',
  'chat.card.action.mismatch',
  'chat.card.retry-action.not-rendered',
  'chat.card.response-mode.deterministic',
  'chat.card.response-mode.openai',
  'chat.card.response-mode.local',
  'chat.card.response-mode.unconfigured',
  'chat.install',
  'chat.progress.loading',
  'chat.card.state.loading',
  'chat.card.state.ready',
  'chat.card.state.empty',
  'chat.card.state.error',
  'chat.card.state.approval',
  'chat.card.state.complete',
  'chat.card.section.text',
  'chat.card.section.facts',
  'chat.card.section.stats',
  'chat.card.section.weather',
  'chat.card.section.list',
  'chat.card.section.progress',
  'chat.card.section.status',
  'chat.auth.expired',
  'chat.auth.retry',
  'personal.home.hero',
  'personal.home.runtime-panel',
  'personal.home.response-mode',
  'personal.home.weather',
  'personal.home.items',
  'personal.home.copilot',
  'personal.home.footer',
  'personal.loading.initial',
  'personal.loading.response-mode',
  'personal.loading.weather',
  'personal.loading.items',
  'personal.error.runtime',
  'personal.error.response-mode',
  'personal.error.weather',
  'personal.error.items',
  'personal.retry.runtime',
  'personal.retry.weather',
  'personal.retry.items',
  'personal.empty.weather',
  'personal.empty.items',
  'personal.auth.expired',
  'personal.auth.retry',
  'personal.response-mode.ready',
  'personal.response-mode.saving',
  'personal.response-mode.unconfigured',
  'personal.weather.permission.allow.browser',
  'personal.weather.permission.allow.teams-native',
  'personal.weather.permission.deny.browser',
  'personal.weather.permission.deny.teams-native',
  'personal.weather.provider.demo',
  'personal.weather.server-error',
  'personal.filter.all',
  'personal.filter.open',
  'personal.filter.done',
  'personal.crud.create.success',
  'personal.crud.create.invalid',
  'personal.crud.create.server-error',
  'personal.crud.read.populated',
  'personal.crud.read.empty',
  'personal.crud.read.server-error',
  'personal.crud.update.open',
  'personal.crud.update.save',
  'personal.crud.update.invalid',
  'personal.crud.update.cancel',
  'personal.crud.update.server-error',
  'personal.crud.delete.confirm',
  'personal.crud.delete.cancel',
  'personal.crud.delete.success',
  'personal.crud.delete.server-error',
  'personal.crud.status.open-to-done',
  'personal.crud.status.done-to-open',
  'personal.crud.status.server-error',
  'personal.copilot.lazy-loading',
  'personal.copilot.ready',
  'personal.copilot.prompt-menu',
  'personal.copilot.weather-tool',
  'personal.copilot.task-tool',
  'personal.copilot.approval-visible',
  'personal.copilot.approve.success',
  'personal.copilot.cancel.success',
  'personal.copilot.approval.conflict',
  'personal.copilot.approval.missing-context',
  'personal.copilot.approval.auth-expired',
  'personal.copilot.runtime-error.retry',
  'personal.copilot.runtime-error.reload',
  'personal.copilot.ai-feedback.positive',
  'personal.copilot.ai-feedback.negative',
  'personal.mobile.narrow-home',
  'personal.mobile.narrow-card',
  'codex.approval.allow',
  'codex.approval.cancel',
  'codex.approval.conflict',
  'codex.cancel.success',
  'codex.retry.continue',
  'codex.progress',
  'codex.complete',
  'codex.failed',
  'codex.blocked',
  'codex.auth-expired',
  'deep-link.static-tab',
  'deep-link.open-tab-action',
  'deep-link.response-mode-card',
  'deep-link.trailing-slash',
]);

const REQUIRED_ROW_FIELDS = [
  'id',
  'feature',
  'surface',
  'location',
  'branch',
  'precondition',
  'action',
  'visibleControl',
  'serverAction',
  'expected',
  'screenshotBefore',
  'screenshotAfter',
  'accessibilityEvidence',
  'runtimeEvidence',
  'result',
  'coverage',
];

const RESULT_STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED', 'N/A']);
const EVIDENCE_STATES = new Set(['captured', 'not-captured', 'not-applicable']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const RELEASE_IDENTITY_KEYS = Object.freeze(['appVersion', 'sourceCommit', 'packageSha256', 'installedVersion']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function push(errors, rowId, message) {
  errors.push(rowId ? `${rowId}: ${message}` : message);
}

function validateScopedReason(reason, name, rowId, resultStatus, errors) {
  if (!isNonBlank(reason)) return;
  const normalizedReason = reason.toUpperCase();
  const statusMarker = resultStatus === 'N/A' ? 'N/A' : 'BLOCKED';
  if (!normalizedReason.includes(statusMarker)) {
    push(errors, rowId, `${name}.reason must explicitly include ${statusMarker} for ${resultStatus}`);
  }
  if (name !== 'result' && !normalizedReason.includes(name.toUpperCase())) {
    push(errors, rowId, `${name}.reason must be scoped to ${name}`);
  }
}

function validateReleaseIdentity(identity, errors, label, { requirePackageSha = false } = {}) {
  if (!isObject(identity)) {
    push(errors, '', `${label} must be an object`);
    return;
  }
  if (!SEMVER.test(identity.appVersion ?? '')) push(errors, '', `${label}.appVersion must be X.Y.Z`);
  if (!isNonBlank(identity.sourceCommit)) push(errors, '', `${label}.sourceCommit is required`);
  if (identity.packageSha256 !== null && !SHA256.test(identity.packageSha256 ?? '')) {
    push(errors, '', `${label}.packageSha256 must be a SHA-256 or null`);
  }
  if (requirePackageSha && !SHA256.test(identity.packageSha256 ?? '')) {
    push(errors, '', `${label}.packageSha256 is required for fresh evidence`);
  }
  if (identity.installedVersion !== null && !SEMVER.test(identity.installedVersion ?? '')) {
    push(errors, '', `${label}.installedVersion must be X.Y.Z or null`);
  }
}

function resolveEvidencePath(evidencePath, evidenceBaseDir) {
  return path.isAbsolute(evidencePath) ? path.normalize(evidencePath) : path.resolve(evidenceBaseDir, evidencePath);
}

function validateExistingEvidencePath(evidence, name, rowId, errors, evidenceBaseDir) {
  if (isNonBlank(evidence.path) && !fs.existsSync(resolveEvidencePath(evidence.path, evidenceBaseDir))) {
    push(errors, rowId, `${name}.path must point to an existing evidence path`);
  }
}

function validateEvidence(
  evidence,
  name,
  rowId,
  resultStatus,
  matrixIdentity,
  errors,
  { evidenceBaseDir = process.cwd() } = {},
) {
  if (!isObject(evidence)) {
    push(errors, rowId, `${name} must be an object`);
    return;
  }

  if (typeof evidence.fresh !== 'boolean') push(errors, rowId, `${name}.fresh must be boolean`);
  if (!EVIDENCE_STATES.has(evidence.state)) {
    push(errors, rowId, `${name}.state must be captured, not-captured, or not-applicable`);
  }
  if (!(evidence.path === null || isNonBlank(evidence.path))) {
    push(errors, rowId, `${name}.path must be a non-empty path or null`);
  }
  if (!(evidence.capturedAt === null || (isNonBlank(evidence.capturedAt) && ISO_DATE.test(evidence.capturedAt)))) {
    push(errors, rowId, `${name}.capturedAt must be an ISO UTC timestamp or null`);
  }
  if (!isNonBlank(evidence.reason)) push(errors, rowId, `${name}.reason is required`);
  if (resultStatus === 'BLOCKED' || resultStatus === 'N/A') {
    validateScopedReason(evidence.reason, name, rowId, resultStatus, errors);
  }
  validateReleaseIdentity(evidence.releaseIdentity, errors, `${rowId}.${name}.releaseIdentity`);

  const shouldBeFresh = resultStatus === 'PASS' || resultStatus === 'FAIL';
  if (shouldBeFresh) {
    if (evidence.fresh !== true) push(errors, rowId, `${name} must be fresh for ${resultStatus}`);
    if (evidence.state !== 'captured') push(errors, rowId, `${name}.state must be captured for ${resultStatus}`);
    if (!isNonBlank(evidence.path)) push(errors, rowId, `${name}.path is required for ${resultStatus}`);
    if (!isNonBlank(evidence.capturedAt) || !ISO_DATE.test(evidence.capturedAt)) {
      push(errors, rowId, `${name}.capturedAt is required for ${resultStatus}`);
    }
    if (!isObject(evidence.releaseIdentity) || evidence.releaseIdentity.packageSha256 === null) {
      push(errors, rowId, `${name} must identify a package SHA for ${resultStatus}`);
    }
    validateExistingEvidencePath(evidence, name, rowId, errors, evidenceBaseDir);
    if (isObject(evidence.releaseIdentity) && isObject(matrixIdentity)) {
      for (const key of RELEASE_IDENTITY_KEYS) {
        if (evidence.releaseIdentity[key] !== matrixIdentity[key]) {
          push(errors, rowId, `${name}.releaseIdentity.${key} must match matrix releaseIdentity`);
        }
      }
    }
  } else {
    const expectedState = resultStatus === 'N/A' ? 'not-applicable' : 'not-captured';
    if (evidence.fresh !== false) push(errors, rowId, `${name}.fresh must be false for ${resultStatus}`);
    if (evidence.state !== expectedState) push(errors, rowId, `${name}.state must be ${expectedState} for ${resultStatus}`);
    if (evidence.path !== null) push(errors, rowId, `${name}.path must be null until evidence is captured`);
    if (evidence.capturedAt !== null) push(errors, rowId, `${name}.capturedAt must be null until evidence is captured`);
  }
}

function validateAccessibilityEvidence(
  evidence,
  rowId,
  resultStatus,
  matrixIdentity,
  errors,
  options,
) {
  const shouldBeFresh = resultStatus === 'PASS' || resultStatus === 'FAIL';
  if (!shouldBeFresh) {
    validateEvidence(evidence, 'accessibilityEvidence', rowId, resultStatus, matrixIdentity, errors, options);
    return;
  }

  if (!isObject(evidence)) {
    push(errors, rowId, 'accessibilityEvidence must be an object');
    return;
  }
  if (evidence.schema !== ACCESSIBILITY_EVIDENCE_SCHEMA) {
    push(errors, rowId, `accessibilityEvidence.schema must be ${ACCESSIBILITY_EVIDENCE_SCHEMA} for ${resultStatus}`);
  }

  for (const phase of ['before', 'after']) {
    if (!hasOwn(evidence, phase)) {
      push(errors, rowId, `accessibilityEvidence.${phase} is required for ${resultStatus}`);
      continue;
    }
    validateEvidence(
      evidence[phase],
      `accessibilityEvidence.${phase}`,
      rowId,
      resultStatus,
      matrixIdentity,
      errors,
      options,
    );
  }

  const beforePath = isObject(evidence.before) ? evidence.before.path : null;
  const afterPath = isObject(evidence.after) ? evidence.after.path : null;
  if (isNonBlank(beforePath) && isNonBlank(afterPath)) {
    const resolvedBeforePath = resolveEvidencePath(beforePath, options?.evidenceBaseDir ?? process.cwd());
    const resolvedAfterPath = resolveEvidencePath(afterPath, options?.evidenceBaseDir ?? process.cwd());
    if (resolvedBeforePath === resolvedAfterPath) {
      push(errors, rowId, 'accessibilityEvidence.before and accessibilityEvidence.after must use distinct paths');
    }
  }
}

function validateDistinctEvidencePaths(beforeEvidence, afterEvidence, beforeName, afterName, rowId, errors, evidenceBaseDir) {
  const beforePath = isObject(beforeEvidence) ? beforeEvidence.path : null;
  const afterPath = isObject(afterEvidence) ? afterEvidence.path : null;
  if (!isNonBlank(beforePath) || !isNonBlank(afterPath)) return;
  const resolvedBeforePath = resolveEvidencePath(beforePath, evidenceBaseDir);
  const resolvedAfterPath = resolveEvidencePath(afterPath, evidenceBaseDir);
  if (resolvedBeforePath === resolvedAfterPath) {
    push(errors, rowId, `${beforeName} and ${afterName} must use distinct paths`);
  }
}

function validateActionObject(action, rowId, errors) {
  if (!isObject(action)) {
    push(errors, rowId, 'action must be an object');
    return;
  }
  for (const key of ['userGesture', 'input', 'operation']) {
    if (!isNonBlank(action[key])) push(errors, rowId, `action.${key} is required`);
  }
}

function validateVisibleControl(control, rowId, errors) {
  if (!isObject(control)) {
    push(errors, rowId, 'visibleControl must be an object');
    return;
  }
  for (const key of ['role', 'label', 'presenceAssertion', 'freshAxAssertion']) {
    if (!isNonBlank(control[key])) push(errors, rowId, `visibleControl.${key} is required`);
  }
  if (control.separateFromServerResult !== true) {
    push(errors, rowId, 'visibleControl.separateFromServerResult must be true');
  }
}

function validateServerAction(action, rowId, errors) {
  if (!isObject(action)) {
    push(errors, rowId, 'serverAction must be an object');
    return;
  }
  for (const key of ['transport', 'trigger', 'handler', 'request', 'resultProof']) {
    if (!isNonBlank(action[key])) push(errors, rowId, `serverAction.${key} is required`);
  }
  if (action.notVisibleOnly !== true) push(errors, rowId, 'serverAction.notVisibleOnly must be true');
}

function validateExpected(expected, rowId, errors) {
  if (!isObject(expected)) {
    push(errors, rowId, 'expected must be an object');
    return;
  }
  for (const key of ['before', 'after', 'server', 'failure']) {
    if (!isNonBlank(expected[key])) push(errors, rowId, `expected.${key} is required`);
  }
}

function validateResult(result, rowId, errors) {
  if (!isObject(result)) {
    push(errors, rowId, 'result must be an object');
    return undefined;
  }
  if (!RESULT_STATUSES.has(result.status)) push(errors, rowId, 'result.status must be PASS, FAIL, BLOCKED, or N/A');
  if (!isNonBlank(result.reason)) push(errors, rowId, 'result.reason is required');
  if (result.status === 'BLOCKED' || result.status === 'N/A') {
    validateScopedReason(result.reason, 'result', rowId, result.status, errors);
  }
  for (const key of ['visibleControl', 'serverAction', 'nextAction']) {
    if (!isNonBlank(result[key])) push(errors, rowId, `result.${key} is required`);
  }
  return result.status;
}

function validateRow(row, index, matrixIdentity, errors, seenIds, foundCoverage, options, allowedCoverageKeys) {
  const rowId = isObject(row) && isNonBlank(row.id) ? row.id : `row[${index}]`;
  if (!isObject(row)) {
    push(errors, rowId, 'row must be an object');
    return;
  }

  for (const key of REQUIRED_ROW_FIELDS) {
    if (!hasOwn(row, key)) push(errors, rowId, `missing required field ${key}`);
  }

  if (seenIds.has(row.id)) push(errors, rowId, 'duplicate row id');
  if (isNonBlank(row.id)) seenIds.add(row.id);

  for (const key of ['feature', 'surface', 'location', 'branch', 'precondition']) {
    if (!isNonBlank(row[key])) push(errors, rowId, `${key} is required`);
  }

  validateActionObject(row.action, rowId, errors);
  validateVisibleControl(row.visibleControl, rowId, errors);
  validateServerAction(row.serverAction, rowId, errors);
  validateExpected(row.expected, rowId, errors);

  const status = validateResult(row.result, rowId, errors);
  if (status) {
    for (const [name, evidence] of [
      ['screenshotBefore', row.screenshotBefore],
      ['screenshotAfter', row.screenshotAfter],
      ['runtimeEvidence', row.runtimeEvidence],
    ]) {
      validateEvidence(evidence, name, rowId, status, matrixIdentity, errors, options);
    }
    validateAccessibilityEvidence(row.accessibilityEvidence, rowId, status, matrixIdentity, errors, options);
    if (status === 'PASS' || status === 'FAIL') {
      validateDistinctEvidencePaths(
        row.screenshotBefore,
        row.screenshotAfter,
        'screenshotBefore',
        'screenshotAfter',
        rowId,
        errors,
        options.evidenceBaseDir,
      );
    }
  }

  if (!Array.isArray(row.coverage) || row.coverage.length === 0) {
    push(errors, rowId, 'coverage must contain at least one required coverage key');
  } else {
    for (const key of row.coverage) {
      if (!isNonBlank(key)) push(errors, rowId, 'coverage keys must be non-empty strings');
      if (!allowedCoverageKeys.includes(key)) push(errors, rowId, `unknown coverage key ${key}`);
      foundCoverage.add(key);
    }
  }
}

export function extractMatrixData(markdown) {
  if (!isNonBlank(markdown)) throw new Error('matrix document is empty');
  const matches = [...markdown.matchAll(/<!--\s*TEAMS_UI_MATRIX_JSON_START\s*-->\s*```json\s*([\s\S]*?)\s*```\s*<!--\s*TEAMS_UI_MATRIX_JSON_END\s*-->/g)];
  if (matches.length !== 1) throw new Error('matrix document must contain exactly one marked JSON block');
  try {
    return JSON.parse(matches[0][1]);
  } catch (error) {
    throw new Error(`matrix JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function validateMatrix(
  matrix,
  {
    requirePass = false,
    evidenceBaseDir = process.cwd(),
    requiredCoverageKeys,
  } = {},
) {
  const errors = [];
  const seenIds = new Set();
  const foundCoverage = new Set();

  if (!isObject(matrix)) {
    return {
      ok: false,
      errors: ['matrix must be an object'],
      summary: { total: 0, pass: 0, fail: 0, blocked: 0, notApplicable: 0, missingCoverage: [...REQUIRED_COVERAGE_KEYS] },
    };
  }
  if (matrix.schemaVersion !== MATRIX_SCHEMA_VERSION) push(errors, '', `schemaVersion must be ${MATRIX_SCHEMA_VERSION}`);
  if (!isNonBlank(matrix.matrixId)) push(errors, '', 'matrixId is required');
  if (!isObject(matrix.releaseIdentity)) push(errors, '', 'releaseIdentity is required');
  validateReleaseIdentity(matrix.releaseIdentity, errors, 'releaseIdentity');
  if (!isObject(matrix.evidencePolicy)) push(errors, '', 'evidencePolicy is required');
  if (!Array.isArray(matrix.rows)) push(errors, '', 'rows must be an array');

  const declaredCoverageKeys = Array.isArray(matrix.coverage?.requiredKeys)
    ? matrix.coverage.requiredKeys
    : [];
  const allowedCoverageKeys = [...new Set([...REQUIRED_COVERAGE_KEYS, ...declaredCoverageKeys])];
  const requiredKeys = requiredCoverageKeys ?? allowedCoverageKeys;
  if (!Array.isArray(matrix.coverage?.requiredKeys)) {
    push(errors, '', 'coverage.requiredKeys must be an array');
  }

  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  for (const [index, row] of rows.entries()) {
    validateRow(row, index, matrix.releaseIdentity, errors, seenIds, foundCoverage, { evidenceBaseDir }, allowedCoverageKeys);
  }

  const missingCoverage = requiredKeys.filter((key) => !foundCoverage.has(key));
  if (missingCoverage.length > 0) push(errors, '', `missing coverage: ${missingCoverage.join(', ')}`);

  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, 'N/A': 0 };
  for (const row of rows) {
    const status = row?.result?.status;
    if (RESULT_STATUSES.has(status)) counts[status] += 1;
  }
  if (requirePass && (counts.FAIL > 0 || counts.BLOCKED > 0)) {
    push(errors, '', `strict readiness requires no FAIL or BLOCKED rows (FAIL=${counts.FAIL}, BLOCKED=${counts.BLOCKED})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      total: rows.length,
      pass: counts.PASS,
      fail: counts.FAIL,
      blocked: counts.BLOCKED,
      notApplicable: counts['N/A'],
      missingCoverage,
    },
  };
}

export function validateMatrixDocument(markdown, options = {}) {
  try {
    return validateMatrix(extractMatrixData(markdown), options);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      summary: { total: 0, pass: 0, fail: 0, blocked: 0, notApplicable: 0, missingCoverage: [...REQUIRED_COVERAGE_KEYS] },
    };
  }
}

function formatSummary(summary) {
  return `rows=${summary.total} PASS=${summary.pass} FAIL=${summary.fail} BLOCKED=${summary.blocked} N/A=${summary.notApplicable} coverageMissing=${summary.missingCoverage.length}`;
}

function runCli() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const defaultMatrixPath = path.resolve(scriptDirectory, '../docs/teams-ui-verification-matrix.md');
  const argumentsWithoutFlags = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const matrixPath = path.resolve(argumentsWithoutFlags[0] ?? defaultMatrixPath);
  const requirePass = process.argv.includes('--require-pass');

  let markdown;
  try {
    markdown = fs.readFileSync(matrixPath, 'utf8');
  } catch (error) {
    console.error(`Teams UI matrix could not be read: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const result = validateMatrixDocument(markdown, { requirePass, evidenceBaseDir: path.dirname(matrixPath) });
  if (!result.ok) {
    console.error(`Teams UI matrix invalid: ${formatSummary(result.summary)}`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Teams UI matrix valid: ${formatSummary(result.summary)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
