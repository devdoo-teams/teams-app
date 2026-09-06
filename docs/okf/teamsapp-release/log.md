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
