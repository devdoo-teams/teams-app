# TeamsApp release knowledge update log

## 2026-09-06

* **Creation**: Created the TeamsApp release failure-history, FAQ, gate, and official-contract concepts as an OKF v0.2 bundle.
* **Evidence**: Recorded Azure DevOps Run 26–30, GitHub immutable-image observations, Teams portal/runtime boundaries, FileProvider provenance risks, A2A live-proof gaps, and mobile location retry findings.
* **Policy**: Added the requirement to read this OKF bundle before Teams/Azure release diagnosis or approval.
* **Status**: Run 30 was manually approved by the user and then failed in the post-approval DeployCanary AzureCLI task with generic exit code 1. Exact subcommand root cause is `UNVERIFIED` because no failure boundary or durable receipt was retained.

## 2026-09-06 — Run 30 post-approval failure and diagnostic fix

* **Official contract**: Azure DevOps approvals control stage execution; deployment jobs provide separate deploy, post-route health, and `on: failure` lifecycle hooks. Microsoft Container Apps guidance requires revision state and system/application logs to classify startup, image, probe, configuration, and exit failures.
* **Observed evidence**: Run 30 summary `https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=30`; failed task `DeployCanaryRevision`; log `https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=30&view=logs&s=4762d5d2-aebb-53b8-a7cb-14d48d3e23e5&j=95b50d7d-ef90-5e8d-33e5-e2c5603024e8`; UI text `Script failed with exit code: 1`.
* **Classification**: `FAIL` / `UNKNOWN_POST_APPROVAL_DEPLOY_BOUNDARY`; foundation create, secret metadata, worker blob, ACR import, workload create, revision, health, and identity hypotheses were not promoted to root cause.
* **Implementation**: Commit `3bfcd676ff510aefdbea6e267c3e238063f9b96f` added `scripts/azure-deployment-failure-receipt.mjs`, named boundaries and safe Azure DevOps log issue in `azure-pipelines.yml`, failure artifact publication, and Azure Core regression inventory.
* **Verification**: `npm run test:azure-deployment-failure-receipt` GREEN; `npm run test:azure-core-runner` GREEN; `node scripts/azure-platform-contract-test.mjs` GREEN. No Azure mutation or new version was performed.
* **Next**: commit/publish this CI-only fix, run a new exact release candidate, inspect the retained boundary receipt plus Azure revision/system/application logs, and only then classify/fix the real Azure failure.

## 2026-09-06 — Run 31 pre-approval release-artifact handoff failure

* **Official contract**: GitHub's artifact REST API supports exact name filtering and returns the artifact digest and `workflow_run.head_sha`; artifact attestations bind repository, workflow, environment, commit SHA, and triggering event, and must be verified by consumers.
* **Observed evidence**: Run 31 (`20260906.10`) checked out source `f6cce7cc3fc1a3787f4db6e4d104d7b6720417f1`, authenticated to GHCR successfully, then logged `Invalid GitHub release handoff: expected exactly one unexpired teams-runtime-identity-f6cce7cc3fc1a3787f4db6e4d104d7b6720417f1 artifact, found 0` and exited with code 1 in `ValidateHandoff` before approval.
* **Classification**: `FAIL_BEFORE_APPROVAL` / `RELEASE_ARTIFACT_UNAVAILABLE`; the pipeline source commit was incorrectly reused as the deploy-only release artifact commit. No Azure mutation or approval occurred.
* **Implementation**: Commit `f06e5f4adcf9cc19c769910b4ea53e32419ed233` added named pre-approval handoff boundaries, a secret-free `github-handoff-failure-receipt` artifact, and a focused regression covering the receipt contract. The application version remains `1.0.103`.
* **Verification**: RED before the change; `npm run test:azure-deployment-failure-receipt`, `node scripts/azure-platform-contract-test.mjs`, and `npm run test:azure-core` GREEN after the change. No Azure mutation or Teams completion message is justified.
* **Next**: run the pipeline with source `f06e5f4` but the already validated deploy-only release artifact commit `71df02e...`; inspect the new handoff receipt and, if pre-approval passes, the post-approval Azure failure boundary and revision logs.

## 2026-09-06 — Run 32 workload what-if boundary and empty receipt

