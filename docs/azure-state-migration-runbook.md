# Azure state migration and cutover runbook

This runbook covers the Task 6 migration gate only. It does not provision Azure, change a Teams endpoint, upload a package, stop Dev Tunnel, or promote a release. The current Dev Tunnel and the local file backend remain compatible and unchanged unless an operator later performs the separately approved Task 7 actions.

## Evidence boundary

The migration scripts distinguish these classes:

- `local-contract` and `local-fixture` prove only local parsing, hashing, retry, rollback, and gate behavior.
- A `DefaultAzureCredential`-backed Cosmos client still emits `evidenceClass=local-contract` until an authenticated producer verifier exists. Its unsigned diagnostic receipt binds the credential-free endpoint, database, container, bundle hash, and source commit, but cannot authorize promotion.
- `attested-github-artifact`, Azure DevOps approval, provider, canary, and Jira claims require an authenticated producer query or a producer-signed/attested receipt verifier before they can become promotion evidence.

No caller-supplied `evidenceClass`, unsigned local JSON file, local fixture, successful unit test, or Bicep build is live Azure, public-runtime, Teams, provider, approval, or Jira evidence. The current local JSON join therefore ends `AZURE_LIVE_EVIDENCE_UNVERIFIED`; it cannot return `READY` until an authenticated producer verifier is implemented and release/environment-bound.

## Bundle contract

`azure-state-export.mjs` reads the current local `AgentJob` JSON array and creates a new immutable directory containing:

- `manifest.json`: source commit, schema versions, total/per-tenant counts, sorted stable IDs, and SHA-256 digests;
- `records.ndjson`: one canonical `RuntimeStore` document for each accepted AgentJob in the server-owned durable-ledger partition.

The export rejects malformed records, duplicate stable IDs, cross-tenant parent links, invalid content hashes, credential-shaped fields, bearer/JWT/private-key-shaped values, and non-JSON data. It never redacts a record because redaction would violate full preservation; it fails before writing instead. Existing output directories are never overwritten.

Example local export:

```bash
npm run azure:state-export -- \
  --source /absolute/path/to/agent-jobs.json \
  --source-commit 0123456789abcdef0123456789abcdef01234567 \
  --output /absolute/path/to/immutable-agent-job-export
```

Do not place migration bundles in Git, build artifacts, Teams packages, logs, or a shared temporary directory. Retain the immutable source bundle until rollback is no longer required.

## Dry-run and apply

Import defaults to dry-run. Without Azure configuration it validates the bundle offline and reports `targetObservation=UNVERIFIED`. With the identity-based Cosmos settings present, dry-run reads the live target and reports planned creates, unchanged records, or conflicts without mutation.

```bash
npm run azure:state-import -- --bundle /absolute/path/to/immutable-agent-job-export
```

Apply requires `--apply`, a new `--snapshot-output` path, and a new `--receipt` path. Before the first create, the importer reads the complete AgentJob ledger partition and writes an immutable pre-import Azure snapshot. It then creates `<receipt>.ledger/` and atomically appends immutable intent/outcome checkpoints around every record mutation. The final requested receipt is written only as an immutable terminal `APPLIED` or `PARTIAL` record. Transient 408/429/5xx writes use bounded retries. Permanent failures produce a durable `PARTIAL` receipt with completed/failed stable IDs and require another idempotent import followed by reconciliation; partial success is never cutover evidence.

```bash
npm run azure:state-import -- \
  --bundle /absolute/path/to/immutable-agent-job-export \
  --apply \
  --snapshot-output /absolute/path/to/immutable-pre-import-azure-snapshot \
  --receipt /absolute/path/to/import-receipt.json
```

The Cosmos CLI path accepts only `TEAMS_STORAGE_BACKEND=cosmos`, `AZURE_COSMOS_ENDPOINT`, `AZURE_COSMOS_DATABASE`, `AZURE_COSMOS_CONTAINER`, and optional `AZURE_CLIENT_ID`. It uses `DefaultAzureCredential`; account keys and connection strings are rejected. Authentication is an operator-owned external prerequisite and must never be copied into the export, snapshot, receipt, report, or logs.

