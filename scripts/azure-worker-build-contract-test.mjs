import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-worker-build-'));

try {
  const build = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-worker.mjs'), '--outdir', output], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, `clean worker build must succeed:\n${build.stderr || build.stdout}`);

  const indexPath = path.join(output, 'index.js');
  const compositionPath = path.join(output, 'composition.js');
  assert.ok(fs.statSync(indexPath).isFile(), 'worker entrypoint must be packaged');
  assert.ok(fs.statSync(compositionPath).isFile(), 'worker composition must be packaged');

  const start = spawnSync(process.execPath, [indexPath, '--run'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      TEAMS_WORKER_COMPOSITION_MODULE: compositionPath,
      TEAMS_STORAGE_BACKEND: 'cosmos',
    },
    timeout: 10_000,
  });
  assert.notEqual(start.status, 0, 'incomplete production configuration must fail closed');
  const diagnostics = `${start.stdout}\n${start.stderr}`;
  assert.doesNotMatch(diagnostics, /ERR_MODULE_NOT_FOUND|Cannot find module/i, 'clean-start failure must never be caused by an omitted runtime module');
  assert.match(diagnostics, /AZURE_COSMOS_ENDPOINT|production worker configuration/i, 'clean-start must reach explicit configuration validation');

  const compositionImport = spawnSync(process.execPath, ['--input-type=module', '--eval', [
    `const loaded = await import(${JSON.stringify(pathToFileURL(compositionPath).href)});`,
    `if (!loaded.state || !loaded.executor) throw new Error('composition exports missing');`,
  ].join('\n')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      TEAMS_STORAGE_BACKEND: 'cosmos',
      AZURE_COSMOS_ENDPOINT: 'https://teamsapp.documents.azure.com/',
      AZURE_COSMOS_DATABASE: 'teamsapp',
      AZURE_COSMOS_CONTAINER: 'runtime-records',
      TEAMS_WORKER_WORKSPACE: root,
      TEAMS_WORKER_EXECUTION_MODE: 'workspace-write',
      CODEX_BIN: '/usr/bin/false',
    },
  });
  assert.equal(compositionImport.status, 0, `packaged production composition must load without source files or node_modules:\n${compositionImport.stderr}`);

  console.log('PASS: clean worker build packages every runtime entry module and starts through fail-closed configuration validation.');
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
