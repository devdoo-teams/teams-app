---
type: "Reference"
title: "TeamsApp official contracts for release evidence"
description: "Official Google OKF, Microsoft Azure, Azure DevOps, and Teams contracts with exact section and observed web line references."
resource: /official-contracts.md
tags: [official-contract, azure, teams, release, evidence]
generated:
  by: "process:codex-okf/1"
  at: "2026-09-06T13:31:30Z"
verified:
  by: "process:official-source-research/1"
  at: "2026-09-06T13:31:30Z"
status: stable
stale_after: "2026-09-13T13:31:30Z"
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
  - id: az-environments
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/environments?view=azure-devops"
    title: "Use Azure Pipelines environments"
    location: "Environment approvals and deployment history sections; section anchor used because rendered line numbers are not stable"
  - id: aca-probes
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/health-probes"
    title: "Health probes in Azure Container Apps"
    location: "Types of probes and multiple revision traffic guidance; observed web lines 36-41 and 187-188 on 2026-09-06"
  - id: aca-start
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures"
    title: "Troubleshoot start failures in Azure Container Apps"
    location: "Health probe failures; observed web line 69 on 2026-09-06"
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

ARM what-if previews a deployment and does not change existing resources.[^arm-what-if] The Azure CLI help exposes the change types and automation options used by this repository, including no-pretty-print, result-format, and validation-level.[^az-group-what-if]

Azure Pipelines pauses a stage until all resource checks are satisfied; an unsuccessful or timed-out check prevents stage execution.[^az-approvals] Azure Container Apps distinguishes startup, liveness, and readiness; in multiple revision mode readiness must succeed before traffic is shifted.[^aca-probes] A running image or 100 percent traffic indicator is not sufficient when the revision has no healthy replica.

Key Vault documentation shows that secret creation and value retrieval are distinct operations.[^key-vault] This project records only secret name and safe status metadata; it never records the value.

# Teams distribution contract

The Teams package document says the package contains the manifest and icons while application logic and data are hosted elsewhere over HTTPS.[^teams-package] The custom app document separates upload prerequisites, installed app management, and update behavior.[^teams-upload] Organization publication and user installation/update are therefore separate evidence boundaries.[^teams-publish]

# Location contract

Teams browser/OS permission, host context, and HTML5 geolocation are separate runtime boundaries. The current product scope removes weather/location from Core; if location returns in a separate release, the permission/reload and location capability contracts must be rechecked against the official Microsoft pages listed in the sources frontmatter.[^teams-permissions][^teams-location]

# Citation discipline

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
[^aca-probes]: Health probes in Azure Container Apps, probe types and revision traffic guidance, observed web lines 36-41 and 187-188. https://learn.microsoft.com/en-us/azure/container-apps/health-probes
[^key-vault]: Azure Key Vault quickstart, add/retrieve secret sections, observed web lines 80-95. https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli
[^teams-package]: Teams app package, App manifest and publishing choices, observed web lines 45-72. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package
[^teams-upload]: Upload your custom app, upload/access/update sections, observed web lines 48-60 and 84-122. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload
[^teams-publish]: Publish your Microsoft Teams agent or app, Before you publish, observed web lines 52-69. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-publish-overview
[^teams-permissions]: Browser device permissions in Teams, declare permission and reload guidance sections. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/browser-device-permissions
[^teams-location]: Location capability in Teams, location support and browser fallback sections. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/location-capability
