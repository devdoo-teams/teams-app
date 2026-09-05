import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedKeys = new Set([
  'schemaVersion',
  'source',
  'commit',
  'version',
  'image',
  'imageDigest',
  'teamsPackageSha256',
  'clientBundleSha256',
  'serverBundleSha256',
]);

const sha256Pattern = /^[0-9a-f]{64}$/;
const imageDigestPattern = /^sha256:[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const imagePattern = /^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/;

function fail(message) {
  throw new Error(`Invalid Azure release receipt: ${message}`);
}

export function validateAzureReleaseInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('receipt must be a JSON object');

  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) fail(`unexpected field(s): ${unexpected.join(', ')}`);

  const missing = [...allowedKeys].filter((key) => !(key in value));
  if (missing.length > 0) fail(`missing required field(s): ${missing.join(', ')}`);

  if (value.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (value.source !== 'github-actions') fail('source must be github-actions');
  if (typeof value.commit !== 'string' || !commitPattern.test(value.commit)) fail('commit must be a lowercase 40-character Git SHA');
  if (typeof value.version !== 'string' || !versionPattern.test(value.version)) fail('version must be a semantic application version');
  if (typeof value.image !== 'string' || !imagePattern.test(value.image) || value.image.includes('@') || value.image.includes(':')) {
    fail('image must be an untagged OCI repository name');
  }
  if (typeof value.imageDigest !== 'string' || !imageDigestPattern.test(value.imageDigest)) {
    fail('imageDigest must be an immutable sha256 digest');
  }
  for (const field of ['teamsPackageSha256', 'clientBundleSha256', 'serverBundleSha256']) {
    if (typeof value[field] !== 'string' || !sha256Pattern.test(value[field])) {
      fail(`${field} must be a lowercase SHA-256 digest`);
    }
  }

  return Object.freeze({ ...value });
}

export function readAzureReleaseInput(receiptPath) {
  const resolvedPath = path.resolve(receiptPath);
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile() || stat.size === 0 || stat.size > 64 * 1024) fail('receipt must be a non-empty JSON file no larger than 64 KiB');
  return validateAzureReleaseInput(JSON.parse(fs.readFileSync(resolvedPath, 'utf8')));
}

function parseArguments(argv) {
  const args = [...argv];
  const json = args[0] === '--json';
  if (json) args.shift();
  if (args.length !== 1) throw new Error('Usage: node scripts/azure-release-input.mjs [--json] <github-release-receipt.json>');
  return { json, receiptPath: path.resolve(args[0]) };
}

function main() {
  const { json, receiptPath } = parseArguments(process.argv.slice(2));
  const receipt = readAzureReleaseInput(receiptPath);
  if (json) {
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } else {
    console.log(`Azure release receipt valid: commit ${receipt.commit}, version ${receipt.version}, image ${receipt.image}@${receipt.imageDigest}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
