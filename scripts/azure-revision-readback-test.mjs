import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  describeAzureRevisionList,
  normalizeAzureRevisionList,
} from './azure-revision-readback.mjs';

const revision = {
  name: 'teamsapp-canary-goictvxm--fixture1234',
  properties: {
    active: true,
    provisioningState: 'Provisioned',
    runningState: 'Running',
    healthState: 'Healthy',
    trafficWeight: 100,
    replicas: 1,
  },
};

assert.deepEqual(normalizeAzureRevisionList([revision]), [revision]);
assert.equal(describeAzureRevisionList([revision]), 'array');
assert.deepEqual(
  normalizeAzureRevisionList({ value: [revision] }),
  [revision],
  'Azure RevisionCollection responses must be normalized from their value array',
);
assert.equal(describeAzureRevisionList({ value: [revision] }), 'RevisionCollection.value');
assert.throws(
  () => normalizeAzureRevisionList({ value: revision }),
  /revision list must contain an array/i,
  'a malformed RevisionCollection must fail closed',
);
assert.equal(describeAzureRevisionList({ value: revision }), 'RevisionCollection.invalid');
assert.throws(
  () => normalizeAzureRevisionList({ items: [revision] }),
  /revision list must be an array or RevisionCollection/i,
  'an unknown response envelope must fail closed',
);
assert.equal(describeAzureRevisionList({ items: [revision] }), 'invalid');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-azure-revision-readback-'));
try {
  const inputPath = path.join(temporaryDirectory, 'revision-list.json');
  fs.writeFileSync(inputPath, JSON.stringify({ value: [revision] }));
  const result = spawnSync(process.execPath, ['scripts/azure-revision-readback.mjs', 'normalize', inputPath], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [revision]);
  const shapeResult = spawnSync(process.execPath, ['scripts/azure-revision-readback.mjs', 'describe', inputPath], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(shapeResult.status, 0, shapeResult.stderr);
  assert.equal(JSON.parse(shapeResult.stdout), 'RevisionCollection.value');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('azure-revision-readback-test: PASS');
