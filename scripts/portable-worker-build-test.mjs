import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const entry = path.join(resolveRuntimeDistRoot(process.cwd()), 'server', 'portable-worker-runtime.js');
assert.ok(fs.existsSync(entry), 'Core build must ship the opt-in portable worker runtime');
const runtime = await import(pathToFileURL(entry).href);
for (const name of ['createPullWorkerHost', 'createPullWorkerRouter', 'createAuthenticatedPullTransport', 'MacPullWorker', 'createAgentServiceMacExecutor', 'resolvePortableHostConfig', 'resolvePortableMacConfig',
  'createPortableHostRuntime', 'createExistingDelegatedAuthorization', 'createMacPullRuntime']) {
  assert.equal(typeof runtime[name], 'function', `portable runtime export ${name}`);
}
console.log('Portable worker runtime artifact exports passed; no host/executor was started.');
