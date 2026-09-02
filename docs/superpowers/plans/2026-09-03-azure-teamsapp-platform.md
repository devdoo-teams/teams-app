# Azure TeamsApp Platform Implementation Plan

## Goal

Move the Teams Core runtime from the temporary Dev Tunnel architecture to a reproducible Azure canary without interrupting the existing service. GitHub remains the source/build ledger, Azure DevOps owns deployment approval and promotion, Azure Container Apps hosts Core, Cosmos DB and Storage Queue provide shared durable state, and one Linux VM hosts the first authenticated Codex worker.

## Global Constraints

- Keep `https://q3kj3s3z-3980.jpe1.devtunnels.ms` serving the current production release until every Azure same-release gate passes.
- Do not bump the Teams package version for infrastructure, documentation, audit, or blocked deployment work.
- Never put secrets, credentials, device codes, tokens, connection strings, or `auth.json` in Git, build artifacts, logs, migration bundles, or Teams packages.
- GitHub builds and publishes immutable artifacts. Azure DevOps is the sole authority for Azure deployment and environment promotion.
- The Azure runtime subscription is `0e58c3cb-474d-4e70-978a-4939c586f867`, region `koreacentral`, and the second subscription is not modified.
- Free-first defaults: one scale-to-zero Container App canary, one Cosmos DB free-tier account when eligible, Storage Queue, Key Vault, Application Insights, and one `Standard_B2ats_v2` Linux worker VM.
- The Container App must not execute Codex CLI child processes. It dispatches durable work to the VM through a queue-backed lease contract.
- File JSON remains a local compatibility backend. Azure mode must use explicit configuration and fail closed when required Azure resources are absent.
- Preserve all accepted records during migration. Export, hash, import idempotently, reconcile counts and stable IDs, then retain a rollback bundle.
- A deployment is not complete until commit, version, image digest, Teams ZIP SHA-256, public runtime identity, Azure revision, installed Teams version, desktop UI, and mobile evidence all identify the same release.
- Core and optional providers remain separate. Grok is outside this release.

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

## Task 2: Shared persistence abstraction and Cosmos DB backend

Files:
- Create `src/server/storage/runtime-store.ts`
- Create `src/server/storage/cosmos-runtime-store.ts`
- Create `src/server/storage/runtime-store-factory.ts`
- Create focused tests under `scripts/`
- Update only the minimum server composition points required to select the backend
- Update `package.json` and lockfile only for required official Azure SDK packages

Requirements:
1. Add contract tests first for scoped reads, idempotent writes, optimistic concurrency, rollback on persistence failure, and tenant/user isolation.
2. Keep the file backend as the default compatibility backend.
3. Select Cosmos only with explicit `TEAMS_STORAGE_BACKEND=azure-cosmos` plus required endpoint/database/container settings.
4. Use managed identity via `DefaultAzureCredential`; do not accept a checked-in account key.
5. Health reports the selected backend and degraded/unavailable state without exposing endpoints or credentials.
6. Do not claim horizontal safety until every mutable store has moved to the shared abstraction; expose migration completeness in health.

Verification:
- focused runtime-store tests
- `npm run test:atomic-stores`
- `npm run test:core`

## Task 3: Durable queue dispatch and Linux Codex worker

Files:
- Create `src/server/queue/agent-dispatch-queue.ts`
- Create `src/server/queue/azure-agent-dispatch-queue.ts`
- Create `src/worker/index.ts`
- Create `scripts/azure-worker-contract-test.ts`
- Create `infra/azure/cloud-init/codex-worker.yml`
- Update server composition and package scripts

Requirements:
1. Write failing contract tests for enqueue, lease, heartbeat, completion receipt, explicit error receipt, cancellation, visibility timeout recovery, and duplicate-delivery idempotency.
2. ACA only enqueues jobs and observes durable receipts; it never spawns Codex.
3. The VM worker uses managed identity for queue/state access and an owner-only `AGENT_CODEX_HOME`; authentication material is provisioned out of band and never copied into images or cloud-init.
4. Every job has a stable task ID, lease owner, checkpoint, heartbeat, terminal result/error, and reconciliation path.
5. A process exit without a non-empty terminal receipt is failure, never completion.

Verification:
- focused queue/worker tests
- existing A2A execution, cancellation, restart, telemetry, and isolation suites
- `npm run test:core`

## Task 4: Full-preservation migration, backup, and rollback

Files:
- Create `scripts/azure-state-export.mjs`
- Create `scripts/azure-state-import.mjs`
- Create `scripts/azure-state-reconcile.mjs`
- Create `scripts/azure-state-migration-test.mjs`
- Create `docs/azure-state-migration-runbook.md`

Requirements:
1. Tests first cover malformed records, duplicate IDs, retries, partial failure, hash mismatch, tenant isolation, and repeatable import.
2. Export creates a manifest of record counts, stable IDs, source commit, schema versions, and SHA-256 digests without secrets.
3. Import is dry-run by default and requires an explicit apply flag.
4. Reconciliation must prove counts, IDs, and content hashes before cutover.
5. Rollback preserves the pre-import Azure snapshot and the immutable local export bundle.

Verification:
- `npm run test:azure-state-migration`
- secret scan over migration fixture artifacts
- existing store hardening suites

## Task 5: Integrated release gate and operator documentation

Files:
- Create or update Azure deployment/runbook documentation
- Extend release gate tests and scripts only as required
- Update GitHub/Azure DevOps workflow contracts

Requirements:
1. One command must validate Azure configuration, immutable handoff receipt, Bicep build, migration readiness, Core build/tests, Teams package identity, and public canary identity.
2. The command must not deploy or mutate Azure by default.
3. Promotion requires an explicit Azure DevOps environment approval and must leave the current Dev Tunnel untouched until all gates pass.
4. Record exact rollback commands and same-release evidence fields.
5. Jira mappings are required for any reproduced defect or release blocker before release completion.

Verification:
- focused workflow tests
- `npm run release:preflight`
- `npm run build:core`
- `npm run test:core`
- `npm run validate:manifest`
- `npm run test:package-determinism`

## Task 6: Provision, deploy, and verify the Azure canary

Requirements:
1. Install/authenticate the official Azure CLI without storing credentials in the repository.
2. Confirm current tenant and exact target subscription before any mutation.
3. Provision with reviewed Bicep using a what-if first.
4. Configure Azure DevOps service connection/environment approval and deploy the immutable GitHub artifact.
5. Migrate state with export, dry-run, apply, and reconcile evidence.
6. Verify ACA health/tab/assets, one live authenticated Codex worker round trip, cancellation/restart recovery, Teams registration/package identity, desktop UI matrix, and mobile evidence.
7. Only after every gate passes, switch the Teams endpoint and send the completion report in Teams.

External mutations in this task require action-time confirmation where the browser or service requires it. If blocked, retain the existing service and report the exact gate.
