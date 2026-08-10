import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stop, transform } from 'esbuild';

const root = process.cwd();
const files = [
  'src/server/codex-capability.ts',
  'src/server/index.ts',
  'src/server/genui-response.ts',
  'src/server/genui-teams.ts',
  'src/server/teams-tab-link.ts',
  'src/shared/genui.ts',
  'src/client/build-flags.ts',
  'src/client/App.tsx',
  'src/client/main.tsx',
];

const readSource = process.env.TEAMS_FILEPROVIDER_SERVER_REUSE === '1'
  ? (relativePath) => execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: root, encoding: 'utf8', timeout: 10_000 })
  : (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');

async function transformWithBoundedRetry(source, options, relativePath) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await transform(source, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/service (?:was stopped|is no longer running)/i.test(message) || attempt === 2) throw error;
      console.warn(`esbuild service stopped while checking ${relativePath}; retrying once`);
      await stop();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`unreachable core source transform state for ${relativePath}`);
}

for (const relativePath of files) {
  const source = await readSource(relativePath);
  const loader = relativePath.endsWith('.tsx') ? 'tsx' : 'ts';
  const result = await transformWithBoundedRetry(source, {
    loader,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: false,
  }, relativePath);
  assert.ok(result.code.length > 0, `${relativePath} produced no compiled output`);
}

console.log(`PASS: core source compile check covered ${files.length} Teams/CLI files`);
