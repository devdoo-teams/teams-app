# Task 2 Report — Provider lifecycle and Hermes A2A v1

## STATUS

PASS for the bounded Task 2 implementation and local verification. The provider-neutral durable lifecycle, official Hermes A2A v1 adapter, existing `A2AProductionAgent` integration, explicit roster registration, and fail-closed configuration are implemented on `codex/azure-platform-20260903` from base `fe1a88b318560c8649583b1de1216514d368b90b`.

This is not a live Azure, Hermes, or Teams release claim. No version, Teams package, Azure resource, Dev Tunnel, remote service, or Git remote was changed.

## EVIDENCE

### TDD RED

- Provider contract: the first `npm run test:provider-lifecycle` failed because `src/server/provider-runtime-adapter.ts` did not exist. This established the provider-neutral adapter/lifecycle seam before production implementation.
- Provider hardening: focused tests subsequently failed on missing opaque credential-reference validation, unbounded provider calls, receipt continuity, unsafe durable fields, lease recovery, and reopened-store validation before those protections were implemented.
- Hermes production binding: `npm run test:provider-lifecycle` failed because `createHermesA2AProductionAgent` was not exported.
- Hermes explicit registration: the same command failed with `ERR_MODULE_NOT_FOUND` for `src/server/hermes-a2a-registration.js`.
- Hermes roster contract: `npm run test:a2a-remote-roster` failed with `peer contains an unsupported field` when `expectedPeerIdentity` and `credentialPrincipal` were first added to the test fixture.
- Nonterminal cancellation: `npm exec -- tsx scripts/hermes-a2a-production-agent-test.ts` failed with the fixture cancellation error while an input-required task was paused; production handling was then changed to persist and invoke official cancellation rather than collapse the task to success or failure.

### GREEN

- Baseline before Task 2: `npm run test:core` passed at base `fe1a88b318560c8649583b1de1216514d368b90b`.
- Focused lifecycle/Hermes: `npm run test:provider-lifecycle` — exit 0; runtime adapter, lifecycle runner, Hermes adapter, Hermes production agent, and Hermes registration tests all PASS.
- Focused strict compile: `npx tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --types node ...` for all Task 2 source/tests — exit 0.
- Release TypeScript graph: `npx tsc --noEmit -p tsconfig.release.json` — exit 0.
- Existing official remote seam: `test:a2a-remote-client`, `test:a2a-remote-agent-adapter`, `test:a2a-remote-http-roundtrip`, and `test:a2a-remote-roster` — all PASS.
- Existing orchestration/recovery: `test:a2a-production-collaboration`, `test:a2a-parent-lifecycle`, `test:a2a-durable-dispatch`, `test:a2a-orchestrator`, and `test:a2a-index-integration` — all PASS.
- Existing cancellation/durability: `test:a2a-deadline-cancellation`, `test:a2a-cancel-idempotency`, and `test:a2a-submission-durability` — all PASS.
- Full Core: `npm run test:core` — exit 0, pinned to clean commit `3d2ecb690034e58b26a2633d02b9f05caa7bdd05`; ended with `PASS: bounded Teams core test suite completed without optional API/MCP paths`.
- Core compile/build: `npm run typecheck:core` — exit 0; `npm run build:core` — exit 0, client and server bundles both pinned to `3d2ecb690034e58b26a2633d02b9f05caa7bdd05`.
- Diff hygiene: `git diff --check fe1a88b318560c8649583b1de1216514d368b90b..3d2ecb690034e58b26a2633d02b9f05caa7bdd05` — exit 0.
- One earlier full-Core run stopped at `release-loop-test.mjs:2031` because the branch HEAD advanced from `39de964` to `3d2ecb6` during its commit-identity fixture. The isolated test passed at stable HEAD, and the complete stable-HEAD rerun passed; no release-loop production change was made.

## COMPLETED

### Provider-neutral lifecycle

