import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STABLE_RUNTIME_ROOT = path.join(os.tmpdir(), 'teams-sdk-mvp-runtime', 'dist');

export function resolveRuntimeDistRoot(root = process.cwd(), env = process.env, stat = fs.statSync) {
  const configured = env.TEAMS_RUNTIME_DIST_DIR?.trim();
  if (configured) return path.resolve(configured);

  const workspaceDist = path.join(root, 'dist');
  try {
    const metadata = stat(workspaceDist);
    if (metadata.isDirectory() && metadata.blocks === 0) return STABLE_RUNTIME_ROOT;
  } catch {
    // A normal local workspace may not have a dist directory before the first build.
  }
  return workspaceDist;
}

export { STABLE_RUNTIME_ROOT };
