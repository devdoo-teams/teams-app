import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const outputDir = path.join(root, 'dist/server');

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outdir: outputDir,
  entryNames: 'index',
  sourcemap: true,
  logLevel: 'info',
});

console.log(`Server bundle created: ${path.relative(root, outputDir)}`);
