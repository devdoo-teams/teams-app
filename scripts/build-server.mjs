import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const outputDir = path.join(root, 'dist/server');
const coreBuild = process.argv.includes('--core');

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  // Bundle the Teams SDK and its transitive runtime dependencies so the
  // production process does not pay the very large cold module-load cost on
  // every start. Only explicitly optional provider packages stay external in
  // the core build; externalizing every package makes Node resolve the Teams
  // SDK's large export graph at startup and can hang before listen().
  packages: 'bundle',
  external: coreBuild ? ['@copilotkit/*', '@modelcontextprotocol/*'] : [],
  outdir: outputDir,
  entryNames: 'index',
  // Keep optional dynamic-import graphs in separate chunks for the core
  // production build. Without code splitting, esbuild hoists their external
  // provider imports into the entry module and the Teams-only server still
  // pays (or can hang on) optional module initialization at startup.
  splitting: coreBuild,
  // Source-map generation for the Teams SDK graph is not needed by the
  // production runtime and can keep Node 24/esbuild open indefinitely.
  sourcemap: coreBuild ? false : true,
  banner: {
    js: "import { createRequire as __teamsCreateRequire } from 'node:module'; const require = __teamsCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

console.log(`Server bundle created: ${path.relative(root, outputDir)}`);
