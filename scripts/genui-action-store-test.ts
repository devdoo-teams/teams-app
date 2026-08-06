import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GenUiActionStore } from '../src/server/genui-action-store.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-genui-actions-'));
const dataFile = path.join(directory, 'actions.json');

try {
  const store = new GenUiActionStore(dataFile, 100);
  await store.initialize();
  const grant = {
    action: 'approve' as const,
    entityId: 'task-test-1',
    correlationId: 'correlation-1',
    conversationId: 'conversation-1',
    requesterId: 'user-1',
  };
  const token = await store.issue(grant);
  assert.ok(token.length >= 32);
  assert.deepEqual(await store.consume({ ...grant, requesterId: 'other-user', token }), { ok: false, reason: 'mismatch' });
  assert.equal((await store.consume({ ...grant, token })).ok, true);
  assert.deepEqual(await store.consume({ ...grant, token }), { ok: false, reason: 'consumed' });

  const restarted = new GenUiActionStore(dataFile, 100);
  await restarted.initialize();
  assert.deepEqual(await restarted.consume({ ...grant, token }), { ok: false, reason: 'consumed' });

  const expiring = new GenUiActionStore(path.join(directory, 'expiring.json'), 5);
  await expiring.initialize();
  const expiringGrant = { ...grant, entityId: 'task-expiring' };
  const expiringToken = await expiring.issue(expiringGrant);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await expiring.consume({ ...expiringGrant, token: expiringToken }), { ok: false, reason: 'expired' });
  console.log('PASS: GenUI action grants are scoped, single-use, persistent, and expiring');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
