import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createMcpProviderToolRegistry } from '../src/server/mcp-provider-tools.js';
import { ProviderMutationReplayStore } from '../src/server/provider-mutation-replay-store.js';

type RegisteredTool = {
  handler: (input: Record<string, unknown>, extra?: unknown) => Promise<Record<string, any>>;
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-provider-idempotency-'));
const replayStore = new ProviderMutationReplayStore(path.join(root, 'replay', 'provider-mutations.json'));
await replayStore.initialize();
const requests: Array<{ method: string | undefined; body: string | undefined }> = [];
const fetchImpl: typeof fetch = async (_input, init) => {
  requests.push({
    method: init?.method,
    body: typeof init?.body === 'string' ? init.body : undefined,
  });
  return new Response(JSON.stringify({ id: 'MP-1', fields: { summary: 'updated' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const server = new McpServer({ name: 'provider-idempotency-test', version: '1.0.0' });
createMcpProviderToolRegistry({
  principal: { tenantId: 'tenant-1', requesterId: 'requester-1' },
  resolveCredential: () => 'fixture-token',
  atlassianSiteUrl: 'https://devdoo.atlassian.net',
  fetchImpl,
  mutationReplayStore: replayStore,
}).register(server);

const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
const edit = tools.jira_edit_issue;
assert.ok(edit, 'Jira mutation is registered');

const payload = {
  issueIdOrKey: 'MP-1',
  fields: { summary: 'updated' },
  idempotencyKey: 'jira-edit-1',
};
const missingKey = await edit.handler({ issueIdOrKey: 'MP-1', fields: { summary: 'updated' } });
assert.equal(missingKey.isError, true);
assert.equal(missingKey.structuredContent?.error?.code, 'MUTATION_IDEMPOTENCY_REQUIRED');
assert.equal(requests.length, 0, 'missing idempotency key never reaches the provider');

const first = await edit.handler(payload);
assert.equal(first.isError, undefined);
assert.equal(requests.length, 1, 'first mutation reaches the provider once');

const replay = await edit.handler({ ...payload, fields: { summary: 'updated' } });
assert.equal(replay.isError, undefined);
assert.deepEqual(replay.structuredContent, first.structuredContent, 'same-key retry returns the original structured result');
assert.equal(requests.length, 1, 'same-key retry does not repeat the provider mutation');

const conflict = await edit.handler({ ...payload, fields: { summary: 'different' } });
assert.equal(conflict.isError, true);
assert.equal(conflict.structuredContent?.error?.code, 'MUTATION_IDEMPOTENCY_CONFLICT');
assert.equal(requests.length, 1, 'fingerprint conflict never reaches the provider');

const equivalentOrder = await edit.handler({
  idempotencyKey: 'jira-edit-1',
  fields: { summary: 'updated' },
  issueIdOrKey: 'MP-1',
});
assert.equal(equivalentOrder.isError, undefined, 'canonical input ordering preserves a valid replay');
assert.equal(requests.length, 1);

console.log('mcp-provider-idempotency-test: PASS');
