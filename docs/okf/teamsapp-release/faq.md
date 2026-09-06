---
type: "Playbook"
title: "TeamsApp release failure FAQ"
description: "Team-facing answers that connect each recurring failure to an official contract, internal line reference, and enforced gate."
resource: /faq.md
tags: [faq, incident-response, release, teams, azure]
generated:
  by: "process:codex-okf/1"
  at: "2026-09-06T14:50:34Z"
verified:
  by: "process:release-faq-reconciliation/1"
  at: "2026-09-06T14:50:34Z"
status: stable
stale_after: "2026-09-13T14:50:34Z"
sources:
  - id: okf-spec
    resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md"
    title: "Open Knowledge Format v0.2 specification"
    location: "Sections 3-5, 8-9; observed web lines 253-327, 370-444, 486-513"
  - id: arm-what-if
    resource: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if"
    title: "Template deployment what-if - Azure Resource Manager"
    location: "What-if operation; observed web lines 29-52"
  - id: az-what-if-help
    resource: "https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest"
    title: "az deployment group what-if"
    location: "what-if options; observed web lines 1016-1042 and 1071-1092"
  - id: az-approval
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops"
    title: "Pipeline deployment approvals - Azure Pipelines"
    location: "stage pause and checks; observed web lines 37-50 and 56-64"
  - id: az-deployment-jobs
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops"
    title: "Deployment jobs - Azure Pipelines"
    location: "deployment lifecycle hooks and failure handling; observed web lines 55-76"
  - id: github-artifacts
    resource: "https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10"
    title: "REST API endpoints for GitHub Actions artifacts"
    location: "artifact lookup/name filtering and response schema including digest and workflow_run.head_sha; observed web lines 13-18, 34-38, 45-53, 71-78"
  - id: github-attestations
    resource: "https://docs.github.com/en/actions/concepts/security/artifact-attestations"
    title: "Artifact attestations - GitHub Docs"
    location: "provenance fields and verification boundary; observed web lines 25-32 and 58-63"
  - id: aca-start-failures
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures"
    title: "Troubleshoot start failures in Azure Container Apps"
    location: "revision/log diagnosis and common causes; observed web lines 33-80"
  - id: aca-exit-failures
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-create-failures"
    title: "Troubleshoot Container Exit Failures in Azure Container Apps"
    location: "exit-event causes and diagnostics; observed web lines 31-55"
  - id: aca-health
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/health-probes"
    title: "Health probes in Azure Container Apps"
    location: "probe types and readiness; observed web lines 36-41 and 187-188"
  - id: key-vault
    resource: "https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli"
    title: "Quickstart - Set and retrieve a secret from Azure Key Vault"
    location: "add/retrieve secret sections; observed web lines 80-95"
  - id: teams-package
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package"
    title: "Teams app package"
    location: "manifest and hosting; observed web lines 45-72"
  - id: teams-upload
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload"
    title: "Upload your custom app"
    location: "upload/update; observed web lines 48-60 and 84-122"
  - id: azure-ledger
    resource: "https://github.com/devdoo-teams/teams-app/blob/main/docs/teams-release-workflow.md"
    title: "TeamsApp release workflow"
    location: "official-contract and same-release sections"
---

# How to use this FAQ

Read this document after failure-history.md and gates.md. Each answer names the evidence boundary, official source section, and internal reference. If the official page or installed CLI help has changed, mark CONTRACT_DRIFT_BLOCKED and refresh the OKF bundle before changing code.

## Q1. Why did local tests pass while Azure deployment failed?

Local tests prove only their source/fixture/contract scope. Azure adds release identity, RBAC, secret metadata, what-if, Bicep, revision, and health boundaries.

Official source and location:
- ARM what-if operation, What-if operation and Required permissions, observed web lines 29-52.[^arm-what-if]
- Azure CLI what-if option table, observed web lines 1016-1042 and 1071-1092.[^az-what-if-help]
- Internal: docs/teams-release-workflow.md lines 39-47.

Action:
- Label every result FIXTURE/LOCAL, CI, or LIVE.
- Do not call local PASS a release PASS.

## Q2. Does a successful immutable image workflow prove deployment?

No. It proves an image/artifact job only. The Azure revision must have healthy replicas and readiness evidence.

Official source and location:
- Azure Container Apps health probes, Types of probes and multiple revision traffic, observed web lines 36-41 and 187-188.[^aca-health]
- Internal: docs/azure-release-run-ledger.md lines 47-55 and gates F22-F23.

Action:
- Block on activation failed, no replicas, readiness timeout, or missing public health.

## Q3. Does organization-published mean the installed Teams app is current?

No. Teams package contents and hosted application logic are different. Installed-client update and public runtime read-back are separate gates.

Official source and location:
- Teams app package, App manifest and publishing choices, observed web lines 45-72.[^teams-package]
- Upload your custom app, Upload your app and Update your app, observed web lines 48-60 and 100-122.[^teams-upload]

Action:
- Reconcile portal status, ZIP internal manifest/SHA, installed version, public health, and a new Bot reply.

## Q4. Why did Run 26 fail on Key Vault?

The workload referenced a secret that was absent. The preflight did not stop before mutation.

Official source and location:
- Key Vault quickstart, Add a secret to Key Vault and Retrieve a secret, observed web lines 80-95.[^key-vault]
- Internal: docs/azure-release-run-ledger.md line 23 and D15-D16.

Action:
- Read only safe metadata.
- Stop on missing/disabled/expired.
- Never write secret values to logs, OKF, Jira, or receipts.

## Q5. Why did Run 27 reject a legitimate Modify?

The classifier allowlist had drifted from the current Bicep/Key Vault property paths. Five current paths appeared as Modify while only three old paths were allowed.

Official source and location:
- ARM what-if, What-if operation and Change types, observed web lines 29-52.[^arm-what-if]
- Azure CLI what-if accepted change types, observed web lines 1016-1031 and 1071-1077.[^az-what-if-help]

Action:
- Keep exact current target paths in the allowlist.
- Add a RED fixture for every intentional shape.
- Keep out-of-scope Modify/Delete/Deploy/Ignore/Unsupported fail-closed.

## Q6. Why did Run 28 and Run 29 repeat the same problem?

Run 28 used pipeline source 45e31b7 while the release receipt named 71df02e. The task checked HEAD before materializing the receipt source. Run 29 added diagnostic capture in dada852 but did not change that behavior.

Internal source lines:
- azure-pipelines.yml: release receipt parsing, fetch, checkout, HEAD/worktree check.
- scripts/azure-platform-contract-test.mjs: lines 790-803 and 908-919.
- Fix commit: 18cea41.

Action:
- fetch and checkout the exact receipt commit in every source-consuming task.
- Treat diagnostics-only and behavioral fixes as separate change types.

## Q7. Is Run 30 complete after the manual approval?

No. The manual approval only allowed the deployment stage to execute. Run 30 then failed inside its single post-approval AzureCLI task with `Script failed with exit code: 1`. Because the run retained no named failure boundary or durable failure receipt, the exact Azure subcommand is unknown rather than silently treated as a foundation, workload, ACR, revision, or health failure.

Official source and location:
- Azure Pipelines approvals control when a stage should run, observed web lines 42-58 and 67-77.[^az-approval]
- Deployment jobs define separate deploy/health/failure lifecycle hooks, observed web lines 55-76.[^az-deployment-jobs]
- Azure Container Apps requires revision status and system/application logs to diagnose startup failures, observed web lines 33-80.[^aca-start-failures]
- Internal: docs/azure-release-run-ledger.md lines 98-107 and docs/okf/teamsapp-release/failure-history.md Run 30 section.

Action:
- Keep Run 30 `FAIL` and do not infer the root cause from its generic exit code.
- Use the next run's `azure-deployment-failure-receipt` artifact and exact Azure revision/log read-back to classify the boundary.
- Do not send the Teams completion message, mark Jira Done, or promote production.

## Q16. What changed after Run 30?

The release pipeline now names its last execution boundary and writes a secret-free failure receipt on an AzureCLI error. The receipt contains only stage/job, boundary, exit code, source commit, release version, run ID, timestamp, and a next-action pointer; raw stderr and secret material are not persisted. A failed-task artifact is published with `condition: failed()`.

Internal source and verification:
- `azure-pipelines.yml` DeployCanary AzureCLI block and failure artifact step.
- `scripts/azure-deployment-failure-receipt.mjs` and `scripts/azure-deployment-failure-receipt-test.mjs`.
- Fix commit: `3bfcd676ff510aefdbea6e267c3e238063f9b96f`.
- `npm run test:azure-deployment-failure-receipt` — GREEN.
- `npm run test:azure-core-runner` — GREEN; the new regression is in the Azure Core inventory.
- `node scripts/azure-platform-contract-test.mjs` — GREEN.

Limit:
- This is a diagnostic/reliability improvement, not proof that Azure Run 30 succeeded. A new Azure run is required to observe the real failing boundary and then the revision/health gates.

## Q17. Why did Run 31 fail before approval even though the source checkout was exact?

Run 31 used the CI/documentation fix commit `f6cce7c...` for both the Azure Pipeline source and the deploy-only `githubReleaseCommit` parameter. The authenticated handoff then looked for exactly one unexpired `teams-runtime-identity-f6cce7c...` artifact and found zero. The run stopped in `ValidateHandoff`; no environment approval or Azure mutation occurred.

Official source and location:
- GitHub's artifact REST contract supports filtering by artifact name and returns `digest` plus `workflow_run.head_sha`, observed web lines 13-18, 34-38, 45-53, and 71-78.[^github-artifacts]
- GitHub artifact attestations bind repository, workflow, environment, commit SHA, and triggering event to provenance, and consumers must verify them, observed web lines 25-32 and 58-63.[^github-attestations]

Internal evidence:
- Azure DevOps Run 31, log 11: `Login Succeeded`; exact checkout at `f6cce7c`; `Invalid GitHub release handoff: expected exactly one unexpired teams-runtime-identity-f6cce7... artifact, found 0`; `Bash exited with code '1'`.
- `scripts/azure-github-handoff.mjs` selects the exact artifact name and requires one unexpired artifact, matching head SHA, immutable digest, and attested subjects.

Action:
- Keep the pipeline source commit and deploy-only release artifact commit separate.
- Select only a commit with a retained GitHub immutable release artifact and attestation, such as the previously validated `71df02e...` release identity, for the next diagnostic run.
- Retain a `github-handoff-failure-receipt` artifact whenever pre-approval handoff fails. This is a diagnostic gate, not a release success signal.

## Q8. Can what-if replace the real deployment?

No. What-if predicts changes without applying them.

Official source and location:
- ARM what-if operation, observed web lines 29-31.[^arm-what-if]

Action:
- Run what-if before approval, then separately verify the first mutation, revision, replica, readiness, and health.

## Q9. Why can a ready Teams status card coexist with no response?

A card is a rendering observation, not proof of a current authenticated host session or a fresh Bot reply. Teams authentication expiry, stale tabs, old runtime, and public DNS can break later requests.

Internal source lines:
- docs/teams-release-workflow.md lines 103-115.
- Historical Teams runtime records: ready card, later authentication expired, and public curl 6 DNS failure.

Action:
- Send one bounded fresh test in the current installed app.
- Capture current accessibility tree, screenshot, reply, and public health identity.
- Never reuse an old card for a new release.

## Q10. Why did A2A fixture tests pass while workers were unavailable?

Fixture/mock workers do not prove independent authenticated Codex workers. Native executable signature/digest and separate auth homes are live prerequisites.

Internal source:
- docs/codex-a2a-isolation-validation.md.
- docs/teams-release-workflow.md lines 31-36.

Action:
- Keep A2A_UNVERIFIED until live Agent Card, send/get/list/cancel, parallel, restart, and telemetry evidence exists.

## Q11. Was iCloud the root cause of every failure?

No. FileProvider was a source/build provenance risk. Azure Run 26–30 had independent causes: missing secret, what-if classifier drift, and release source mismatch.

Internal source:
- AGENTS.md lines 93-99.
- docs/azure-release-run-ledger.md lines 21-55.

