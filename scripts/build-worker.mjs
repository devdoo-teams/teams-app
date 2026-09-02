import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const outdirFlag = process.argv.indexOf('--outdir');
const configuredOutdir = outdirFlag >= 0 ? process.argv[outdirFlag + 1] : undefined;
if (outdirFlag >= 0 && !configuredOutdir) throw new Error('--outdir requires a path');
const target = path.resolve(root, configuredOutdir ?? 'dist/worker');
const parent = path.dirname(target);
const staging = path.join(parent, `.${path.basename(target)}-staging-${process.pid}-${Date.now()}`);
const backup = path.join(parent, `.${path.basename(target)}-backup-${process.pid}-${Date.now()}`);

await fs.mkdir(parent, { recursive: true });
try {
  await build({
    absWorkingDir: root,
    entryPoints: {
      index: 'src/worker/index.ts',
      composition: 'src/worker/composition.ts',
    },
    outdir: staging,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire as __teamsCreateRequire } from 'node:module'; const require = __teamsCreateRequire(import.meta.url);",
    },
    sourcemap: false,
    logLevel: 'info',
  });

  let hadTarget = false;
  try {
    await fs.rename(target, backup);
    hadTarget = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await fs.rename(staging, target);
    if (hadTarget) await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadTarget) await fs.rename(backup, target);
    throw error;
  }
} finally {
  await fs.rm(staging, { recursive: true, force: true });
  await fs.rm(backup, { recursive: true, force: true });
}
