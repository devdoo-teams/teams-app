import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const output = process.argv[2];
if (!output || !path.isAbsolute(output) || !output.startsWith('/tmp/')) {
  throw new Error('Usage: node scripts/build-personal-notification-layout-fixture.mjs /tmp/<fixture-output>');
}
await fs.mkdir(output, { recursive: true });
await build({ entryPoints: ['scripts/personal-notification-layout-fixture.tsx'], bundle: true,
  format: 'esm', jsx: 'automatic', outdir: output, entryNames: 'fixture', logLevel: 'info' });
await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MP-349 synthetic layout regression</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
console.log(`Synthetic layout fixture created: ${output}`);
