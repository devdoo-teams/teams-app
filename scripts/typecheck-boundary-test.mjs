import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile('tsconfig.release.json', 'utf8'));
const include = config.include ?? [];

assert(include.includes('src/**/*.ts'), 'release typecheck must include server and shared TypeScript sources');
assert(include.includes('src/**/*.tsx'), 'release typecheck must include React TypeScript sources');
assert(include.includes('types/release-stubs/**/*.d.ts'), 'release typecheck must include bounded dependency stubs');
assert(
  !include.includes('vite.config.ts'),
  'release typecheck must not load the unused Vite dependency graph; the production client is built by scripts/build-client.mjs',
);

console.log('PASS: release typecheck is bounded to production source and release stubs');
