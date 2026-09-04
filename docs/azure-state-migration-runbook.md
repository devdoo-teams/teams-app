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

Rollback restores the exact application document envelopes captured before import and removes records absent from that snapshot. Import snapshot writers and mutation receipt writers are repository-created private capabilities; arbitrary callbacks and copied properties are rejected before target mutation. The receipt ledger binds a UUID operation ID and canonical request SHA-256 and hash-chains each immutable checkpoint. A normal target-operation failure can seal durable `PARTIAL`; if an outcome or terminal receipt cannot be persisted after a mutation may have committed, the command instead reports `MIGRATION_RECOVERY_REQUIRED`. The last durable entry remains nonterminal `IN_PROGRESS`/seal intent. An existing incomplete ledger is never replayed as a fresh operation: inspect its operation ID, request hash, in-flight item, reconcile the target, and choose an operator-reviewed recovery before using a new receipt path. Do not delete or relabel an incomplete ledger as completion.

The secret guard scans the complete accepted bundle, record, runtime-document, target-document, preflight evidence, reconciliation receipt, and mutation receipt envelopes before use or persistence, including nested arrays. Singular and plural credential key families are rejected. Explicit non-secret metadata fields such as credential principals, IDs, versions, expiry times, hashes/digests, URIs, references, statuses, and policy names remain permitted, but their values still pass the credential-value scanner.

The neutral-key Azure account-key rule is deliberately bounded: it rejects a canonical 88-character Base64 value that decodes to 64 high-entropy bytes and contains the character classes expected from generated key material. This catches raw Azure account-key-shaped material hidden under names such as `payload` without treating ordinary names such as `secretaryName`, `accountManagerName`, or `tokenizationModel` as credential fields. It is a guardrail, not a general DLP system: transformed, split, encrypted, noncanonical, or differently shaped secrets may not match, so producers must still keep every migration and release envelope secret-free.

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
- `AZURE_RELEASE_ATTESTATION_PATH`

The evidence caller does not configure the attestation trust root, target policy, release challenge, or replay state through environment variables. In particular, there is no `AZURE_RELEASE_ATTESTATION_TRUSTED_PUBLIC_KEYS` operational setting: a caller-provided public key must never establish production readiness. An operational implementation must inject a repository-owned or deployment-protected verifier capability whose immutable policy identifies the trusted key, issuer, subject, audience, Azure/Teams target, release run, challenge, nonce, and attempt. The capability and one-shot challenge state stay private to that verifier interface.

The producer writes one `teamsapp.azure-release-aggregate-attestation.v1` envelope with `algorithm=Ed25519`, `producer=azure-devops-release-pipeline`, key ID, issuer, subject, audience, exact environment ID/name, exact Cosmos/queue/managed-identity/Teams target, canonical issued/expiry timestamps, an `operation` containing the release-run ID, challenge ID, and attempt, a bounded nonce, and the exact commit/version/image/image-digest/Teams-package/client/server identity. Its `evidenceHashes` are SHA-256 hashes of canonical stable JSON for the release receipt, handoff provenance, migration bundle, reconciliation receipt, approval receipt, provider receipt, public canary receipt, and Jira receipt. The detached signature is base64url Ed25519 over the canonical envelope with the `signature` field omitted. The verifier permits no unknown attestation fields, allows at most a 15-minute validity window, and rejects missing signatures, untrusted keys, fixture producer labels, wrong claims/targets/releases/challenges, expired envelopes, evidence tampering, non-Ed25519 keys, and reuse of a consumed challenge.

The repository contains no signer, private key, or protected live verifier adapter, and does not claim that constructing `DefaultAzureCredential` proves a live Azure request. The exported local verifier factory encloses its copied target/trust/challenge policy behind a private unforgeable capability and consumes a valid challenge once. Generated-key tests can therefore prove only `LOCAL_SIGNED_VERIFIER_CONTRACT_PASS`. The production `validateAzureIntegratedEvidence` entry point has no caller-accessible capability injection and currently fails closed as `AZURE_LIVE_EVIDENCE_UNVERIFIED`; it cannot return operational `READY` until a separately reviewed protected Azure/ADO verifier is implemented.

Then run:

```bash
TEAMS_RELEASE_TARGET=azure npm run release:preflight
```

The evidence join validates that all inputs bind the same handoff commit/version/image/package/client/server identity, the migration bundle and reconciliation source commits match the handoff, the Teams package hash and manifest match, enabled providers contain a nonempty result plus cancellation/recovery structure, approval names the exact configured environment and release, and every recorded defect/blocker/improvement has a Jira mapping. The public canary health URL must be exactly `https://<attested TAB_DOMAIN>/api/health`, with no credentials, port change, query, or fragment. The join recursively rejects credential-bearing fields and values. Unsigned JSON, local fixture evidence, caller-supplied trust configuration, and the local signed contract result cannot become operational evidence. The command remains non-mutating and currently ends `AZURE_LIVE_EVIDENCE_UNVERIFIED`: it performs no provisioning, deployment, endpoint switch, portal operation, Jira write, or secret lookup.

## Promotion rule

Azure DevOps owns promotion. The repository pipeline independently verifies that the exact environment has one enabled Approval check with explicit approvers. A YAML environment name alone is not approval proof. Do not promote or change the Teams endpoint until the integrated preflight, reconciliation, public canary, installed Teams identity, desktop matrix, and mobile gates all pass for the same release. Until then, leave the existing Dev Tunnel serving its current release.
