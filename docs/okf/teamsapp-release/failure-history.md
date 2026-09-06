---
type: "Release Failure History"
title: "TeamsApp Azure and Teams release failure history"
description: "Evidence-bounded history of source, provider, Azure, Teams, and release-loop failures with root causes and fixes."
resource: /failure-history.md
tags: [teamsapp, azure, release, incident, failure, provenance]
generated:
  by: "process:codex-okf/1"
  at: "2026-09-06T13:31:30Z"
verified:
  by: "process:release-evidence-reconciliation/1"
  at: "2026-09-06T13:31:30Z"
status: stable
stale_after: "2026-09-13T13:31:30Z"
sources:
  - id: okf-spec
    resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md"
    title: "Open Knowledge Format v0.2 specification"
    location: "Sections 1, 3, 4, 5, 8, 9; observed web lines 197-204, 253-327, 370-444, 486-513"
  - id: arm-what-if
    resource: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if"
    title: "Template deployment what-if - Azure Resource Manager"
    location: "What-if operation and permissions; observed web lines 29-52"
  - id: az-what-if-help
    resource: "https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest"
    title: "az deployment group what-if"
    location: "what-if option table and examples; observed web lines 1016-1042 and 1071-1092"
  - id: az-approval
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops"
    title: "Pipeline deployment approvals - Azure Pipelines"
    location: "approval/check stage pause; observed web lines 37-50 and 56-64"
  - id: aca-health
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/health-probes"
    title: "Health probes in Azure Container Apps"
    location: "probe types and readiness before traffic; observed web lines 36-41 and 187-188"
  - id: teams-package
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package"
    title: "Teams app package"
    location: "manifest, package, hosting and publish choices; observed web lines 45-72"
  - id: teams-upload
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload"
    title: "Upload your custom app"
    location: "upload prerequisites and update behavior; observed web lines 48-60 and 84-122"
  - id: key-vault
    resource: "https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli"
    title: "Quickstart - Set and retrieve a secret from Azure Key Vault"
    location: "add/retrieve secret sections; observed web lines 80-95"
  - id: azure-run-27
    resource: "https://dev.azure.com/devdoo/1ab04197-bb8b-4b2a-bc59-084f08e4d5b9/_build/results?buildId=27"
    title: "TeamsApp Azure DevOps Run 27"
    location: "run result and deployment/preflight logs"
  - id: azure-run-28
    resource: "https://dev.azure.com/devdoo/1ab04197-bb8b-4b2a-bc59-084f08e4d5b9/_build/results?buildId=28"
    title: "TeamsApp Azure DevOps Run 28"
    location: "run result and pre-approval source mismatch"
  - id: azure-run-29
    resource: "https://dev.azure.com/devdoo/1ab04197-bb8b-4b2a-bc59-084f08e4d5b9/_build/results?buildId=29"
    title: "TeamsApp Azure DevOps Run 29"
    location: "run result and diagnostic reproduction"
  - id: azure-run-30
    resource: "https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=30"
    title: "TeamsApp Azure DevOps Run 30"
    location: "current run status and approval waiting state"
  - id: pipeline-source
    resource: "https://github.com/devdoo-teams/teams-app/blob/18cea41fd16d97b39038a00761a272ae23d310d5/azure-pipelines.yml"
    title: "TeamsApp Azure pipeline at source-materialization fix"
    location: "release receipt parsing, fetch/checkout, HEAD/worktree verification"
  - id: platform-contract
    resource: "https://github.com/devdoo-teams/teams-app/blob/18cea41fd16d97b39038a00761a272ae23d310d5/scripts/azure-platform-contract-test.mjs"
    title: "TeamsApp Azure platform contract test"
    location: "pre-approval and deploy source-materialization assertions"
  - id: release-workflow
    resource: "https://github.com/devdoo-teams/teams-app/blob/main/docs/teams-release-workflow.md"
    title: "TeamsApp release workflow"
    location: "official-contract debugging and same-release evidence rules"
---

# Executive finding

The repeated mismatch was not one single failure. It was a combination of real defects and evidence-boundary overclaiming.

The real Azure failures in the retained run history are:

