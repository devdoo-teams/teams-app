import fs from 'node:fs';

const SHA256 = /^[0-9a-f]{64}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/u;
const TARGET = 'x86_64-unknown-linux-musl';

function fail(message) {
  throw new Error(message);
}

function readJsonObject(filePath, label) {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size === 0 || stat.size > 64 * 1024) {
    fail(`${label} must be a non-empty regular JSON file smaller than 64 KiB`);
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a JSON object`);
  return value;
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) fail(message);
}

function main() {
  const [workerManifestPath, packageManifestPath, expectedCommit, expectedCodexSha256, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || !workerManifestPath || !packageManifestPath || !expectedCommit || !expectedCodexSha256) {
    fail('usage: validate-worker-runtime-manifest.mjs <worker-manifest> <codex-package-manifest> <commit> <codex-sha256>');
  }

  const worker = readJsonObject(workerManifestPath, 'worker manifest');
  const codexPackage = readJsonObject(packageManifestPath, 'Codex package manifest');
  requireEqual(worker.schemaVersion, 2, 'worker manifest schema is invalid');
  requireEqual(worker.commit, expectedCommit, 'worker manifest commit mismatch');
  requireEqual(worker.codexBinSha256, expectedCodexSha256, 'worker manifest Codex digest mismatch');
  if (!SHA256.test(worker.codexPackageSha256)) fail('worker manifest Codex package digest is invalid');
  if (!VERSION.test(worker.codexPackageVersion)) fail('worker manifest Codex package version is invalid');

  for (const [name, expected] of Object.entries({
    layoutVersion: 1,
    version: worker.codexPackageVersion,
    target: TARGET,
    variant: 'codex',
    entrypoint: 'bin/codex',
    resourcesDir: 'codex-resources',
    pathDir: 'codex-path',
  })) {
    requireEqual(codexPackage[name], expected, `Codex package manifest ${name} mismatch`);
  }

  process.stdout.write(`${worker.codexPackageVersion}:${worker.codexPackageSha256}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
