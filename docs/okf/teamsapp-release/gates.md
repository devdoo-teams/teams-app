---
type: "Release Gate Checklist"
title: "TeamsApp release and failure-prevention gates"
description: "The atomic gates promoted from repeated failures; one failed or unverified gate stops progression."
resource: /gates.md
tags: [release-gate, azure, teams, provenance, rollback]
generated:
  by: "process:codex-okf/1"
  at: "2026-09-08T04:24:56Z"
verified:
  by: "process:release-gate-reconciliation/1"
  at: "2026-09-08T04:24:56Z"
status: stable
stale_after: "2026-09-15T04:24:56Z"
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
  - id: az-pipeline-artifacts
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/artifacts/pipeline-artifacts?tabs++=+yaml&view=azure-devops"
    title: "Publish and download pipeline artifacts - Azure Pipelines"
    location: "stage artifact handoff and `$(Pipeline.Workspace)`; observed web lines 305-355 on 2026-09-07"
  - id: aca-blue-green
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/blue-green-deployment"
    title: "Blue-Green Deployment in Azure Container Apps"
    location: "stable/green labels, traffic switch and rollback; observed web lines 31-57 on 2026-09-07"
  - id: vm-custom-script
    resource: "https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/custom-script-linux"
    title: "Run Custom Script Extension on Linux VMs in Azure"
    location: "idempotence, managed identity and diagnostic logs; observed web lines 68-81, 203-243, 383-413 on 2026-09-07"
  - id: github-artifacts
    resource: "https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10"
    title: "REST API endpoints for GitHub Actions artifacts"
    location: "artifact lookup/name filter and response schema including digest and workflow_run.head_sha; observed web lines 13-18, 34-38, 45-53, 71-78"
  - id: github-attestations
    resource: "https://docs.github.com/en/actions/concepts/security/artifact-attestations"
    title: "Artifact attestations - GitHub Docs"
    location: "provenance fields and verification boundary; observed web lines 25-32 and 58-63"
  - id: aca-start-failures
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures"
    title: "Troubleshoot start failures in Azure Container Apps"
    location: "revision/log diagnosis and common causes; observed web lines 33-80"
  - id: aca-health
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/health-probes"
    title: "Health probes in Azure Container Apps"
    location: "probe types and readiness; observed web lines 36-41 and 187-188"
  - id: aca-scaling
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/scale-app"
    title: "Set scaling rules in Azure Container Apps"
    location: "minimum replicas, scale-to-zero, and always-running guidance; observed web lines 31-56 on 2026-09-07"
  - id: aca-revisions
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/revisions"
    title: "Update and deploy changes in Azure Container Apps"
    location: "revision running states, Scale to 0, readiness, and multiple-revision traffic; observed web lines 48-72 and 128-138 on 2026-09-07"
  - id: az-vm-run-command
    resource: "https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command"
    title: "Run scripts in a Linux VM by using action Run Commands"
    location: "VM agent execution, RunShellScript, bounded output/time, and non-interactive restrictions; observed 2026-09-07"
  - id: teams-upload
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload"
    title: "Upload your custom app"
    location: "upload/update and installed app sections; observed web lines 48-60 and 84-122"
  - id: release-ledger
    resource: "https://github.com/devdoo-teams/teams-app/blob/main/docs/teams-release-workflow.md"
    title: "TeamsApp release workflow"
    location: "same-release, official-contract, and completion sections"
  - id: apple-sleep-settings
    resource: "https://support.apple.com/en-ie/guide/mac-help/mchle41a6ccd/mac"
    title: "Set sleep and wake settings for your Mac"
    location: "Set your Mac to go to sleep after inactivity and Specify sleep and wake settings; observed web lines 296-320 on 2026-09-07"
  - id: apple-lock-screen
    resource: "https://support.apple.com/en-euro/guide/mac-help/-mh11784/mac"
    title: "Change Lock Screen settings on Mac"
    location: "Lock Screen options; observed web lines 274-292 on 2026-09-07"
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
8a. `githubReleaseCommit` is a deploy-only identity: it must resolve to exactly one unexpired artifact with the expected name, workflow head SHA, immutable digest, extracted release receipt, and verified attestations. A pipeline/documentation source commit without that artifact is not deployable.

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
23a. A failed pre-approval GitHub handoff writes a separate secret-free `github-handoff-failure-receipt` artifact with the last named handoff boundary before approval is retried.
23b. The post-approval failure-receipt helper is copied from the pipeline source into an agent-temporary absolute path before the task checks out the deploy-only release commit; the failure trap executes that preserved helper, so receipt generation cannot depend on release-source contents.
23c. Every failure artifact is non-empty, schema-valid, SHA-256 recorded, and read back through the Azure DevOps artifact API or an approved immutable copy. Artifact task completion or an artifact listing alone is not PASS.
23d. The post-approval receipt writer is invoked by a nonzero `EXIT` trap that also preserves the original exit status; an `ERR` trap alone is insufficient because an explicit `exit 1` path can bypass it. The focused regression must exercise an explicit exit path.

Azure Pipelines approvals control when a stage should run.[^az-approval] Deployment jobs separately model deploy, route/post-route health, and `on: failure` handling.[^az-deployment-jobs] Pipeline artifacts require an explicit stage handoff and read-back.[^az-pipeline-artifacts] Container Apps blue-green guidance keeps stable traffic while green is tested before promotion and rollback.[^aca-blue-green] Linux Custom Script Extension requires idempotent scripts and exposes agent/handler logs for diagnosis.[^vm-custom-script]

## F. Runtime and Teams

24. Azure revision has active healthy state and startup/liveness/readiness evidence. For the current HTTP canary, `Running` or the observed `ScaledToZero` is accepted only when provisioning is `Succeeded`, the revision is active, `healthState` is `Healthy` for `ScaledToZero`, and traffic is 100%; public health must still return successfully.
24d. Revision readiness reads the exact revision with `az containerapp revision show` and, when that response is temporarily incomplete, reads `az containerapp revision list --all` and applies the identical active/provisioned/running-or-healthy/100%-traffic predicate. A list fallback is not a readiness relaxation; an exact matching record is still required, and a value-free revision-state receipt is retained.[^az-aca-revision-cli]
24e. Revision read-back normalizes both a top-level array and the official `RevisionCollection.value` envelope before applying the predicate; malformed or unknown envelopes fail closed. The value-free receipt records the response shape, never raw revision payloads.[^az-aca-revision-rest]
24f. Revision diagnostics must be generated by the tested read-back helper, which projects state from `revision.properties.*` for both list and single-show responses. Shell response-shape values must be unquoted, and the contract test must reject root-level jq shorthand; a diagnostic receipt with `null` fields is not readiness evidence.
24g. If the live provider emits `runningState=RunningAtMaxScale`, which is not enumerated on the current Microsoft REST page, accept only the observed strict tuple `active=true`, `provisioningState=Provisioned|Succeeded`, `healthState=Healthy`, `replicas>=1`, and `trafficWeight=100`; record `CONTRACT_DRIFT_REVIEW_REQUIRED` and reject every other unlisted state. This observed extension does not replace the separate `minReplicas>=1` 24/7 and worker gates.
24b. The 24/7 promoted service is a separate gate: its deployed scale configuration must have `minReplicas >= 1`, because a healthy `ScaledToZero` revision is not an always-running worker. This requires its own what-if and runtime read-back.
24c. Before final identity, the deployment must invoke the exact Azure VM through non-interactive `RunShellScript` and verify a redacted worker-runtime receipt: systemd enabled/active/running, current release commit and installed manifest commit, Codex executable path/digest, owner-only regular `auth.json` metadata, and `codex login status` under `teamsworker`. Missing auth or a failed login is `BLOCKED`, not a retryable Azure health warning. The helper is snapshotted before release checkout and its receipt is published only on success.
24a. Multiple-revision canary keeps the known-good revision serving traffic while a labeled green revision is independently readiness- and function-tested; traffic promotion and rollback are separate actions.
25. Public HTTPS /api/health returns source commit, version, image/server identity matching the receipt.
26. Portal, downloaded package, installed desktop/mobile app, app ID, version, and SHA agree.
27. Teams desktop shows the target chat, fresh Bot reply, card/tab/buttons, current accessibility tree, and before/after screenshots.
28. Mobile permission, GPS, and mobile UI remain separate; no desktop proof is promoted to MOBILE_READY.
28a. Remote display evidence is classified before any native-UI handoff: `pmset`/Caffeine is `POWER_ASSERTION_ACTIVE`, black local capture is `REMOTE_CAPTURE_UNAVAILABLE`, CUA lock/unlock failure is `CUA_CONTROL_UNAVAILABLE`, and a user-provided remote desktop screenshot is `USER_REMOTE_VIEW` at its capture time. Only same-host/same-session direct lock evidence plus an independent corroborating signal is `CONFIRMED_SCREEN_LOCK`; conflicts are `REMOTE_SESSION_MISMATCH` and do not justify an unlock request.

Container Apps troubleshooting requires revision status and system/application logs to distinguish image pull, crash, timeout, ingress, probe, configuration, and secret-reference failures.[^aca-start-failures] Container Apps distinguishes startup, liveness, and readiness; readiness must succeed before traffic shift.[^aca-health] Teams upload/update is also a separate package and installed-client process.[^teams-upload]

## G. Closure and traceability

