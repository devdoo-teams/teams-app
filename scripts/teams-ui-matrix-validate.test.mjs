import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  return {
    state: 'captured',
    fresh: true,
    path: pathValue,
    capturedAt: FRESH_CAPTURED_AT,
    source: 'focused-validator-test',
    releaseIdentity: structuredClone(releaseIdentity),
    reason,
  };
}

function promoteRowToPass(candidate) {
  const row = candidate.rows[0];
  row.screenshotBefore = freshEvidence(
    validatorPath,
    candidate.releaseIdentity,
    'Fresh before screenshot captured for the validator contract test.',
  );
  row.screenshotAfter = freshEvidence(
    testFilePath,
    candidate.releaseIdentity,
    'Fresh after screenshot captured for the validator contract test.',
  );
  row.accessibilityEvidence = {
    schema: 'paired-before-after-v1',
    before: freshEvidence(
      matrixPath,
      candidate.releaseIdentity,
      'Fresh AX-before evidence captured for the validator contract test.',
    ),
    after: freshEvidence(
      validatorPath,
      candidate.releaseIdentity,
      'Fresh AX-after evidence captured for the validator contract test.',
    ),
  };
  row.runtimeEvidence = freshEvidence(
    testFilePath,
    candidate.releaseIdentity,
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
  return { validator, matrix: validator.extractMatrixData(markdown) };
}

test('validator accepts the authoritative Teams UI matrix document', () => {
  assert.ok(fs.existsSync(validatorPath), 'the validator CLI must exist');
  assert.ok(fs.existsSync(matrixPath), 'the authoritative matrix document must exist');

  const result = spawnSync(process.execPath, [validatorPath, matrixPath], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Teams UI matrix valid/);
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
