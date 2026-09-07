---
type: "Reference"
title: "TeamsApp official contracts for release evidence"
description: "Official Google OKF, Microsoft Azure, Azure DevOps, and Teams contracts with exact section and observed web line references."
resource: /official-contracts.md
tags: [official-contract, azure, teams, release, evidence]
generated:
  by: "process:codex-okf/1"
  at: "2026-09-07T14:42:00Z"
verified:
  by: "process:official-source-research/1"
  at: "2026-09-07T14:42:00Z"
status: stable
stale_after: "2026-09-14T14:42:00Z"
sources:
  - id: okf-spec
    resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md"
    title: "Open Knowledge Format v0.2 specification"
    location: "Sections 1, 2, 3, 4, 5, 6, 8, 9; observed web rendering lines 197-204, 253-315, 370-444, 486-513 on 2026-09-06"
  - id: okf-blog
    resource: "https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/"
    title: "Introducing the Open Knowledge Format"
    location: "Introduction and What we are shipping sections; observed web lines 63-91 and 148-175 on 2026-09-06"
  - id: arm-what-if
    resource: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if"
    title: "Template deployment what-if - Azure Resource Manager"
    location: "What-if operation, Required permissions, and What-if limits; observed web lines 29-52 on 2026-09-06"
  - id: az-group-what-if
    resource: "https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest"
    title: "az deployment group what-if"
    location: "what-if option table and examples; observed web lines 1016-1042 and 1071-1092 on 2026-09-06"
  - id: az-approvals
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops"
    title: "Pipeline deployment approvals - Azure Pipelines"
    location: "Approvals and checks; observed web lines 37-50 and 56-64 on 2026-09-06"
  - id: az-deployment-jobs
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops"
    title: "Deployment jobs - Azure Pipelines"
    location: "Deployment lifecycle hooks and `on: failure`; observed web lines 55-76 on 2026-09-06"
  - id: node-esm
    resource: "https://nodejs.org/api/esm.html"
    title: "Modules: ECMAScript modules - Node.js documentation"
    location: "Import specifiers, relative resolution, and mandatory file extensions; observed web lines 212-226 on 2026-09-06"
  - id: az-pipeline-artifacts
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/artifacts/pipeline-artifacts?tabs++=+yaml&view=azure-devops"
    title: "Publish and download pipeline artifacts - Azure Pipelines"
    location: "Use Artifacts across stages and migration guidance; observed web lines 305-355 on 2026-09-07"
  - id: az-artifact-rest
    resource: "https://learn.microsoft.com/en-us/rest/api/azure/devops/build/artifacts/get-artifact?view=azure-devops-rest-7.1"
    title: "Artifacts - Get Artifact REST API"
    location: "Get Artifact operation, buildId/artifactName query, API version 7.1; observed current page on 2026-09-07"
  - id: aca-blue-green
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/blue-green-deployment"
    title: "Blue-Green Deployment in Azure Container Apps"
    location: "Blue/green responsibilities, labels, zero-traffic verification, traffic switch, rollback; observed web lines 31-57 on 2026-09-07"
  - id: az-vm-run-command
    resource: "https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command"
    title: "Run scripts in a Linux VM by using action Run Commands"
    location: "VM agent execution, RunShellScript, bounded output/time, and non-interactive restrictions; observed 2026-09-07"
  - id: vm-custom-script
    resource: "https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/custom-script-linux"
    title: "Run Custom Script Extension on Linux VMs in Azure"
    location: "Tips, managedIdentity protected settings, and troubleshooting logs; observed web lines 68-81, 203-243, 383-413 on 2026-09-07"
  - id: aca-managed-identity-pull
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull"
    title: "Azure Container Apps image pull with managed identity"
    location: "User-assigned identity, AcrPull, and revision image pull flow; observed web lines 31-37, 47-62, 95-140 on 2026-09-07"
  - id: official-aca-bicep-examples
    resource: "https://github.com/microsoft/azure-container-apps/tree/main/templates/bicep"
    title: "microsoft/azure-container-apps Bicep templates"
    location: "Public main tree with main.bicep, workloadProfiles, ruleBasedRouting, and ingress examples; observed 2026-09-07"
  - id: official-azure-pipelines-deployment-example
    resource: "https://github.com/microsoft/azure-pipelines-yaml/blob/master/design/deployment.md"
    title: "microsoft/azure-pipelines-yaml deployment design"
    location: "A deployment job, environment history, runOnce lifecycle; observed web lines 196-243 on 2026-09-07"
  - id: az-environments
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/environments?view=azure-devops"
    title: "Use Azure Pipelines environments"
    location: "Environment approvals and deployment history sections; section anchor used because rendered line numbers are not stable"
  - id: github-artifacts
    resource: "https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10"
    title: "REST API endpoints for GitHub Actions artifacts"
    location: "artifact lookup/name filter, digest, workflow_run.head_sha, and Actions read permission; observed web lines 13-18, 34-38, 45-53, 71-78 on 2026-09-06"
  - id: github-attestations
    resource: "https://docs.github.com/en/actions/concepts/security/artifact-attestations"
    title: "Artifact attestations - GitHub Docs"
    location: "provenance fields and verification boundary; observed web lines 25-32 and 58-63 on 2026-09-06"
  - id: aca-probes
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/health-probes"
    title: "Health probes in Azure Container Apps"
    location: "Types of probes and multiple revision traffic guidance; observed web lines 36-41 and 187-188 on 2026-09-06"
  - id: aca-scaling
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/scale-app"
    title: "Set scaling rules in Azure Container Apps"
    location: "minimum replicas, scale-to-zero, and always-running guidance; observed web lines 31-56 on 2026-09-07"
  - id: aca-revisions
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/revisions"
    title: "Update and deploy changes in Azure Container Apps"
    location: "revision running states, Scale to 0, readiness, and multiple-revision traffic; observed web lines 48-72 and 128-138 on 2026-09-07"
  - id: aca-start
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures"
    title: "Troubleshoot start failures in Azure Container Apps"
    location: "Revision/log diagnosis, common failures, configuration, and probes; observed web lines 33-80 on 2026-09-06"
  - id: aca-exit
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-create-failures"
    title: "Troubleshoot Container Exit Failures in Azure Container Apps"
    location: "Exit-event causes and diagnostics; observed web lines 31-55 on 2026-09-06"
  - id: key-vault
    resource: "https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli"
    title: "Quickstart - Set and retrieve a secret from Azure Key Vault"
    location: "Add a secret to Key Vault and Retrieve a secret; observed web lines 80-95 on 2026-09-06"
  - id: bicep-preflight
    resource: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-preflight"
    title: "Bicep deployment preflight validation"
    location: "Preflight validation section; section anchor used because rendered line numbers are not stable"
  - id: teams-package
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package"
    title: "Teams app package"
    location: "App manifest and publishing choices; observed web lines 45-72 on 2026-09-06"
  - id: teams-upload
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload"
    title: "Upload your custom app"
    location: "Upload your app, Access your app, Update your app; observed web lines 48-60 and 84-122 on 2026-09-06"
  - id: teams-publish
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-publish-overview"
    title: "Publish your Microsoft Teams agent or app"
    location: "Before you publish and valid app package; observed web lines 52-69 on 2026-09-06"
  - id: teams-location
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/location-capability"
    title: "Location capability in Teams"
    location: "Location API support and browser fallback sections; section anchor used because rendered line numbers are not stable"
  - id: apple-sleep-settings
    resource: "https://support.apple.com/en-ie/guide/mac-help/mchle41a6ccd/mac"
    title: "Set sleep and wake settings for your Mac"
    location: "Set your Mac to go to sleep after inactivity and Specify sleep and wake settings; observed web lines 296-320 on 2026-09-07"
  - id: apple-lock-screen
    resource: "https://support.apple.com/en-euro/guide/mac-help/-mh11784/mac"
    title: "Change Lock Screen settings on Mac"
    location: "Lock Screen options, including Require password after screen saver begins or display is turned off; observed web lines 274-292 on 2026-09-07"
  - id: teams-permissions
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/browser-device-permissions"
    title: "Browser device permissions in Teams"
    location: "Declare device permissions and permission/reload guidance; section anchor used because rendered line numbers are not stable"