- Added `ProviderRuntimeAdapter` with explicit preflight, submit, get, cancel, optional documented reconciliation, raw-to-canonical classification, observation validation, bounded redaction, and immutable completion-evidence checks.
- Added durable lifecycle records for server-derived Teams scope plus separate provider, credential principal/reference, execution, context/session, runtime boundary, artifact, and audit identities.
- Persisted `submitting` before provider `SendMessage` and the complete accepted receipt before `bindChild` and polling.
- Enforced same scoped idempotency key plus same request hash as reconciliation; a different hash fails with `IDEMPOTENCY_CONFLICT` before another submit.
- Added receipt/task/session/context continuity, CAS revisions, operation leases, bounded preflight/submit/get/cancel calls, cancellation intent, recovery scanning, atomic rollback, and fail-closed reload validation.
- Kept input-required and auth-required nonterminal. Unknown raw states, unsafe responses, invalid completion evidence, and delivery-unknown states are quarantined; they are never guessed into completion.
- Completion requires a documented terminal-success state and a nonempty validated result or immutable/content-addressed artifact.

### Hermes official A2A v1

- Added exact HTTPS-origin configuration, Agent Card discovery, expected peer-name pinning, JSON-RPC protocol version `1.0`, text mode and bearer-security validation, skill/tag capability negotiation, and bounded Agent Card revalidation.
- Used the existing official client for `SendMessage`, `GetTask`, and `CancelTask`; no public route or parallel task protocol was added.
- Rejected direct-message responses because this lifecycle requires a durable task receipt.
- Preserved provider task/context identity through polling, recovery, and cancellation; retained validated artifact and audit references.
- Stored only the opaque `env://<TOKEN_ENV_NAME>` credential reference. Token values are resolved at the call boundary and are absent from lifecycle records, failures, and health facts.
- Bound Hermes to the existing `A2AProductionAgent` seam. Input/auth pauses remain durable and nonterminal while recovery polling continues; cancellation uses the persisted receipt.

### Explicit composition and default compatibility

- Extended only `kind=hermes` roster entries with required `expectedPeerIdentity` and `credentialPrincipal`; existing generic `a2a` and `grok-hermes` entries retain their prior path.
- Added isolated per-peer Hermes startup registration. A bad card, missing token reference, identity mismatch, or unsupported capability yields only a safe `CONFIGURATION_ERROR` health fact and does not disable healthy peers.
- Added `PROVIDER_LIFECYCLE_STORE_PATH` under the existing single-process store lease only when at least one Hermes peer is explicitly configured.
- With no Hermes roster entry, no lifecycle store is created and the existing Core/file/local Codex behavior remains the default.
- Package and Teams manifest versions remain `1.0.100`; no ZIP was created or uploaded.

## FILES

- Provider lifecycle: `src/server/provider-runtime-adapter.ts`, `src/server/provider-lifecycle-runner.ts`.
- Hermes transport/production binding: `src/server/hermes-a2a-adapter.ts`, `src/server/hermes-a2a-registration.ts`.
- Existing composition seams: `src/server/a2a-remote-roster.ts`, `src/server/index.ts`.
- Focused tests: `scripts/provider-runtime-adapter-test.ts`, `scripts/provider-lifecycle-runner-test.ts`, `scripts/hermes-a2a-adapter-test.ts`, `scripts/hermes-a2a-production-agent-test.ts`, `scripts/hermes-a2a-registration-test.ts`, `scripts/a2a-remote-roster-test.ts`.
- Test/config documentation: `scripts/core-test-runner.mjs`, `package.json`, `.env.example`, `docs/api-free-teams-roadmap.md`.

## COMMITS

- `7647b2ec305d4d5300387977c470c66499317ebd` — provider lifecycle contract.
- `0e67b7845347dda0a9f542d1a7ac4df30da0ba41` — lifecycle recovery hardening.
- `3a0a309eada711d963cb3b441fac8cfa86295f4c` — race, lease, validation, and store hardening.
- `228077e554a3d6fd1e778c7c60fac51353526ab1` — durable Hermes A2A v1 adapter, production binding, registration, composition, and focused tests.
- `f0e06b34bb707b5e375170d3c75d4196cef1de35` — reopened lifecycle evidence validation.
- `39de964c956203d81aa5fb46e37710c10d215fd2` — poisoned receipt/artifact regressions.
- `3d2ecb690034e58b26a2633d02b9f05caa7bdd05` — provider lifecycle review closeout report.

## SELF-REVIEW

