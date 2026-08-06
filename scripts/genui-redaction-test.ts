import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GenUiActionStore } from '../src/server/genui-action-store.js';
import { GenUiResponseFactory } from '../src/server/genui-response.js';
import { redactSensitiveText } from '../src/server/sensitive-text.js';

const bearer = 'Bearer abcdefghijklmnopQRSTUV12';
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature-value-123';
const openAiKey = 'sk-proj-abcdefghijklmnopQRSTUV12';
const clientSecret = 'client_secret=client-secret-value-123';
const accessToken = 'access_token=access-value-123';
const refreshToken = 'refresh_token: refresh-value-123';
const password = 'password="p@ssword-value-123"';
const jsonAccessToken = '"access_token":"json-access-value-123"';
const privateKey = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'very-secret-private-key-material',
  '-----END RSA PRIVATE KEY-----',
].join('\n');
const credentialUrl = 'https://example.test/callback?access_token=url-secret-123&city=seoul';

const source = [bearer, jwt, openAiKey, clientSecret, accessToken, refreshToken, password, jsonAccessToken, privateKey, credentialUrl].join('\n');
const redacted = redactSensitiveText(source);

for (const secret of [
  'abcdefghijklmnopQRSTUV12',
  jwt,
  'sk-proj-abcdefghijklmnopQRSTUV12',
  'client-secret-value-123',
  'access-value-123',
  'refresh-value-123',
  'p@ssword-value-123',
  'json-access-value-123',
  'very-secret-private-key-material',
  'url-secret-123',
]) {
  assert.equal(redacted.includes(secret), false, `secret was not redacted: ${secret}`);
}
assert.match(redacted, /Bearer \[REDACTED\]/);
assert.match(redacted, /client_secret=\[REDACTED\]/);
assert.match(redacted, /access_token=\[REDACTED\]/);
assert.match(redacted, /https:\/\/example\.test\/callback\?access_token=\[REDACTED\]&city=seoul/);
assert.match(redacted, /BEGIN PRIVATE KEY-----\nREDACTED\n-----END PRIVATE KEY-----/);

const ordinary = 'task-ms h87wp6-c62e58ff · 서울 · 22.0°C · 습도 58% · weather 37.5665 126.978';
assert.equal(redactSensitiveText(ordinary), ordinary, 'ordinary task/weather text should remain unchanged');

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-genui-redaction-'));
const dataFile = path.join(directory, 'actions.json');

try {
  const store = new GenUiActionStore(dataFile);
  await store.initialize();
  const factory = new GenUiResponseFactory(store);
  const job = {
    id: 'task-sk-abcdefghijklmnop',
    prompt: `파일에 ${clientSecret} 및 ${password}를 넣지 마세요.`,
    mode: 'workspace-write' as const,
    status: 'awaiting_approval' as const,
    conversationId: 'conversation-mobile-1',
    requesterId: 'requester-1',
    tenantId: 'tenant-1',
    progress: [],
    createdAt: new Date().toISOString(),
  };
  const originalJob = JSON.stringify(job);
  const approval = await factory.approval(job);
  const serializedApproval = JSON.stringify(approval);

  assert.equal(JSON.stringify(job), originalJob, 'source job must not be mutated');
  assert.equal(approval.kind, 'approval');
  assert.equal(approval.actions.length, 2);
  assert.equal(approval.actions[0]?.entityId, job.id, 'action entity ID must remain unchanged');
  assert.match(approval.fallbackText ?? '', new RegExp(job.id), 'task ID must remain visible in fallback text');
  assert.ok(approval.actions.every((action) => action.actionToken.length >= 32));
  assert.equal(serializedApproval.includes(clientSecret), false);
  assert.equal(serializedApproval.includes('p@ssword-value-123'), false);
  assert.match(approval.sections[0]?.description ?? '', /\[REDACTED\]/);

  const emptyScopeJob = { ...job, tenantId: '   ' };
  const emptyScopeCard = await factory.approval(emptyScopeJob);
  assert.equal(emptyScopeCard.kind, 'error');
  assert.equal(emptyScopeCard.actions.length, 0, 'invalid scope must issue zero grants');
  assert.equal(emptyScopeCard.id, 'approval-scope-invalid');
  assert.equal(JSON.parse(await fs.readFile(dataFile, 'utf8')).length, 2, 'invalid scope must not add grants');

  const oversizedScopeJob = { ...job, conversationId: 'c'.repeat(513) };
  const oversizedScopeCard = await factory.approval(oversizedScopeJob);
  assert.equal(oversizedScopeCard.kind, 'error');
  assert.equal(oversizedScopeCard.actions.length, 0, 'oversized scope must issue zero grants');

  const nonStringScopeJob = { ...job, requesterId: 42 as unknown as string };
  const nonStringScopeCard = await factory.approval(nonStringScopeJob);
  assert.equal(nonStringScopeCard.kind, 'error');
  assert.equal(nonStringScopeCard.actions.length, 0, 'non-string scope must issue zero grants');
  assert.equal(JSON.stringify(nonStringScopeCard).includes('requester-1'), false);
  assert.equal(JSON.stringify(nonStringScopeCard).includes(clientSecret), false);

  console.log('PASS: Teams-bound GenUI redacts credentials, preserves action IDs, and fails closed on approval scope corruption');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
