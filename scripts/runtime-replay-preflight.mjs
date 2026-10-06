import fs from 'node:fs/promises';
import path from 'node:path';

export async function verifyOptionalReplayAtStartup(runtimeDistRoot, env = process.env) {
  const marker = JSON.parse(await fs.readFile(path.join(runtimeDistRoot, 'server/.teams-server-build-commit'), 'utf8'));
  if (marker.schemaVersion !== 3 || !['core', 'optional'].includes(marker.mode)) throw new Error('runtime build mode is unverified');
  const publicHints = ['PUBLIC_BASE_URL', 'TAB_DOMAIN', 'BOT_DOMAIN', 'DEV_TUNNEL_ID'].some(name => env[name]?.trim());
  const safeLocal = env.TEAMS_SKIP_AUTH === 'true' && env.TEAMS_LOCAL_DEV === 'true' && env.NODE_ENV !== 'production' && !publicHints;
  const authenticatedMcpRequested = env.TEAMS_MCP_AUTHENTICATED_ENABLED?.trim().toLowerCase() === 'true';
  const active = marker.mode === 'optional' && env.TEAMS_MCP_PROVIDER_TOOLS === 'true' && (safeLocal || authenticatedMcpRequested);
  if (!active) return { replay: 'not-opened', mode: marker.mode };
  const file = env.PROVIDER_MUTATION_REPLAY_STORE_PATH?.trim();
  if (!file) throw new Error('active provider replay requires an explicit existing store path');
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('replay store must be a regular file');
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state?.schemaVersion !== 1 || !state.records || typeof state.records !== 'object' || Array.isArray(state.records)) throw new Error('replay store schema is invalid');
    // Full record validation remains in ProviderMutationReplayStore.initialize.
    return { replay: 'existing-schema-verified', mode: marker.mode };
  } catch (error) {
    throw new Error(`active provider replay preflight blocked: ${error.message}`, { cause: error });
  }
}
