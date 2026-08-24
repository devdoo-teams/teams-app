import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const validatorPath = path.join(scriptsDirectory, 'teams-ui-matrix-validate.mjs');
const matrixPath = path.join(scriptsDirectory, '..', 'docs', 'teams-ui-verification-matrix.md');
const testFilePath = fileURLToPath(import.meta.url);

const FRESH_CAPTURED_AT = '2026-08-10T12:00:00.000Z';

function freshEvidence(pathValue, releaseIdentity, reason) {
  const artifact = fs.readFileSync(pathValue);
  return {
    state: 'captured',
    fresh: true,
    path: pathValue,
    sha256: crypto.createHash('sha256').update(artifact).digest('hex'),
    bytes: artifact.length,
    capturedAt: FRESH_CAPTURED_AT,
    source: 'focused-validator-test',
    releaseIdentity: structuredClone(releaseIdentity),
    reason,
  };
}

function upgradeMatrixFixtureToV2(candidate, evidenceScope = 'desktop') {
  candidate.schemaVersion = 2;
  candidate.evidenceScope = evidenceScope;
  for (const row of candidate.rows) {
    row.evidenceSurface = evidenceScope;
    for (const evidence of [row.screenshotBefore, row.screenshotAfter, row.runtimeEvidence]) {
      evidence.sha256 ??= null;
      evidence.bytes ??= null;
    }
    if (row.accessibilityEvidence?.before || row.accessibilityEvidence?.after) {
      for (const evidence of [row.accessibilityEvidence.before, row.accessibilityEvidence.after]) {
        evidence.sha256 ??= null;
        evidence.bytes ??= null;
      }
    } else {
      row.accessibilityEvidence.sha256 ??= null;
      row.accessibilityEvidence.bytes ??= null;
    }
  }
  return candidate;
}

function promoteRowToPass(candidate) {
  const row = candidate.rows[0];
  candidate.releaseIdentity.packageSha256 ??= '0'.repeat(64);
  const evidenceIdentity = {
    ...candidate.releaseIdentity,
    // The authoritative matrix may intentionally be pre-package with a null
    // SHA. This synthetic value belongs only to the validator fixture; it is
    // never written to the production evidence matrix.
    packageSha256: candidate.releaseIdentity.packageSha256,
  };
  row.screenshotBefore = freshEvidence(
    validatorPath,
    evidenceIdentity,
    'Fresh before screenshot captured for the validator contract test.',
  );
  row.screenshotAfter = freshEvidence(
    testFilePath,
    evidenceIdentity,
    'Fresh after screenshot captured for the validator contract test.',
  );
  row.accessibilityEvidence = {
    schema: 'paired-before-after-v1',
    before: freshEvidence(
      matrixPath,
      evidenceIdentity,
      'Fresh AX-before evidence captured for the validator contract test.',
    ),
    after: freshEvidence(
      validatorPath,
      evidenceIdentity,
      'Fresh AX-after evidence captured for the validator contract test.',
    ),
  };
  row.runtimeEvidence = freshEvidence(
    testFilePath,
    evidenceIdentity,
    'Fresh runtime evidence captured for the validator contract test.',
  );
  row.result = {
    ...row.result,
    status: 'PASS',
    reason: 'PASS: focused validator contract fixture has independent UI and runtime proof.',
    visibleControl: 'The visible control is proven by the paired AX evidence.',
    serverAction: 'The runtime result is proven by the runtime evidence artifact.',
    nextAction: 'No further action for this fixture.',
  };
  return row;
}

async function loadValidatorAndMatrix() {
  assert.ok(fs.existsSync(validatorPath), 'the validator module must exist');
  assert.ok(fs.existsSync(matrixPath), 'the authoritative matrix document must exist');
  const validator = await import(validatorPath);
  const markdown = await fsPromises.readFile(matrixPath, 'utf8');
  const legacyMatrix = validator.extractMatrixData(markdown);
  return {
    validator,
    legacyMatrix,
    matrix: upgradeMatrixFixtureToV2(structuredClone(legacyMatrix)),
  };
}

