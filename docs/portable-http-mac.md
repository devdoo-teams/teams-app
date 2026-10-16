---
type: "Implementation contract"
title: "Portable HTTP and existing Mac execution"
sources:
  - resource: "https://raw.githubusercontent.com/nodejs/node/v24.13.1/doc/api/globals.md"
    title: "Node.js v24.13.1 globals"
    location: "AbortController and fetch sections; version-pinned Markdown"
  - resource: "https://expressjs.com/en/guide/routing/"
    title: "Express 5 routing"
    location: "Routing and middleware callbacks; observed lines 46-51 on 2026-10-16; HTML line numbers are not a stable contract"
generated: { by: "process:portable-worker-implementation", at: "2026-10-16T17:00:00Z" }
verified: { by: "process:local-synthetic-tests", at: "2026-10-16T17:00:00Z" }
status: draft
stale_after: "2026-10-23T17:00:00Z"
---

# Portable HTTP / existing Mac execution

This is an opt-in implementation awaiting Astra review and deployment composition.
The current production index and 3978 server remain unchanged. This is not a
Railway/Render deployment, a real Codex trial or a Teams client verification.

## Included implementation

`npm run build:core` ships `dist/server/portable-worker-runtime.js` alongside the
existing server. It exports factories; importing it starts nothing.

| Export | Responsibility |
| --- | --- |
| `createPullWorkerHost` | Single-writer durable task/claim/begin/cancellation/result ledger and AgentExecutionDispatcher |
| `createPullWorkerRouter` | Authenticated HTTP operations with injected verified worker identity; no registration or token issuance |
| `createAuthenticatedPullTransport` | Outbound HTTPS client, timeout/body bounds, no redirects, no DevTunnel relay |
| `MacPullWorker` | Serialized bounded polling steps, stop on disconnect, explicit reconnect after verified cleanup |
| `createAgentServiceMacExecutor` | Existing Mac AgentService, local durable idempotency, unchanged model/admission/isolation checks |

The host accepts only fresh read-only Codex jobs with a complete existing model
selection and exact source commit. Writes and continuations are rejected rather
than translating remote approval/session state into local execution authority.

## Lifecycle

1. Existing cloud AgentService submits through the dispatcher after its own policy checks.
2. The authenticated Mac claims its owner's work; claim persistence precedes reply.
3. The Mac acknowledges begin; running persistence precedes execution.
4. Local submission uses a stable owner/job idempotency key and immutable request hash.
5. Heartbeats carry cancellation requests. Terminal cancellation requires local cleanup.
6. Finish is durable and replayable, including a lost acknowledgement.

The Mac adapter waits for `AgentService.waitForExecutionSettlement()`: execution
must have finished and isolation, projected workspace and admission cleanup must
be explicitly verified. A terminal job status or an error message does not prove
cleanup. Process-local proof is intentionally not reconstructed from terminal
records after restart; those records remain unverified for remote publication.
An authorized replay checks owner, idempotency key/hash and immutable request
fields before acquiring another admission slot. Concurrent identical submissions
serialize through that lookup and attach to one execution, including after the
runner records its observed thread ID. Completed receipts with an empty or
whitespace-only result fail validation before durable persistence, so a valid
retry can still succeed.

An unstarted expired claim can be reissued. A started expired job is quarantined
and blocks further work for that worker. It is never automatically reassigned.
Uncertain local start, failed cleanup, stale source, changed owner/model or ambiguous
late cancellation remain blocked for reconciliation. A completed result racing a
cancellation can require operator reconciliation; no successful cancellation is
invented. There is no arbitrary cross-machine exactly-once guarantee.

## Composition gates before activation

- Choose the approved public HTTP origin, persistent storage and one writer.
  PostgreSQL/other shared stores are not implemented by this slice.
- Supply existing Teams delegated authentication and an independently verified,
  stable mapping to the intended Mac worker and tenant/requester. A body field or
  user-selected worker ID is not authentication. No machine credential is created
  here; reviewing this binding is required before mounting production routes.
- Compose cloud AgentService with `host.dispatcher` and the new authenticated router.
  Existing `index.ts` still supports its prior modes only; setting a new env value
  does not activate these modules.
- Compose the Mac connector with the existing local AgentService and its existing
  operator identity, service-home reservation and verified read-only isolation.
  Do not instantiate a second uncoordinated CLI executor or copy auth homes.
- Scheduling must poll faster than the configured lease budget while native
  execution is pending. Begin/start is fail-closed; a stalled start needs operator
  reconciliation. `close()` reports whether owned cleanup was verified.
- Review newly exposed job text/data flow and exact Bot/tab/SSO domain/package
  changes before any new hosting target or installation update.

## Verification and release identities

Focused synthetic tests are registered in Core, including actual loopback HTTP,
durable replay/restart, lost replies, disconnect/cancel cleanup, ownership/model
tampering and the real AgentService isolation rejection. Additional real-service
regressions cover delayed/failed cleanup, cancellation, restart without lifecycle
proof, active/concurrent replay at a one-requester limit and blank result retries.
Only the runner and isolation boundary in those service fixtures are synthetic.
The tests do not execute a
real CLI or use a login, real Teams data or external provider.

The implementation branch prepares version 1.0.157 after confirming its tag is
unused. Frozen 1.0.154/ea17384 tag/draft/run and public 1.0.152/8dcc remain preserved.
Local exact-commit build/package evidence is separate from remote exact-SHA CI,
new hosting HTTPS, Bot/SSO round-trip, installation and Teams web/Mac/iPhone gates.
Operational promotion awaits Astra review. Existing mismatches remain visible
until those gates complete; they are not repaired by rewriting old receipts.
