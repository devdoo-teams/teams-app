import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadCopilotUiArtifact(options: {
  enabled: boolean;
  runtimeDistRoot: string;
  sourceCommit: string;
}) {
  if (!options.enabled) return undefined;
  const root = path.join(options.runtimeDistRoot, 'copilot-ui');
  const marker = JSON.parse(await readFile(path.join(root, '.teams-copilot-ui-build.json'), 'utf8'));
  if (marker.schemaVersion !== 1 || marker.mode !== 'copilot-ui' || marker.worktree !== 'clean'
    || marker.sourceCommit !== options.sourceCommit || !/^[a-f0-9]{40,64}$/.test(marker.sourceCommit)
    || marker.runtimeVersion !== '1.66.2' || marker.agUiVersion !== '0.0.57'
    || !marker.files || typeof marker.files !== 'object') {
    throw new Error('COPILOT_UI_ARTIFACT_IDENTITY_MISMATCH');
  }
  const actual: string[] = [];
  async function walk(dir: string, relative = ''): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (rel === '.teams-copilot-ui-build.json') continue;
      const target = path.join(dir, entry.name);
      if ((await lstat(target)).isSymbolicLink()) throw new Error('COPILOT_UI_ARTIFACT_SYMLINK');
      if (entry.isDirectory()) await walk(target, rel);
      else if (entry.isFile()) actual.push(rel);
      else throw new Error('COPILOT_UI_ARTIFACT_NOT_REGULAR');
    }
  }
  await walk(root);
  if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(marker.files).sort())
    || !marker.files['server.js'] || !marker.files['client/index.html']) {
    throw new Error('COPILOT_UI_ARTIFACT_FILE_SET_MISMATCH');
  }
  for (const rel of actual) {
    if (createHash('sha256').update(await readFile(path.join(root, rel))).digest('hex') !== marker.files[rel]) {
      throw new Error('COPILOT_UI_ARTIFACT_HASH_MISMATCH');
    }
  }
  // Set before SDK module initialization; no telemetry, remote model or MCP path.
  process.env.COPILOTKIT_TELEMETRY_DISABLED = 'true';
  const module = await import(pathToFileURL(path.join(root, 'server.js')).href);
  if (typeof module.createCopilotUiHandler !== 'function') throw new Error('COPILOT_UI_HANDLER_MISSING');
  return { createHandler: module.createCopilotUiHandler as typeof import('./copilot-ui-runtime.js')['createCopilotUiHandler'],
    clientDist: path.join(root, 'client'), marker };
}
