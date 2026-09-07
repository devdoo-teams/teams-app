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

/**
 * Keep only the documented readiness fields from one revision resource.
 * Azure exposes these fields below `properties`; reading them from the
 * resource root would silently turn a useful failure diagnostic into nulls.
 */
export function summarizeAzureRevision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Azure revision must be an object');
  }
  const properties = value.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error('Azure revision properties must be an object');
  }
  const property = (name) => properties[name] ?? null;
  return {
    name: typeof value.name === 'string' ? value.name : null,
    properties: {
      active: property('active'),
      provisioningState: property('provisioningState'),
      runningState: property('runningState'),
      healthState: property('healthState'),
      trafficWeight: property('trafficWeight'),
      replicas: property('replicas'),
    },
  };
}

/**
 * Build a secret-free diagnostic receipt for either a revision list response
 * or a single revision show response. The readiness predicate remains in the
 * pipeline; this helper only makes the observed state legible and stable.
 */
export function createAzureRevisionStateReceipt(value, expectedRevision, responseShape) {
  if (typeof expectedRevision !== 'string' || expectedRevision.length === 0) {
    throw new Error('expected revision must be a non-empty string');
  }
  if (typeof responseShape !== 'string' || responseShape.length === 0) {
    throw new Error('revision response shape must be a non-empty string');
  }
  const revisions = Array.isArray(value)
    || (value && typeof value === 'object' && Object.hasOwn(value, 'value'))
    ? normalizeAzureRevisionList(value)
    : [value];
  return {
    schemaVersion: 1,
    expectedRevision,
    revisionListResponseShape: responseShape,
    candidates: revisions
      .filter((revision) => revision && typeof revision === 'object' && revision.name === expectedRevision)
      .map(summarizeAzureRevision),
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function main() {
  const [command, inputPath] = process.argv.slice(2);
  if (!['normalize', 'describe', 'receipt'].includes(command) || typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new Error('usage: azure-revision-readback.mjs <normalize|describe|receipt> <json-file> [expected-revision] [response-shape]');
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  if (command === 'describe') {
    process.stdout.write(`${describeAzureRevisionList(input)}\n`);
    return;
  }
  if (command === 'receipt') {
    const [, , expectedRevision, responseShape] = process.argv.slice(2);
    printJson(createAzureRevisionStateReceipt(input, expectedRevision, responseShape));
    return;
  }
  printJson(normalizeAzureRevisionList(input));
}

const isMain = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
);
if (isMain) main();
