import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createChildTestEnvironment } from './child-test-environment.mjs';

// Execute the real npm-start entry point. The inert fixture entry proves whether
// preflight admitted initialization; no Teams credentials or public server.
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teams-replay-startup-')));
const dist = path.join(root, 'dist');
const replay = path.join(root, 'replay.json');
const entry = 'console.log("ENTRY_REACHED");\n';
await fs.mkdir(path.join(dist, 'server'), { recursive: true });
await fs.writeFile(path.join(dist, 'server/index.js'), entry);
async function run(mode, enabled, content) {
  await fs.rm(replay, { force: true });
  if (content !== undefined) await fs.writeFile(replay, content);
  await fs.writeFile(path.join(dist, 'server/.teams-server-build-commit'), JSON.stringify({ schemaVersion: 3, commit: 'a'.repeat(40), mode, worktree: 'clean', bundleSha256: crypto.createHash('sha256').update(entry).digest('hex') }));
  const env = createChildTestEnvironment(process.env, { overrides: { TEAMS_RUNTIME_DIST_DIR: dist, PROVIDER_MUTATION_REPLAY_STORE_PATH: replay, TEAMS_MCP_PROVIDER_TOOLS: enabled ? 'true' : 'false', TEAMS_MCP_AUTHENTICATED_ENABLED: enabled ? 'true' : 'false' } });
  return spawnSync(process.execPath, ['scripts/start-server.mjs'], { env, encoding: 'utf8', timeout: 5000 });
}
try {
  for (const content of [undefined, '{broken']) {
    const core = await run('core', true, content);
    assert.equal(core.status, 0, core.stderr);
    assert.match(core.stdout, /ENTRY_REACHED/);
    const optionalDisabled = await run('optional', false, content);
    assert.equal(optionalDisabled.status, 0, optionalDisabled.stderr);
  }
  for (const content of [undefined, '{broken', '{"schemaVersion":1,"records":null}']) {
    const blocked = await run('optional', true, content);
    assert.notEqual(blocked.status, 0, 'active replay missing/corrupt must block actual startup');
    assert.doesNotMatch(blocked.stdout, /ENTRY_REACHED/);
    assert.match(blocked.stderr, /replay/i);
  }
  const ready = await run('optional', true, '{"schemaVersion":1,"records":{}}');
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /ENTRY_REACHED/);
  console.log('PASS: real startup entry skips inactive replay and blocks missing/corrupt active replay');
} finally { await fs.rm(root, { recursive: true, force: true }); }
