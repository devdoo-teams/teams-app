import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const sourceDir = path.join(root, 'src/client/mcp');
const outputDir = path.join(root, 'dist/mcp-widget');
const assetsDir = path.join(outputDir, 'assets');

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });

await build({
  entryPoints: [path.join(sourceDir, 'main.tsx')],
  bundle: true,
  format: 'esm',
  minify: true,
  outdir: assetsDir,
  entryNames: 'main',
  sourcemap: true,
  logLevel: 'info',
});

const sourceHtml = await fs.readFile(path.join(sourceDir, 'index.html'), 'utf8');
const clientBundle = await fs.readFile(path.join(assetsDir, 'main.js'));
const assetVersion = crypto.createHash('sha256').update(clientBundle).digest('hex').slice(0, 12);
const html = sourceHtml.replace(
  '<script type="module" src="./main.tsx"></script>',
  `<script type="module" src="./assets/main.js?v=${assetVersion}"></script>`,
);

await fs.writeFile(path.join(outputDir, 'index.html'), html, 'utf8');
console.log(`MCP GenUI widget created: ${path.relative(root, outputDir)}`);
