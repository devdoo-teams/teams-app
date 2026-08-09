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

async function assertClientRuntime(outputDir) {
  const requiredFiles = [
    path.join(outputDir, 'index.html'),
    path.join(outputDir, 'assets', 'main.js'),
    path.join(outputDir, 'assets', 'main.css'),
  ];
  for (const requiredFile of requiredFiles) {
    if (!(await exists(requiredFile))) {
      throw new Error(`incomplete client runtime: missing ${requiredFile}`);
    }
  }
}

/**
 * Builds into a sibling temporary directory and swaps it into place only
 * after every build and post-processing step has completed successfully.
 * A failed build therefore cannot remove the client currently served by the
 * public Teams process.
 */
export async function buildClientAtomically({ outputDir, buildImplementation }) {
  if (!outputDir || typeof buildImplementation !== 'function') {
    throw new TypeError('outputDir and buildImplementation are required');
  }

  const parentDir = path.dirname(outputDir);
  await fs.mkdir(parentDir, { recursive: true });
  const temporaryDir = await fs.mkdtemp(path.join(parentDir, '.client-build-'));
  const backupDir = `${outputDir}.previous-${process.pid}-${Date.now()}`;
  let movedExisting = false;
  let committed = false;

  try {
    await buildImplementation(temporaryDir);
    await assertClientRuntime(temporaryDir);
    if (await exists(outputDir)) {
      await fs.rename(outputDir, backupDir);
      movedExisting = true;
    }
    try {
      await fs.rename(temporaryDir, outputDir);
      await assertClientRuntime(outputDir);
      committed = true;
    } catch (error) {
      if (await exists(outputDir)) {
        await fs.rm(outputDir, { recursive: true, force: true });
      }
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
