import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

import { buildClientAtomically } from './build-client-atomic.mjs';

const root = process.cwd();
const outputDir = path.join(root, 'dist/client');

await buildClientAtomically({
  outputDir,
  buildImplementation: async (temporaryDir) => {
    const assetsDir = path.join(temporaryDir, 'assets');
    await fs.mkdir(assetsDir, { recursive: true });

    await build({
      entryPoints: [path.join(root, 'src/client/main.tsx')],
      bundle: true,
      format: 'esm',
      splitting: true,
      minify: true,
      outdir: assetsDir,
      entryNames: 'main',
      chunkNames: 'chunks/[name]-[hash]',
      // CopilotKit v2 produces a large split bundle. With the current
      // Node 24 + esbuild API combination, generating a source map for that
      // graph can hang indefinitely. Production Teams tabs do not need
      // source maps, so keep this bounded and opt-in only for a separate
      // debugging build when the toolchain is known to support it.
      sourcemap: false,
      loader: { '.css': 'css', '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
      logLevel: 'info',
    });

    const sourceHtml = await fs.readFile(path.join(root, 'src/client/index.html'), 'utf8');
    const clientBundle = await fs.readFile(path.join(assetsDir, 'main.js'));
    const assetVersion = crypto.createHash('sha256').update(clientBundle).digest('hex').slice(0, 12);
    const html = sourceHtml
      .replace('<meta name="theme-color" content="#6264a7" />', '<meta name="theme-color" content="#6264a7" />\n    <link rel="stylesheet" href="./assets/main.css" />')
      .replace('<script type="module" src="/main.tsx"></script>', `<script type="module" src="./assets/main.js?v=${assetVersion}"></script>`);

    await fs.writeFile(path.join(temporaryDir, 'index.html'), html, 'utf8');
  },
});

console.log(`Client bundle created: ${path.relative(root, outputDir)}`);