test('validator CLI explicitly rejects the authoritative legacy matrix pending schema migration', () => {
  assert.ok(fs.existsSync(validatorPath), 'the validator CLI must exist');
  assert.ok(fs.existsSync(matrixPath), 'the authoritative matrix document must exist');

  const result = spawnSync(process.execPath, [validatorPath, matrixPath], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /schemaVersion 1.*legacy|migrate.*schemaVersion 2/i);
});

test('validator rejects legacy schema 1 with an explicit migration error', async () => {
  const { validator, legacyMatrix } = await loadValidatorAndMatrix();
  const result = validator.validateMatrix(legacyMatrix);

  assert.equal(result.ok, false, 'schema 1 must not be accepted as current release evidence');
  assert.match(result.errors.join('\n'), /schemaVersion 1.*legacy|migrate.*schemaVersion 2/i);
});

test('schema 2 requires evidenceSurface plus SHA-256 and bytes on every evidence slot', async () => {
  const { validator, legacyMatrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(legacyMatrix);
  candidate.schemaVersion = 2;
  candidate.evidenceScope = 'desktop';

  const result = validator.validateMatrix(candidate);
  const errors = result.errors.join('\n');
  assert.equal(result.ok, false);
  assert.match(errors, /evidenceSurface/);
  assert.match(errors, /sha256|SHA-256/);
  assert.match(errors, /bytes|byte count/);
});

test('schema 2 fixture with explicit surface and integrity metadata remains structurally valid', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = upgradeMatrixFixtureToV2(structuredClone(matrix));

  const result = validator.validateMatrix(candidate, { evidenceScope: 'desktop' });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('validator enforces exhaustive coverage and records blocked evidence without treating it as a pass', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const result = validator.validateMatrix(matrix);

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.ok(result.summary.total >= 50, 'the matrix must be exhaustive rather than a representative sample');
  assert.ok(result.summary.blocked > 0, 'unavailable external UI evidence must remain explicitly blocked');
  assert.deepEqual(
    result.summary.missingCoverage,
    [],
    `missing coverage: ${result.summary.missingCoverage.join(', ')}`,
  );
});

test('validator accepts matrix-declared extension coverage while retaining the baseline contract', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(matrix);
  const extensionKey = 'test.declared.extension';
  const extensionRow = structuredClone(candidate.rows[0]);
  extensionRow.id = 'teams-ui-test-declared-extension';
  extensionRow.branch = 'Declared extension coverage';
  extensionRow.coverage = [extensionKey];
  candidate.coverage.requiredKeys.push(extensionKey);
  candidate.rows.push(extensionRow);

  const accepted = validator.validateMatrix(candidate);
  assert.equal(accepted.ok, true, accepted.errors.join('\n'));

  const undeclared = structuredClone(matrix);
  const undeclaredRow = structuredClone(undeclared.rows[0]);
  undeclaredRow.id = 'teams-ui-test-undeclared-extension';
  undeclaredRow.branch = 'Undeclared extension coverage';
  undeclaredRow.coverage = ['test.undeclared.extension'];
  undeclared.rows.push(undeclaredRow);
  const rejected = validator.validateMatrix(undeclared);
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join('\n'), /unknown coverage key test\.undeclared\.extension/);
});

test('validator rejects a row that omits the fresh before screenshot gate', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(matrix);
  delete candidate.rows[0].screenshotBefore;

  const result = validator.validateMatrix(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /screenshotBefore/);
});

test('validator rejects PASS when screenshot, AX, or runtime evidence is not fresh and identified', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(matrix);
  const row = candidate.rows[0];
  row.result = {
    ...row.result,
    status: 'PASS',
    reason: 'fixture must be rejected because it has no fresh evidence',
  };

  const result = validator.validateMatrix(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /fresh|release identity|packageSha256/i);
});

