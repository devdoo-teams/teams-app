import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import {
  captureRuntimeClosure,
  prepareRuntimeDependencyStaging,
  verifyRuntimeClosure,
} from './runtime-closure.mjs';

export {
  captureRuntimeClosure,
  createRuntimeDependencyStagingPlan,
  prepareRuntimeDependencyStaging,
  verifyRuntimeClosure,
} from './runtime-closure.mjs';

const RUNTIME_CLOSURE_LIMITS = Object.freeze({
  maxEntries: 100_000,
  maxFileBytes: 64 * 1_024 * 1_024,
  maxTotalBytes: 1_024 * 1_024 * 1_024,
  maxPathBytes: 4_096,
});
const APPROVED_NATIVE_ADDONS = Object.freeze([]);
const RUNTIME_DEPENDENCY_CACHE_SCHEMA = 'teams-runtime-dependency-cache/v3';
const RUNTIME_DEPENDENCY_CACHE_DIR = 'teams-sdk-mvp-runtime-deps-cache';
const RUNTIME_DEPENDENCY_CACHE_MARKER = '.teams-runtime-dependency-cache.json';
const MAX_PINNED_RUNTIME_INPUT_BYTES = 16 * 1_024 * 1_024;
const ABANDONED_STAGE_MAX_AGE_MS = 60 * 60 * 1_000;
const RUNTIME_DEPENDENCY_STAGE_NAME = /^\.stage-[a-f0-9]{64}-[A-Za-z0-9]{6}$/;

function requireAbsolutePath(value, name) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    throw new TypeError(`${name} must be an explicitly supplied absolute path`);
  }
  return path.resolve(value);
}

function samePinnedInputIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function runtimeInputCacheKey(inputs) {
  const hash = crypto.createHash('sha256');
  const orderedInputs = [...inputs].sort((left, right) => (
    Buffer.compare(Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8'))
  ));
  for (const input of orderedInputs) {
    hash.update(input.name);
    hash.update('\0');
    hash.update(String(input.bytes));
    hash.update('\0');
    hash.update(input.contentSha256);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function dependencyCacheInput(name, bytes) {
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (name === 'package.json') {
    delete parsed.version;
  } else if (name === 'package-lock.json') {
    delete parsed.version;
    if (parsed.packages?.[''] && typeof parsed.packages[''] === 'object') {
      delete parsed.packages[''].version;
    }
  }
  const normalized = Buffer.from(JSON.stringify(parsed), 'utf8');
  return {
    name,
    bytes: normalized.byteLength,
    contentSha256: crypto.createHash('sha256').update(normalized).digest('hex'),
  };
}

async function readPinnedRuntimeInput(sourcePath) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw new Error('O_NOFOLLOW is required to identify pinned runtime inputs safely');
  }
  let handle;
  try {
    handle = await fs.open(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    const pathBefore = await fs.lstat(sourcePath, { bigint: true });
    if (
      !before.isFile()
      || !pathBefore.isFile()
      || !samePinnedInputIdentity(before, pathBefore)
      || before.size > BigInt(MAX_PINNED_RUNTIME_INPUT_BYTES)
    ) {
      throw new Error(`pinned runtime input must be one stable regular file: ${sourcePath}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(sourcePath, { bigint: true });
    if (
      !samePinnedInputIdentity(before, after)
      || !samePinnedInputIdentity(before, pathAfter)
      || BigInt(bytes.byteLength) !== before.size
    ) {
      throw new Error(`pinned runtime input changed while being read: ${sourcePath}`);
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readPinnedRuntimeInputs(root) {
  const sourceRoot = requireAbsolutePath(root, 'root');
  const inputs = await Promise.all(['package.json', 'package-lock.json'].map(async (name) => {
    const bytes = await readPinnedRuntimeInput(path.join(sourceRoot, name));
    return {
      name,
      contents: bytes,
      bytes: bytes.byteLength,
      contentSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  }));
  return {
    cacheKey: runtimeInputCacheKey(inputs.map(({ name, contents }) => dependencyCacheInput(name, contents))),
    rawInputKey: runtimeInputCacheKey(inputs),
  };
}

function cacheKeyFromInputAttestations(attestations) {
  return runtimeInputCacheKey(attestations.map((input) => ({
    name: input.path,
    bytes: input.bytes,
    contentSha256: input.contentSha256,
  })));
}

function cacheRootFromOptions(options = {}) {
  const configured = options.cacheRoot
    ?? process.env.TEAMS_RUNTIME_DEPS_CACHE_DIR
    ?? path.join(os.tmpdir(), RUNTIME_DEPENDENCY_CACHE_DIR);
  return requireAbsolutePath(configured, 'cacheRoot');
}

function isPathInsideOrEqual(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolvePotentialRealPath(candidatePath) {
  const unresolvedSegments = [];
  let existingAncestor = candidatePath;
  while (true) {
    try {
      return path.join(await fs.realpath(existingAncestor), ...unresolvedSegments);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      unresolvedSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

async function assertCacheRootOutsideSource(sourceRoot, cacheRoot) {
  const [sourceRealRoot, potentialCacheRealRoot] = await Promise.all([
    fs.realpath(sourceRoot),
    resolvePotentialRealPath(cacheRoot),
  ]);
  if (
    isPathInsideOrEqual(sourceRoot, cacheRoot)
    || isPathInsideOrEqual(sourceRealRoot, potentialCacheRealRoot)
  ) {
    throw new Error(`cacheRoot must be outside pinnedSourceRoot: ${cacheRoot}`);
  }
}

async function reclaimAbandonedStages(cacheRoot, nowMs = Date.now()) {
  const entries = await fs.readdir(cacheRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !RUNTIME_DEPENDENCY_STAGE_NAME.test(entry.name)) continue;
    const stageRoot = path.join(cacheRoot, entry.name);
    let metadata;
    try {
      metadata = await fs.lstat(stageRoot);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue;
    if (nowMs - metadata.mtimeMs < ABANDONED_STAGE_MAX_AGE_MS) continue;
    try {
      await fs.rm(stageRoot, { recursive: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function verifyCachedRuntimeDependencies(cacheRoot, cacheKey) {
  const markerPath = path.join(cacheRoot, RUNTIME_DEPENDENCY_CACHE_MARKER);
  let marker;
  try {
    marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (
    marker?.schema !== RUNTIME_DEPENDENCY_CACHE_SCHEMA
    || marker?.cacheKey !== cacheKey
    || marker?.nodeModulesRoot !== 'node_modules'
    || typeof marker?.runtimeClosureSha256 !== 'string'
  ) {
    throw new Error(`runtime dependency cache marker is invalid: ${markerPath}`);
  }
  const nodeModulesRoot = path.join(cacheRoot, 'node_modules');
  const attestation = await captureRuntimeClosure({
    root: nodeModulesRoot,
    limits: RUNTIME_CLOSURE_LIMITS,
    approvedNativeAddons: APPROVED_NATIVE_ADDONS,
  });
  if (attestation.sha256 !== marker.runtimeClosureSha256) {
    throw new Error(`runtime dependency cache contents do not match its marker: ${cacheRoot}`);
  }
  return nodeModulesRoot;
}

export async function ensureFileProviderRuntimeDependencies(root, options = {}) {
  const sourceRoot = requireAbsolutePath(root, 'root');
  const cacheRoot = cacheRootFromOptions(options);
  await assertCacheRootOutsideSource(sourceRoot, cacheRoot);
  const { cacheKey, rawInputKey } = await readPinnedRuntimeInputs(sourceRoot);
  const finalRoot = path.join(cacheRoot, cacheKey);
  await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(cacheRoot, 0o700);
  await reclaimAbandonedStages(cacheRoot);

  const cached = await verifyCachedRuntimeDependencies(finalRoot, cacheKey);
  if (cached) return cached;

  const stagingRoot = await fs.mkdtemp(path.join(cacheRoot, `.stage-${cacheKey}-`));
  let published = false;
  try {
    const prepared = await prepareRuntimeDependencyStaging({ pinnedSourceRoot: sourceRoot, stagingRoot });
    if (cacheKeyFromInputAttestations(prepared.inputAttestations) !== rawInputKey) {
      const error = new Error('pinned runtime inputs changed while dependency staging was prepared');
      error.code = 'RUNTIME_DEPENDENCY_INPUT_CHANGED';
      throw error;
    }
    const attestation = await captureRuntimeClosure({
      root: prepared.nodeModulesRoot,
      limits: RUNTIME_CLOSURE_LIMITS,
      approvedNativeAddons: APPROVED_NATIVE_ADDONS,
    });
    await verifyRuntimeClosure({
      root: prepared.nodeModulesRoot,
      expected: attestation,
      limits: RUNTIME_CLOSURE_LIMITS,
      approvedNativeAddons: APPROVED_NATIVE_ADDONS,
    });
    await fs.writeFile(
      path.join(stagingRoot, RUNTIME_DEPENDENCY_CACHE_MARKER),
      `${JSON.stringify({
        schema: RUNTIME_DEPENDENCY_CACHE_SCHEMA,
        cacheKey,
        nodeModulesRoot: 'node_modules',
        runtimeClosureSha256: attestation.sha256,
      })}\n`,
      { mode: 0o600 },
    );
    try {
      await fs.rename(stagingRoot, finalRoot);
      published = true;
      return path.join(finalRoot, 'node_modules');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const publishedByPeer = await verifyCachedRuntimeDependencies(finalRoot, cacheKey);
      if (!publishedByPeer) throw error;
      return publishedByPeer;
    }
  } finally {
    if (!published) await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}
