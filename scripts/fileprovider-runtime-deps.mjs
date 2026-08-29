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
const RUNTIME_DEPENDENCY_CACHE_SCHEMA = 'teams-runtime-dependency-cache/v2';
const RUNTIME_DEPENDENCY_CACHE_DIR = 'teams-sdk-mvp-runtime-deps-cache';
const RUNTIME_DEPENDENCY_CACHE_MARKER = '.teams-runtime-dependency-cache.json';
const MAX_PINNED_RUNTIME_INPUT_BYTES = 16 * 1_024 * 1_024;

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
      bytes: bytes.byteLength,
      contentSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  }));
  return runtimeInputCacheKey(inputs);
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
  const cacheRoot = cacheRootFromOptions(options);
  const cacheKey = await readPinnedRuntimeInputs(root);
  const finalRoot = path.join(cacheRoot, cacheKey);
  await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(cacheRoot, 0o700);

  const cached = await verifyCachedRuntimeDependencies(finalRoot, cacheKey);
  if (cached) return cached;

  const stagingRoot = await fs.mkdtemp(path.join(cacheRoot, `.stage-${cacheKey}-`));
  let published = false;
  try {
    const prepared = await prepareRuntimeDependencyStaging({ pinnedSourceRoot: root, stagingRoot });
    if (cacheKeyFromInputAttestations(prepared.inputAttestations) !== cacheKey) {
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