test('validator accepts PASS with distinct existing screenshots, paired AX evidence, runtime evidence, and same-release identity', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(matrix);
  promoteRowToPass(candidate);

  const result = validator.validateMatrix(candidate);
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('validator applies the same fresh evidence contract to FAIL rows', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(matrix);
  const row = promoteRowToPass(candidate);
  row.result = {
    ...row.result,
    status: 'FAIL',
    reason: 'FAIL: the independent runtime proof records the observed branch failure.',
  };

  const result = validator.validateMatrix(candidate);
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('validator rejects PASS when before and after screenshot paths are the same', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(matrix);
  const row = promoteRowToPass(candidate);
  row.screenshotAfter.path = row.screenshotBefore.path;

  const result = validator.validateMatrix(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /screenshotBefore and screenshotAfter must use distinct paths/);
});

test('validator rejects PASS when a screenshot or runtime evidence path does not exist', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(matrix);
  const row = promoteRowToPass(candidate);
  row.screenshotBefore.path = path.join(scriptsDirectory, '__missing-screenshot-before__.png');
  row.runtimeEvidence.path = path.join(scriptsDirectory, '__missing-runtime-evidence__.json');

  const result = validator.validateMatrix(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /screenshotBefore\.path must point to an existing evidence path/);
  assert.match(result.errors.join('\n'), /runtimeEvidence\.path must point to an existing evidence path/);
});

test('validator requires distinct fresh before and after AX evidence for PASS', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const missingPhase = structuredClone(matrix);
  const missingPhaseRow = promoteRowToPass(missingPhase);
  delete missingPhaseRow.accessibilityEvidence.before;

  const missingPhaseResult = validator.validateMatrix(missingPhase);
  assert.equal(missingPhaseResult.ok, false);
  assert.match(missingPhaseResult.errors.join('\n'), /accessibilityEvidence\.before is required/);

  const stalePhase = structuredClone(matrix);
  const stalePhaseRow = promoteRowToPass(stalePhase);
  stalePhaseRow.accessibilityEvidence.after.fresh = false;
  stalePhaseRow.accessibilityEvidence.after.state = 'not-captured';
  stalePhaseRow.accessibilityEvidence.after.path = null;
  stalePhaseRow.accessibilityEvidence.after.capturedAt = null;

  const stalePhaseResult = validator.validateMatrix(stalePhase);
  assert.equal(stalePhaseResult.ok, false);
  assert.match(stalePhaseResult.errors.join('\n'), /accessibilityEvidence\.after.*must be fresh/);
});

test('validator includes installedVersion in same-release identity checks when it is present', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(matrix);
  candidate.releaseIdentity.installedVersion = '1.0.26';
  const row = promoteRowToPass(candidate);
  row.accessibilityEvidence.after.releaseIdentity.installedVersion = '1.0.27';

  const result = validator.validateMatrix(candidate);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join('\n'),
    /accessibilityEvidence\.after\.releaseIdentity\.installedVersion must match matrix releaseIdentity/,
  );
});

test('validator requires BLOCKED and N/A reasons to identify their status and evidence scope', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const blockedCandidate = structuredClone(matrix);
  blockedCandidate.rows[0].screenshotBefore.reason = 'Evidence is unavailable.';

  const blockedResult = validator.validateMatrix(blockedCandidate);
  assert.equal(blockedResult.ok, false);
  assert.match(blockedResult.errors.join('\n'), /screenshotBefore\.reason.*BLOCKED|scoped/i);

  const notApplicableCandidate = structuredClone(matrix);
  const notApplicableRow = notApplicableCandidate.rows.find((row) => row.result.status === 'N/A');
  assert.ok(notApplicableRow, 'the authoritative matrix must retain an N/A row for this contract test');
  notApplicableRow.result.reason = 'Not applicable.';

  const notApplicableResult = validator.validateMatrix(notApplicableCandidate);
  assert.equal(notApplicableResult.ok, false);
  assert.match(notApplicableResult.errors.join('\n'), /result\.reason.*N\/A|scoped/i);
});

test('validator requires visible-control proof and server-action/result proof to stay separate', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const candidate = structuredClone(matrix);
  candidate.rows[0].visibleControl.separateFromServerResult = false;
  delete candidate.rows[0].serverAction.resultProof;

  const result = validator.validateMatrix(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /separateFromServerResult|resultProof/);
});

