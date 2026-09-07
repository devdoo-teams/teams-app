import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Normalize the two response shapes used by Container Apps revision APIs.
 * The CLI normally exposes an array, while ARM RevisionCollection responses
 * wrap the same revisions in a `value` array. Unknown envelopes are rejected
 * so a read-back cannot silently become an empty candidate set.
 */
export function normalizeAzureRevisionList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Object.hasOwn(value, 'value')) {
    if (Array.isArray(value.value)) return value.value;
    throw new Error('Azure revision list must contain an array in RevisionCollection.value');
  }
  throw new Error('Azure revision list must be an array or RevisionCollection.value array');
}

export function describeAzureRevisionList(value) {
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object' && Object.hasOwn(value, 'value')) {
    return Array.isArray(value.value) ? 'RevisionCollection.value' : 'RevisionCollection.invalid';
  }
  return 'invalid';
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function main() {
  const [command, inputPath] = process.argv.slice(2);
  if (!['normalize', 'describe'].includes(command) || typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new Error('usage: azure-revision-readback.mjs <normalize|describe> <json-file>');
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  print(command === 'describe' ? describeAzureRevisionList(input) : normalizeAzureRevisionList(input));
}

const isMain = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
);
if (isMain) main();