1. Run 26: missing Key Vault secret.
2. Run 27: current five-secret what-if modifications were not in the classifier allowlist.
3. Run 28: pipeline checkout commit differed from the attested release commit.
4. Run 29: diagnostic logging improved but the source mismatch remained.
5. Run 30: the source materialization fix passed pre-approval, but the run is still waiting for manual approval.

Earlier failures also included FileProvider source instability, missing dependencies, non-live A2A/provider preflight, Teams authentication/session drift, mobile location retry lock, portal-versus-installed identity gaps, DNS/public runtime failure, canary activation failure, and delegated worktree/result reconciliation gaps.

A prior response that said “passed” without naming this evidence boundary was too broad. The corrected vocabulary is: local/fixture PASS, CI PASS, or live PASS only when the named gate and exact release identity match.

# Release identity

The current target is one immutable bundle:

- source commit: 71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a
- app/manifest: 1.0.103
- package SHA-256: 492bcf2a63fe398181fe1188e07c615089a63fb64ee37ef8df68704cf521e6cd
- image: ghcr.io/devdoo-teams/teams-app@sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27

Any other package, server, portal screen, or Teams message is not evidence for this target. OKF v0.2 makes provenance, trust, lifecycle, and attestation first-class in frontmatter.[^okf-spec]

# Timeline

## FileProvider and stale build provenance

Observed:
- EWORKTREEDIRTY
- tsx, esbuild, or client assets missing
- The service was stopped
- dataless/slow FileProvider materialization
- old server bundle, ZIP, or Dev Tunnel appearing as current

Root cause:
- build/package ran before confirming normal local source I/O and clean tracked state;
- pinned fallback could materialize an older commit from a dirty workspace;
- running process and new artifact were not reconciled to one identity.

Fix:
- classify dataless/read-delay/blocks=0/The service was stopped as SOURCE_IO_UNSTABLE;
- use one canonical worktree and require clean tracked files before fallback build;
- marker must include schema, full commit, mode, clean status, and bundle SHA;
- after a source change, create a new commit, bundle, ZIP, and receipt.

Internal evidence:
- AGENTS.md lines 93-99;
- docs/azure-release-run-ledger.md lines 3-19 and 77-87;
- source audit records in docs/research/2026-09-05-azure-what-if-rbac-review.md.

Result:
- source provenance rule implemented;
- current Azure canary remains unrelated and unverified.

## A2A/provider fixture versus live worker

Observed:
- AGENT_CODEX_HOME, auth.json, CODEX_BIN, and CODEX_BIN_SHA256 absent in some operating checks;
- a2aExecution.state=unavailable;
- signed/SHA-pinned executable preflight unavailable;
- mock children, fixed fixture tokens, or loopback HTTP tests passed.

Root cause:
- a worker profile contract was promoted to authenticated independent worker proof;
- configured/ready was not separated from a bounded authenticated capability call.

Fix:
- require isolated worker home, identity, executable digest/signature, cancellation, restart, and telemetry evidence;
- align validator and runtime worker cardinality;
- keep fixture PASS separate from live A2A PASS.

Internal evidence:
- docs/codex-a2a-isolation-validation.md;
- docs/teams-release-workflow.md lines 31-36;
- prior audit classification: A2A_UNVERIFIED.

Result:
- local contract coverage exists;
- live independent worker proof remains UNVERIFIED.

## Teams ready card, expired session, and mobile location

Observed:
- a ready card showed production, teams-authenticated, deterministic, codex;
- a later session showed Teams authentication expired or no reply;
- tab recovery screen appeared;
- mobile location timed out and retry could remain locked by a pending attempt.

Root cause:
- status card, current host session, WebView, OS permission, GPS callback, and server round-trip were treated as one state;
- timed-out HTML5 location attempts were not abandoned before a fresh retry.

Fix:
- require a new Teams message/reply and current host state, not an old card;
- separate bootstrap, permission, GPS, and server response evidence;
- keep weather/location outside current Core;
- if location returns, add an attempt-generation/abandon RED regression before version bump.

Internal evidence:
- docs/teams-mobile-location-contract.md;
- historical source audit: src/client/location.ts lines 391-602 and src/client/App.tsx lines 457-485;
- docs/teams-release-workflow.md lines 16-29.