test('validator rejects duplicate row IDs and strict release readiness with blocked rows', async () => {
  const { validator, matrix } = await loadValidatorAndMatrix();
  const duplicate = structuredClone(matrix);
  duplicate.rows[1].id = duplicate.rows[0].id;

  const duplicateResult = validator.validateMatrix(duplicate);
  assert.equal(duplicateResult.ok, false);
  assert.match(duplicateResult.errors.join('\n'), /duplicate row id/i);

  const strictResult = validator.validateMatrix(matrix, { requirePass: true });
  assert.equal(strictResult.ok, false);
  assert.match(strictResult.errors.join('\n'), /BLOCKED|FAIL|strict/i);
});

function fullScopeFixtureFromLegacy(legacyMatrix) {
  const candidate = upgradeMatrixFixtureToV2(structuredClone(legacyMatrix), 'full');
  const surfaceKeys = new Map([
    ['deep-link.trailing-slash', 'portal'],
    ['deep-link.static-tab', 'portal'],
    ['chat.install', 'installed'],
    ['deep-link.open-tab-action', 'installed'],
    ['chat.card.tab-link', 'installed'],
    ['chat.card.no-top-level-duplicate', 'desktop'],
    ['chat.commands.status.summary', 'desktop'],
    ['personal.home.hero', 'desktop'],
    ['personal.home.runtime-panel', 'desktop'],
    ['personal.mobile.narrow-home', 'mobile'],
    ['personal.mobile.narrow-card', 'mobile'],
    ['personal.auth.expired', 'mobile'],
    ['personal.auth.retry', 'mobile'],
  ]);
  for (const row of candidate.rows) {
    const firstKey = Array.isArray(row.coverage) ? row.coverage[0] : undefined;
    row.evidenceSurface = surfaceKeys.get(firstKey) ?? 'desktop';
  }
  return candidate;
}

test('validator requires an injective required-key to distinct-row matching per surface', async () => {
  const { validator, legacyMatrix } = await loadValidatorAndMatrix();
  const candidate = fullScopeFixtureFromLegacy(legacyMatrix);
  const desktopKeys = [
    'chat.card.no-top-level-duplicate',
    'chat.commands.status.summary',
    'personal.home.hero',
    'personal.home.runtime-panel',
  ];
  const desktopRows = candidate.rows.filter((row) => row.evidenceSurface === 'desktop');
  assert.ok(desktopRows.length >= 4, 'fixture needs four desktop rows for the Hall-condition case');
  const preservedCoverage = desktopRows.slice(0, 4).map((row) => row.coverage.filter((key) => !desktopKeys.includes(key)));
  for (const row of desktopRows) {
    const remaining = row.coverage.filter((key) => !desktopKeys.includes(key));
    row.coverage = remaining.length > 0 ? remaining : ['chat.commands.help'];
  }
  desktopRows[0].coverage = [...desktopKeys.slice(0, 3), ...preservedCoverage[0]];
  desktopRows[1].coverage = [...desktopKeys.slice(0, 3), ...preservedCoverage[1]];
  desktopRows[2].coverage = [desktopKeys[3], ...preservedCoverage[2]];
  desktopRows[3].coverage = [desktopKeys[3], ...preservedCoverage[3]];

  const result = validator.validateMatrix(candidate);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /injective|distinct rows|one.*required.*row|matching/i);
});

test('validator rejects full scope when a mobile baseline key is omitted', async () => {
  const { validator, legacyMatrix } = await loadValidatorAndMatrix();
  const candidate = fullScopeFixtureFromLegacy(legacyMatrix);
  const missingKey = 'personal.mobile.narrow-card';
  const target = candidate.rows.find((row) => row.coverage.includes(missingKey));
  assert.ok(target, `fixture must contain ${missingKey}`);
  target.coverage = target.coverage.filter((key) => key !== missingKey);
  if (target.coverage.length === 0) target.coverage = ['chat.commands.help'];

  const result = validator.validateMatrix(candidate);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), new RegExp(`missing coverage:.*${missingKey.replaceAll('.', '\\.')}`));
  assert.match(result.errors.join('\n'), /full scope surface mobile missing required coverage/);
});