---

# Purpose

This concept is the source map for the TeamsApp release OKF bundle. It records not only the URL but the exact section and the web-rendering line range observed during research. A future reader must re-open the source and compare the current contract before using a time-sensitive claim.

# OKF contract

Google's canonical OKF v0.2 specification says that a knowledge bundle is a directory of Markdown documents with YAML frontmatter and that the only always-required concept key is type.[^okf-spec] It also says provenance belongs in sources, generated and verified are separate, status expresses lifecycle, and log/index files have defined bundle conventions.[^okf-spec]

The Google Cloud announcement describes OKF as a vendor-neutral, human- and agent-friendly, portable format rather than a runtime or required SDK.[^okf-blog] Therefore this bundle uses plain Markdown/YAML and does not claim that OKF itself validates Azure or Teams behavior.

# Azure release contract

The Linux VM worker has a separate runtime gate from ACA HTTP health. Microsoft documents that VM Run Command uses the VM agent, supports the `RunShellScript` command for Linux, limits output and execution time, and does not support interactive prompts. The release pipeline therefore runs a non-interactive probe only: it reads systemd state and release metadata, hashes the installed Codex executable, checks owner-only `auth.json` metadata without reading its contents, and runs `codex login status` as the service user. User login, device code, password, and MFA remain outside the pipeline. Source: [Run scripts in a Linux VM by using action Run Commands](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command), Benefits, Restrictions, Available commands, and Azure CLI sections observed on 2026-09-07.

