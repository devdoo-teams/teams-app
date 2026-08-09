import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const runtimeDistRoot = resolveRuntimeDistRoot(process.cwd());
process.env.TEAMS_RUNTIME_DIST_DIR = runtimeDistRoot;
await import(pathToFileURL(path.join(runtimeDistRoot, 'server', 'index.js')).href);
