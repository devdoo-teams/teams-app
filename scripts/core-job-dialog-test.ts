import assert from 'node:assert/strict';
import { coreJobDialogResponse } from '../src/server/core-job-dialog.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
const job: CoreOrchestrationJob = { id: 'synthetic-dialog-job', prompt: '합성 입력', mode: 'read-only', status: 'completed', createdAt: '2026-10-11T00:00:00.000Z', progress: [] };
const input = { dialog_id: 'core-job-detail', jobId: job.id };
const opened = coreJobDialogResponse(input, job, 'https://synthetic.example.com', true);
assert.equal(opened.task.type, 'continue');
if (opened.task.type !== 'continue') throw new Error('Dialog unavailable');
const url = new URL(opened.task.value.url);
assert.equal(url.pathname, '/tabs/copilot-ui/');
assert.equal(url.searchParams.get('jobId'), job.id);
assert.equal(url.searchParams.get('surface'), 'dialog');
assert.equal(new URL(opened.task.value.fallbackUrl).searchParams.get('jobId'), job.id);
for (const [value, authorizedJob, origin, available] of [
  [input, undefined, 'https://synthetic.example.com', true],
  [{ ...input, jobId: 'foreign-job' }, job, 'https://synthetic.example.com', true],
  [{ ...input, tenantId: 'client-injection' }, job, 'https://synthetic.example.com', true],
  [{ ...input, url: 'https://foreign.example.com' }, job, 'https://synthetic.example.com', true],
  [input, job, 'http://synthetic.example.com', true],
  [input, job, 'https://synthetic.example.com/path', true],
  [input, job, 'https://synthetic.example.com', false],
] as const) assert.equal(coreJobDialogResponse(value, authorizedJob, origin, available).task.type, 'message');
console.log('PASS: authenticated same-job Dialog and fixed HTTPS/fallback destination');
