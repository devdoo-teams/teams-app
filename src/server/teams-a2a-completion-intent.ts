import crypto from 'node:crypto';

import type { A2AScope } from './a2a-contract.js';
import { TeamsA2AOutboundConflictError, type TeamsA2AOutboundStore } from './teams-a2a-outbound-store.js';

export function teamsA2ACompletionFingerprint(parentTaskId: string, scope: A2AScope): string {
  return fingerprint(parentTaskId, {
    tenantId: scope.tenantId,
    requesterId: scope.requesterId,
    conversationId: scope.conversationId,
  });
}

export function isTeamsA2ACompletionFingerprint(
  payloadSha256: string, parentTaskId: string, scope: A2AScope,
): boolean {
  if (payloadSha256 === teamsA2ACompletionFingerprint(parentTaskId, scope)) return true;
  // The historical Bot activityScope used exactly this field order before the
  // stores normalized it. Recognize that identity without rebinding its receipt.
  return payloadSha256 === fingerprint(parentTaskId, {
    requesterId: scope.requesterId,
    conversationId: scope.conversationId,
    tenantId: scope.tenantId,
  });
}

export async function ensureTeamsA2ACompletionIntent(
  store: TeamsA2AOutboundStore, parentTaskId: string, scope: A2AScope,
) {
  const existing = store.getCompletionIntent(parentTaskId, scope);
  if (existing) {
    if (!isTeamsA2ACompletionFingerprint(existing.payloadSha256, parentTaskId, scope)) {
      throw new TeamsA2AOutboundConflictError('Outbound intent is already bound to a different completion payload.');
    }
    return { intent: existing, created: false };
  }
  return store.createOrGetCompletionIntent({
    parentTaskId, scope, payloadSha256: teamsA2ACompletionFingerprint(parentTaskId, scope),
  });
}

function fingerprint(parentTaskId: string, scope: A2AScope): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    schemaVersion: 'teams-a2a-completion-intent.v1', parentTaskId, scope,
  }), 'utf8').digest('hex');
}
