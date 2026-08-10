import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const RUNTIME_DEPENDENCY_ROOT = path.join(os.tmpdir(), 'teams-sdk-mvp-runtime-deps');
const RUNTIME_PACKAGES = [
  'express',
  'zod',
  '@microsoft/teams.apps',
  'react',
  'react-dom',
  '@microsoft/teams-js',
];

export async function ensureFileProviderRuntimeDependencies(root) {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const specs = RUNTIME_PACKAGES.map((name) => `${name}@${packageJson.dependencies?.[name] ?? ''}`);
  let installed = false;

  try {
    const packageStats = await Promise.all(
      RUNTIME_PACKAGES.map((name) => fs.stat(path.join(RUNTIME_DEPENDENCY_ROOT, 'node_modules', name, 'package.json'))),
    );
    installed = packageStats.every((stat) => stat.isFile() && (!Number.isInteger(stat.blocks) || stat.blocks > 0));
  } catch {
    installed = false;
  }

  if (!installed) {
    await fs.mkdir(RUNTIME_DEPENDENCY_ROOT, { recursive: true });
    execFileSync('npm', [
      'install',
      '--prefix', RUNTIME_DEPENDENCY_ROOT,
      '--no-save',
      '--package-lock=false',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      ...specs,
    ], { cwd: root, stdio: 'inherit' });
  }

  return path.join(RUNTIME_DEPENDENCY_ROOT, 'node_modules');
}
