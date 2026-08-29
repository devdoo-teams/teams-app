import assert from 'node:assert/strict';
import fs from 'node:fs';

const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
const dockerignore = fs.readFileSync('.dockerignore', 'utf8');
const coreWorkflow = fs.readFileSync('.github/workflows/core-ci.yml', 'utf8');
const runtimeDistVerifier = fs.readFileSync('scripts/verify-runtime-dist.mjs', 'utf8');
const ignoredEntries = new Set(
  dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')),
);
const containerJob = coreWorkflow.match(/\n  container:[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:|\s*$)/)?.[0] ?? '';

assert.match(
  dockerfile,
  /^FROM node:24\.19\.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime/m,
  'the runtime image must use the pinned Node 24.19.0 Alpine base',
);
assert.doesNotMatch(dockerfile, /RUN npm run build/, 'the image must not rebuild a second copy of the release bundle');
assert.match(dockerfile, /ARG TEAMS_SOURCE_COMMIT/, 'the image build must accept the source commit identity');
assert.match(dockerfile, /ENV TEAMS_SOURCE_COMMIT=\$\{TEAMS_SOURCE_COMMIT\}/, 'the source commit must be carried into the build and runtime stages');
assert.match(dockerfile, /COPY dist \.\/dist/, 'the image must reuse the CI-verified dist artifact');
assert.match(dockerfile, /COPY scripts\/verify-runtime-dist\.mjs/, 'the image must run the dist provenance verifier');
assert.match(runtimeDistVerifier, /schemaVersion !== 3/, 'the image verifier must validate the release marker schema');
assert.match(runtimeDistVerifier, /bundleSha256/, 'the image verifier must validate the server bundle digest');
assert.match(dockerfile, /EXPOSE 3978/, 'the image must expose the Teams runtime port');
assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/health/, 'the image must define an HTTP health check');
assert.match(dockerfile, /CMD \["node", "dist\/server\/index\.js"\]/, 'the image must start the Core server entrypoint');
assert.equal(ignoredEntries.has('.git'), true, 'the artifact-only build context must not include Git history');
assert.match(dockerignore, /^dist\/\*$/m, 'the build context must exclude unverified dist entries by default');
assert.match(dockerignore, /^!dist\/client\/$/m, 'the build context must include the verified client artifact');
assert.match(dockerignore, /^!dist\/client\/\*\*$/m, 'the build context must include verified client files');
assert.match(dockerignore, /^!dist\/server\/$/m, 'the build context must include the verified server artifact');
assert.match(dockerignore, /^!dist\/server\/\*\*$/m, 'the build context must include verified server files');
assert.equal(ignoredEntries.has('.env.example'), false, 'the build context must retain the tracked environment contract');
assert.equal(ignoredEntries.has('data'), false, 'the build context must retain the tracked data directory placeholder');
assert.match(dockerignore, /^!\.env\.example$/m, 'the tracked environment example must override the secret env pattern');
assert.match(dockerignore, /^data\/\*$/m, 'runtime data contents must stay ignored without hiding the tracked directory');
assert.match(dockerignore, /^!data\/\.gitkeep$/m, 'the tracked data directory placeholder must be retained');
assert.match(containerJob, /actions\/setup-node@[0-9a-f]{40}/, 'the Core container job must use the pinned Node setup action');
assert.match(containerJob, /npm ci --ignore-scripts --no-audit --no-fund/, 'the Core container job must install locked dependencies before building the artifact');
assert.match(containerJob, /npm run build:core[\s\S]*docker\/build-push-action/, 'the Core container job must build the verified artifact before Docker packaging');

console.log('PASS: Docker packages one CI-verified Core artifact and validates its runtime identity');
