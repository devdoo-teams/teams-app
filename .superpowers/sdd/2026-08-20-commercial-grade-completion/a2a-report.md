# A2A production composition report

Date: 2026-08-20

Worktree: `/Users/doosansmacbookpro/Documents/TeamsApp`

Starting identity: `HEAD c1cf573ec54f86557b66719318948e658a66316a`, package version `1.0.76`

Source implementation commit: `dda28eb36b4d72262090ade778891f9ae7bf1c96`

Integrated implementation identity: `4ab7099d65481c169eaa8eefeb587394a035cc89` (`fix(a2a): finalize remote lifecycle report`), on top of `dda28eb`.

## STATUS

PASS for the bounded implementation and focused local A2A tests. A live external A2A provider, Teams-host dispatch, and same-release deployment evidence remain unverified and were intentionally not attempted.

## EVIDENCE

- The implementation preserves the official A2A `SendMessage` request shape: `params.message` contains the message identity, context, role, parts, and media type; a non-standard top-level idempotency field is not emitted. Reference: [A2A specification](https://a2a-protocol.org/latest/specification/).
- Remote task identity is bound before polling, cancellation is attempted on abort/deadline/poll exhaustion, and recovery rejects a returned task whose identity differs from the durable child job ID.
- `src/server/index.ts` composes the configured remote agent into the production registry only when `TEAMS_A2A_REMOTE_AGENT_ENDPOINT` and `TEAMS_A2A_REMOTE_AGENT_BEARER_TOKEN` are both present. Partial configuration fails closed; the token is not included in logs or response data.
- `src/server/a2a-execution.ts` routes persisted remote child jobs through the registered agent's recovery handler before falling back to the local provider recovery path. `src/server/a2a-production-runtime.ts` enforces the agent/provider identity pair at that boundary.
- Existing authorization policy and route tests retain tenant/requester/conversation scope checks and fail-closed agent authorization; no scope/auth mapping change was needed after the focused tests passed.
- Tests use injected fetches and local durable JSON fixtures. They do not claim a live Teams, external A2A, or Codex provider round trip.

The first RED reproduction was:

```text
npm run test:a2a-remote-agent-adapter
SyntaxError: ... a2a-remote-agent-adapter.js does not provide an export named 'createConfiguredA2ARemoteAgent'
```

The configured composition test then asserts the bearer header and exact `SendMessage` parameter keys. The production fixes and the focused fixture correction were followed by GREEN runs.

## COMPLETED

- `src/server/a2a-remote-client.ts`: removed the unsupported top-level idempotency extension from `SendMessage`.
- `src/server/a2a-remote-agent-adapter.ts`: added configured-client composition, bounded task polling, cancellation, restart recovery, identity checks, and telemetry hooks.
- `src/server/a2a-production-runtime.ts`, `src/server/a2a-execution.ts`, and `src/server/index.ts`: registered the optional remote agent and connected durable recovery to startup reconciliation.
- `scripts/a2a-remote-agent-adapter-test.ts`, `scripts/a2a-remote-client-test.ts`, and `scripts/a2a-durable-dispatch-test.ts`: added RED-to-GREEN contract and restart-recovery coverage.
- The tracked implementation was committed as `dda28eb` and the follow-up submitted-task cancellation/report correction as `4ab7099`; both were created after focused tests and `git diff --check` passed.

No GHCP, Atlassian, client UI, manifest, release, browser, Jira, version, package, or upload files were changed.

## VERIFICATION MATRIX

| Area | Result | Evidence |
| --- | --- | --- |
| Production registration/use | PASS | Optional configured remote agent is appended to the trusted registry in `src/server/index.ts`; configured factory test exercises card discovery and use. |
| Authenticated send/poll/cancel | PASS | `test:a2a-remote-client`, `test:a2a-remote-agent-adapter`; bearer header, JSON-RPC version, polling, abort cancellation, and task binding are asserted. |
| Official SendMessage shape | PASS | Exact `params` key assertion permits only `message`; top-level idempotency extension removed. See [A2A JSON-RPC specification](https://github.com/a2aproject/A2A/blob/main/docs/specification.md). |
| Scope/auth mapping | PASS | `test:a2a-agent-authorization-policy`, `test:a2a-route`, `test:a2a-jsonrpc-route`, and `test:a2a-remote-client`. |
| Independent identity | PASS | `test:a2a-independent-agent-identity`, `test:a2a-durable-dispatch`. |
| Restart durability | PASS | `test:a2a-durable-dispatch` recovers a persisted remote agent/provider identity through the production runtime callback without resubmission. |
| Deadlines/cancellation | PASS | `test:a2a-remote-agent-adapter`, `test:a2a-deadline-cancellation`, and durable cancellation tests. |
| Telemetry | PASS | Adapter telemetry assertion plus `test:a2a-telemetry`; provider labels and bounded zero-latency lifecycle samples are recorded without prompt/artifact data. |
| Live external/Teams proof | BLOCKED | No endpoint/token or release deployment was supplied; no external request, package, upload, or Teams-host claim was made. |

## TESTS

Post-change focused commands passed:

```text
npm run test:a2a-remote-client
npm run test:a2a-remote-agent-adapter
npm run test:a2a-route
npm run test:a2a-jsonrpc-route
npm run test:a2a-execution
npm run test:a2a-parent-lifecycle
npm run test:a2a-independent-agent-identity
npm run test:a2a-durable-dispatch
npm run test:a2a-admission-restart
npm run test:a2a-deadline-cancellation
npm run test:a2a-submission-durability
npm run test:a2a-agent-authorization-policy
npm run test:a2a-telemetry
npm run test:a2a-official-contract-audit
npm run test:a2a-observability
npm run test:a2a-orchestrator
npm run test:a2a-role-catalog
npm run test:a2a-index-integration
git diff --check
```

`test:a2a-index-integration` explicitly reports that it mounts the authenticated Core orchestration route but performs no live Teams/Codex provider round trip; that row remains unverified until the release runtime is exercised.

## BLOCKER

No blocker for the bounded local implementation. The first `npm run typecheck:core` attempt correctly fail-closed with `EWORKTREEDIRTY` before compilation while the scoped changes were uncommitted; a clean-worktree Core gate is the next verification step. Release readiness remains outside this task until that gate and any separately authorized package/public/Teams evidence exist. External remote-agent credentials and endpoint were not invented or contacted.

## NEXT ACTION

Run the clean-worktree Core gate against `4ab7099`, keep version `1.0.76` until the combined functional release is accepted, and do not package or upload this bounded slice alone. A separately authorized release task would need to combine commit, manifest, package SHA, public health, and host evidence into one release identity.
