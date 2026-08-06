import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const outputDir = path.join(root, 'dist/server');

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  // Bundle the Teams SDK and its transitive runtime dependencies so the
  // production process does not pay the very large cold module-load cost on
  // every start. Node built-ins remain external for the node platform.
  packages: 'bundle',
  outdir: outputDir,
  entryNames: 'index',
  sourcemap: true,
  banner: {
    js: "import { createRequire as __teamsCreateRequire } from 'node:module'; const require = __teamsCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

console.log(`Server bundle created: ${path.relative(root, outputDir)}`);