## Reconciliation

Reconciliation is mandatory after every successful or retried apply. It reads the live AgentJob ledger partition and proves exact total count, sorted stable IDs, per-record content hashes, aggregate ID hash, aggregate content hash, partition identity, and tenant ownership before writing a new immutable receipt.

```bash
npm run azure:state-reconcile -- \
  --bundle /absolute/path/to/immutable-agent-job-export \
  --receipt /absolute/path/to/live-azure-reconciliation.json
```

A reconciliation receipt includes the exact bundle/source commit and observed hashes. The unsigned local receipt alone cannot satisfy the Azure migration gate even when it came from an authenticated observation; a later authenticated producer verifier must bind that observation to the same release handoff.

## Rollback

Keep both the original local export and the pre-import Azure snapshot immutable. Preview rollback first:

```bash
npm run azure:state-import -- \
  --rollback-snapshot /absolute/path/to/immutable-pre-import-azure-snapshot
```

After the required Azure DevOps environment approval and action-time authorization, apply rollback explicitly:

```bash
npm run azure:state-import -- \
  --rollback-snapshot /absolute/path/to/immutable-pre-import-azure-snapshot \
  --apply \
  --receipt /absolute/path/to/rollback-receipt.json
```

Rollback restores the exact application document envelopes captured before import and removes records absent from that snapshot. It uses the same immutable per-record receipt ledger and returns durable `PARTIAL` evidence rather than throwing away progress when a target mutation fails. Reconcile the rollback snapshot afterward. Do not switch or stop the current Dev Tunnel as part of migration or rollback.

## Integrated non-mutating preflight

The normal `npm run release:preflight` remains the existing local/Dev Tunnel-compatible gate. Set `TEAMS_RELEASE_TARGET=azure` only for the Azure promotion candidate. Azure mode adds migration tests, manifest validation, package determinism, and a final evidence join after the existing Core build/tests, deployment configuration check, and official Bicep compilation contract.

Azure mode requires paths to these already-created immutable inputs:

- `AZURE_RELEASE_RECEIPT_PATH`
- `AZURE_HANDOFF_PROVENANCE_PATH`
- `AZURE_TEAMS_PACKAGE_PATH`
- `AZURE_MIGRATION_BUNDLE_PATH`
- `AZURE_MIGRATION_RECONCILIATION_RECEIPT_PATH`
- `AZURE_APPROVAL_RECEIPT_PATH`
- `AZURE_PROVIDER_READINESS_RECEIPT_PATH`
- `AZURE_PUBLIC_CANARY_RECEIPT_PATH`
- `AZURE_JIRA_MAPPING_RECEIPT_PATH`

Approval structure is additionally bound to `AZURE_DEVOPS_ENVIRONMENT_ID`, `AZURE_DEVOPS_ENVIRONMENT_NAME`, and the exact release identity. This structural match is not proof that approval occurred; unsigned local approval JSON remains unverified.

Then run:

```bash
TEAMS_RELEASE_TARGET=azure npm run release:preflight
```

The evidence join validates that all inputs bind the same handoff commit/version/image/package/client/server identity, the migration bundle and reconciliation source commits match the handoff, the Teams package hash and manifest match, enabled providers contain a nonempty result plus cancellation/recovery structure, approval names the exact configured environment and release, and every recorded defect/blocker/improvement has a Jira mapping. It recursively rejects credential-bearing fields and values. Because these inputs are unsigned local JSON, the join then fails closed as `AZURE_LIVE_EVIDENCE_UNVERIFIED`; it performs no provisioning, deployment, endpoint switch, portal operation, Jira write, or secret lookup.

## Promotion rule

Azure DevOps owns promotion. The repository pipeline independently verifies that the exact environment has one enabled Approval check with explicit approvers. A YAML environment name alone is not approval proof. Do not promote or change the Teams endpoint until the integrated preflight, reconciliation, public canary, installed Teams identity, desktop matrix, and mobile gates all pass for the same release. Until then, leave the existing Dev Tunnel serving its current release.
