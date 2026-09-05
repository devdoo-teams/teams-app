# Azure TeamsApp Platform Implementation Plan

## Goal

Use the Teams chat and personal tab as the user interface for a durable Azure-hosted agent platform without interrupting the existing service. Teams Core owns authenticated scope and orchestration; Codex workers and approved remote agents such as Hermes A2A, a Grok-backed agent, and concrete Buzz relay/ACP actions participate through explicit provider adapters. GitHub remains the source/build ledger, Azure DevOps owns deployment approval and promotion, Azure Container Apps hosts Core, Cosmos DB and Storage Queue provide shared durable state, and Linux workers execute local CLI agents.

## Global Constraints

- Keep `https://q3kj3s3z-3980.jpe1.devtunnels.ms` serving the current production release until every Azure same-release gate passes.
- Do not bump the Teams package version for infrastructure, documentation, audit, or blocked deployment work.
- Never put secrets, credentials, device codes, tokens, connection strings, or `auth.json` in Git, build artifacts, logs, migration bundles, or Teams packages.
- GitHub builds and publishes immutable artifacts. Azure DevOps is the sole authority for Azure deployment and environment promotion.
- The Azure runtime subscription is `0e58c3cb-474d-4e70-978a-4939c586f867`, region `koreacentral`, and the second subscription is not modified.
- Free-first defaults: one scale-to-zero Container App canary, one Cosmos DB free-tier account when eligible, Storage Queue, Key Vault, Application Insights, and one `Standard_B2ats_v2` Linux worker VM.
- The Container App must not execute Codex, Hermes, Buzz, or other CLI child processes. It dispatches durable work to VM workers or calls explicitly registered HTTPS provider adapters.
- File JSON remains a local compatibility backend. Azure mode must use explicit configuration and fail closed when required Azure resources are absent.
- Preserve all accepted records during migration. Export, hash, import idempotently, reconcile counts and stable IDs, then retain a rollback bundle.
- A deployment is not complete until commit, version, image digest, Teams ZIP SHA-256, public runtime identity, Azure revision, installed Teams version, desktop UI, and mobile evidence all identify the same release.
- Core and optional providers remain separate. No optional provider is advertised as ready until startup preflight and one bounded live round trip prove its real identity, capability, receipt, cancellation/recovery behavior, and nonempty result.
- Hermes uses its official A2A v1 endpoint as the preferred direct integration. Buzz relay/CLI/ACP, GitHub agent-tasks REST, and xAI/Grok are distinct transports and must not be mislabeled as native A2A.
- GitHub's `@GitHub` Microsoft Teams integration is an out-of-band first-party workflow, not an embeddable TeamsApp backend API. Direct backend use, if enabled, uses the documented preview agent-tasks REST contract with user-to-server authentication.

## Task 1: Azure platform contract, Bicep, and pipeline ownership

Files:
- Create `infra/azure/main.bicep`
- Create `infra/azure/modules/*.bicep`
- Create `infra/azure/parameters/canary.bicepparam`
- Create `azure-pipelines.yml`
- Create `scripts/azure-platform-contract-test.mjs`
- Create `scripts/azure-release-input.mjs`
- Create `scripts/azure-release-input-test.mjs`
- Update `package.json`
- Update `.env.example`

Requirements:
1. Write tests first that execute the release-input validator and inspect compiled Bicep/YAML behavior, not mere source-line presence.
2. Bicep provisions resource-group-scoped ACA environment/app, ACR, Cosmos DB, Storage account/queue/file share, Key Vault, Log Analytics/Application Insights, managed identities, and a Linux VM using `Standard_B2ats_v2`.
3. Use managed identities and RBAC; do not emit secrets or connection strings as outputs.
4. The Container App scales to zero and receives only secret references/identity-based endpoints.
5. The Azure DevOps pipeline consumes a GitHub-produced release receipt containing commit, version, image digest, ZIP SHA-256, and client/server digests; validates the receipt; requires an Azure DevOps environment approval; deploys by immutable image digest; verifies revision readiness and public identity; and supports rollback to the previous revision.
6. GitHub workflow changes, if any, stop before Azure deployment and publish the immutable receipt as the handoff artifact.

