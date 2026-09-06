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
* **Implementation**: Added `scripts/azure-deployment-failure-receipt.mjs`, named boundaries and safe Azure DevOps log issue in `azure-pipelines.yml`, failure artifact publication, and Azure Core regression inventory.
* **Verification**: `npm run test:azure-deployment-failure-receipt` GREEN; `npm run test:azure-core-runner` GREEN; `node scripts/azure-platform-contract-test.mjs` GREEN. No Azure mutation or new version was performed.
* **Next**: commit/publish this CI-only fix, run a new exact release candidate, inspect the retained boundary receipt plus Azure revision/system/application logs, and only then classify/fix the real Azure failure.
