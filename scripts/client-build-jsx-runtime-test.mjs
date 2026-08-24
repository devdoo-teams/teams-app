import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildSource = fs.readFileSync(path.join(root, 'scripts/build-client.mjs'), 'utf8');
const tsconfigSource = fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8');

assert.match(
  tsconfigSource,
  /"jsx"\s*:\s*"react-jsx"/,
  'the TypeScript source contract uses the automatic React JSX runtime',
);
assert.match(
  buildSource,
  /\bjsx\s*:\s*["']automatic["']/,
  'the production esbuild client bundle must use the automatic JSX runtime too',
);
assert.doesNotMatch(
  buildSource,
  /\bjsx\s*:\s*["']transform["']/,
  'the production client bundle must not fall back to classic JSX globals',
);

console.log('PASS: production client build preserves the automatic React JSX runtime contract');
