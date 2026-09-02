import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const outdirArgument = process.argv.find((argument) => argument.startsWith('--outdir='));
const outputDir = path.resolve(root, outdirArgument?.slice('--outdir='.length) ?? 'dist/optional-providers');
const requiredInputs = [
  'src/server/providers/optional-provider-entrypoint.ts',
  'src/server/providers/github-agent-tasks-contract.ts',
  'src/server/providers/github-agent-tasks-adapter.ts',
  'src/server/providers/grok-provider-runtime-adapter.ts',
];

await fs.mkdir(path.dirname(outputDir), { recursive: true });
const temporaryDir = await fs.mkdtemp(path.join(path.dirname(outputDir), '.optional-providers-'));
try {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/server/providers/optional-provider-entrypoint.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: path.join(temporaryDir, 'index.js'),
    metafile: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const inputs = Object.keys(result.metafile.inputs)
    .map((input) => path.relative(root, path.resolve(root, input)).split(path.sep).join('/'))
    .sort();
  for (const requiredInput of requiredInputs) {
    assert.equal(inputs.includes(requiredInput), true, `optional provider build must compile ${requiredInput}`);
  }
  const bundle = await fs.readFile(path.join(temporaryDir, 'index.js'));
  assert.ok(bundle.length > 0, 'optional provider bundle must be non-empty');
  const receipt = Object.freeze({
    schemaVersion: 1,
    entryPoint: requiredInputs[0],
    requiredInputs,
    inputs,
    output: 'index.js',
    sha256: crypto.createHash('sha256').update(bundle).digest('hex'),
  });
  await fs.writeFile(path.join(temporaryDir, 'optional-provider-build.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.rename(temporaryDir, outputDir);
  console.log(`Optional provider bundle created: ${path.relative(root, outputDir)}`);
} catch (error) {
  await fs.rm(temporaryDir, { recursive: true, force: true });
  throw error;
}
