import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createExecutionPresentationActivity } from '../src/server/execution-presentation-activity.js';

// Exercise the exact production sender without initializing the public server.
const sourcePath = path.resolve(import.meta.dirname, '../src/server/index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
const names = new Set(['asRecord', 'nonEmptyString', 'adaptiveCardDeliveryHttpResponseStatus',
  'adaptiveCardDeliveryErrorClassification', 'deliverAdaptiveCardWithFallback', 'deliverGenUiActivity',
  'connectorAcceptedReceipt', 'createBotSender', 'sendCoreOrchestrationActivity',
  'AMBIGUOUS_ADAPTIVE_CARD_DELIVERY_CODES']);
const fragments = ast.statements.filter(statement => {
  const name = ts.isFunctionDeclaration(statement) ? statement.name?.text : ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0]?.name.getText(ast) : undefined;
  return name !== undefined && names.has(name);
}).map(statement => statement.getText(ast));
assert.equal(fragments.length, names.size);
const fallbackModule = await import('../src/server/adaptive-card-text-fallback.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return undefined;
  throw error;
});
const compiled = ts.transpileModule(fragments.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const context = vm.createContext({ genUiMode: 'adaptive',
  adaptiveCardTextFallback: fallbackModule?.adaptiveCardTextFallback,
  GenUiEnvelopeV1Schema: { parse() { throw new Error('unexpected envelope'); } },
});
vm.runInContext(compiled, context, { timeout: 2_000 });
const job = { id: 'synthetic-fallback-job', provider: 'codex' as const, status: 'completed' as const,
  mode: 'read-only' as const, prompt: 'Synthetic read only.', result: 'SYNTHETIC_RESULT_42', progress: [], tools: [] };
const options = { openTabUrl: 'https://teams.microsoft.com/l/entity/00000000-0000-4000-8000-000000000001/home?webUrl=https%3A%2F%2Fsynthetic.invalid%2Ftabs%2Fhome%2F', richEnabled: true };
for (const mode of ['text', 'summary', 'rich'] as const) {
  const activity = createExecutionPresentationActivity(job, mode, options);
  const normal: unknown[] = [];
  const accepted = context.createBotSender(async (value: unknown) => { normal.push(value); return { id: 'accepted' }; });
  await context.sendCoreOrchestrationActivity(accepted, activity);
  assert.equal(normal.length, 1);
  assert.deepEqual(normal[0], activity, 'successful delivery preserves the original activity');
  if (mode !== 'text') assert.equal('text' in (normal[0] as object), false, 'successful card must remain attachment-only');

  const rejected: any[] = [];
  const sender = context.createBotSender(async (value: unknown) => {
    rejected.push(value); if (rejected.length === 1) throw { response: { status: 400 } }; return { id: 'fallback' };
  });
  await context.sendCoreOrchestrationActivity(sender, activity);
  assert.equal(rejected.length, 2, 'confirmed rejection gets one fallback');
  assert.ok(typeof rejected[1].text === 'string' && rejected[1].text.trim(), 'confirmed rejection must produce a nonempty visible fallback');
  assert.match(rejected[1].text, /synthetic-fallback-job/, 'same job identity survives fallback');
  if (mode !== 'summary') assert.match(rejected[1].text, /SYNTHETIC_RESULT_42/);
  assert.equal(rejected[1].attachments, undefined);
  // Proactive paths call this same sender directly with an empty text argument.
  const proactive: any[] = [];
  await context.createBotSender(async (value: unknown) => {
    proactive.push(value); if (proactive.length === 1) throw { response: { status: 400 } }; return {};
  })('', undefined, activity);
  assert.equal(proactive[1].text, rejected[1].text);

  for (const error of [{ code: 'ECONNRESET' }, { name: 'TimeoutError' }, { status: 400 },
    { code: 'ECONNRESET', response: { status: 400 } }]) {
    let deliveries = 0;
    const ambiguous = context.createBotSender(async () => { deliveries++; throw error; });
    await context.sendCoreOrchestrationActivity(ambiguous, activity);
    assert.equal(deliveries, 1, 'ambiguous delivery never duplicates a message');
  }
  context.genUiMode = 'legacy';
  const legacy: any[] = [];
  await context.createBotSender(async (value: unknown) => { legacy.push(value); return {}; })('', undefined, activity);
  assert.match(legacy[0].text, /synthetic-fallback-job/, 'legacy still shows the requested job');
  assert.equal(legacy[0].attachments, undefined);
  context.genUiMode = 'adaptive';
}
assert.equal(typeof fallbackModule?.adaptiveCardTextFallback, 'function');
const fallback = fallbackModule!.adaptiveCardTextFallback;
const privatePayload = { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {
  body: [{ type: 'TextBlock', text: 'Safe visible result' }, { type: 'FactSet', facts: [{ title: 'Status', value: 'completed' }] },
    { type: 'Input.Text', value: 'PRIVATE_INPUT' }],
  actions: [{ type: 'Action.Submit', data: { approvalToken: 'PRIVATE_ACTION' } },
    { type: 'Action.ShowCard', card: { body: [{ type: 'TextBlock', text: 'PRIVATE_HIDDEN_CARD' }] } }],
} }] };
const safe = fallback(privatePayload);
assert.match(safe, /Safe visible result/);
assert.match(safe, /Status: completed/);
assert.doesNotMatch(safe, /PRIVATE_INPUT|PRIVATE_ACTION|PRIVATE_HIDDEN_CARD/);
assert.ok(fallback({}).trim(), 'unsupported content provides an actionable message');
assert.ok(fallback({ type: 'message', text: 'x'.repeat(100_000) }).length <= 4_000);
assert.doesNotMatch(fallback({ text: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890' }), /abcdefghijklmnopqrstuvwxyz1234567890/);
console.log('PASS: same-job visible fallback survives definite rejection; cards stay attachment-only; ambiguous delivery never retries; hidden inputs/actions excluded');