Official evidence:
- browser/OS permissions and reload are separate contract sections in Microsoft's Browser device permissions page;
- Teams location support and HTML5 fallback are separate sections in Microsoft's Location capability page.

Result:
- historical client bug is CODE-REPRODUCIBLE;
- current mobile is MOBILE_UNVERIFIED;
- Core weather path is out of scope.

## GitHub image success versus Azure canary failure

Observed:
- immutable image workflows 33974456746 and 33976297233 showed success, artifacts, and attestation;
- Azure revision teamsapp-canary-goictvxm--756312161b showed active/100 percent traffic but activation failed and no active replicas.

Root cause:
- image supply-chain success was used as runtime readiness evidence.

Fix:
- gate on startup/liveness/readiness probes, active replicas, revision state, logs, and public health;
- activation failed, no replicas, or readiness timeout is BLOCKED;
- keep the previous service until a healthy canary and rollback identity exist.

Official evidence:
- Azure Container Apps defines startup, liveness, and readiness separately and says readiness must succeed before traffic shift.[^aca-health]
- Azure troubleshooting states that probe failure can restart the container or mark the revision unhealthy.

Result:
- image artifact is CI PASS;
- canary is FAIL/BLOCKED;
- production success is not proven.

## Teams portal publish versus installed/public identity

Observed:
- Developer Portal showed 1.0.103 published to the organization;
- local manifest/ZIP showed 1.0.103;
- public /api/health failed with curl 6: DNS 해석 실패;
- installed desktop/mobile version, ZIP SHA, and fresh Bot reply were not reconciled.

Root cause:
- organization publication, package, hosted runtime, and installed client were treated as one step.

Fix:
- read back ZIP internal manifest, app ID, version, device permissions, and SHA;
- update the existing app identity through the update path;
- reconcile portal, downloaded package, installed client, public health, and fresh Bot reply.

Official evidence:
- Teams package docs separate manifest/icons from externally hosted app logic.[^teams-package]
- upload/update docs separate HTTPS prerequisites, installed-app management, and update consent.[^teams-upload]

Result:
- portal state is observed;
- same-release installed/public state is UNVERIFIED.

## Run 26: missing Key Vault secret

Failure:
    ERROR: (SecretNotFound) A secret with (name/id) teams-bot-client-secret was not found in this key vault.

Root cause:
- required secret metadata was not checked before the workload mutation.

Fix:
- check only secret name and safe status metadata before mutation;
- stop on missing/disabled/expired;
- never log or put secret value, password, token, MFA, or device code in any receipt.

Official evidence:
- Key Vault quickstart has distinct Add a secret and Retrieve a secret sections; observed web lines 80-95.[^key-vault]

Result:
- root cause confirmed;
- metadata preflight implemented;
- post-fix live deployment not yet observed.

## Run 27: what-if allowlist drift

Failure:
- current five Key Vault reference changes appeared as Modify;
- classifier knew only older three paths.

Root cause:
- Bicep/template evolution and classifier fixture drifted.

Fix:
- commit 45e31b7 added current property paths and keyVaultUrl variants;
- azure-what-if-receipt-test.mjs added the current five-secret RED fixture and GREEN assertion;
- outside Modify/Delete/Deploy/Ignore/Unsupported remains fail-closed.

Official evidence:
- ARM what-if is non-mutating and classifies predicted changes.[^arm-what-if]
- Azure CLI exposes the exact change types and automation options used by the gate.[^az-what-if-help]

Result:
- focused and Azure Core tests PASS;
- live post-fix canary not yet observed.

## Run 28: pipeline checkout versus attested release source

Failure:
- pipeline source was 45e31b7;
- release receipt source was 71df02e;
- HEAD equality failed before az --version and parameter output.

Root cause:
- pipeline checkout HEAD was assumed to be the attested release source.

Fix:
- pre-approval and deploy tasks now fetch the receipt commit, checkout it detached, then verify HEAD and clean tracked state.
- scripts/azure-platform-contract-test.mjs asserts the ordering.

Internal line references:
- azure-pipelines.yml release receipt block, current commit 18cea41;
- scripts/azure-platform-contract-test.mjs lines 790-803 and 908-919 in current source.

