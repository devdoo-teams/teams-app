import os from 'node:os';
import path from 'node:path';

const STABLE_RUNTIME_ROOT = path.join(os.tmpdir(), 'teams-sdk-mvp-runtime', 'dist');

export function resolveRuntimeDistRoot(root = process.cwd(), env = process.env) {
  const configured = env.TEAMS_RUNTIME_DIST_DIR?.trim();
  if (configured) return path.resolve(configured);

  // Directory allocation metadata is not a reliable FileProvider signal.
  // A normal APFS directory can report zero allocated blocks, and switching
  // roots after the client build would split client and server artifacts.
  // FileProvider recovery must select one explicit runtime root for the whole
  // build through TEAMS_RUNTIME_DIST_DIR.
  return path.join(root, 'dist');
}

export { STABLE_RUNTIME_ROOT };
