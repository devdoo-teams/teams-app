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