Result:
- behavioral fix present in 18cea41;
- Run 30 pre-approval observed the exact source materialization;
- post-approval deploy materialization not yet observed.

## Run 29: diagnostics did not fix behavior

Failure:
- source dada852;
- receipt source 71df02e;
- same mismatch reproduced.

Root cause:
- safe diagnostic capture was mistaken for a behavioral fix.

Fix:
- dada852 only retained redacted parameter-generation failure detail and checked that the output file was non-empty;
- 18cea41 changed behavior by materializing the exact receipt source;
- reports now label diagnostic-only and behavioral changes separately.

Result:
- diagnostics are safer;
- full release is not complete.

## Run 30: fixed pre-approval, waiting approval

Observed:
- pipeline source 18cea41fd16d97b39038a00761a272ae23d310d5;
- requested release 71df02e, app 1.0.103;
- authenticated handoff, Azure Core 26/26, RBAC, foundation what-if, worker/RBAC receipt completed;
- Azure DevOps UI says one approval needs review and deploy is waiting.

Official evidence:
- Azure Pipelines pauses a stage while resource checks are pending; an unsuccessful or timed-out check prevents stage execution.[^az-approval]

Result:
- pre-approval PASS within its named scope;
- Azure mutation, revision readiness, public health, Teams UI, and mobile are UNVERIFIED;
- no Teams completion message.

# Historical failure inventory

| Failure group | Observed evidence | Preventive classification |
|---|---|---|
| workflow no jobs were run | branch/event/job condition yielded no executed job | no-job is not PASS; contract-test event and condition |
| Azure org/account mismatch | tenant, project, service connection, or environment association did not reconcile | read back tenant/subscription/project/service connection |
| old Dev Tunnel or DNS | localhost, old tunnel, or curl 6 | use actual portUri and health identity |
| missing tsx/esbuild/assets | dependency-absent checkout | DEPENDENCY_BLOCKED; never guess-install in a read-only audit |
| Cosmos/storage drift | environment name/factory/wiring mismatch | configuration contract and live store proof |
| A2A address validation gap | reserved/mapped IPv6 or IPv4 review finding | dedicated security regression before live use |
| Teams card mismatch | duplicate top-level/card text or unsupported mobile subset | canonical card subset and actual client evidence |
| detached worktree and approval backlog | duplicate review, stale branches, pending tasks | direct parent default, bounded dispatch, close/reconcile |
| authentication boundary confusion | Codex CLI, Teams CLI, Azure, and MFA treated as one login | separate status checks; user-only secret handoff |

These records do not substitute for current Run 30 evidence.

# Current judgment

The current state is RELEASE_BLOCKED / RUN 30 WAITING_APPROVAL.

- local/contract/Azure Core evidence: PASS within scope;
- Azure mutation and healthy revision: NOT STARTED or UNVERIFIED;
- public health identity: UNVERIFIED;
- portal/installed same package: UNVERIFIED;
- Teams desktop fresh reply: UNVERIFIED;
- mobile: MOBILE_UNVERIFIED;
- live A2A: UNVERIFIED.

[^okf-spec]: Open Knowledge Format v0.2 specification, sections 1, 3, 4, 5, 8, 9, observed web lines 197-204, 253-327, 370-444, 486-513. https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
[^arm-what-if]: Template deployment what-if, What-if operation and permissions, observed web lines 29-52. https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if
[^az-what-if-help]: Azure CLI az deployment group what-if, option table and examples, observed web lines 1016-1042 and 1071-1092. https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest
[^az-approval]: Pipeline deployment approvals, stage pause and approval sections, observed web lines 37-50 and 56-64. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops
[^aca-health]: Health probes in Azure Container Apps, probe types and readiness before traffic, observed web lines 36-41 and 187-188. https://learn.microsoft.com/en-us/azure/container-apps/health-probes
[^key-vault]: Azure Key Vault quickstart, add/retrieve secret sections, observed web lines 80-95. https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli
[^teams-package]: Teams app package, App manifest and publishing choices, observed web lines 45-72. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package
[^teams-upload]: Upload your custom app, upload/access/update sections, observed web lines 48-60 and 84-122. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload
