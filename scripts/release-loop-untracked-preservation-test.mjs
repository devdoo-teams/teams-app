import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertInitialUntrackedPreserved,
  captureUntrackedBaseline,
  createInitialState,
} from './release-loop.mjs';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-loop-untracked-'));
const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-loop-untracked-outside-'));
const relativePath = 'baseline file.txt';
const baselinePath = path.join(tempDir, relativePath);
const movedPath = path.join(tempDir, 'moved-baseline.txt');
const outsidePath = path.join(outsideDir, 'outside.txt');
const parentSymlinkPath = path.join(tempDir, 'parent-link');
const originalContent = 'user-owned baseline content\n';

try {
  await fs.writeFile(baselinePath, originalContent);
  await fs.writeFile(outsidePath, 'must never be fingerprinted\n');
  const untrackedAtStart = [`?? ${relativePath}`];
  const createState = () => createInitialState({
    runId: 'run-untracked-preservation',
    commit: '0123456789abcdef0123456789abcdef01234567',
    shortCommit: '0123456',
    version: '1.0.0',
    startedAt: '2026-08-19T00:00:00.000Z',
    untrackedAtStart,
    untrackedAtStartBaseline: captureUntrackedBaseline(untrackedAtStart, { rootDir: tempDir }),
  });
  let state = createState();

  assert.deepEqual(
    assertInitialUntrackedPreserved(state, { rootDir: tempDir }),
    { checked: 1 },
    'an unchanged baseline untracked file must pass the preservation gate',
  );

  await fs.writeFile(baselinePath, 'replaced content\n');
  assert.throws(
    () => assertInitialUntrackedPreserved(state, { rootDir: tempDir }),
    (error) => error?.code === 'EUNTRACKEDSTARTMUTATED' && /replaced|content|SHA-256/i.test(error.message),
    'in-place replacement of a baseline untracked file must fail closed',
  );
  await fs.writeFile(baselinePath, originalContent);

  await fs.rename(baselinePath, movedPath);
  assert.throws(
    () => assertInitialUntrackedPreserved(state, { rootDir: tempDir }),
    (error) => error?.code === 'EUNTRACKEDSTARTMUTATED' && /deleted|moved|missing/i.test(error.message),
    'moving a baseline untracked file must fail closed',
  );
  await fs.rename(movedPath, baselinePath);
  state = createState();

  await fs.rm(baselinePath);
  assert.throws(
    () => assertInitialUntrackedPreserved(state, { rootDir: tempDir }),
    (error) => error?.code === 'EUNTRACKEDSTARTMUTATED' && /deleted|moved|missing/i.test(error.message),
    'deleting a baseline untracked file must fail closed',
  );
  await fs.writeFile(baselinePath, originalContent);
  state = createState();

  await fs.writeFile(path.join(tempDir, 'new-release-artifact.txt'), 'new artifact\n');
  assert.deepEqual(
    assertInitialUntrackedPreserved(state, { rootDir: tempDir }),
    { checked: 1 },
    'new release artifacts must not invalidate preserved user-owned baseline files',
  );

  await fs.symlink(outsideDir, parentSymlinkPath, 'dir');
  assert.throws(
    () => captureUntrackedBaseline([`?? ${path.join('parent-link', 'outside.txt')}`], { rootDir: tempDir }),
    (error) => error?.code === 'EUNTRACKEDBASELINEINVALID' && /symlinked parent|escapes/i.test(error.message),
    'a symlinked parent must not permit fingerprinting a file outside the repository',
  );
  assert.throws(
    () => captureUntrackedBaseline(['?? ../outside.txt'], { rootDir: tempDir }),
    (error) => error?.code === 'EUNTRACKEDBASELINEINVALID' && /escapes/i.test(error.message),
    'a lexical parent traversal must fail closed',
  );

  const legacyState = structuredClone(state);
  delete legacyState.untrackedAtStartBaseline;
  assert.throws(
    () => assertInitialUntrackedPreserved(legacyState, { rootDir: tempDir }),
    (error) => error?.code === 'EUNTRACKEDBASELINEUNAVAILABLE' && /baseline|restart|supersede/i.test(error.message),
    'a release state without baseline fingerprints must fail closed',
  );
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
}

console.log('Release-loop untracked preservation tests passed.');