Action:
- Record SOURCE_IO_UNSTABLE separately from Azure runtime failure.
- Never use an old bundle or running server to hide a source problem.

## Q12. Should every failed retry increment the app version?

No. Audit, documentation, CI changes, and blocked deployment retries do not qualify. Version bump requires a user-visible feature or reproduced bug fix, RED regression, implementation GREEN, and Core evidence.

Internal source:
- AGENTS.md lines 3-8.
- docs/teams-release-workflow.md lines 39-47 and 65-90.

Action:
- Keep 1.0.103 for this release-loop recovery.
- Bind any future qualifying bump to commit, manifest, ZIP SHA, image, health, and UI evidence.

## Q13. Do secrets or MFA/device codes belong in this knowledge bundle?

No. OKF sources preserve provenance, not secret values. Passwords, OTPs, passkeys, recovery codes, bearer tokens, and secret values remain user-only or secret-store inputs.

Internal source:
- AGENTS.md lines 38-47.
- docs/azure-release-run-ledger.md lines 72-76.

Action:
- Store only safe metadata and redacted error text.

## Q14. Should every available agent slot be filled?

No. Delegation is allowed only for independent work with a concrete deliverable and measured net time advantage. Unreconciled result, empty final response, detached worktree, or stale branch is not success.

Internal source:
- AGENTS.md lines 10-17.
- docs/azure-release-run-ledger.md gates G27-G30.

Action:
- Parent owns critical path, browser/auth handoff, integration, and release evidence.
- Close completed/errored/interrupted agents and reconcile every worktree before ending the turn.

## Q15. What is the minimum release-complete proof?

All required items must use the same identity:

- canonical source commit and clean tracked worktree;
- package/manifest version, app ID, device permissions, ZIP SHA;
- immutable image digest;
- same-run handoff, RBAC, what-if, and secret metadata receipt;
- healthy Azure revision with replicas and probes;
- public health source/version/image identity;
- portal and installed Teams package identity;
- fresh Teams desktop Bot reply and UI evidence;
- mobile only when actual mobile evidence exists;
- blocker-to-Jira mapping and durable non-empty receipt.

If any item is FAIL, BLOCKED, UNVERIFIED, or MIXED_IDENTITY, completion is forbidden.

[^okf-spec]: Open Knowledge Format v0.2 specification, sections 3-5 and 8-9, observed web lines 253-327, 370-444, 486-513. https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
[^arm-what-if]: ARM what-if operation, What-if operation and permissions, observed web lines 29-52. https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if
[^az-what-if-help]: Azure CLI az deployment group what-if, option table and examples, observed web lines 1016-1042 and 1071-1092. https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest
[^az-approval]: Pipeline deployment approvals, stage pause and checks, observed web lines 37-50 and 56-64. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops
[^az-deployment-jobs]: Deployment jobs, rollout lifecycle hooks and `on: failure` handling, observed web lines 55-76. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops
[^github-artifacts]: REST API endpoints for GitHub Actions artifacts, artifact lookup/name filtering and response schema including `digest` and `workflow_run.head_sha`, observed web lines 13-18, 34-38, 45-53, 71-78. https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10
[^github-attestations]: GitHub artifact attestations, provenance fields and verification boundary, observed web lines 25-32 and 58-63. https://docs.github.com/en/actions/concepts/security/artifact-attestations
[^aca-start-failures]: Troubleshoot start failures in Azure Container Apps, revision/log diagnosis and common causes, observed web lines 33-80. https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures
[^aca-exit-failures]: Troubleshoot Container Exit Failures in Azure Container Apps, exit events and diagnostics, observed web lines 31-55. https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-create-failures
[^aca-health]: Health probes in Azure Container Apps, probe types and readiness, observed web lines 36-41 and 187-188. https://learn.microsoft.com/en-us/azure/container-apps/health-probes
[^key-vault]: Azure Key Vault quickstart, add/retrieve secret sections, observed web lines 80-95. https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli
[^teams-package]: Teams app package, App manifest and publishing choices, observed web lines 45-72. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package
[^teams-upload]: Upload your custom app, upload/update sections, observed web lines 48-60 and 84-122. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload
