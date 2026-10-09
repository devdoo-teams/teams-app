import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCopilotUiArtifact } from '../src/server/copilot-ui-loader.js';

const sourceCommit = 'a'.repeat(40);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'teams-copilot-ui-artifact-test-'));
try {
  assert.equal(await loadCopilotUiArtifact({ enabled: false, runtimeDistRoot: '/does-not-exist', sourceCommit }), undefined,
    'default Core must not read or initialize an optional artifact');
  async function fixture(name: string) {
    const runtimeDistRoot = path.join(temporaryRoot, name);
    const root = path.join(runtimeDistRoot, 'copilot-ui');
    await mkdir(path.join(root, 'client'), { recursive: true });
    const contents: Record<string, string> = {
      'server.js': 'export function createCopilotUiHandler() { return "synthetic-loader-port"; }\n',
      'client/index.html': '<!doctype html><title>Synthetic artifact identity fixture</title>',
      'package.json': '{"type":"module"}',
    };
    for (const [relative, content] of Object.entries(contents)) await writeFile(path.join(root, relative), content);
    const marker = { schemaVersion: 1, mode: 'copilot-ui', worktree: 'clean', sourceCommit,
      runtimeVersion: '1.66.2', agUiVersion: '0.0.57', files: Object.fromEntries(Object.entries(contents)
        .map(([relative, content]) => [relative, createHash('sha256').update(content).digest('hex')])) };
    await writeFile(path.join(root, '.teams-copilot-ui-build.json'), JSON.stringify(marker));
    return { runtimeDistRoot, root, marker };
  }
  const good = await fixture('good');
  const loaded = await loadCopilotUiArtifact({ enabled: true, runtimeDistRoot: good.runtimeDistRoot, sourceCommit });
  assert.equal(typeof loaded?.createHandler, 'function');
  assert.equal(loaded?.clientDist, path.join(good.root, 'client'));
  assert.equal(process.env.COPILOTKIT_TELEMETRY_DISABLED, 'true');
  await assert.rejects(loadCopilotUiArtifact({ enabled: true, runtimeDistRoot: good.runtimeDistRoot, sourceCommit: 'b'.repeat(40) }),
    /COPILOT_UI_ARTIFACT_IDENTITY_MISMATCH/);
  const changed = await fixture('changed');
  await writeFile(path.join(changed.root, 'server.js'), 'throw new Error("tampered-module-must-not-initialize");');
  await assert.rejects(loadCopilotUiArtifact({ enabled: true, runtimeDistRoot: changed.runtimeDistRoot, sourceCommit }),
    /COPILOT_UI_ARTIFACT_HASH_MISMATCH/);
  const extra = await fixture('extra');
  await writeFile(path.join(extra.root, 'unrecorded.js'), 'unrecorded');
  await assert.rejects(loadCopilotUiArtifact({ enabled: true, runtimeDistRoot: extra.runtimeDistRoot, sourceCommit }),
    /COPILOT_UI_ARTIFACT_FILE_SET_MISMATCH/);
  const linked = await fixture('linked');
  await rm(path.join(linked.root, 'server.js'));
  await symlink(path.join(good.root, 'server.js'), path.join(linked.root, 'server.js'));
  await assert.rejects(loadCopilotUiArtifact({ enabled: true, runtimeDistRoot: linked.runtimeDistRoot, sourceCommit }),
    /COPILOT_UI_ARTIFACT_SYMLINK/);
  const version = await fixture('version');
  await writeFile(path.join(version.root, '.teams-copilot-ui-build.json'), JSON.stringify({ ...version.marker, runtimeVersion: '1.66.3' }));
  await assert.rejects(loadCopilotUiArtifact({ enabled: true, runtimeDistRoot: version.runtimeDistRoot, sourceCommit }),
    /COPILOT_UI_ARTIFACT_IDENTITY_MISMATCH/);
  console.log('PASS: disabled Core does not load SDK artifacts; explicit artifacts require exact commit/version/file set/hash and reject symlinks before module initialization (synthetic identity fixtures).');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