* **Official contract**: ARM what-if is a non-mutating preview with typed resource changes; Azure CLI `what-if` is run with provider validation, full resource payloads, machine-readable output, and no prompt. Approval remains separate from deployment and health evidence.[^arm-what-if][^az-what-if-help][^az-approval][^az-deployment-jobs]
* **Observed evidence**: Run `32` / build `20260906.11` used pipeline source `395e158f8c61570aa644963897e0c7231f7b3b5d`, release artifact commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, and app `1.0.103`. After approval, Azure CLI `2.89.1` / Bicep `0.46.1` stopped at `workload-parameters-and-what-if` with a disallowed `Modify` for the exact canary Container App resource. Artifact `156` (`azure-what-if-workload-receipt`) was retained at 29400 bytes. Artifact `157` (`azure-deployment-failure-receipt`) was retained at 0 bytes; log 46 recorded 0 processed files.
* **Classification**: `FAIL_AFTER_APPROVAL`; the exact resource-level what-if boundary is observed, but the property delta is `UNVERIFIED` because the Azure DevOps artifact MCP returned `TF400813` while downloading artifact 156. No workload create/update, revision, traffic, or public health proof exists.
* **Root cause**: `WORKLOAD_WHAT_IF_ALLOWLIST_MISMATCH` is confirmed at the classifier boundary. Separately, `ZERO_BYTE_FAILURE_RECEIPT` is confirmed because DeployCanary checked out release commit `71df02e`, which did not contain the CI receipt helper added in the pipeline source.
* **Implementation**: Commit `9c793d4d5f2c436223d3c8c8fa228b052515c8fa` snapshots the CI receipt helper to `$(Agent.TempDirectory)` before release checkout and executes that preserved path from the failure trap. The focused test now asserts snapshot-before-checkout and preserved-path execution.
* **Verification**: focused receipt test GREEN; Azure Core regression gate 27/27 GREEN at `9c793d4`. Application/package/Teams version remains `1.0.103`; no new ZIP, upload, Azure mutation, or Teams completion message was performed.
* **Next**: push the fix, queue a fresh run with the same known deploy-only artifact, verify the failure receipt is non-empty if the what-if gate still blocks, and only then decide whether the exact observed property delta justifies a narrowly scoped classifier fixture.

[^arm-what-if]: ARM what-if operation, What-if operation and Required permissions, observed web lines 29-52. https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if
[^az-what-if-help]: Azure CLI az deployment group what-if, option table and examples, observed web lines 1016-1042 and 1071-1092. https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest
[^az-approval]: Pipeline deployment approvals, stage pause and check execution, observed web lines 37-50 and 56-64. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops
[^az-deployment-jobs]: Deployment jobs, deployment lifecycle hooks and failure handling, observed web lines 55-76. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops

## 2026-09-07 — Azure DevOps + Linux VM/ACA root-cause research

* **Official contract**: Microsoft documents Azure DevOps approvals as resource-owner checks outside YAML, deployment jobs as lifecycle hooks with separate deploy/route/post-route/failure boundaries, ACA readiness before multiple-revision traffic, blue-green labels/weights for rollback, and Linux Custom Script Extension idempotence, protected managed-identity downloads, and agent/handler logs.
* **Observed evidence**: Run 32 stopped at `workload-parameters-and-what-if` on a disallowed Container App `Modify`; property delta remains `UNVERIFIED` because artifact 156 read-back returned `TF400813`. Artifact 157 was 0-byte because the receipt helper was not present after release checkout; source fix is `9c793d4` and docs are `d67a84a`.
* **Root-cause conclusion**: the primary systemic defect is not gate count alone. Source/artifact handoff, foundation mutation, workload what-if, ACA revision/traffic, VM worker readiness, and durable evidence were coupled into one broad mutation task. This caused an incomplete failure receipt and makes approval, image import, VM state, and public health easy to over-promote as one success.
* **Knowledge graph**: [`docs/research/2026-09-07-azure-devops-linux-vm-root-cause.md`](../../research/2026-09-07-azure-devops-linux-vm-root-cause.md) records the graph, official URLs with observed sections/line ranges, repository file/line evidence, confirmed versus unverified causes, and a staged redesign. It recommends separating plan/approval/mutation/readiness/promotion and consolidating duplicate checks into durable receipts rather than deleting evidence gates.
* **Toolchain note**: local `az` was not installed, so local CLI help could not be verified. Run 32 hosted evidence recorded Azure CLI `2.89.1`, Azure DevOps extension `1.0.7`, and Bicep `0.46.1`. No Azure mutation or version bump was performed.
* **Status**: `RELEASE_BLOCKED`; no allowlist widening, new Azure run, Teams completion message, or Jira Done transition is justified until artifact read-back and a fresh non-empty failure receipt are proven.

