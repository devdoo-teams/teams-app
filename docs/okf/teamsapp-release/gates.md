---
type: "Release Gate Checklist"
title: "TeamsApp release and failure-prevention gates"
description: "The atomic gates promoted from repeated failures; one failed or unverified gate stops progression."
resource: /gates.md
tags: [release-gate, azure, teams, provenance, rollback]
generated:
  by: "process:codex-okf/1"
  at: "2026-09-06T14:08:05Z"
verified:
  by: "process:release-gate-reconciliation/1"
  at: "2026-09-06T14:08:05Z"
status: stable
stale_after: "2026-09-13T14:08:05Z"
sources:
  - id: okf-spec
    resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md"
    title: "Open Knowledge Format v0.2 specification"
    location: "Sections 3-5, 8-10; observed web lines 253-327, 370-444, 486-532"
  - id: arm-what-if
    resource: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if"
    title: "Template deployment what-if - Azure Resource Manager"
    location: "What-if operation and permissions; observed web lines 29-52"
  - id: az-what-if-help
    resource: "https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest"
    title: "az deployment group what-if"
    location: "option table and examples; observed web lines 1016-1042 and 1071-1092"
  - id: az-approval
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops"
    title: "Pipeline deployment approvals - Azure Pipelines"
    location: "stage pause and check categories; observed web lines 37-50"
  - id: az-deployment-jobs
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops"
    title: "Deployment jobs - Azure Pipelines"
    location: "deployment lifecycle hooks and failure handling; observed web lines 55-76"
  - id: aca-start-failures
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures"
    title: "Troubleshoot start failures in Azure Container Apps"
    location: "revision/log diagnosis and common causes; observed web lines 33-80"
  - id: aca-health
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/health-probes"
    title: "Health probes in Azure Container Apps"
    location: "probe types and readiness; observed web lines 36-41 and 187-188"
  - id: teams-upload
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload"
    title: "Upload your custom app"
    location: "upload/update and installed app sections; observed web lines 48-60 and 84-122"
  - id: release-ledger
    resource: "https://github.com/devdoo-teams/teams-app/blob/main/docs/teams-release-workflow.md"
    title: "TeamsApp release workflow"
    location: "same-release, official-contract, and completion sections"
---

# Gate policy

OKF v0.2 makes provenance, verification, lifecycle, and attestation explicit in frontmatter.[^okf-spec] This checklist applies the same separation to releases. A gate is PASS only when its evidence is non-empty, current, and bound to the target identity. FAIL, BLOCKED, UNVERIFIED, or MIXED_IDENTITY stops the next stage.

# Atomic gates

## A. Source and workspace

1. Canonical worktree is /Users/doosansmacbookpro/Documents/TeamsApp.
2. main, origin/main, pipeline source, and requested release source are recorded.
3. Tracked worktree is clean; unexplained detached worktrees and stashes are reconciled.
4. Every source-consuming Azure task fetches and checks out the exact release receipt commit before HEAD comparison.

Evidence:
- git status --short --branch
- git worktree list --porcelain
- git stash list
- pipeline source and receipt source
- azure-pipelines.yml and platform contract test

## B. Immutable inputs

5. GitHub handoff binds repository, commit, artifact, ZIP SHA, image digest, and app version.
6. package.json, manifest, and ZIP internal manifest agree on version/app ID/device permissions.
7. Version bump occurs only for a user-visible feature or reproduced bug fix with RED/GREEN/Core evidence.
8. No old ZIP, public process, Dev Tunnel, local bypass, or optional provider receipt is reused.

Evidence:
- release receipt
- package hash
- ZIP manifest read-back
- version-policy diff

## C. Official Azure preflight

9. Azure CLI, Azure DevOps task, Bicep, Node, and package versions are recorded.
10. Bicep binary path is verified and does not shadow the pinned Node runtime.
11. what-if uses subscription, resource group, no-pretty-print, full payloads, provider validation, and no prompt as defined by the installed help.[^az-what-if-help]
12. raw what-if output and a secret-free validated receipt are retained.
13. Exact target allowlist is applied; out-of-scope Modify/Delete/Deploy/Ignore/Unsupported is fail-closed.

