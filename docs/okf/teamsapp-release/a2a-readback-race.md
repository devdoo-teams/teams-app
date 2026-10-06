---
type: "Concept"
sources:
  - resource: "https://nodejs.org/docs/latest-v24.x/api/fs.html"
    title: "Node.js File system"
    location: "Promises API; application serialization is distinct from asynchronous read/write, consulted local store contract; HTML lines not stable"
generated: { by: "process:codex", at: "2026-10-06T17:58:23Z" }
verified: { by: "process:deterministic-local-reproduction", at: "2026-10-06T17:58:23Z" }
status: "VERIFIED_LOCAL_ONLY"
stale_after: "2026-10-13T17:58:23Z"
---

# A2A regression read-back must not write

OBSERVED EVIDENCE: first1.0.107/f50c524 canonical Core run timed out at scripts/teams-a2a-outbound-restart-regression-test.ts:191 with the repaired intent still dispatching. One isolated invocation, three additional bounded isolated invocations and a second full machine invocation passed. This did not establish absence of a race.

DETERMINISTIC RED: a server store claims an intent; a separate observer initializes its dispatching snapshot; the server records connector-accepted; the observer calls createOrGetCompletionIntent(existing). That method still executes mutate/persist, so its stale whole snapshot restores dispatching. /tmp/teams-catalog-update-20261006/a2a-stale-observer-red.log:1–15 records the exact accepted→dispatching assertion failure. This is the actual read-back pattern previously used in the restart test, not proof that production has multiple permitted writers.

FIXTURE GREEN: src/server/teams-a2a-outbound-store.ts:55–72 adds validated read-only snapshot helpers. They never initialize a writer, create an intent, repair a lease, or publish a snapshot. The restart test now reads the repaired identity/payload and polls the terminal status through these helpers. scripts/a2a-outbound-readback-test.ts preserves the race interleaving and checks accepted state plus identical file bytes after inspection, including owner mismatch rejection. The same bounded restart command passes without changing4-second timeout.

INFERENCE: the reproduced observer race explains the original test's terminal-status reversal; the original failure's live snapshot was removed by its fixture cleanup, so its exact interleaving cannot be read back independently. Retain first failure, deterministic RED and new GREEN evidence separately. No Azure/provider/production-delivery root cause is asserted.

PROJECT CONTRACT: the file store remains one authoritative writer per process/lease. This change adds observation, not multi-writer support or exactly-once delivery. Local tests cannot complete MP-322 or a release without same-release public/install/UI evidence.
