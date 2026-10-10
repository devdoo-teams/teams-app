import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.scripts['build:channels-renderer'], 'node scripts/build-channels-renderer.mjs',
  'explicit pinned renderer artifact build command is missing');
assert.doesNotMatch(pkg.scripts.build, /channels-renderer/);
assert.doesNotMatch(pkg.scripts['build:core'], /channels-renderer/);
const releasePaths = JSON.parse(await fs.readFile(path.join(root, 'tsconfig.release.json'), 'utf8')).compilerOptions.paths;
assert.deepEqual(releasePaths['@copilotkit/channels-teams/render'], ['types/release-stubs/copilotkit-channels-teams-render.d.ts']);
assert.match(await fs.readFile(path.join(root, 'types/release-stubs/copilotkit-channels-ui.d.ts'), 'utf8'), /function createNativeNode\(/);
const { buildChannelsRenderer, validateChannelsRendererArtifact, CHANNELS_RENDERER_OUTPUT, CHANNELS_RENDERER_MARKER } =
  await import('./build-channels-renderer.mjs');
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-channels-renderer-build-test-'));
const git = args => execFileSync('git', args, { cwd: fixture, timeout: 5_000, encoding: 'utf8',
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
try {
  git(['init', '-q']);
  git(['config', 'user.name', 'Teams Synthetic Test']);
  git(['config', 'user.email', 'teams-test@example.invalid']);
  await fs.writeFile(path.join(fixture, '.gitignore'), 'dist/\n');
  await fs.writeFile(path.join(fixture, 'package.json'), '{"type":"module"}\n');
  for (const source of ['src/server/channels-native-card-renderer.ts', 'src/shared/genui.ts', 'src/shared/response-mode.ts']) {
    await fs.mkdir(path.dirname(path.join(fixture, source)), { recursive: true });
    await fs.copyFile(path.join(root, source), path.join(fixture, source));
  }
  git(['add', '--', '.gitignore', 'package.json', 'src']);
  git(['commit', '-q', '-m', 'synthetic pinned renderer source']);
  const commit = git(['rev-parse', 'HEAD']);
  const untracked = path.join(fixture, 'keep-user-file.txt');
  await fs.writeFile(untracked, 'must stay untouched\n');
  const outputDir = path.join(fixture, 'dist', 'channels-renderer');
  const options = { root: fixture, sourceCommit: commit, outputDir, nodeModulesDir: path.join(root, 'node_modules') };
  await assert.rejects(buildChannelsRenderer({ ...options, sourceCommit: commit.slice(0, 8) }), /full|pinned|OID/i);
  const entry = path.join(fixture, 'src/server/channels-native-card-renderer.ts');
  const source = await fs.readFile(entry, 'utf8');
  await fs.appendFile(entry, '\n// tracked dirty change\n');
  await assert.rejects(buildChannelsRenderer(options), error => error.code === 'EWORKTREEDIRTY');
  assert.equal(await fs.access(outputDir).then(() => true, () => false), false, 'dirty build publishes no artifact');
  await fs.writeFile(entry, source);
  const marker = await buildChannelsRenderer(options);
  assert.equal(CHANNELS_RENDERER_OUTPUT, 'channels-native-card-renderer.js');
  assert.equal(CHANNELS_RENDERER_MARKER, '.teams-channels-renderer-build.json');
  assert.equal(marker.schemaVersion, 1);
  assert.equal(marker.mode, 'channels-native-renderer');
  assert.equal(marker.worktree, 'clean');
  assert.equal(marker.commit, commit);
  assert.equal(marker.sourceCommit, commit);
  assert.equal(marker.output, CHANNELS_RENDERER_OUTPUT);
  assert.deepEqual(marker.packageVersions, { '@copilotkit/channels-ui': '0.7.3', '@copilotkit/channels-teams': '0.7.3' });
  const artifact = await fs.readFile(path.join(outputDir, CHANNELS_RENDERER_OUTPUT));
  assert.equal(marker.artifactSha256, createHash('sha256').update(artifact).digest('hex'));
  assert.deepEqual(await validateChannelsRendererArtifact(outputDir, commit), marker);
  const module = await import(pathToFileURL(path.join(outputDir, CHANNELS_RENDERER_OUTPUT)).href);
  assert.equal(typeof module.renderChannelsNativeCard, 'function', 'built artifact exposes real renderer');
  assert.equal(module.CHANNELS_NATIVE_RENDERER_CONTRACT.packageVersion, '0.7.3');
  const canonical = { type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.6',
    body: [{ type: 'TextBlock', text: '합성 결과', wrap: true }] };
  assert.deepEqual(module.renderChannelsNativeCard({ card: canonical, kind: 'result', identity: { jobId: 'synthetic-job' },
    scope: { tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner', conversationId: 'synthetic-chat' }, actionGrants: [] }).card, canonical);
  const second = await buildChannelsRenderer({ ...options, outputDir: path.join(fixture, 'dist', 'second-renderer') });
  assert.equal(second.artifactSha256, marker.artifactSha256, 'pinned source build is deterministic across temporary roots');
  await assert.rejects(validateChannelsRendererArtifact(outputDir, 'b'.repeat(40)), /CHANNELS_RENDERER_ARTIFACT_INVALID/);
  const markerPath = path.join(outputDir, CHANNELS_RENDERER_MARKER);
  for (const changed of [{ schemaVersion: 0 }, { mode: 'core' }, { worktree: 'dirty' }, { output: '../escape.js' },
    { artifactSha256: 'a'.repeat(64) }, { packageVersions: { '@copilotkit/channels-ui': '0.9.0' } }]) {
    await fs.writeFile(markerPath, JSON.stringify({ ...marker, ...changed }));
    await assert.rejects(validateChannelsRendererArtifact(outputDir, commit), /CHANNELS_RENDERER_ARTIFACT_INVALID/);
  }
  await fs.writeFile(markerPath, JSON.stringify(marker));
  await fs.appendFile(path.join(outputDir, CHANNELS_RENDERER_OUTPUT), '\n// tampered\n');
  await assert.rejects(validateChannelsRendererArtifact(outputDir, commit), /CHANNELS_RENDERER_ARTIFACT_INVALID/);
  await fs.writeFile(path.join(outputDir, CHANNELS_RENDERER_OUTPUT), artifact);
  await fs.writeFile(entry, `import '@copilotkit/runtime';\n${source}`);
  git(['add', '--', 'src/server/channels-native-card-renderer.ts']);
  git(['commit', '-q', '-m', 'synthetic forbidden provider import']);
  await assert.rejects(buildChannelsRenderer({ ...options, sourceCommit: git(['rev-parse', 'HEAD']) }), /SOURCE_CLOSURE_DRIFT/);
  assert.deepEqual(await fs.readFile(path.join(outputDir, CHANNELS_RENDERER_OUTPUT)), artifact, 'provider drift preserves previous artifact');
  await fs.writeFile(entry, 'this is invalid typescript !\n');
  git(['add', '--', 'src/server/channels-native-card-renderer.ts']);
  git(['commit', '-q', '-m', 'synthetic failing source']);
  await assert.rejects(buildChannelsRenderer({ ...options, sourceCommit: git(['rev-parse', 'HEAD']) }));
  assert.deepEqual(await fs.readFile(path.join(outputDir, CHANNELS_RENDERER_OUTPUT)), artifact, 'failed build preserves previous artifact');
  assert.equal(await fs.readFile(untracked, 'utf8'), 'must stay untouched\n');
  console.log('Channels renderer build tests passed: pinned clean Git, actual native artifact, marker/hash drift, deterministic build, provider import rejection, atomic failure, preserved user files, Core opt-in boundary.');
} finally { await fs.rm(fixture, { recursive: true, force: true }); }
