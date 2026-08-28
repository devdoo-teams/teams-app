import crypto from 'node:crypto';

export type RestPrincipal = Readonly<{
  tenantId: string;
  requesterId: string;
}>;

const MAX_PRINCIPAL_VALUE_LENGTH = 256;

/**
 * REST requests do not carry a Teams conversation reference that the server
 * can authenticate. Derive a stable opaque scope from validated Entra claims
 * instead of allowing a body/header value to select an outbound conversation.
 */
export function deriveServerOwnedRestConversationId(principal: RestPrincipal): string {
  assertPrincipalValue(principal.tenantId, 'tenantId');
  assertPrincipalValue(principal.requesterId, 'requesterId');
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify([principal.tenantId, principal.requesterId]), 'utf8')
    .digest('hex')
    .slice(0, 48);
  return `rest-${digest}`;
}

function assertPrincipalValue(value: string, field: string): void {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_PRINCIPAL_VALUE_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`Invalid REST principal ${field}.`);
  }
}
