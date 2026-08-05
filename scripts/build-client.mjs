import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const outputDir = path.join(root, 'dist/client');
const assetsDir = path.join(outputDir, 'assets');

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/client/main.tsx')],
  bundle: true,
  format: 'esm',
  minify: true,
  outdir: assetsDir,
  entryNames: 'main',
  sourcemap: true,
  logLevel: 'info',
});

const sourceHtml = await fs.readFile(path.join(root, 'src/client/index.html'), 'utf8');
const html = sourceHtml
  .replace('<meta name="theme-color" content="#6264a7" />', '<meta name="theme-color" content="#6264a7" />\n    <link rel="stylesheet" href="./assets/main.css" />')
  .replace('<script type="module" src="/main.tsx"></script>', '<script type="module" src="./assets/main.js"></script>');

await fs.writeFile(path.join(outputDir, 'index.html'), html, 'utf8');

console.log(`Client bundle created: ${path.relative(root, outputDir)}`);