29. Every reproduced bug/release blocker maps to confirmed Jira key/URL or JIRA_SYNC_UNVERIFIED.
30. A non-empty durable receipt reconciles process, commit, artifacts, tests, and result.
31. No Teams completion message, Jira Done, or production promotion before all required gates pass.
32. Append run ID, source, artifact/ZIP SHA, image digest, result, blocker, and next action to the ledger.

# Current run

Run 54 is the current Azure canary result: it used the exact `319e676` handoff and hosted checkout, passed handoff, hosted Azure Core/RBAC, manual approval, workload what-if, Blob staging, workload mutation, revision readiness, and the public health fetch, then failed at `worker-runtime`. The VM `RunShellScript` probe returned the redacted observation `auth_file="missing"`; the exact reason the out-of-band VM auth file is absent remains `ROOT_CAUSE_REVIEW_REQUIRED`. Run 53's strict observed-state correction is now covered by regression tests. Worker-runtime, 24/7, Teams package, desktop/mobile, and A2A promotion remain `BLOCKED` or `UNVERIFIED`; no app version bump, upload, or completion message is allowed.

# Required commands before a new run

    git diff --check
    node scripts/azure-platform-contract-test.mjs
    node scripts/azure-deployment-contract-test.mjs
    npm run test:azure-deployment-failure-receipt
    npm run test:azure-worker-runtime-probe
    npm run test:azure-revision-readback
    npm run test:azure-core
    git status --short --branch

[^az-deployment-jobs]: Deployment jobs, rollout lifecycle hooks and `on: failure` handling, observed web lines 55-76. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops
[^az-pipeline-artifacts]: Publish and download pipeline artifacts, stage handoff and workspace guidance, observed web lines 305-355. https://learn.microsoft.com/en-us/azure/devops/pipelines/artifacts/pipeline-artifacts?tabs++=+yaml&view=azure-devops
[^aca-blue-green]: Blue-Green Deployment in Azure Container Apps, stable/green revision, labels, traffic switch and rollback, observed web lines 31-57. https://learn.microsoft.com/en-us/azure/container-apps/blue-green-deployment
[^vm-custom-script]: Run Custom Script Extension on Linux VMs, idempotence tips, managed identity protected settings, and troubleshooting logs, observed web lines 68-81, 203-243, 383-413. https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/custom-script-linux
[^github-artifacts]: REST API endpoints for GitHub Actions artifacts, artifact lookup/name filter and response schema including `digest` and `workflow_run.head_sha`, observed web lines 13-18, 34-38, 45-53, 71-78. https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10
[^github-attestations]: GitHub artifact attestations, provenance fields and verification boundary, observed web lines 25-32 and 58-63. https://docs.github.com/en/actions/concepts/security/artifact-attestations
[^aca-start-failures]: Troubleshoot start failures in Azure Container Apps, revision/log diagnosis and common causes, observed web lines 33-80. https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures
[^okf-spec]: Open Knowledge Format v0.2 specification, sections 3-5, 8-10, observed web lines 253-327, 370-444, 486-532. https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
[^arm-what-if]: ARM what-if operation, What-if operation and Required permissions, observed web lines 29-52. https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if
[^az-what-if-help]: Azure CLI az deployment group what-if, option table and examples, observed web lines 1016-1042 and 1071-1092. https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest
[^az-aca-revision-cli]: Azure CLI az containerapp revision, `list` and `show` commands, required parameters, `--all`, and examples, current page read 2026-09-08 (rendered line numbers are not stable). https://learn.microsoft.com/en-us/cli/azure/containerapp/revision?view=azure-cli-latest
[^az-aca-revision-rest]: Container Apps Revisions - List Revisions - REST API, `RevisionCollection.value` envelope and revision state fields, observed web result on 2026-09-08. https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revisions/list-revisions?view=rest-resource-manager-containerapps-2026-01-01
[^az-approval]: Pipeline deployment approvals, approvals and check execution, observed web lines 42-58 and 67-77. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops
[^aca-health]: Health probes in Azure Container Apps, probe types and readiness before traffic, observed web lines 36-41 and 187-188. https://learn.microsoft.com/en-us/azure/container-apps/health-probes
[^teams-upload]: Upload your custom app, upload/update and installed app sections, observed web lines 48-60 and 84-122. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload
[^apple-sleep-settings]: Apple Support, Set sleep and wake settings for your Mac, observed web lines 296-320 on 2026-09-07. https://support.apple.com/en-ie/guide/mac-help/mchle41a6ccd/mac
[^apple-lock-screen]: Apple Support, Change Lock Screen settings on Mac, observed web lines 274-292 on 2026-09-07. https://support.apple.com/en-euro/guide/mac-help/-mh11784/mac
