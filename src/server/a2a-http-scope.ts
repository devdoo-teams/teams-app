import crypto from 'node:crypto';

import type { A2AScope } from './a2a-contract.js';
import {
  validateIdempotencyKey,
  validateScope,
} from './a2a-contract.js';

const INTERNAL_CONVERSATION_PREFIX = 'a2a-http';
const HASH_LENGTH = 32;

export function deriveA2AHttpScope(authenticatedScope: A2AScope, idempotencyKey: string): A2AScope {
  const validatedKey = validateIdempotencyKey(idempotencyKey);
  const normalized = validateScope({
    tenantId: authenticatedScope.tenantId,
    requesterId: authenticatedScope.requesterId,
    conversationId: INTERNAL_CONVERSATION_PREFIX,
  });
  const conversationId = `${INTERNAL_CONVERSATION_PREFIX}-${sha256([
    normalized.tenantId,
    normalized.requesterId,
    validatedKey,
  ]).slice(0, HASH_LENGTH)}`;
  return {
    tenantId: normalized.tenantId,
    requesterId: normalized.requesterId,
    conversationId,
  };
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
