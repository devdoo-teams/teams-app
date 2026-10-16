# Mutation and authentication recovery

This internal contract addresses the159 review reproduction: an accepted201
became `ApiAuthError` after another operation observed a refreshed credential.
The submit UI treated the error as definitive and discarded its replay key.

## Boundaries

- Authentication failure before dispatch, or a definitive HTTP401/403 rejection,
  remains `ApiAuthError`. No mutation has been admitted by the auth-first Core
  route in that case. An operation with an earlier possibly accepted mutation
  cannot downgrade its whole outcome to a definitive read/auth failure.
- After a potentially mutating request is dispatched, response loss, cancellation,
  timeout, unreadable/invalid successful receipt or unknown/changed owner is
  `ApiMutationUncertainError`. It contains no private body, token or identity.
  An observed response status is optional evidence, not permission to show a
  withheld body. There is no automatic retransmission.
- GET/HEAD/OPTIONS are reads. Their late private results are blocked after a
  credential change, without claiming a mutation may have happened.
- Core and repository clients check response scope after JSON body completion,
  including an abort-ignoring delayed body. Successful Core mutation receipts
  must contain a job identity; malformed receipts cannot render fake success.

## Server scope correlation and precondition

`X-Teams-Principal-Scope` is SHA256 of the JSON tuple of server-validated tenant,
requester and conversation. Core routes derive it from the existing validated
request state after authentication. It is a correlation value, not a credential,
signature, new role or grant. Caller body/query values cannot set that scope.

The client observes this header only on same-origin Core requests with redirects
refused. A late mutation receipt may be confirmed across token renewal only when
both the receipt and the current credential have the same server-observed scope.
An opaque token change alone establishes no principal identity. Missing/malformed
scope leaves a changed-credential receipt uncertain; different scope withholds it.
Old responses never replace the current scope observation.

A missing/malformed header on an error (for example a headerless503 from a proxy)
does not erase the last valid scope in the same credential generation. A credential
change, reset or401/403 still clears it. A different valid scope, including a
conversation change with the same token, invalidates private views and late bodies.

Every same-origin Core fetch receives a monotonic dispatch sequence, even when
several fetches share one logical operation/token lease. The first valid scope
observation records its sequence immediately. An older response with a different
or missing scope cannot replace it or expose its body. This is checked before
scope mutation and again after JSON completion. Older parallel responses with the
same verified scope still succeed; credential-generation isolation and the
same-owner accepted-mutation recovery rule continue to apply.

Core JSON mutations send the previously observed scope in
`X-Teams-Expected-Principal-Scope` when available. The server compares it with
the authenticated scope before service admission; mismatch is409
`CORE_PRINCIPAL_CHANGED`, malformed values400. The optional precondition never
supplies authorization. Existing authentication, owner checks, request hash,
idempotency lock and durable store remain authoritative and unchanged.

## Key and UI lifetime

Submission keys are memory-only, bounded to64 unresolved logical requests and
bound to the observed scope plus exact canonical submission identity. Editing a
prompt or switching owner does not evict another unresolved key. Returning to the
same owner/input reuses it. Unknown outcomes, including a view-generation change,
keep the key. A later failed recovery/auth attempt cannot erase earlier uncertainty;
only a confirmed receipt settles that uncertain key.

Unknown/malformed scope cannot allocate a submission key or dispatch a new UI
submission. The user must refresh to obtain a valid server scope first. There is
no fallback bucket for an unverified client session. If scope becomes unknown
after a credential change, pending keys remain in memory under their original
verified owner; restoring that owner allows the same-key recovery. Unknown scope
cannot settle/delete them or migrate them to another account/conversation.

If a catalog refresh changes only execution metadata for the same visible input
while a prior request is uncertain, a fresh key is blocked until the original
acceptance is checked. The old key and request are not silently replaced.

Credential changes clear private Core/PR views and Core drafts. A pending submit
shows **접수 결과 미확인**. The user reopens the original authenticated scope,
refreshes the owner-filtered job list and can explicitly retry the same exact
submission; its same key replays the durable job instead of launching another.
Non-idempotent followups/stops remain uncertain and require status read-back;
they are not automatically sent again.

## Verification limits

`npm run test:mutation-auth` exercises actual apiFetch, Core client, auth-first
Express router, Core service, temporary AgentJobStore and mounted React submit
handlers. Only synthetic token validation/provider observations are used; the
execution port creates test store rows and never launches an agent or real CLI.
It covers201/auth races, same-owner renewal vs account/tenant change, response/body
loss, GET/POST boundaries, scope mismatch, sticky/bounded keys and UI replay.
`npm run test:principal-scope` adds unknown-to-known and known-to-unknown mounted
React recovery, headerless503 retention, same-token conversation changes, and real
HTTP307 redirect refusal with no requests reaching the redirect destination.
`npm run test:principal-scope-order` covers initial full-response/body reordering,
same-scope parallel reads, fetches inside one logical operation, and credential
changes. Conversation switching is fixture-only: production conversation scope
is fixed per principal. This is not a live cross-account data-leak reproduction.

These are local contracts and synthetic results, not a live Teams/Entra/DC test.
Keys are not persisted across page/app restart; durable server job read-back is
required before repeating a submission after losing the browser session. New
scope metadata must be validated with the matching server/client release. Native
Teams screens and actual SSO renewal remain unverified until separately observed.