ARM what-if is non-mutating and predicts changes rather than applying them.[^arm-what-if]

## D. Permissions and secrets

14. Tenant, subscription, service principal, and resource-group permissions are read back.
15. Required Key Vault secret name/status metadata is checked; values are never logged.
16. Missing, disabled, or expired secret stops the deployment.

## E. Approval and deployment

17. Environment approval is requested only after exact artifact, RBAC, what-if, and secret metadata receipts pass.
18. Approval PASS is never treated as deployment PASS; the post-approval deployment job has separately named mutation, revision, health, and failure boundaries.
19. Deploy re-materializes and verifies the exact receipt source.
20. First mutation verifies Bicep output, worker archive/package digest, what-if receipt, and release identity.
21. Existing service remains until the canary is healthy and rollback identity is recorded.
22. A failed post-approval task writes a secret-free failure receipt containing only stage/job, last named boundary, exit code, source/version/run identity, and next action.
23. The failure receipt is published with a failure condition even when the mutation task exits nonzero; raw stderr, tokens, secret values, and auth material are not copied into it.

Azure Pipelines approvals control when a stage should run.[^az-approval] Deployment jobs separately model deploy, route/post-route health, and `on: failure` handling.[^az-deployment-jobs]

## F. Runtime and Teams

24. Azure revision has active healthy replicas and startup/liveness/readiness evidence.
25. Public HTTPS /api/health returns source commit, version, image/server identity matching the receipt.
26. Portal, downloaded package, installed desktop/mobile app, app ID, version, and SHA agree.
27. Teams desktop shows the target chat, fresh Bot reply, card/tab/buttons, current accessibility tree, and before/after screenshots.
28. Mobile permission, GPS, and mobile UI remain separate; no desktop proof is promoted to MOBILE_READY.

Container Apps troubleshooting requires revision status and system/application logs to distinguish image pull, crash, timeout, ingress, probe, configuration, and secret-reference failures.[^aca-start-failures] Container Apps distinguishes startup, liveness, and readiness; readiness must succeed before traffic shift.[^aca-health] Teams upload/update is also a separate package and installed-client process.[^teams-upload]

## G. Closure and traceability

29. Every reproduced bug/release blocker maps to confirmed Jira key/URL or JIRA_SYNC_UNVERIFIED.
30. A non-empty durable receipt reconciles process, commit, artifacts, tests, and result.
31. No Teams completion message, Jira Done, or production promotion before all required gates pass.
32. Append run ID, source, artifact/ZIP SHA, image digest, result, blocker, and next action to the ledger.

# Current run

Run 30 has A–D pre-approval evidence within its declared scope, but post-approval deployment failed with generic exit code 1 and no durable failure boundary. It is FAILED_AFTER_APPROVAL, not release complete.

# Required commands before a new run

    git diff --check
    node scripts/azure-platform-contract-test.mjs
    npm run test:azure-core
    git status --short --branch

[^az-deployment-jobs]: Deployment jobs, rollout lifecycle hooks and `on: failure` handling, observed web lines 55-76. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops
[^aca-start-failures]: Troubleshoot start failures in Azure Container Apps, revision/log diagnosis and common causes, observed web lines 33-80. https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures
[^okf-spec]: Open Knowledge Format v0.2 specification, sections 3-5, 8-10, observed web lines 253-327, 370-444, 486-532. https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
[^arm-what-if]: ARM what-if operation, What-if operation and Required permissions, observed web lines 29-52. https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if
[^az-what-if-help]: Azure CLI az deployment group what-if, option table and examples, observed web lines 1016-1042 and 1071-1092. https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest
[^az-approval]: Pipeline deployment approvals, approvals and check execution, observed web lines 42-58 and 67-77. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops
[^aca-health]: Health probes in Azure Container Apps, probe types and readiness before traffic, observed web lines 36-41 and 187-188. https://learn.microsoft.com/en-us/azure/container-apps/health-probes
[^teams-upload]: Upload your custom app, upload/update and installed app sections, observed web lines 48-60 and 84-122. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload
