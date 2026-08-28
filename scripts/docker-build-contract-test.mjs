import assert from 'node:assert/strict';
import fs from 'node:fs';

const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
const dockerignore = fs.readFileSync('.dockerignore', 'utf8');
const buildClient = fs.readFileSync('scripts/build-client.mjs', 'utf8');
const buildServer = fs.readFileSync('scripts/build-server.mjs', 'utf8');
const ignoredEntries = new Set(
  dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')),
);

assert.match(dockerfile, /^FROM node:22-alpine AS build/m, 'Docker build stage must be pinned to the supported Node image');
assert.match(dockerfile, /RUN apk add --no-cache git/, 'the build stage must provide Git for pinned source verification');
assert.match(dockerfile, /ARG TEAMS_SOURCE_COMMIT/, 'the image build must accept the source commit identity');
assert.match(dockerfile, /ENV TEAMS_SOURCE_COMMIT=\$\{TEAMS_SOURCE_COMMIT\}/, 'the source commit must be carried into the build and runtime stages');
assert.match(dockerfile, /ENV TEAMS_BUILD_CONTEXT=docker/, 'the Docker build must select the narrow Docker context provenance mode');
assert.match(dockerfile, /EXPOSE 3978/, 'the image must expose the Teams runtime port');
assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/health/, 'the image must define an HTTP health check');
assert.match(dockerfile, /CMD \["node", "dist\/server\/index\.js"\]/, 'the image must start the Core server entrypoint');
assert.equal(ignoredEntries.has('.git'), false, 'the build context must retain .git for pinned source verification');
assert.equal(ignoredEntries.has('.gitignore'), false, 'the build context must retain tracked .gitignore for clean source verification');
assert.equal(ignoredEntries.has('.env.example'), false, 'the build context must retain the tracked environment contract');
assert.equal(ignoredEntries.has('data'), false, 'the build context must retain the tracked data directory placeholder');
assert.match(dockerignore, /^!\.env\.example$/m, 'the tracked environment example must override the secret env pattern');
assert.match(dockerignore, /^data\/\*$/m, 'runtime data contents must stay ignored without hiding the tracked directory');
assert.match(dockerignore, /^!data\/\.gitkeep$/m, 'the tracked data directory placeholder must be retained');
for (const [name, source] of [['client', buildClient], ['server', buildServer]]) {
  assert.match(source, /excludedTrackedPaths: dockerBuild \? \['Dockerfile', '\.dockerignore'\] : \[\]/, `${name} build must exclude only Docker special files from Git clean verification`);
}

console.log('PASS: Docker build context carries the pinned Git source and runtime health contract');
