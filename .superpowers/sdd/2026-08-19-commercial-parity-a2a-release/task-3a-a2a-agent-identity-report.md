# Task 3A — MP-126 bounded A2A agent identity

## Scope and routing

This is the bounded MP-126 independent-agent identity slice only. Each child
request can select an `agentId`; the production runtime resolves that ID only
from its trusted in-process registry and supplies the registry-owned
`agentId` and `providerId` to the selected child executor. The resolved
identity is included in the internal child result and dispatch audit. A
request-supplied provider identity is not trusted or propagated.

## Trusted allowlist and authorization

The runtime rejects a missing selection when there is no configured default,
an agent ID absent from the trusted allowlist, and an authorization denial.
An optional registry authorization callback receives the authenticated scope,
Core role, and validated capabilities. Selection and authorization occur
before the parent transitions from `submitted` to `working` and before child
execution. Duplicate child idempotency fingerprints include the resolved
agent and provider identities, preventing an existing child key from being
reused for a different selected execution identity.

## Backward compatibility

Existing `coreA2A.executeChild` callers remain supported without a registry.
They use the stable legacy identity `teams-core` / `core-default`, which is
passed to the executor and recorded in child/audit evidence. The dispatch
audit schema is now `a2a-core-dispatch-audit.v2` because the internal entry
shape contains these two required identity fields. Agent-card and A2A task
wire contracts are unchanged.

## Implementation provenance

- Implementation commit: `6467156c55544fae87712b4b22fad652cac8fa17`
- Scoped implementation/test paths:
  - `src/server/a2a-orchestrator.ts`
  - `src/server/a2a-observability.ts`
  - `src/server/a2a-production-runtime.ts`
  - `scripts/a2a-observability-test.ts`
  - `scripts/a2a-independent-agent-identity-test.ts`

## Exact focused verification

- `npx tsx scripts/a2a-independent-agent-identity-test.ts` — PASS:
  `a2a-independent-agent-identity-test: PASS`.
- `npx tsx scripts/a2a-observability-test.ts` — PASS:
  `a2a-observability-test: PASS`.
- `npm run test:a2a-orchestrator` — PASS.
- `npm run test:a2a-index-integration` — PASS (mounted authenticated Core
  orchestration route; no live Teams/Codex provider round trip).
- `npm run test:a2a-jsonrpc-route` — PASS.
- `git diff --check` — PASS (exit 0).

The independent identity test verifies registry-selected Codex/Copilot-style
agent/provider routing, a request-level provider spoof being ignored,
allowlist rejection, authorization rejection before parent state transition
or execution, and the legacy `teams-core` / `core-default` fallback.

## Explicit limitation

MP-114 durable parent graph persistence, cancellation, and restart recovery
remain unresolved. `scripts/a2a-durable-dispatch-test.ts` is intentionally
untracked and excluded from this slice. This report does not claim commercial
A2A completion, durable multi-agent completion, live provider validation, or
Teams deployment verification.

## Post-commit core source check

With the tracked worktree clean (baseline untracked files preserved), the
exact post-commit command and result were:

```text
$ npm run typecheck:core

> teams-sdk-mvp@1.0.51 typecheck:core
> node scripts/core-source-check.mjs

PASS: core source compile check covered 22 Teams/CLI files
```
