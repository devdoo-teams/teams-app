import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadChannelsNativeRenderer } from '../src/server/channels-renderer-loader.js';
import type { ChannelsNativeCardInput } from '../src/server/channels-native-card-renderer.js';

const watchdog = setTimeout(() => {
  console.error('channels-renderer-loader-test: 20-second watchdog expired');
  process.exit(1);
}, 20_000);
watchdog.unref();
const root = mkdtempSync(path.join(os.tmpdir(), 'teams-channels-renderer-loader-'));
const sourceCommit = 'a'.repeat(40);
const expectedContract = { packageVersion: '0.7.3', deliveredVersion: '1.6' };
const importKey = Symbol.for('teams.fixture.channels-renderer-loader.imports');
const globals = globalThis as unknown as Record<symbol, Record<string, number> | undefined>;
const previousImports = globals[importKey];
const imports: Record<string, number> = {};
globals[importKey] = imports;
let checks = 0;

function moduleSource(name: string, contract: unknown = expectedContract, exportRenderer = true): string {
  return `
const imports = globalThis[Symbol.for('teams.fixture.channels-renderer-loader.imports')];
imports[${JSON.stringify(name)}] = (imports[${JSON.stringify(name)}] ?? 0) + 1;
export const CHANNELS_NATIVE_RENDERER_CONTRACT = ${JSON.stringify(contract)};
${exportRenderer ? `export function renderChannelsNativeCard(input) {
  return { status: 'faithful', card: structuredClone(input.card), identity: structuredClone(input.identity),
    plainText: 'synthetic loader fixture', payloadBytes: Buffer.byteLength(JSON.stringify(input.card)),
    contract: CHANNELS_NATIVE_RENDERER_CONTRACT,
    diagnostics: { unsupportedElements: 0, excludedActions: 0, inputContractMismatch: false,
      actionPayloadsPreserved: true, withinTeamsBudget: true } };
}` : 'export const renderChannelsNativeCard = "not a function";'}
`;
}
function fixture(name: string, options: {
  markerPatch?: Record<string, unknown>; rawMarker?: string; omitMarker?: boolean;
  omitArtifact?: boolean; contract?: unknown; exportRenderer?: boolean; tamperArtifact?: boolean;
} = {}): { directory: string; marker: Record<string, unknown> } {
  const directory = path.join(root, name);
  const rendererDirectory = path.join(directory, 'channels-renderer');
  mkdirSync(rendererDirectory, { recursive: true });
  // Distinct URLs prevent ESM's module cache from hiding any contract change.
  writeFileSync(path.join(rendererDirectory, 'package.json'), JSON.stringify({ type: 'module' }));
  const code = moduleSource(name, options.contract ?? expectedContract, options.exportRenderer ?? true);
  const marker = { schemaVersion: 1, sourceCommit, commit: sourceCommit, worktree: 'clean',
    mode: 'channels-native-renderer', output: 'channels-native-card-renderer.js',
    artifactSha256: createHash('sha256').update(code).digest('hex'), ...options.markerPatch };
  if (!options.omitArtifact) writeFileSync(path.join(rendererDirectory, 'channels-native-card-renderer.js'),
    code + (options.tamperArtifact ? '\nthrow new Error("tampered artifact must not be imported");\n' : ''));
  if (!options.omitMarker) writeFileSync(path.join(rendererDirectory, '.teams-channels-renderer-build.json'),
    options.rawMarker ?? JSON.stringify(marker));
  return { directory, marker };
}
const load = (runtimeDistRoot: string, commit = sourceCommit, enabled = true) =>
  loadChannelsNativeRenderer({ enabled, runtimeDistRoot, sourceCommit: commit });
async function identityBlocked(name: string, options: Parameters<typeof fixture>[1] = {}, commit = sourceCommit): Promise<void> {
  const { directory } = fixture(name, options);
  await assert.rejects(load(directory, commit), /CHANNELS_RENDERER_IDENTITY_BLOCKED/, name);
  assert.equal(imports[name] ?? 0, 0, `${name}: rejected identity cannot execute the artifact`);
  checks += 1;
}

