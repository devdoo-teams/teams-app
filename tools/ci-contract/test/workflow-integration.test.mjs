import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { workflowJobPlan } from '../lib/workflow-plan.mjs';

test('CI integration is reversible without changing any original command, job, permission or failure policy', async () => {
  const { instrumentWorkflow, stripObservationIntegration } = await import('../lib/workflow-integration.mjs');
  const workflow = readFileSync(new URL('../../../.github/workflows/core-ci.yml', import.meta.url), 'utf8');
  const original = stripObservationIntegration(workflow); const integrated = instrumentWorkflow(original);
  assert.equal(stripObservationIntegration(integrated), original);
  assert.equal(integrated, workflow);
  assert.equal(createHash('sha256').update(original).digest('hex'), '1954404f5c8f9f06460991f76b1aad4c68075ddcc0374f18817c55cce679b031');
  assert.equal((integrated.match(/id: ci_receipt_finalize/g) ?? []).length, 8);
  assert.equal((integrated.match(/id: ci_receipt_upload/g) ?? []).length, 8);
  assert.equal((integrated.match(/id: ci_original_/g) ?? []).length, 47);
  assert.equal((integrated.match(/npm run /g) ?? []).length, (original.match(/npm run /g) ?? []).length);
  assert.equal((integrated.match(/if: always\(\)/g) ?? []).length, 16);
  for (const [key, count] of Object.entries({ core: 8, a2a: 7, continuity: 6, azure: 4, optional: 5, copilot_ui: 5, container: 6, artifact: 6 })) assert.equal(workflowJobPlan(integrated, key).length, count);
  assert.throws(() => instrumentWorkflow(integrated));
});
