import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-optional-provider-build-'));
const outputDir = path.join(temporaryRoot, 'artifact');
try {
  const built = spawnSync(process.execPath, [
    'scripts/build-optional-providers.mjs',
    `--outdir=${outputDir}`,
  ], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(built.status, 0, `optional provider production compilation failed:\n${built.stderr || built.stdout}`);
  const receipt = JSON.parse(await fs.readFile(path.join(outputDir, 'optional-provider-build.json'), 'utf8'));
  assert.deepEqual(receipt.requiredInputs, [
    'src/server/providers/optional-provider-runtime.ts',
    'src/server/providers/optional-provider-entrypoint.ts',
    'src/server/providers/github-agent-tasks-contract.ts',
    'src/server/providers/github-agent-tasks-adapter.ts',
    'src/server/providers/grok-provider-runtime-adapter.ts',
    'src/server/response-engine-grok.ts',
  ]);
  for (const requiredInput of receipt.requiredInputs) {
    assert.equal(receipt.inputs.includes(requiredInput), true, `metafile must include ${requiredInput}`);
  }
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/u);
  assert.ok((await fs.stat(path.join(outputDir, 'index.js'))).size > 0, 'compiled provider bundle must be non-empty');
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log('optional-provider-build-test: PASS');