try {
  assert.equal(await load(path.join(root, 'missing-disabled'), sourceCommit, false), undefined,
    'disabled renderer does not require any artifact or marker');
  checks += 1;
  const disabled = fixture('disabled-valid');
  assert.equal(await load(disabled.directory, sourceCommit, false), undefined);
  assert.equal(imports['disabled-valid'] ?? 0, 0, 'disabled feature never imports a valid renderer');
  const enabled = await load(disabled.directory);
  assert.equal(typeof enabled?.render, 'function');
  assert.equal(imports['disabled-valid'], 1, 'the same artifact is imported only after explicit enablement');
  checks += 1;

  for (const [name, patch] of [
    ['wrong-schema', { schemaVersion: 2 }],
    ['wrong-source-commit', { sourceCommit: 'b'.repeat(40) }],
    ['wrong-marker-commit', { commit: 'b'.repeat(40) }],
    ['dirty-worktree', { worktree: 'dirty' }],
    ['wrong-mode', { mode: 'optional' }],
    ['wrong-output', { output: '../other.js' }],
    ['wrong-hash', { artifactSha256: 'b'.repeat(64) }],
    ['short-hash', { artifactSha256: 'a'.repeat(12) }],
    ['missing-hash', { artifactSha256: undefined }],
  ] as const) await identityBlocked(name, { markerPatch: patch });
  await identityBlocked('different-runtime-commit', {}, 'b'.repeat(40));
  await identityBlocked('short-runtime-commit', {
    markerPatch: { sourceCommit: 'a2ca210', commit: 'a2ca210' },
  }, 'a2ca210');
  await identityBlocked('tampered-artifact', { tamperArtifact: true });

  for (const [name, options] of [
    ['missing-marker', { omitMarker: true }],
    ['missing-artifact', { omitArtifact: true }],
    ['invalid-marker-json', { rawMarker: '{"schemaVersion":' }],
    ['null-marker', { rawMarker: 'null' }],
  ] as const) {
    const { directory } = fixture(name, options);
    await assert.rejects(load(directory), `${name}: unavailable evidence must fail closed`);
    assert.equal(imports[name] ?? 0, 0, `${name}: unavailable evidence cannot execute the artifact`);
    checks += 1;
  }

  for (const [name, options] of [
    ['wrong-package-contract', { contract: { ...expectedContract, packageVersion: '0.7.2' } }],
    ['wrong-delivered-contract', { contract: { ...expectedContract, deliveredVersion: '1.5' } }],
    ['missing-contract-fields', { contract: {} }],
    ['missing-renderer-function', { exportRenderer: false }],
  ] as const) {
    const { directory } = fixture(name, options);
    await assert.rejects(load(directory), /CHANNELS_RENDERER_CONTRACT_DRIFT_BLOCKED/, name);
    assert.equal(imports[name], 1, `${name}: identity passed but the imported contract was rejected`);
    checks += 1;
  }

  const valid = fixture('faithful-valid');
  const renderer = await load(valid.directory);
  assert.ok(renderer);
  assert.deepEqual(renderer.marker, valid.marker);
  assert.equal(imports['faithful-valid'], 1);
  const identity = { jobId: 'synthetic-job', requestId: 'synthetic-request', approvalId: 'synthetic-approval' };
  const scope = { tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner', conversationId: 'synthetic-conversation' };
  const data = { action: 'approve', schemaVersion: 1, ...identity, confirmationToken: 'synthetic-token' };
  const card: ChannelsNativeCardInput['card'] = {
    type: 'AdaptiveCard', version: '1.6', body: [{ type: 'TextBlock', text: '합성 승인 fixture' }],
    actions: [{ type: 'Action.Submit', title: '승인', data }],
  };
  const input: ChannelsNativeCardInput = { card, kind: 'approval', identity, scope,
    actionGrants: [{ scope, identity, data }] };
  const before = structuredClone(input);
  const output = renderer.render(input);
  assert.equal(output.status, 'faithful');
  assert.deepEqual(output.card, card, 'the loader exposes the valid fixture renderer without altering the card');
  assert.deepEqual(output.identity, identity);
  assert.deepEqual(output.contract, expectedContract);
  assert.deepEqual(input, before, 'loading and calling the renderer leaves the supplied approval payload untouched');
  checks += 1;
  console.log(`channels-renderer-loader-test: ${checks} fixture assertions passed (loader only; no live SDK rendering)`);
} finally {
  clearTimeout(watchdog);
  rmSync(root, { recursive: true, force: true });
  if (previousImports === undefined) delete globals[importKey];
  else globals[importKey] = previousImports;
}
