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
