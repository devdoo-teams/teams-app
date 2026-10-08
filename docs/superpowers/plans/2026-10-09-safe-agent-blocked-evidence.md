# Safe blocked agent evidence implementation plan

> For agentic workers: use superpowers:executing-plans for the implementation; independent read-only log analysis and regression review run in parallel as explicitly requested.

**Goal:** Preserve safe evidence from a resolved, structured blocked CLI report without changing its failed state or expanding access.

**Architecture:** Use the existing owner-scoped job `result` field alongside `error`. Sanitize before persistence and label diagnostic classification as model-reported rather than an observed transport failure. Existing tool-start observations remain unchanged.

**Tech Stack:** Teams Core, TypeScript, existing AgentService/AgentJobStore, synthetic runner tests.

**Spec:** MP-362 and the current delegated continuation request; existing `docs/teams-release-workflow.md`.

## Global constraints

- MCP, network, plugins, auth, deployment targets and user files remain unchanged.
- No raw command/stdout/stderr/event storage or inferred tool/skill success.
- Preserve failed/cancelled states, scope checks and admission cleanup.
- Only labeled structured report fields are retained; raw stdout/stderr and free-form blocks are omitted. Reports are sanitized before a maximum 4000-character persistence boundary, with explicit truncation.
- Public timeout diagnosis must retain separate local/server/tunnel/public timestamps; no speculative restart.

## Review focus

- Credentials, quoted JSON, private keys, device codes, private paths and C0/C1 controls cannot survive persisted reports.
- Long Unicode reports stay bounded and reload safely.
- Unknown structured BLOCKED stays failed; explicit BLOCKER:NONE retains existing behavior.
- Late resolved output cannot overwrite cancellation or produce a completion notification.
- Report text must never become a tool-success or skill/MCP invocation observation.

## Task 1: Safe blocked report regression and fix

**Files:** `scripts/agent-blocked-evidence-test.ts`, `src/server/remote-troubleshooting.ts`, `src/server/agent-service.ts`, `scripts/core-test-runner.mjs` if required for registration.

**Interfaces:** Existing AgentJob `result`, `error`, `status`, `tools`, tokenUsage and executionReceipt; no new schema or capability.

- [x] Add a synthetic successful runner report that is blocked; assert failed status, retained safe evidence and argument-free starts.
- [x] Observe missing-result RED before implementation.
- [x] Add redaction/restart/foreign-scope, unknown/NONE, late-cancel and completed/thrown-failure cases.
- [x] Implement structured blocked recognition and sanitization, retaining safe metadata and failed semantics.
- [ ] Run the same focused test GREEN, Core/default/strict checks and final independent diff review.
- [ ] Commit only related files and synchronize the validated commit.

## Task 2: Same-identity release evidence

**Files:** Version/manifest/lock fields and existing release evidence workflow only.

- [ ] Read back MP-363 exact same-route boundary with bounded probes and logs; preserve unknown causes.
- [ ] Build/package from committed clean source, inspect ZIP identity/permissions and validate runtime candidate before replacement.
- [ ] Use the existing catalog update route and existing sessions where gates permit; no duplicate old job or permission change.
- [ ] Compare safe tool results in one new same-release synthetic job if public/runtime gates permit.
- [ ] Keep blocked gates explicit; no readiness, Jira Done or completion message without required evidence.
