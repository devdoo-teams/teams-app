import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertServerRuntime(outputDir) {
  const entry = path.join(outputDir, 'index.js');
  if (!(await exists(entry))) throw new Error(`incomplete server runtime: missing ${entry}`);
}

/** Build a server sibling and swap it only after the entry is complete. */
export async function buildServerAtomically({ outputDir, buildImplementation }) {
  if (!outputDir || typeof buildImplementation !== 'function') {
    throw new TypeError('outputDir and buildImplementation are required');
  }

  const parentDir = path.dirname(outputDir);
  await fs.mkdir(parentDir, { recursive: true });
  const temporaryDir = await fs.mkdtemp(path.join(parentDir, '.server-build-'));
  const backupDir = `${outputDir}.previous-${process.pid}-${Date.now()}`;
  let movedExisting = false;
  let committed = false;

  try {
    await buildImplementation(temporaryDir);
    await assertServerRuntime(temporaryDir);
    if (await exists(outputDir)) {
      await fs.rename(outputDir, backupDir);
      movedExisting = true;
    }
    try {
      await fs.rename(temporaryDir, outputDir);
      await assertServerRuntime(outputDir);
      committed = true;
    } catch (error) {
      if (await exists(outputDir)) await fs.rm(outputDir, { recursive: true, force: true });
      if (movedExisting && (await exists(backupDir))) {
        await fs.rename(backupDir, outputDir);
        movedExisting = false;
      }
      throw error;
    }
    if (movedExisting) {
      await fs.rm(backupDir, { recursive: true, force: true });
      movedExisting = false;
    }
  } finally {
    if (!committed) await fs.rm(temporaryDir, { recursive: true, force: true });
    if (movedExisting) {
      if (!(await exists(outputDir))) await fs.rename(backupDir, outputDir);
      else await fs.rm(backupDir, { recursive: true, force: true });
    }
  }
}