# GitHub release handoff contract

GitHub's Actions artifact API permits an exact artifact-name lookup and returns the artifact digest together with `workflow_run.head_sha`; private repositories require an Actions read permission for the relevant endpoint.[^github-artifacts] GitHub artifact attestations bind repository, workflow, environment, commit SHA, and triggering event to provenance, and verification is required by the consumer rather than implied by artifact existence.[^github-attestations]

For this repository, `githubReleaseCommit` is therefore a deploy-only immutable release identity. It must resolve to exactly one unexpired `teams-runtime-identity-<commit>` artifact whose workflow head SHA, digest, extracted release receipt, package digest, and attestations all match. A pipeline/documentation source commit without that artifact is not a deployable release and must stop before approval.

ARM what-if previews a deployment and does not change existing resources.[^arm-what-if] The Azure CLI help exposes the change types and automation options used by this repository, including no-pretty-print, result-format, and validation-level.[^az-group-what-if]

Azure Pipelines approvals control when a stage should run; they do not assert that every later deployment command succeeded.[^az-approvals] Deployment jobs model deploy, route/post-route health, and `on: failure` lifecycle hooks separately.[^az-deployment-jobs] Azure Container Apps troubleshooting requires revision state plus system/application logs to classify image pull, timeout, crash, ingress, probe, configuration, and secret-reference failures.[^aca-start] Container Apps distinguishes startup, liveness, and readiness; in multiple revision mode readiness must succeed before traffic is shifted.[^aca-probes] A running image or 100 percent traffic indicator is not sufficient when the revision has no healthy replica.

Key Vault documentation shows that secret creation and value retrieval are distinct operations.[^key-vault] This project records only secret name and safe status metadata; it never records the value.

Azure DevOps pipeline artifacts are a stage handoff, not automatic proof that a file is readable: the producer must publish and the consumer must download/read back the exact artifact.[^az-pipeline-artifacts][^az-artifact-rest] Container Apps blue-green guidance keeps the stable revision serving traffic while a labeled green revision is tested before promotion and preserves rollback.[^aca-blue-green] Linux Custom Script Extension guidance requires idempotent, noninteractive scripts and identifies `/var/log/waagent.log` and `/var/log/azure/custom-script/handler.log` as diagnostic boundaries.[^vm-custom-script] ACR managed identity and `AcrPull` prove a separate image pull authorization boundary, not revision readiness.[^aca-managed-identity-pull]

# Teams distribution contract

The Teams package document says the package contains the manifest and icons while application logic and data are hosted elsewhere over HTTPS.[^teams-package] The custom app document separates upload prerequisites, installed app management, and update behavior.[^teams-upload] Organization publication and user installation/update are therefore separate evidence boundaries.[^teams-publish]

# Location contract

Teams browser/OS permission, host context, and HTML5 geolocation are separate runtime boundaries. The current product scope removes weather/location from Core; if location returns in a separate release, the permission/reload and location capability contracts must be rechecked against the official Microsoft pages listed in the sources frontmatter.[^teams-permissions][^teams-location]

# Citation discipline

## Remote display and lock evidence

Apple documents power/sleep timing separately from Lock Screen password behavior.[^apple-sleep-settings][^apple-lock-screen] The installed `pmset` help likewise defines `-g assertions` as a power-assertion report, while `screencapture` is a screen-capture utility. Neither contract says that a power assertion, a black capture, or a failed automation control proves the state of a different remote display session.

This repository therefore keeps the following evidence boundaries distinct: `POWER_ASSERTION_ACTIVE` for `pmset`/Caffeine power assertions, `REMOTE_CAPTURE_UNAVAILABLE` for a black local capture, `CUA_CONTROL_UNAVAILABLE` for a Computer Use control failure, and `USER_REMOTE_VIEW` for a user-provided remote screenshot at its capture time. Only corroborated same-host/same-session direct lock evidence is `CONFIRMED_SCREEN_LOCK`. A conflict is `REMOTE_SESSION_MISMATCH`, not a license to infer that the user locked the Mac or to ask for unlock.

