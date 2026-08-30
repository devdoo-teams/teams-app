import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = await fs.readFile(path.join(root, 'Dockerfile'), 'utf8');
const dockerignore = await fs.readFile(path.join(root, '.dockerignore'), 'utf8');

assert.match(
  dockerfile,
  /^FROM node:24\.19\.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime/m,
  'runtime image must use the pinned CI Node image',
);
assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts --no-audit --no-fund/, 'runtime dependencies must be locked and production-only');
assert.doesNotMatch(dockerfile, /RUN npm (?:run )?build/, 'the image must not rebuild a different release artifact');
assert.match(dockerfile, /COPY dist \.\/dist/, 'the image must consume the CI-built dist tree');
assert.match(dockerfile, /COPY appPackage \.\/appPackage/, 'the image must retain the manifest package source');
assert.match(dockerfile, /COPY scripts\/start-server\.mjs \.\/scripts\/start-server\.mjs/, 'the image must include the npm start loader');
assert.match(dockerfile, /COPY scripts\/runtime-dist\.mjs \.\/scripts\/runtime-dist\.mjs/, 'the image must include the shared runtime root resolver');
assert.match(dockerfile, /COPY scripts\/verify-runtime-dist\.mjs \/tmp\/verify-runtime-dist\.mjs/, 'the image must verify dist before startup');
assert.match(dockerfile, /RUN node \/tmp\/verify-runtime-dist\.mjs/, 'the image must fail closed on a mismatched dist marker');
assert.match(dockerfile, /ENV TEAMS_RUNTIME_DIST_DIR=\/app\/dist/, 'the image must use one explicit client/server dist root');
assert.match(dockerfile, /CMD \["npm", "start"\]/, 'the image must honor the project startup contract');
assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/health/, 'the image must expose an HTTP health check');

for (const ignored of ['node_modules', 'appPackage/build', '.env', '.env.*', '.git']) {
  assert.match(
    dockerignore,
    new RegExp(`^${ignored.replaceAll('.', '\\.')}$`, 'm'),
    `${ignored} must stay out of the runtime build context`,
  );
}
assert.match(dockerignore, /^dist\/\*$/m, 'unverified dist entries must remain excluded by default');
assert.match(dockerignore, /^!dist\/client\/\*\*$/m, 'the verified client tree must remain available');
assert.match(dockerignore, /^!dist\/server\/\*\*$/m, 'the verified server tree must remain available');
assert.match(dockerignore, /^\.env\.\*$/m, 'runtime environment files must never enter the image context');

console.log('PASS: Docker runtime uses pinned Core dist, npm start, provenance verification, and secret-safe context');