Verification:
- `npm run test:azure-platform-contract`
- `npm run test:azure-release-input`
- `npm run typecheck:core`

## Task 2: Provider-neutral durable lifecycle and Hermes A2A adapter

Files:
- Create `src/server/provider-runtime-adapter.ts`
- Create `src/server/provider-lifecycle-runner.ts`
- Create `src/server/hermes-a2a-adapter.ts`
- Create focused tests under `scripts/`
- Update only the minimum A2A composition points required to register the adapter

Requirements:
1. Add contract tests first for preflight, durable submitting/accepted receipts, request-hash idempotency, delivery-unknown recovery, unknown-state quarantine, timeout, cancellation, input/auth-required states, and nonempty completion evidence.
2. Preserve server-derived Teams tenant/requester/conversation scope and keep provider, credential principal, execution, context/session, runtime boundary, artifact, and audit identities distinct.
3. Keep raw provider state beside canonical A2A state; never guess unknown states.
4. Implement Hermes through its official A2A v1 Agent Card and Send/Get/Cancel contracts. Require configured HTTPS origin, expected peer identity, bearer-token reference, capability negotiation, task/context continuity, and artifact/result validation.
5. The existing local Core/Codex path remains unchanged by default. Hermes registration is explicit and fail closed.
6. Do not introduce native Buzz, GitHub, or Grok assumptions into this shared lifecycle.

Verification:
- focused adapter/lifecycle/Hermes tests
- existing A2A remote client, adapter, roster, production collaboration, cancellation, and recovery suites
- `npm run test:core`

## Task 3: Shared Cosmos state, durable queue dispatch, and Linux Codex worker

Files:
- Create `src/server/storage/runtime-store.ts`
- Create `src/server/storage/cosmos-runtime-store.ts`
- Create `src/server/storage/runtime-store-factory.ts`
- Create `src/server/queue/agent-dispatch-queue.ts`
- Create `src/server/queue/azure-agent-dispatch-queue.ts`
- Create `src/worker/index.ts`
- Create `scripts/azure-worker-contract-test.ts`
- Create `infra/azure/cloud-init/codex-worker.yml`
- Update server composition and package scripts

Requirements:
1. Add storage contract tests first for scoped reads, idempotent writes, optimistic concurrency, rollback on persistence failure, and tenant/user isolation.
2. Keep file JSON as the default compatibility backend. Select Cosmos only with explicit configuration and `DefaultAzureCredential`; never accept a checked-in account key.
3. Move mutable stores behind the shared boundary incrementally and report migration completeness in health. Do not claim horizontal safety while any authoritative mutable store remains process-local.
4. Write failing queue tests for enqueue, lease, heartbeat, checkpoint, completion receipt, explicit error receipt, cancellation, visibility-timeout recovery, and duplicate-delivery idempotency.
5. ACA only enqueues local CLI jobs and observes durable receipts; it never spawns a CLI process.
6. The VM worker uses managed identity for queue/state access and an owner-only `AGENT_CODEX_HOME`; authentication material is provisioned out of band and never copied into images or cloud-init.
7. A process exit without a nonempty terminal receipt is failure, never completion.
8. Codex is sourced only from a versioned official `openai/codex` Linux package. Authenticate the package archive SHA-256, validate `codex-package.json`, execute the extracted binary on Linux to confirm the expected version, retain the companion runtime files, and keep the archive and binary SHA-256 values distinct through the pipeline and VM installer.

Verification:
- focused queue/worker tests
- `npm run test:azure-codex-package`
- existing A2A execution, cancellation, restart, telemetry, and isolation suites
- `npm run test:core`

## Task 4: Teams Core chat and tab orchestration surface

Files:
- Add a narrow authenticated Core orchestration HTTP facade
- Add a React Teams personal-tab orchestration panel
- Extend the Teams bot command manifest and Adaptive Cards
- Add focused server and client tests

Requirements:
1. Tests first cover submit, get/list, cancel, approval/input-required, retry, duplicate submission, invalid input, unavailable provider, empty state, error state, and mobile fallback guidance.
2. The server derives tenant/requester/conversation scope. Client fields cannot redirect scope.
3. Chat and tab use the same orchestration application service and durable task identity.
4. The tab is Core React/TeamsJS and must not depend on CopilotKit or MCP UI.
5. Every registered provider exposes only measured capabilities and availability. No fixture-only provider is presented as live.
6. Adaptive Card responses remain attachment-only and use the canonical Microsoft Teams Adaptive Cards 1.6 contract with the repository-approved mobile-safe subset.

