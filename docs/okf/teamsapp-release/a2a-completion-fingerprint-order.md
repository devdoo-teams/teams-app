---
type: "Concept"
sources:
  - resource: "https://tc39.es/ecma262/multipage/structured-data.html#sec-serializejsonobject"
    title: "ECMAScript Language Specification: SerializeJSONObject"
    location: "25.5.4.5 steps6-8; observed web lines4209-4228 on2026-10-07; HTML lines are not stable, section anchor authoritative"
  - resource: "https://raw.githubusercontent.com/nodejs/node/v24.13.1/doc/api/crypto.md"
    title: "Node.js v24.13.1 crypto API"
    location: "crypto.createHash and hash.update/hash.digest sections; installed Node24.13.1; section anchor used"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability#update-cards"
    title: "Send and receive messages"
    location: "Send messages and Update cards sections observed2026-10-07; HTML lines not stable; transport acceptance and activity identity remain separate"
generated: { by: "process:codex", at: "2026-10-07T15:29:54Z" }
verified: { by: "process:live-readonly-and-synthetic-red", at: "2026-10-07T15:29:54Z" }
status: "SOURCE_FIX_LIVE_UNVERIFIED"
stale_after: "2026-10-14T15:29:54Z"
---

OFFICIAL CONTRACT: JSON object serialization enumerates properties in their defined order;
hashing JSON bytes is not a semantic scope comparison. The local durable binding contract still
requires exact tenant/requester/conversation/parent identity and immutable accepted/ambiguous/rejected
outbound receipts. Recognizing the known historical v1 Bot order does not authorize arbitrary payloads.

OBSERVED EVIDENCE: MP-345 live read-only inspection2026-10-07T15:18:07Z found exactly1 completed
parent and1 connector-accepted intent/attempt1. Existing payload SHA matches only the original
`requesterId,conversationId,tenantId` order. Persisted task/intent stores use
`tenantId,requesterId,conversationId`; replaying the same semantic identity produced a different SHA.
Before this fix `src/server/index.ts:984` created the first order, while
`src/server/a2a-store.ts:1406` and `src/server/teams-a2a-outbound-store.ts:391` normalized the second.
The old startup loop at `src/server/index.ts:3751` attempted to rebind all terminal Teams tasks,
including already accepted, so the conflict aborted unrelated queued recovery.
Value-redacted evidence: `/tmp/teams-catalog-update-20261006/followup115/mp345-value-redacted-readback.json:1`.

FIXTURE: the extended `scripts/teams-a2a-outbound-restart-regression-test.ts:1` against original115
bundle160f40e failed exit1 with the exact `Outbound intent is already bound to a different completion payload.`
and no later queued completion. Its isolated loopback, synthetic stores/fake worker/local outbox are
fixtures, not public auth or real delivery. RED output:
`/tmp/teams-catalog-update-20261006/followup115/mp345-restart-RED.log:1`.
New canonical-order, scope isolation, legacy accepted receipt preservation and arbitrary-binding rejection
unit tests pass in `scripts/teams-a2a-completion-intent-test.ts:1`; actual new-bundle restart GREEN
and whole Core/CI/public activation remain separate pending gates at this snapshot.
The registered SDK chat replay test also fails against115 when a valid canonical receipt is replayed
through the historical Bot scope order: an error card is emitted instead of reusing the settled receipt.
Its RED is `/tmp/teams-catalog-update-20261006/followup115/mp345-chat-replay-RED.log:1`.
The new lookup's stored-parent/key mismatch was independently reproduced and fixed with a separate
persisted scratch-store RED/GREEN test, tracked as MP-346; no live store was edited.

IMPLEMENTATION: `src/server/teams-a2a-completion-intent.ts:1` explicitly orders future scope fields and
recognizes exactly canonical and historical Bot-order v1 fingerprints. The store exposes a scoped,
read-only completion lookup. Existing settled intents are not recreated during missing-intent repair;
queued recovery still validates the complete bound scope/parent fingerprint. Repeated valid old activity
reuses the existing intent without changing SHA, attempts, activity, or receipt. Invalid binding remains
a conflict and is not sent. Accepted/rejected/ambiguous entries remain unclaimable.

LIVE RESULT: current115/160f40e/PID46385 and tunnel52764 remain serving authenticated public health.
The live accepted intent was only read, never reset/retried/resent. Candidate116 is a new source/package
identity pending clean pinned build, runtime regression, CI, same-catalog upload, full staging+isolated
boot/health/asset GET before transition, and fresh UI. Native pipe BLOCKED and MOBILE_UNVERIFIED remain
independent. No Jira Done or Teams completion claim.

INFERENCE: MP338 live error recovery remains UNVERIFIED because the browser's root-frame URL block
did not affect the cross-origin OOPIF poll; nonflattened target diagnostic sessions failed. No actual error
notice was observed. Current browser diagnostic transport limitations are not a reproduced product bug.
