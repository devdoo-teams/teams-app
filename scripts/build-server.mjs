import path from 'node:path';
import { build } from 'esbuild';
import { buildServerAtomically } from './build-server-atomic.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const outputDir = path.join(resolveRuntimeDistRoot(root), 'server');
const coreBuild = process.argv.includes('--core');

await buildServerAtomically({
  outputDir,
  buildImplementation: (temporaryDir) => build({
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
    // These imports are only reached by explicitly enabled optional branches.
    // Leave them external in the core artifact so the deterministic Teams
    // server has no MCP/CopilotKit chunks to ship or initialize.
    external: coreBuild
      ? [
        '@copilotkit/*',
        '@modelcontextprotocol/*',
        './mcp-genui.js',
        './copilot-agent.js',
        './copilot-channels-shadow.js',
      ]
      : [],
    outdir: temporaryDir,
    entryNames: 'index',
    splitting: coreBuild,
    sourcemap: coreBuild ? false : true,
    banner: {
      js: "import { createRequire as __teamsCreateRequire } from 'node:module'; const require = __teamsCreateRequire(import.meta.url);",
    },
    define: coreBuild ? { __TEAMS_CORE_BUILD__: 'true' } : {},
    logLevel: 'info',
  }),
});

console.log(`Server bundle created: ${path.relative(root, outputDir)}`);