Verification:
- focused Core orchestration API/UI tests
- existing Teams chat regression, security scope, GenUI, tab route, and client suites
- `npm run test:core`

## Task 5: Optional Grok, Buzz, and GitHub provider adapters

Files:
- Create separate adapters and tests only for documented provider contracts
- Extend explicit provider registry/configuration
- Update optional build/test scripts

Requirements:
1. Grok remains an xAI-backed response/agent transport behind an optional feature flag and explicit credential reference. A model response alone is not a durable agent completion.
2. Buzz support must target an approved concrete use case: allowlisted `buzz-cli` JSON action, signed relay event, or Buzz-hosted ACP session. Preserve signer, event, channel/thread, community, and relay receipt identities. Do not describe Buzz as A2A.
3. GitHub cloud agent support uses the documented preview agent-tasks REST API with user-to-server auth, entitlement/repository preflight, polling, state translation, and durable result/artifact identity. Cancel/steer remain unsupported unless official endpoints exist.
4. GitHub's separate `@GitHub` Teams app is linked as an out-of-band collaboration option and never counted as a TeamsApp child execution.
5. Hermes HTTP/ACP/CLI are explicit fallback adapter kinds, never automatic downgrade paths from Hermes A2A.
6. Each optional adapter fails closed when configuration or live preflight is missing and is excluded from default Core build/runtime.

Verification:
- focused optional adapter tests
- `npm run test:optional`
- `npm run build:optional`
- provider-specific bounded live checks before any ready claim

## Task 6: Full-preservation migration, integrated gates, and rollback

Files:
- Create `scripts/azure-state-export.mjs`
- Create `scripts/azure-state-import.mjs`
- Create `scripts/azure-state-reconcile.mjs`
- Create `scripts/azure-state-migration-test.mjs`
- Create `docs/azure-state-migration-runbook.md`
- Create or update Azure deployment/runbook documentation
- Extend release gate tests and scripts only as required

Requirements:
1. Tests first cover malformed records, duplicate IDs, retries, partial failure, hash mismatch, tenant isolation, and repeatable import.
2. Export creates a manifest of record counts, stable IDs, source commit, schema versions, and SHA-256 digests without secrets.
3. Import is dry-run by default and requires an explicit apply flag.
4. Reconciliation must prove counts, IDs, and content hashes before cutover.
5. Rollback preserves the pre-import Azure snapshot and the immutable local export bundle.
6. One non-mutating command validates Azure configuration, immutable handoff receipt, official Bicep build, migration readiness, Core build/tests, Teams package identity, provider readiness classification, and public canary identity.
7. Promotion requires explicit Azure DevOps environment approval and leaves the current Dev Tunnel untouched until all gates pass.
8. Jira mappings are required for every reproduced defect or release blocker.

Verification:
- `npm run test:azure-state-migration`
- secret scan over migration fixture artifacts
- existing store hardening suites
- focused workflow tests
- `npm run release:preflight`
- `npm run build:core`
- `npm run test:core`
- `npm run validate:manifest`
- `npm run test:package-determinism`

## Task 7: Provision, deploy, and verify the Azure canary

Requirements:
1. Install/authenticate the official Azure CLI without storing credentials in the repository.
2. Confirm current tenant and exact target subscription before any mutation.
3. Provision with reviewed Bicep using a what-if first.
4. Configure Azure DevOps service connection/environment approval and deploy the immutable GitHub artifact.
5. Migrate state with export, dry-run, apply, and reconcile evidence.
6. Verify ACA health/tab/assets, one live authenticated Codex worker round trip, Hermes A2A and every enabled optional provider round trip, cancellation/restart recovery, Teams registration/package identity, desktop UI matrix, and mobile evidence.
7. Only after every gate passes, switch the Teams endpoint and send the completion report in Teams.

External mutations in this task require action-time confirmation where the browser or service requires it. If blocked, retain the existing service and report the exact gate.
