import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';

const root = process.cwd();
const files = [
  'src/server/codex-capability.ts',
  'src/server/genui-response.ts',
  'src/server/genui-teams.ts',
  'src/server/teams-tab-link.ts',
  'src/shared/genui.ts',
  'src/client/build-flags.ts',
  'src/client/App.tsx',
  'src/client/main.tsx',
];

for (const relativePath of files) {
  const source = await fs.readFile(path.join(root, relativePath), 'utf8');
  const loader = relativePath.endsWith('.tsx') ? 'tsx' : 'ts';
  const result = await transform(source, {
    loader,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: false,
  });
  assert.ok(result.code.length > 0, `${relativePath} produced no compiled output`);
}

console.log(`PASS: core source compile check covered ${files.length} Teams/CLI files`);
