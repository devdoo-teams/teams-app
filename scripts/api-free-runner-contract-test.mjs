import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner = fs.readFileSync(new URL('./api-free-test-runner.mjs', import.meta.url), 'utf8');

assert.match(
  runner,
  /'typecheck:core'/,
  'the default API-free suite must use the bounded core typecheck',
);
assert.doesNotMatch(
  runner,
  /\n\s*'typecheck',/,
  'the default API-free suite must not invoke the unbounded full typecheck',
);

console.log('PASS: API-free runner avoids the unbounded full typecheck');
