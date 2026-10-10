import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createExecutionPresentation } from '../src/shared/execution-presentation.js';
import { ExecutionPresentationDetails } from '../src/client/ExecutionPresentationCard.js';
import { createExecutionPresentationActivity } from '../src/server/execution-presentation-activity.js';
const job = { id: 'synthetic-receipt-once', provider: 'codex' as const, mode: 'read-only' as const,
  status: 'completed' as const, prompt: 'Synthetic request', result: 'Synthetic response', progress: [],
  model: 'UNIQUE_SYNTHETIC_SELECTED_MODEL', createdAt: '2026-10-10T00:00:00Z' };
const presentation = createExecutionPresentation(job);
const html = renderToStaticMarkup(<ExecutionPresentationDetails presentation={presentation} details={['diagnostics']} />);
assert.equal(html.split(job.model).length - 1, 1, 'React selected diagnostics shows each receipt value once');
for (const mode of ['text', 'summary'] as const) {
  const activity = createExecutionPresentationActivity(job, mode, { richEnabled: false, details: ['diagnostics'] });
  const nested = (activity as any).attachments[0].content.actions[0].card;
  const facts = nested.body.flatMap((item: any) => item.facts ?? []);
  for (const receipt of presentation.receiptFacts) assert.equal(facts.filter((fact: any) => fact.title === receipt.label && fact.value === receipt.value).length, 1, `${mode}: ${receipt.label} appears once`);
}
console.log('PASS: React and native selected diagnostics render each receipt fact once');
