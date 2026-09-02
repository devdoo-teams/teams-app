import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/server/index.ts'), 'utf8');

assert.match(source, /parseCoreOrchestrationChatCommand/u, 'Teams chat must consume the shared Core command parser');
assert.match(source, /createCoreOrchestrationJobActivity/u, 'Teams chat must render the shared attachment-only job card');
assert.match(source, /createCoreOrchestrationListActivity/u, 'Teams chat must render the shared attachment-only list card');
assert.match(source, /async function handleCoreOrchestrationChatCommand/u, 'Teams chat must have an explicit Core orchestration handler');
assert.match(source, /createServerDerivedCoreScope\(scope\)/u, 'Teams activity scope must be branded server-side before service use');
assert.match(source, /coreOrchestrationService\.submit/u, 'submit must use the same application service as the tab');
assert.match(source, /coreOrchestrationService\.get/u, 'status must use the same application service as the tab');
assert.match(source, /coreOrchestrationService\.list/u, 'list must use the same application service as the tab');
assert.match(source, /coreOrchestrationService\[command\.kind\]/u, 'cancel/approve/retry must dispatch through the same application service as the tab');
assert.match(source, /coreOrchestrationService\.provideInput/u, 'input must use the same application service as the tab');
assert.match(source, /isCoreOrchestrationCardSubmission/u, 'orchestration card submissions must be recognized before generic GenUI actions');
assert.match(source, /handleCoreOrchestrationCardSubmission/u, 'orchestration card submissions must use a dedicated authenticated handler');
assert.match(source, /coreOrchestrationActivityIdempotencyKey/u, 'chat submissions must derive a stable activity idempotency key');
assert.match(source, /sendCoreOrchestrationActivity/u, 'Core responses must use an attachment-only send boundary');
assert.match(source, /if \(coreCommand\)[\s\S]*handleCoreOrchestrationChatCommand/u, 'explicit Core commands must be handled before legacy/natural language routing');

for (const action of ['cancel', 'approve', 'retry', 'provide-input']) {
  assert.match(source, new RegExp(`orchestration\\.${action}`), `card action ${action} must be wired`);
}

console.log('core-orchestration-teams-chat-wiring-test: PASS');
