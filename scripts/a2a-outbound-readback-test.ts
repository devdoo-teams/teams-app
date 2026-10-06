import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TeamsA2AOutboundStore, readTeamsA2ACompletionIntent } from '../src/server/teams-a2a-outbound-store.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-readback-'));
const file = path.join(root, 'outbound.json');
const scope = { tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner', conversationId: 'synthetic-chat' };
try {
 const server = new TeamsA2AOutboundStore(file); await server.initialize();
 const input = { parentTaskId: 'synthetic-parent', scope, payloadSha256: 'a'.repeat(64) };
 const { intent } = await server.createOrGetCompletionIntent(input);
 await server.claim(intent.id, scope, 'synthetic-lease', 60000);
 const snapshot = await readTeamsA2ACompletionIntent(file, input.parentTaskId, scope);
 assert.equal(snapshot?.status, 'dispatching');
 await server.recordConnectorAccepted(intent.id, scope, 'synthetic-lease', 'synthetic-activity');
 const before = await fs.readFile(file, 'utf8');
 assert.equal((await readTeamsA2ACompletionIntent(file, input.parentTaskId, scope))?.status, 'connector-accepted');
 assert.equal(await fs.readFile(file, 'utf8'), before, 'inspection cannot publish its stale dispatching snapshot');
 assert.equal((await readTeamsA2ACompletionIntent(file, input.parentTaskId, { ...scope, requesterId: 'other' })), undefined);
 console.log('PASS: process-boundary readback never rewrites a stale dispatching snapshot over acceptance');
} finally { await fs.rm(root, { recursive: true, force: true }); }