For every new failure, record all of the following before changing code:

1. Official URL and exact section title.
2. Web line range if the current renderer exposes a stable range; otherwise state section-anchor-only.
3. Installed tool version and subcommand help excerpt.
4. Internal source file and exact line range.
5. Reproduction command, exit status, and unredacted failure retained only in approved local logs.
6. Redacted evidence suitable for this bundle.
7. Fix commit, RED test, GREEN test, and live read-back status.

[^okf-spec]: Open Knowledge Format v0.2 specification, sections 1-5, observed web lines 197-204, 253-315, 370-444, 486-513. https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
[^okf-blog]: Google Cloud, Introducing the Open Knowledge Format, introduction and format-not-platform sections, observed web lines 63-91 and 148-175. https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/
[^arm-what-if]: ARM what-if operation, What-if operation and Required permissions, observed web lines 29-52. https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if
[^az-group-what-if]: Azure CLI az deployment group what-if, option table and examples, observed web lines 1016-1042 and 1071-1092. https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest
[^az-approvals]: Pipeline deployment approvals, approvals/checks and stage execution, observed web lines 37-50 and 56-64. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops
[^az-deployment-jobs]: Deployment jobs, rollout lifecycle hooks and `on: failure` handling, observed web lines 55-76. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops
[^az-pipeline-artifacts]: Publish and download pipeline artifacts, stage handoff and workspace guidance, observed web lines 305-355. https://learn.microsoft.com/en-us/azure/devops/pipelines/artifacts/pipeline-artifacts?tabs++=+yaml&view=azure-devops
[^az-artifact-rest]: Artifacts - Get Artifact REST API, API version 7.1 and artifact lookup contract. https://learn.microsoft.com/en-us/rest/api/azure/devops/build/artifacts/get-artifact?view=azure-devops-rest-7.1
[^github-artifacts]: REST API endpoints for GitHub Actions artifacts, artifact lookup/name filter and response schema including `digest` and `workflow_run.head_sha`, observed web lines 13-18, 34-38, 45-53, 71-78. https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10
[^github-attestations]: GitHub artifact attestations, provenance fields and verification boundary, observed web lines 25-32 and 58-63. https://docs.github.com/en/actions/concepts/security/artifact-attestations
[^aca-probes]: Health probes in Azure Container Apps, probe types and revision traffic guidance, observed web lines 36-41 and 187-188. https://learn.microsoft.com/en-us/azure/container-apps/health-probes
[^aca-blue-green]: Blue-Green Deployment in Azure Container Apps, stable/green revision, labels, traffic switch and rollback, observed web lines 31-57. https://learn.microsoft.com/en-us/azure/container-apps/blue-green-deployment
[^aca-start]: Troubleshoot start failures in Azure Container Apps, revision/log diagnosis and common causes, observed web lines 33-80. https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures
[^aca-exit]: Troubleshoot Container Exit Failures in Azure Container Apps, exit events and diagnostics, observed web lines 31-55. https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-create-failures
[^key-vault]: Azure Key Vault quickstart, add/retrieve secret sections, observed web lines 80-95. https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli
[^vm-custom-script]: Run Custom Script Extension on Linux VMs, idempotence tips, managed identity protected settings, and troubleshooting logs, observed web lines 68-81, 203-243, 383-413. https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/custom-script-linux
[^aca-managed-identity-pull]: Azure Container Apps image pull with managed identity, identity/AcrPull/revision flow, observed web lines 31-37, 47-62, 95-140. https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull
[^teams-package]: Teams app package, App manifest and publishing choices, observed web lines 45-72. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package
[^teams-upload]: Upload your custom app, upload/access/update sections, observed web lines 48-60 and 84-122. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload
[^teams-publish]: Publish your Microsoft Teams agent or app, Before you publish, observed web lines 52-69. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-publish-overview
[^teams-permissions]: Browser device permissions in Teams, declare permission and reload guidance sections. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/browser-device-permissions
[^teams-location]: Location capability in Teams, location support and browser fallback sections. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/location-capability
[^apple-sleep-settings]: Apple Support, Set sleep and wake settings for your Mac, observed web lines 296-320 on 2026-09-07. https://support.apple.com/en-ie/guide/mac-help/mchle41a6ccd/mac
[^apple-lock-screen]: Apple Support, Change Lock Screen settings on Mac, observed web lines 274-292 on 2026-09-07. https://support.apple.com/en-euro/guide/mac-help/-mh11784/mac
