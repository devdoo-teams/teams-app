import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { deriveServerOwnedRestConversationId } from '../src/server/rest-scope.js';
import { AgentJobStore } from '../src/server/agent-job-store.js';

const first = deriveServerOwnedRestConversationId({ tenantId: 'tenant-a', requesterId: 'user-a' });
assert.match(first, /^rest-[a-f0-9]{48}$/);
assert.equal(first, deriveServerOwnedRestConversationId({ tenantId: 'tenant-a', requesterId: 'user-a' }));
assert.notEqual(first, deriveServerOwnedRestConversationId({ tenantId: 'tenant-b', requesterId: 'user-a' }));
assert.notEqual(first, deriveServerOwnedRestConversationId({ tenantId: 'tenant-a', requesterId: 'user-b' }));
assert.equal(first.includes('tenant-a'), false);
assert.equal(first.includes('user-a'), false);
assert.throws(() => deriveServerOwnedRestConversationId({ tenantId: '', requesterId: 'user-a' }), /Invalid REST principal/);
assert.throws(() => deriveServerOwnedRestConversationId({ tenantId: 'tenant-a', requesterId: 'user\u0000a' }), /Invalid REST principal/);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-rest-scope-security-'));
try {
  const store = new AgentJobStore(path.join(root, 'jobs.json'));
  await store.initialize();
  const owned = await store.create({
    prompt: 'owned',
    provider: 'codex',
    mode: 'read-only',
    scope: { tenantId: 'tenant-a', requesterId: 'user-a', conversationId: 'server-owned-chat' },
  });
  await store.create({
    prompt: 'other principal',
    provider: 'codex',
    mode: 'read-only',
    scope: { tenantId: 'tenant-b', requesterId: 'user-a', conversationId: 'other-chat' },
  });
  assert.equal(store.getForPrincipal(owned.id, { tenantId: 'tenant-a', requesterId: 'user-a' })?.conversationId, 'server-owned-chat');
  assert.equal(store.getForPrincipal(owned.id, { tenantId: 'tenant-b', requesterId: 'user-a' }), undefined);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('PASS: authenticated REST scopes derive from validated principals and cannot be redirected by conversation IDs');