- Scope/identity: Teams scope comes only from the existing production-agent input and is never replaced by provider data. Provider, credential principal/reference, execution, context, boundary, artifact, and audit IDs remain distinct persisted fields.
- Durability/idempotency: verified intent-before-Send, receipt-before-bind/poll, replay without second `SendMessage`, hash conflict rejection, restart recovery, durable cancellation, file rollback, and lease release after failed poll/reconciliation.
- Protocol/state: verified only official A2A v1 card and JSON-RPC methods for Hermes. Unknown states quarantine; input/auth are nonterminal; task/context mismatch fails closed.
- Completion: verified blank result/artifact rejection, content digest checks, unsafe URI rejection, and terminal replay without duplicate provider I/O.
- Security: no real credential was introduced. Tests use explicit fixture strings; production records only environment references. Provider text, errors, audit refs, URLs, reopened records, and artifacts are bounded and checked for credential material.
- Compatibility: full Core, existing generic remote A2A, collaboration, cancellation, recovery, typecheck, and build passed. No existing public route was changed or duplicated.
- Release boundary: source/package/manifest version remains unchanged as required. No release, upload, deployment, tunnel, browser, Jira, or push action occurred.

## BLOCKER

None for the bounded local Task 2 implementation.

## LIVE-UNVERIFIED BOUNDARIES

- No real Hermes endpoint, Agent Card, bearer credential, provider task, cancellation, or restart recovery was exercised. Hermes evidence is fixture-only.
- No Azure Cosmos/Queue/VM/Container Apps resource was provisioned or contacted. The lifecycle store is still `file-json-single-process`; shared multi-replica durability belongs to the later storage/platform task.
- No installed Teams desktop/mobile UI, public Bot reply, package upload, or same-release runtime was exercised. Task 2 is not `DESKTOP_READY`, `MOBILE_READY`, or a release completion.
- Receiptless Hermes delivery remains quarantined because this adapter has no documented exact-correlation lookup that safely proves which task a lost `SendMessage` response created; it never blind-resubmits.
- Task 2 adds no user-facing input/auth continuation surface. Such provider states remain durable and nonterminal until the peer progresses, the deadline expires, or cancellation is requested.

## NEXT ACTION

Task 3 may replace the file lifecycle store with the accepted shared transactional storage port and recovery worker. Live Hermes readiness requires separately approved real endpoint/credential configuration and same-run Teams/Azure evidence; it must not reuse these fixture results.

## FINAL ACCEPTANCE ADDENDUM — 2026-09-03

The initial closeout above was reopened by independent review. The final bounded acceptance identity is `fa5e7019195aef36185be5758aeb8ca30dd1534e`, not `3d2ecb690034e58b26a2633d02b9f05caa7bdd05`.

Additional reviewed fixes:

- `263e8443fefebaae3e064e6e5738c107e8bb7576` — official A2A v1 security schema, selected interface/origin validation, and terminal cancellation acknowledgement.
- `0e9470cab4f3dddeacfe7d5d298c5ac7f85bdb5c` — persisted lifecycle validation, credential URI filtering, byte-exact artifacts, and bounded accepted callbacks.
- `66788097e3a0d0f2f45600d19cedc9eceeadde2e` — route validation before credential resolution, first-supported interface selection, tenant propagation, and optional capability handling.
- `1881c1ceb7e48752245c07b54bdbed09da982a1a` — missing receipts, invalid states, nested credential values, repeated URI encoding, and callback cancellation generation handling.
- `185d348e9e1bfb78efa7123e4e1c71a7c9be2f6c` — IPv6 literal/redirect validation, JSON-RPC response correlation, nonselected interface isolation, and child Agent Card schema validation.
- `fa5e7019195aef36185be5758aeb8ca30dd1534e` — immutable receipt execution binding, sensitive non-string primitive rejection, and legacy/custom-store compatibility.

Committed-tree verification at `fa5e701`:

- `npm run test:provider-lifecycle` — PASS.
- `npm run test:a2a-remote-client` — PASS.
- `npm run typecheck:core` — PASS.
- Full `npm run test:core` passed at the preceding clean integration identity `0e9470c`; the final acceptance commits were then covered by the focused suites and two independent bounded reviews. A new full-Core run remains required after Task 3 integration.
- Independent lifecycle acceptance — PASS for MP-222, MP-223, MP-224, MP-227, MP-230, and MP-231.
- Independent Hermes/A2A acceptance — PASS for MP-225, MP-226, MP-228, and MP-232 through MP-238.

Jira issues MP-222 through MP-228, MP-230 through MP-238 were updated with the final local evidence and moved to `In Review`, not `Done`. Live Hermes, Azure, package, public runtime, Teams desktop, and Teams mobile evidence remain unverified.
