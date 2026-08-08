import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildClientAtomically } from './build-client-atomic.mjs';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-client-atomic-'));
const outputDir = path.join(tempRoot, 'dist', 'client');
const sentinelPath = path.join(outputDir, 'index.html');
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(sentinelPath, 'previous-runtime-must-survive', 'utf8');

await assert.rejects(
  buildClientAtomically({
    outputDir,
    buildImplementation: async () => {
      throw new Error('simulated build failure');
    },
  }),
  /simulated build failure/,
);
assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'previous-runtime-must-survive');

await buildClientAtomically({
  outputDir,
  buildImplementation: async (temporaryDir) => {
    await fs.mkdir(temporaryDir, { recursive: true });
    await fs.writeFile(path.join(temporaryDir, 'index.html'), 'new-runtime', 'utf8');
  },
});
assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'new-runtime');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('Atomic client build tests passed.');
