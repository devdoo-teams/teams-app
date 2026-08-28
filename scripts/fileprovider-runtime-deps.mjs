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

export async function ensureFileProviderRuntimeDependencies(root) {
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-sdk-mvp-runtime-deps-'));
  const prepared = await prepareRuntimeDependencyStaging({ pinnedSourceRoot: root, stagingRoot });
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
  return prepared.nodeModulesRoot;
}