## 2026-09-07 — Failure receipt integrity hardening

* **Official contract**: Azure Pipelines artifacts are a stage handoff and must be retained and read back as evidence; a task status or artifact listing alone does not prove a usable receipt.[^az-pipeline-artifacts]
* **Observed risk**: the Run 32 source fix preserved the receipt helper, but the trap still suppressed helper failure and did not reject an empty or malformed receipt before artifact publication.
* **Implementation**: commit `32308334af096ca062939c62913bdb17f8da4949` adds a non-empty/schema-valid check, a SHA-256 sidecar, and explicit safe `receiptWriteStatus` logging. It does not copy stderr, tokens, or secret values and does not change the application version.
* **Verification**: the new assertions were RED before implementation; `npm run test:azure-deployment-failure-receipt` is GREEN after it; `npm run test:azure-core` completed all 27/27 fixtures from the clean commit.
* **Limit**: this proves source-level failure-evidence behavior only. A fresh hosted run must still read back both the JSON and `.sha256` artifact through Azure DevOps before Run 32's failure evidence is promoted to `VERIFIED`; the workload `Modify` delta remains `UNVERIFIED`.

## 2026-09-07 — Run 32 artifact read-back mismatch rechecked

* **Observed evidence**: Azure DevOps MCP `pipelines_artifact.list` returned Run 32 artifacts `156` and `157` with the previously reported sizes (`29400` and `0` bytes). A read-only `download` call reported success for both, but each local destination contained a 62-byte plain-text `TF400813: The user is not authorized to access this resource.` response rather than a ZIP archive.
* **Classification**: `ARTIFACT_READBACK_UNVERIFIED`; the MCP wrapper status and downloaded bytes disagree. No property-level what-if delta, failure JSON, or failure SHA was read back.
* **Action**: preserve the fail-closed gate; do not treat the artifact listing, wrapper success, or filename as content evidence. A valid ZIP/JSON/SHA read-back through an authorized Azure DevOps API or approved immutable copy is still required.

## 2026-09-07 — Run 33 browser read-back and legacy canary delta fixture

* **Official contract**: ARM what-if remains a non-mutating preview and Azure Container Apps startup/readiness must be diagnosed from revision state and logs, not from approval or artifact metadata alone. Sources: [ARM what-if](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if) and [Container Apps start failures](https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures).
* **Observed evidence**: Run 33 / build `20260906.12` passed the three pre-approval jobs, was manually approved, then stopped at `workload-parameters-and-what-if`. The existing Ego Lite Azure DevOps artifact page was used to read back `azure-what-if-workload-diagnostic.json`; local SHA-256 was `d9592177fd9dc1c99331540297ec1de58eadc1827725b2e4a461e77eb4f1fb05`.
* **Exact what-if result**: `Modify=6`, `NoChange=20`, `Ignore=2`, `Unsupported=9`; the Container App Modify contains a deterministic legacy env/secret array reconciliation, image/revision changes, and platform-default deletions. The nine Unsupported rows are role-assignment/reference expressions with missing Azure reasons and remain `REVIEW_REQUIRED`.
* **Live canary evidence**: latest revision `teamsapp-canary-goictvxm--756312161b` is `ActivationFailed`, health `None`, replicas `0`, and traffic `100%`. Its system/application logs contain `Production requires BOT_CLIENT_ID to be explicitly configured.` The Container App environment-variable read-back did not contain `BOT_CLIENT_ID`, while the checked-in Bicep and Azure DevOps pipeline definition require it.
* **Implementation**: added an exact value-free Run 33 Container App property multiset to `scripts/azure-canary-preflight.mjs` and a regression fixture to `scripts/azure-what-if-receipt-test.mjs`. The rule accepts only this observed shape; it does not broaden arbitrary environment or secret changes.
* **Verification**: the new regression was RED before the classifier change and `node scripts/azure-what-if-receipt-test.mjs` is GREEN after it. `summarizeAzureWhatIf` now classifies the downloaded diagnostic as `REVIEW_REQUIRED` with the nine Unsupported rows preserved. Full `npm run test:azure-core` is pending a clean commit because the FileProvider gate correctly rejected the dirty tracked worktree (`EWORKTREEDIRTY`).
* **Limit**: no Azure mutation, version bump, package upload, or Teams completion message is justified. The classifier fix is source-only until committed, full Core verification is rerun, and the remaining Unsupported review plus runtime recovery are separately proven.

## 2026-09-07 — Run 34 release-checkout helper provenance gap

* **Observed evidence**: Run 34 used pipeline source `c0b54175ddff7d90d099f5dbc400b9e2dafb17ae` and the same deploy-only release artifact `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`. Hosted Azure Core passed 26/26, but the deploy job checked out the release commit before executing `azure-what-if-receipt.mjs`; that release commit did not contain the new Run 33 classifier variant. The run therefore failed again at `workload-parameters-and-what-if` with the same disallowed Container App Modify boundary.
* **Root cause**: the CI policy helper and its classifier dependency were treated as release-source files even though they are pipeline-control code. This is a source handoff/provenance defect, not evidence that the new exact fixture is wrong.
* **Implementation**: the deploy job now snapshots `azure-what-if-receipt.mjs` and `azure-canary-preflight.mjs` into `$(Agent.TempDirectory)` before release checkout and invokes the preserved helper pair. This mirrors the earlier failure-receipt helper snapshot rule.
* **Verification**: `node scripts/azure-platform-contract-test.mjs` was RED before the change and GREEN after it. The application version remains `1.0.103`; no Azure mutation or Teams completion message was performed.
* **Next**: commit/push this CI handoff fix, rerun the exact release candidate, verify the workload receipt reaches `REVIEW_REQUIRED` rather than classifier failure, then review the nine Unsupported rows and continue only with durable runtime evidence.

## 2026-09-07 — Run 33 pre-approval artifact read-back mismatch

* **Observed evidence**: Run `33` / build `20260906.12` used pipeline source `main@92b95d5364e610c827b7f396c2c832ebc961ad10`, deploy-only release artifact commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, and product version `1.0.103`. The Azure gate job completed its observed pre-approval receipt publication while the build API remained `state=1`; no DeployCanary mutation or public-health result was promoted.
* **Artifact list**: MCP `pipelines_artifact.list` reported artifact `158` (`approval-configuration-receipt`, 343 bytes), `160` (`azure-platform-preflight-receipt`, 856 bytes), `162` (`azure-rbac-preflight-receipt`, 275 bytes), and `163` (`azure-what-if-preflight-receipt`, 44495 bytes).
* **Read-back**: MCP download reported success for all four, but each local destination was an ASCII 62-byte file containing `TF400813: The user is not authorized to access this resource.` rather than a ZIP. All four bytes had SHA-256 `3d632e252d055b8f89c79a59b004ea7c747c9ae9b90d47cfaf0445eed56ea52f`.
* **Classification**: `RUN_IN_PROGRESS` and `ARTIFACT_READBACK_UNVERIFIED`. Artifact-list metadata, wrapper success, and the filename are not content evidence. Approval, RBAC, what-if JSON, checksum, Azure mutation, revision health, and Teams runtime remain separate and unverified.
* **Action**: the run is not duplicated or cancelled. The artifact authorization/read-back boundary must be restored before using any property delta or widening the what-if allowlist. No version bump or Teams completion message is justified.

[^az-pipeline-artifacts]: Publish and download pipeline artifacts, stage handoff and workspace guidance, observed web lines 305-355. https://learn.microsoft.com/en-us/azure/devops/pipelines/artifacts/pipeline-artifacts?tabs++=+yaml&view=azure-devops
