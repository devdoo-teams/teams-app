---
type: "Release Failure History"
title: "TeamsApp Azure and Teams release failure history"
description: "Evidence-bounded history of source, provider, Azure, Teams, and release-loop failures with root causes and fixes."
resource: /failure-history.md
tags: [teamsapp, azure, release, incident, failure, provenance]
generated:
  by: "process:codex-okf/1"
  at: "2026-09-08T04:24:56Z"
verified:
  by: "process:release-evidence-reconciliation/1"
  at: "2026-09-08T04:24:56Z"
status: stable
stale_after: "2026-09-15T04:24:56Z"
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
  - id: az-deployment-jobs
    resource: "https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops"
    title: "Deployment jobs - Azure Pipelines"
    location: "deployment lifecycle hooks and failure handling; observed web lines 55-76"
  - id: node-esm
    resource: "https://nodejs.org/api/esm.html"
    title: "Modules: ECMAScript modules - Node.js documentation"
    location: "relative import resolution and mandatory file extensions; observed web lines 212-226 on 2026-09-06"
  - id: github-artifacts
    resource: "https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10"
    title: "REST API endpoints for GitHub Actions artifacts"
    location: "artifact lookup, name filtering, digest, workflow_run.head_sha, and read permission; observed web lines 13-18, 34-38, 45-53, 71-78"
  - id: github-attestations
    resource: "https://docs.github.com/en/actions/concepts/security/artifact-attestations"
    title: "Artifact attestations - GitHub Docs"
    location: "provenance fields and verification boundary; observed web lines 25-32 and 58-63"
  - id: aca-start-failures
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures"
    title: "Troubleshoot start failures in Azure Container Apps"
    location: "revision/log diagnosis, common failures, configuration and probe causes; observed web lines 33-80"
  - id: aca-exit-failures
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-create-failures"
    title: "Troubleshoot Container Exit Failures in Azure Container Apps"
    location: "exit-event causes and diagnostics; observed web lines 31-55"
  - id: aca-health
    resource: "https://learn.microsoft.com/en-us/azure/container-apps/health-probes"
    title: "Health probes in Azure Container Apps"
    location: "probe types and readiness before traffic; observed web lines 36-41 and 187-188"
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
    title: "Run scripts in a Linux VM by using Run Commands"
    location: "VM-agent execution, RunShellScript, output/timeout restrictions, and non-interactive execution; observed web sections Benefits, Restrictions, and Azure CLI on 2026-09-07"
  - id: azure-run-45
    resource: "https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=45"
    title: "TeamsApp Azure DevOps Run 45"
    location: "invalid MCP queue parameter read-back and ValidateHandoff bootstrap failure"
  - id: azure-run-46
    resource: "https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=46"
    title: "TeamsApp Azure DevOps Run 46"
    location: "same-release worker runtime probe, failure boundary, and retained receipt"
  - id: azure-run-47
    resource: "https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=47"
    title: "TeamsApp Azure DevOps Run 47"
    location: "promoted 24/7 minReplicas what-if boundary and retained failure receipt"
  - id: az-storage-blob-cli-source
    resource: "https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/azure/cli/command_modules/storage/commands.py"
    title: "Azure CLI Storage command registration"
    location: "storage blob metadata show transforms get_blob_properties to x.metadata; observed source lines 2688-2693"
  - id: az-storage-blob-reference
    resource: "https://learn.microsoft.com/en-us/cli/azure/storage/blob?view=azure-cli-latest"
    title: "az storage blob"
    location: "metadata show/update and upload command contracts; observed current CLI reference"
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
    location: "run result after manual approval; failed DeployCanary task and linked log"
  - id: azure-run-30-failed-log
    resource: "https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=30&view=logs&s=4762d5d2-aebb-53b8-a7cb-14d48d3e23e5&j=95b50d7d-ef90-5e8d-33e5-e2c5603024e8"
    title: "TeamsApp Azure DevOps Run 30 failed deployment job log"
    location: "DeployCanaryRevision AzureCLI task; UI exposed only generic exit code 1"
  - id: pipeline-source
    resource: "https://github.com/devdoo-teams/teams-app/blob/18cea41fd16d97b39038a00761a272ae23d310d5/azure-pipelines.yml"
    title: "TeamsApp Azure pipeline at source-materialization fix"
    location: "release receipt parsing, fetch/checkout, HEAD/worktree verification"
  - id: failure-receipt-fix
    resource: "https://github.com/devdoo-teams/teams-app/blob/3bfcd676ff510aefdbea6e267c3e238063f9b96f/azure-pipelines.yml"
    title: "TeamsApp Azure post-approval failure boundary fix"
    location: "named failure boundaries, secret-free receipt, and failed-task artifact"
  - id: platform-contract
    resource: "https://github.com/devdoo-teams/teams-app/blob/18cea41fd16d97b39038a00761a272ae23d310d5/scripts/azure-platform-contract-test.mjs"
    title: "TeamsApp Azure platform contract test"
    location: "pre-approval and deploy source-materialization assertions"
  - id: release-workflow
    resource: "https://github.com/devdoo-teams/teams-app/blob/main/docs/teams-release-workflow.md"
    title: "TeamsApp release workflow"
    location: "official-contract debugging and same-release evidence rules"
  - id: apple-sleep-settings
    resource: "https://support.apple.com/en-ie/guide/mac-help/mchle41a6ccd/mac"
    title: "Set sleep and wake settings for your Mac"
    location: "Set your Mac to go to sleep after inactivity and Specify sleep and wake settings; observed web lines 296-320 on 2026-09-07"
  - id: apple-lock-screen
    resource: "https://support.apple.com/en-euro/guide/mac-help/-mh11784/mac"
    title: "Change Lock Screen settings on Mac"
    location: "Lock Screen options; observed web lines 274-292 on 2026-09-07"
---

# Executive finding

The repeated mismatch was not one single failure. It was a combination of real defects and evidence-boundary overclaiming.

The real Azure failures in the retained run history are:

1. Run 26: missing Key Vault secret.
2. Run 27: current five-secret what-if modifications were not in the classifier allowlist.
3. Run 28: pipeline checkout commit differed from the attested release commit.
4. Run 29: diagnostic logging improved but the source mismatch remained.
5. Run 30: the source materialization fix passed pre-approval, the user manually approved the environment, and the post-approval DeployCanary AzureCLI task failed with generic exit code 1.
6. Run 31: the pipeline source was clean and exact, but the deploy parameter incorrectly selected the CI-only commit as the release artifact commit; authenticated handoff lookup correctly found zero matching immutable artifacts and stopped before approval.

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

## Run 30: approval passed, post-approval deployment failed

Observed:
- pipeline source 18cea41fd16d97b39038a00761a272ae23d310d5;
- requested release 71df02e, app 1.0.103;
- authenticated handoff, Azure Core 26/26, RBAC, foundation what-if, worker/RBAC receipt completed;
- the user manually approved the pending environment check;
- Azure DevOps UI then reported `DeployCanary` / `DeployCanaryRevision` failed;
- failed task text was `Script failed with exit code: 1 Provision and deploy immutable canary revision`;
- the failed task link was `https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=30&view=logs&s=4762d5d2-aebb-53b8-a7cb-14d48d3e23e5&j=95b50d7d-ef90-5e8d-33e5-e2c5603024e8`;
- no `azure-deployment-failure-receipt` artifact or named post-approval failure boundary existed in Run 30;
- rollback was skipped because the deploy stage failed before a successful canary identity/readiness result.

Official evidence:
- Azure Pipelines approvals control when a stage should run, but deployment-job lifecycle hooks are the place to separate deployment, post-route health, and failure handling.[^az-approval][^az-deployment-jobs]
- Microsoft’s Container Apps troubleshooting contract requires revision status plus system/application logs to distinguish image pull, timeout, crash, ingress, probe, configuration, and secret-reference failures.[^aca-start-failures]
- Container exit diagnostics expose exit events and exit codes; a generic pipeline exit code is not an Azure revision root cause.[^aca-exit-failures]

Classification:
- `OFFICIAL CONTRACT`: approval is a gate, not a deployment-success assertion; Azure Container Apps failure diagnosis requires revision/log evidence;
- `OBSERVED EVIDENCE`: Run 30 pre-approval stages passed, the user approved, and the single post-approval AzureCLI task failed with exit code 1;
- `INFERENCE`: the exact failing subcommand is not recoverable from the retained Run 30 artifact/UI summary; foundation create, Key Vault metadata, workload what-if/blob, ACR import, workload create, revision, health, and final identity remain competing hypotheses;
- `ROOT CAUSE`: `UNKNOWN_POST_APPROVAL_DEPLOY_BOUNDARY` for Run 30. The confirmed process defect is diagnostic loss: one large task had no named failure boundary or durable failure receipt, so the run cannot distinguish those hypotheses after the fact.

Fix:
- add a fail-safe `ERR` trap with named boundaries before each Azure mutation/verification boundary;
- retain a secret-free `azure-deployment-failure-receipt` artifact on task failure with boundary, exit code, source commit, version, and run ID;
- emit an Azure DevOps safe log issue pointing to the boundary and artifact without copying stderr, tokens, or secret values;
- add a focused RED/GREEN regression test and include it in the Azure Core test inventory.

Fix commit: `3bfcd676ff510aefdbea6e267c3e238063f9b96f`.

Result:
- Run 30 remains `FAIL`, not `PASS` or `IN_PROGRESS`;
- the repository fix is locally GREEN but has not been exercised by a new Azure run yet;
- Azure mutation, revision readiness, public health, Teams UI, and mobile remain `UNVERIFIED` for release 1.0.103;
- no Teams completion message or Jira Done transition is allowed.

## Run 31: release artifact commit was not deployable

Observed:
- pipeline run `31` / build `20260906.10` used source `f6cce7cc3fc1a3787f4db6e4d104d7b6720417f1`;
- the template parameter `githubReleaseCommit` was also set to `f6cce7cc3fc1a3787f4db6e4d104d7b6720417f1`, although this commit only carried the pipeline/documentation fix and had no immutable runtime artifact;
- log 11 recorded `Login Succeeded`, exact checkout at `f6cce7c`, then `Invalid GitHub release handoff: expected exactly one unexpired teams-runtime-identity-f6cce7cc3fc1a3787f4db6e4d104d7b6720417f1 artifact, found 0`, followed by `Bash exited with code '1'`;
- the run stopped in `ValidateHandoff` before environment approval and before any Azure mutation.

Official evidence:
- GitHub's artifact API documents name filtering and the artifact response's `digest` and `workflow_run.head_sha` fields.[^github-artifacts]
- GitHub artifact attestations bind provenance to repository, commit SHA, workflow, and triggering event, and verification is a separate consumer obligation.[^github-attestations]

Classification:
- `OFFICIAL CONTRACT`: an attested deploy artifact must be resolved by its exact artifact identity and provenance before consumption;
- `OBSERVED EVIDENCE`: authentication and source checkout succeeded, while the exact requested artifact count was zero;
- `INFERENCE`: the invocation mixed a pipeline source commit with the deploy-only release artifact commit parameter; this was not an Azure foundation, revision, or health failure;
- `ROOT CAUSE`: `RELEASE_ARTIFACT_UNAVAILABLE` caused by an invalid release-artifact parameter, with no approval or Azure side effect.

Fix:
- added a named `ValidateHandoff` boundary and secret-free `github-handoff-failure-receipt` artifact on failed pre-approval handoff tasks;
- kept pipeline source and deploy-only release artifact identity separate; a CI/documentation commit is not silently promoted to a deployable release;
- added a RED/GREEN regression to the Azure Core inventory.

Result:
- Run 31 remains `FAIL_BEFORE_APPROVAL`;
- the fix is locally GREEN on commit `f06e5f4adcf9cc19c769910b4ea53e32419ed233`;
- a new hosted run with the known release artifact commit is required to exercise the receipt and observe the Run 30 post-approval boundary;
- no Azure mutation, Teams package update, completion message, or Jira Done transition is justified.

## Run 32: workload what-if blocked and failure receipt was empty

Observed:
- pipeline run `32` / build `20260906.11` used source `395e158f8c61570aa644963897e0c7231f7b3b5d` and the deploy-only release artifact commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a` for app `1.0.103`;
- authenticated handoff, Azure Core 27/27, RBAC, foundation what-if, worker package, and approval preflight completed; the user approved the `teamsapp-canary` environment;
- Azure CLI `2.89.1` / Bicep `0.46.1` reached the post-approval workload what-if and logged `Invalid Azure canary preflight: what-if contains disallowed Modify change for /subscriptions/0e58c3cb-474d-4e70-978a-4939c586f867/resourceGroups/rg-teamsapp-canary/providers/Microsoft.App/containerApps/teamsapp-canary-goictvxm`;
- the workload evidence artifact `azure-what-if-workload-receipt` was retained as artifact `156` with reported size `29400`; the current Azure DevOps artifact MCP download returned `TF400813`, so the exact property delta inside that artifact is not promoted here;
- the bounded failure artifact `azure-deployment-failure-receipt` was artifact `157` with reported size `0`; log 46 recorded `Processed 0 files` from the failure directory and `Uploaded 0 out of 61 bytes`.
- a subsequent read-only MCP `download` for both artifact names returned a wrapper success message, but each local destination was a 62-byte plain-text `TF400813: The user is not authorized to access this resource.` response, not a ZIP; the wrapper result and bytes are therefore classified separately.

Official evidence:
- ARM what-if is a non-mutating preview and exposes predicted resource change types; a `Modify` result must be evaluated against the deployment's explicit allowlist rather than treated as proof that a mutation occurred.[^arm-what-if]
- Azure CLI's what-if contract supports full resource payloads, machine-readable output, provider validation, and no-prompt automation used by this pipeline.[^az-what-if-help]
- Azure Pipelines approval and deployment lifecycle are separate boundaries; approval does not establish a successful revision or health result.[^az-approval][^az-deployment-jobs]

Classification:
- `OFFICIAL CONTRACT`: the what-if gate may block a predicted `Modify`; what-if itself did not mutate Azure;
- `OBSERVED EVIDENCE`: the exact resource and failing boundary `workload-parameters-and-what-if` are in log 44; no deployment, revision, traffic, or public health evidence exists;
- `INFERENCE`: the container-app `Modify` delta did not match the repository's exact workload planned-change variants. The property-level cause remains `UNVERIFIED` until artifact `156` can be read back;
- `ROOT CAUSE`: `WORKLOAD_WHAT_IF_ALLOWLIST_MISMATCH` is confirmed at the gate boundary, while `ZERO_BYTE_FAILURE_RECEIPT` is separately confirmed as a CI helper provenance defect.

Fix:
- commit `9c793d4d5f2c436223d3c8c8fa228b052515c8fa` snapshots `scripts/azure-deployment-failure-receipt.mjs` into `$(Agent.TempDirectory)` before the deploy job checks out the release commit, then runs that preserved helper from the `ERR` trap;
- `scripts/azure-deployment-failure-receipt-test.mjs` now has a RED/GREEN ordering regression proving that receipt handling cannot depend on files present only in the release commit;
- commit `32308334af096ca062939c62913bdb17f8da4949` additionally requires the failure receipt to be non-empty and schema-valid, writes a SHA-256 sidecar, and logs a safe `receiptWriteStatus` without persisting raw stderr;
- the new assertions were RED before implementation; `npm run test:azure-deployment-failure-receipt` and `npm run test:azure-core` (27/27) are GREEN at the clean fix commit; application/package/Teams version remains `1.0.103`.

Result:
- Run 32 remains `FAIL_AFTER_APPROVAL` before any workload create/update, revision, traffic, or health proof;
- the empty receipt defect is fixed in source, but a new hosted run must read back both the JSON and SHA-256 sidecar to prove the artifact is non-empty and usable;
- the what-if allowlist must not be widened speculatively; inspect artifact `156` or a fresh diagnostic before changing property variants;
- artifact `156`/`157` content remains `UNVERIFIED` until an authorized read-back returns valid ZIP/JSON/SHA bytes rather than the MCP authorization text;
- no Teams completion message or Jira Done transition is justified; Jira mapping is `JIRA_SYNC_UNVERIFIED` in this run.

## Run 33: pre-approval artifacts report sizes but return authorization text

Observed:
- Run `33` / build `20260906.12` used pipeline source `92b95d5364e610c827b7f396c2c832ebc961ad10` (`main`), release artifact commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, and app version `1.0.103`.
- MCP artifact listing returned `158 approval-configuration-receipt` (343 bytes), `160 azure-platform-preflight-receipt` (856 bytes), `162 azure-rbac-preflight-receipt` (275 bytes), and `163 azure-what-if-preflight-receipt` (44495 bytes).
- MCP downloads reported success, but all four local outputs were ASCII 62-byte files containing `TF400813: The user is not authorized to access this resource.`, with SHA-256 `3d632e252d055b8f89c79a59b004ea7c747c9ae9b90d47cfaf0445eed56ea52f`; none was a ZIP.
- The build API remained `state=1` and no final result, DeployCanary mutation, ACA revision, or public health evidence was observed at this checkpoint.

Official evidence:
- Azure Pipelines documents artifacts as stage handoffs that are published and downloaded through the pipeline workspace; a listed artifact and a task-level download message do not replace read-back of the actual bytes.[^az-pipeline-artifacts]
- Azure DevOps approvals/checks are a separate resource boundary from deployment execution; an approval or pre-approval receipt cannot be promoted to deployment success.[^az-approval][^az-deployment-jobs]

Classification:
- `RUN_IN_PROGRESS`: the run has no terminal result at this checkpoint.
- `ARTIFACT_READBACK_UNVERIFIED`: reported metadata and downloaded bytes disagree. Approval configuration, RBAC, what-if JSON, and checksum are not read-back evidence.
- `INFERENCE ONLY`: the exact MCP/API authorization or URL translation defect is not identified; no allowlist or Azure parameter change is justified.

Action:
- keep the single Run 33 execution under observation without duplicating or cancelling it;
- restore an authorized artifact read-back path and require ZIP/header, internal JSON, schema, and SHA-256 validation;
- only after terminal run result and Azure logs are read back may DeployCanary, ACA health, public identity, or Teams UI be evaluated.

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
| approval passed but deployment failed generically | Run 30 manual approval followed by one AzureCLI exit code 1 with no durable boundary | named deployment boundaries, secret-free failure receipt, failure artifact, Azure revision/log read-back |
| release artifact parameter had no immutable artifact | Run 31 handoff lookup found zero artifacts for the requested commit before approval | separate pipeline source/release commit, exact artifact/head SHA/digest lookup, pre-approval handoff failure receipt |
| failure receipt helper disappeared after release checkout | Run 32 workload what-if failed after checkout to `71df02e`; the receipt artifact processed 0 files because the helper existed only in the pipeline source commit | snapshot CI receipt helpers before release checkout, execute the preserved absolute path, and assert ordering in Azure Core |
| pipeline artifact metadata disagrees with downloaded bytes | Run 33 artifacts 158/160/162/163 reported non-empty sizes but MCP downloads returned the same 62-byte `TF400813` authorization text | fail closed on ZIP/header/schema/SHA read-back; do not promote wrapper success or reported size to content evidence |

These records do not substitute for current Azure run evidence.

# Current judgment

The current state is `AZURE_CANARY_REVISION_PASS / PUBLIC_HEALTH_FETCH_PASS / WORKER_RUNTIME_GATE_BLOCKED / RELEASE_BLOCKED`: Run 54 passed handoff, hosted Core/RBAC, approval, workload what-if, Blob staging, workload deployment, revision readiness, and the public health fetch, then failed at the enforced `worker-runtime` gate because the Azure VM probe observed `auth_file="missing"`. The exact reason the VM auth file is absent is not established by this run and remains `ROOT_CAUSE_REVIEW_REQUIRED`; Mac/CUA unlock state is not VM-side evidence. Run 46 had the same worker boundary on an earlier source; Run 45 was an invalid queue attempt with empty required template parameters and failed before mutation. Run 44 remains the last canary PASS before the worker gate was introduced. Run 53 remains FAILED_AFTER_APPROVAL at `revision-and-health`, Run 52 remains FAILED_AFTER_APPROVAL at the same boundary, Run 51 remains FAILED_AFTER_APPROVAL at `revision-and-health`, Run 50 remains FAILED_AFTER_APPROVAL at `workload-parameters-and-what-if`, Run 43 remains FAILED_AFTER_APPROVAL at `final-identity-contract`, Run 42 remains FAILED_AFTER_APPROVAL at the same boundary, Run 41 remains FAILED_AFTER_APPROVAL at `revision-and-health`, Run 40 remains FAILED_AFTER_APPROVAL at `revision-and-health`, Run 39 remains FAILED_AFTER_APPROVAL at `worker-blob`, Run 38 remains FAILED_AFTER_APPROVAL at the same boundary, Run 32 remains FAILED_AFTER_APPROVAL, Run 31 remains FAILED_BEFORE_APPROVAL, and Run 30 remains FAILED_AFTER_APPROVAL.

- local/contract/Azure Core evidence: PASS within scope;
- Run 32 workload what-if: FAILED after approval at `workload-parameters-and-what-if`; no Azure workload mutation occurred;
- Run 32 failure receipt: FAILED to retain a non-empty artifact in the run, fixed in source commit `9c793d4` but not yet hosted-verified;
- Run 39 worker Blob metadata query: FAILED because the nested `metadata.sha256` query produced a false empty value; Run 40 proves the corrected top-level query passes;
- Run 40 revision readiness: FAILED because healthy `ScaledToZero` was excluded by the `Running`-only predicate; source correction is pending a fresh hosted run;
- Run 40 failure receipt: FAILED to retain a non-empty artifact because explicit `exit 1` bypassed the `ERR` trap; the `EXIT`-trap correction is pending a fresh hosted run;
- Run 42 final identity: FAILED because the release checkout replaced the updated pipeline contract helper with an older copy; the source snapshot correction is locally tested but hosted-unverified;
- Run 42 failure receipt: retained with `receiptWriteStatus=READY` and checksum `6e8a536eccb8da674b37f33b3b60dc713ab637a72a572e759ebc61addbb846af`; receipt integrity is verified, but release success is not;
- Run 43 final identity: FAILED because the preserved `azure-deployment-contract.mjs` imported `./azure-release-input.mjs`, but that dependency was not included in the temporary snapshot; the source snapshot closure is now incomplete by direct hosted evidence;
- Run 43 failure receipt: artifact `245` reported `545 B`; the task logged `receiptWriteStatus=READY` with checksum `2651ec69422d53fa8a0674ff4101c195e16b2fc4c778c61e57a80950dabd2019`;
- Run 44 final identity: PASS for the Azure canary deployment; the preserved helper closure loaded successfully and logged the exact release commit, version, and image digest;
- Run 44 public health and ACA revision: PASS within the HTTP canary boundary; health returned `ok=true`, version `1.0.103`, release source identity, authenticated Teams Core fields, and the existing revision read-back was `Healthy / ScaledToZero / traffic 100% / replicas 0`;
- Run 45 queue: FAILED at `ValidateHandoff/bootstrap` because the MCP queue call supplied empty `githubReleaseCommit`, `azureDevOpsEnvironmentId`, and Codex package parameters. It was not a deployment or application failure.
- Run 46 worker runtime: FAILED at `worker-runtime` after public health with `auth_file="missing"; expected "present"`. The exact failure receipt JSON was read back in Ego Lite, its SHA-256 sidecar matched (prefix `f8975bcf...`), and the receipt bound the failure to source `71df02e2...`, version `1.0.103`, pipeline run `46`.
- Run 46 artifact/UI: the Azure DevOps artifact page showed `azure-deployment-failure-receipt` at `536 B`, containing JSON `471 B` and SHA sidecar `65 B`; the JSON body read back as `boundary=worker-runtime`, `exitCode=1`, `rawErrorPersisted=false`.
- Run 33 pre-approval receipt read-back: reported artifact sizes conflict with 62-byte authorization text; no receipt content is verified;
- Run 31 release handoff: FAILED before approval because the requested artifact was absent;
- Run 30 post-approval Azure mutation: FAILED at an unknown named boundary (Run 30 evidence incomplete);
- Run 39 deployment receipt: valid, non-empty, checksum-backed, with exact failure boundary;
- healthy revision: observed as `Healthy / ScaledToZero / traffic 100% / replicas 0`, but same-run final identity reconciliation: UNVERIFIED;
- public health: HTTP 200 and core identity observed in Run 42; same-release final identity: UNVERIFIED;
- public health: HTTP 200 and same-release core identity observed in Run 44; external worker/A2A readiness remains UNVERIFIED;
- worker runtime: `BLOCKED` until the existing VM has an out-of-band owner-only Codex `auth.json` and `codex login status` passes under `teamsworker`; the new probe is now a mandatory deployment boundary.
- portal/installed same package: UNVERIFIED;
- Teams desktop fresh reply: UNVERIFIED;
- mobile: MOBILE_UNVERIFIED;
- live A2A: UNVERIFIED.

## 2026-09-08 — Run 54 reached the worker runtime gate but the VM auth file was missing

**OFFICIAL CONTRACT.** Microsoft Linux VM Run Command executes scripts through the VM agent with `RunShellScript` and does not provide an interactive terminal: [Run scripts in a Linux VM by using Run Commands](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command). The repository's cloud-init contract separately states that authentication material is provisioned out of band and must not be copied into cloud-init (`infra/azure/cloud-init/codex-worker.yml:1-3`).

**OBSERVED EVIDENCE.** Azure DevOps Run 54 / build `20260908.1` used source/release commit `319e676d13b3b366a1df52bee022306b71da0eac`, app `1.0.103`, and image `sha256:5a04180696ca4c5ab12da199e0ff6b737b490cf14f14501402091714f3b531cd`. The hosted run passed handoff, hosted Core/RBAC, approval, workload what-if, Blob staging, workload deployment, revision readiness, and the public health fetch. It then invoked the named VM with `RunShellScript`; the task log recorded `Invalid Azure worker runtime probe: auth_file was "missing"; expected "present"`, `receiptWriteStatus=READY`, and `boundary=worker-runtime exitCode=1`. Artifact listing retained workload artifact `324` and failure artifact `325` (536 B total).

**SOURCE CONTRACT.** `azure-pipelines.yml:883-906` runs the probe after the health fetch. `scripts/azure-worker-runtime-probe.mjs:109-150` checks only redacted auth metadata at `$AGENT_CODEX_HOME/auth.json`, then requires a regular file with mode `600`, link count `1`, owner `teamsworker`, and authenticated `codex login status`. The probe's exact missing-file observation is therefore confirmed. The reason it is missing (login not completed, path/configuration, or prior VM state) is not established by this run and remains `ROOT_CAUSE_REVIEW_REQUIRED`.

**CLASSIFICATION.** `CONFIRMED_FAILURE_BOUNDARY / WORKER_AUTH_OUT_OF_BAND_MISSING`. The user's Mac/CUA lock state is a separate host/session fact and cannot be promoted to Azure VM authentication evidence. No auth contents, device codes, or secrets were logged or copied.

**CURRENT JUDGMENT.** `AZURE_CANARY_REVISION_PASS / PUBLIC_HEALTH_FETCH_PASS / WORKER_RUNTIME_GATE_BLOCKED / RELEASE_BLOCKED`. Run 44 remains the last canary success before the worker gate was introduced; it is not equivalent to a current 24/7 worker success. Next action is a user-only device-login handoff on the existing VM, followed by one bounded probe read-back. No app version bump, package upload, traffic promotion, or completion message is justified.

## 2026-09-07 — Run 38/39 worker Blob metadata query root cause and correction

**OFFICIAL CONTRACT.** Azure CLI registers `storage blob metadata show` against `get_blob_properties` and transforms the response with `lambda x: x.metadata`, so the command returns the user-defined metadata map at the top level ([official source](https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/azure/cli/command_modules/storage/commands.py), lines 2688-2693). The current [`az storage blob` reference](https://learn.microsoft.com/en-us/cli/azure/storage/blob?view=azure-cli-latest) defines metadata show/update, upload, `--auth-mode login`, and overwrite controls.

**OBSERVED EVIDENCE.** Run 38 / build `20260906.17` failed after approval at `worker-blob`; the valid retained receipt has `sourceCommit=71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, `releaseVersion=1.0.103`, and `pipelineRunId=38`. Run 39 / build `20260906.18`, pipeline source `6edcdbc6576ae9585f43ca6dc4fd2241262cc78e`, reached the same boundary and printed: `immutable Blob metadata SHA-256 mismatch: expected fe36475c64b74a39876df0734569ad9f880089f37413299035f783598cddc74b, observed <empty>`. The Azure Portal read-back showed the exact `worker-artifacts` container and a container-scope `Storage Blob Data Contributor` role assignment for the deployment service principal.

**CLASSIFICATION.** `CONFIRMED_ROOT_CAUSE` / `AZURE_BLOB_METADATA_QUERY_SHAPE`. The nested query `metadata.sha256` was wrong for this command's top-level metadata-map output; `sha256` is the correct query. The prior “empty metadata” was a query-shape false negative, not proof that the storage role or container was missing.

**FIX AND VERIFICATION.** Commit `6edcdbc6576ae9585f43ca6dc4fd2241262cc78e` introduced the single bounded worker-Blob staging helper and redacted diagnostics. The follow-up correction changes the query to `sha256` and adds a RED regression that rejects `metadata.sha256`; the focused helper, platform-contract, and core-runner tests are GREEN after the correction. Version remains `1.0.103`; no package or Teams upload is warranted for this CI-only repair.

**CURRENT JUDGMENT.** Run 39 remains `FAIL_AFTER_APPROVAL` and is not a verification pass for the correction. The exact invalid query is now identified; the existing Blob is preserved until a fresh run successfully reads the correct metadata. Azure revision/public health/Teams UI/mobile/A2A remain `UNVERIFIED`.

## 2026-09-07 — Run 40 healthy scale-to-zero misclassified and explicit-exit receipt loss

**OFFICIAL CONTRACT.** Azure Container Apps documents `Scale to 0` as a running status with zero replicas that can create replicas again when a scale rule is triggered, and states that `minReplicas` defaults to 0; an always-running instance requires `minReplicas` of 1 or higher ([scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app), lines 31-56; [revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions), lines 48-72). The same revision guidance says readiness and startup probes must pass before traffic is shifted (revisions, lines 128-138; [health probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes), lines 36-47 and 187-188). Azure Pipelines deployment jobs separate deploy, post-route health, and failure lifecycle hooks ([deployment jobs](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops), lines 55-76).

**OBSERVED EVIDENCE.** Run 40 / build `20260906.19` used pipeline source `e91b7aa020cf44f53727616194cc19c225df100a`, deploy-only release commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, version `1.0.103`, and image `ghcr.io/devdoo-teams/teams-app@sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`. The hosted Azure CLI was `2.89.1`, Azure DevOps extension `1.0.7`, Bicep `0.46.1`; the log first reached `Azure worker Blob staging: existing; sha256=fe36475c64b74a39876df0734569ad9f880089f37413299035f783598cddc74b`. It then failed at `revision-and-health` with `Expected release revision did not reach Running/Succeeded/100%: teamsapp-canary-goictvxm--71df02e2ea`. The existing Ego Lite Azure Container Apps page read back that revision as `Healthy`, `ScaledToZero`, traffic `100`, replicas `0`, with the same revision shown as latest.

The run's Azure DevOps artifact list reported `azure-what-if-workload-receipt` artifact `220` at `51956` bytes and `azure-deployment-failure-receipt` artifact `221` at `0` bytes. Log 46 recorded `Processed 0 files` and `Uploaded 0 out of 61 bytes`. Log 44 ended with explicit `exit 1`; it did not contain the new `receiptWriteStatus=READY` warning. This is a separate evidence-loss failure from the revision-state classification.

**CLASSIFICATION.** Two `CONFIRMED_ROOT_CAUSE` findings are recorded:

1. `ACA_SCALE_TO_ZERO_READINESS_FALSE_NEGATIVE`: the pipeline and shared deployment contract accepted only `runningState == Running`, although the deployed revision was healthy, active, provisioned, traffic-serving, and intentionally configured with `minReplicas: 0`. This does not prove 24/7 operation; the 24/7 gate remains blocked until `minReplicas >= 1` and the worker runtime are read back.
2. `EXPLICIT_EXIT_BYPASSES_ERR_RECEIPT_TRAP`: the task's `ERR` trap did not write a receipt for the explicit `exit 1` branch, leaving the failure artifact empty despite the helper being present before release checkout. The prior helper-provenance fix was therefore not sufficient for every failure path.

**FIX AND VERIFICATION.** The source correction adds `isRevisionReadyForRelease` in `scripts/azure-deployment-contract.mjs:45-53`, reuses it for rollback and final identity validation at `:73-76` and `:125-130`, and updates the deploy poll in `azure-pipelines.yml:784-791` to allow only `ScaledToZero` with `healthState == Healthy`. The failure handler now declares cleanup paths before the trap and uses a single nonzero `EXIT` trap at `azure-pipelines.yml:497-534`; the dedicated test includes a real `/bin/bash` explicit-exit regression at `scripts/azure-deployment-failure-receipt-test.mjs:118-129`. `scripts/azure-deployment-contract-test.mjs` covers healthy and unhealthy scale-to-zero cases at `:46-63` and `:98-107`; `scripts/azure-platform-contract-test.mjs:980-982` checks the pipeline predicate. All three focused commands were GREEN after the change: `node scripts/azure-deployment-failure-receipt-test.mjs`, `node scripts/azure-deployment-contract-test.mjs`, and `node scripts/azure-platform-contract-test.mjs`. No application version bump or Teams package upload was performed.

**CURRENT JUDGMENT.** Run 40 remains `FAIL_AFTER_APPROVAL`; its healthy revision observation is not a hosted verification of the source fix, and its empty failure artifact is not promoted to a usable receipt. After the clean commit passes `npm run test:azure-core`, one bounded hosted rerun is required. A successful rerun must read back a non-empty failure receipt if it fails, or pass the corrected readiness predicate, public health, and identity contract if it succeeds. The 24/7 worker, Teams portal/package, desktop, mobile, and live A2A gates remain `UNVERIFIED`.

## 2026-09-07 — Run 41 receipt read-back and official provisioning-state gap

**OFFICIAL CONTRACT.** The current Microsoft Container Apps revision documentation names `Provisioned` as the successful provisioning state and separately lists `Scale to 0` as zero running replicas that can be recreated by a scale rule ([revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions), lines 48-72). The same documentation requires successful provisioning, replica readiness, and probes before traffic is shifted (lines 128-138). The scaling documentation permits `minReplicas: 0` and reserves `minReplicas >= 1` for an always-running instance ([scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app), lines 31-56).

**OBSERVED EVIDENCE.** Run 41 / build `20260906.20` used pipeline source `3a5549770d25ce914959653bdb1fe9acc11b8bae`, the same deploy-only release commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, app `1.0.103`, and the same image digest. Handoff, approval configuration, Azure Core/RBAC, manual environment approval, and worker Blob staging succeeded. The hosted task then ended at `revision-and-health` with the older message `Expected release revision did not reach Running/Succeeded/100%: teamsapp-canary-goictvxm--71df02e2ea`.

The existing Ego Lite Azure Container Apps page still showed the latest revision `teamsapp-canary-goictvxm--71df02e2ea` as `Healthy`, `ScaledToZero`, traffic `100`, replicas `0`. Run 41's Azure DevOps artifact page showed `azure-deployment-failure-receipt` total `541 B`, containing `azure-deployment-failure-receipt.json` `476 B` and `.sha256` `65 B`. The JSON was read back in the same Ego Lite tab with `boundary=revision-and-health`, `exitCode=1`, `pipelineRunId=41`; the task log recorded `receiptWriteStatus=READY` with SHA `aaa1fb75a08c5b8dd3ff7141c36cee72fa401a07590cdb73bb8de5b9012c65f3`.

**CLASSIFICATION.** `FAIL_AFTER_APPROVAL` is confirmed. Failure evidence is now `VERIFIED` for Run 41 because the UI showed both files and the JSON body was read back; this is distinct from deployment success. The exact raw `revision.json` fields were not retained by Run 41 because the diagnostic logging change was not yet in its source. The `Provisioned` versus legacy `Succeeded` mismatch is therefore `INFERENCE / REVIEW_REQUIRED`, supported by the current official contract but not promoted to a confirmed live root cause until the next run's safe state diagnostic shows the actual value. No allowlist widening or 24/7 claim is justified.

**FIX AND VERIFICATION.** The next source change accepts the official `Provisioned` state while preserving `Succeeded` compatibility, keeps the `ScaledToZero + Healthy` restriction, and emits only non-secret revision state fields when the bounded poll fails (`azure-pipelines.yml:784-808`; `scripts/azure-deployment-contract.mjs:1-54,73-86,125-130`). Focused deployment, failure-receipt, and platform-contract tests are GREEN after the change. No application version bump, package upload, or Teams completion message was performed.

**CURRENT JUDGMENT.** Run 41 remains failed and is not a verification pass for the current source change. After a clean `npm run test:azure-core`, queue only one bounded Run 42 using the same release identity. Its first required read-back is the redacted revision-state diagnostic; only a real `Provisioned`/`Succeeded` + healthy/active/traffic result followed by public health can advance the release. `minReplicas >= 1`, worker VM 24/7 evidence, Teams package/desktop/mobile, and live A2A remain `UNVERIFIED`.

## 2026-09-07 — Run 42 final identity helper provenance gap

**OFFICIAL CONTRACT.** Azure Pipelines deployment jobs run sequential deployment steps and separate deployment/failure lifecycle boundaries ([deployment jobs](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops), lines 37-76). Azure Container Apps revision readiness requires successful provisioning and probe readiness before traffic promotion ([revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions), lines 128-138); the API/revision contract is evaluated from the actual revision read-back, not from a pipeline stage label.

**OBSERVED EVIDENCE.** Run 42 / build `20260906.21` used pipeline source `b38a1eb786b5da639314ecf2d04a81edb0190d50`, deploy-only release commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, version `1.0.103`, and image digest `sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`. Handoff, Azure Core/RBAC, approval, worker Blob staging, workload deploy, and the pipeline-source readiness predicate passed. The task then fetched public `/api/health` successfully (2920-byte response) but the final identity step logged `Invalid Azure deployment contract: revision readiness or traffic state is not complete` and failed at `final-identity-contract`. The failure receipt was retained with `receiptWriteStatus=READY` and SHA `6e8a536eccb8da674b37f33b3b60dc713ab637a72a572e759ebc61addbb846af`.

The existing pipeline source contained the updated `Provisioned`/`ScaledToZero` contract, but the task had checked out the deploy-only release commit before invoking `node scripts/azure-deployment-contract.mjs verify`. A read-only comparison showed the release commit still required `runningState == Running` and `provisioningState == Succeeded` (`git show 71df02e2:scripts/azure-deployment-contract.mjs`). The source and release helper identities were therefore mixed. A separate live curl against the same Azure FQDN returned HTTP 200 with `ok=true`, `version=1.0.103`, `sourceCommit=71df02e2...`, `auth=teams-authenticated`, `bot=teams-sdk`, and `outbound=teams-sdk`; its dispatch worker heartbeat/readiness and A2A execution remained unavailable.

**CLASSIFICATION.** `CONFIRMED_ROOT_CAUSE` / `RELEASE_CHECKOUT_CONTRACT_HELPER_DRIFT`: the pipeline-level readiness accepted the observed state, while the release-checkout copy of the final identity helper rejected it. `PUBLIC_HEALTH_PASS_WITH_IDENTITY_GATE_FAIL` is separately recorded; HTTP 200 is not a release completion proof. No application crash, Blob mismatch, or new version violation is inferred from this run.

**FIX AND VERIFICATION.** The source correction snapshots `scripts/azure-deployment-contract.mjs` into the agent-temporary helper directory before `git checkout --detach "$commit"` and invokes the preserved absolute path (`azure-pipelines.yml:471-495,555-557,814-816`). `scripts/azure-platform-contract-test.mjs:975-981` now asserts snapshot ordering and invocation; it was RED before the correction and GREEN after it, together with the deployment and failure-receipt tests. No application version bump or Teams package upload was performed.

**CURRENT JUDGMENT.** Run 42 remains `FAIL_AFTER_APPROVAL`; its public health result is useful live evidence but not same-release completion because the final identity contract did not pass. After the clean Core gate, one bounded rerun with the preserved helper is required. If that run passes, continue to package/portal/desktop Teams verification; 24/7 worker, Teams mobile, and live A2A remain separate `UNVERIFIED` gates.

## 2026-09-07 — Run 43 incomplete helper dependency snapshot

**OFFICIAL CONTRACT.** Node.js resolves relative ECMAScript module specifiers relative to the importing module and requires the file extension ([Node.js ECMAScript modules](https://nodejs.org/api/esm.html), `import Specifiers` and `Mandatory file extensions`, observed lines 212-226). The Azure Pipelines deployment job and final identity check are separate sequential steps ([deployment jobs](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops), lines 37-76), so the temporary helper bundle must be executable as a complete module graph after release checkout.

**OBSERVED EVIDENCE.** Run 43 / build `20260906.22` used pipeline source `10d340b5f7bd04b3d14f2e407c02e567ed2eef5c`, deploy-only release commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, version `1.0.103`, and the same image digest `sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`. The run passed handoff, hosted Core 26/26, approval, worker Blob staging, workload deployment, the updated revision poll, and public health fetch. It then failed at `final-identity-contract`; the exact hosted error was `ERR_MODULE_NOT_FOUND: Cannot find module '/home/vsts/work/_temp/azure-what-if-receipt-tools/azure-release-input.mjs' imported from /home/vsts/work/_temp/azure-what-if-receipt-tools/azure-deployment-contract.mjs`.

The failure artifact list showed `azure-deployment-failure-receipt` artifact `245` with `545` bytes, containing the non-empty failure receipt, and the task logged `receiptWriteStatus=READY` with checksum `2651ec69422d53fa8a0674ff4101c195e16b2fc4c778c61e57a80950dabd2019`. The same task fetched `2920` bytes from the public health endpoint before the module-load failure. This is distinct from Run42: the top-level helper was preserved, but its relative dependency was not.

**CLASSIFICATION.** `CONFIRMED_ROOT_CAUSE` / `INCOMPLETE_RELEASE_CRITICAL_HELPER_CLOSURE`. The prior fix protected one helper file but did not protect the complete relative import closure. `PUBLIC_HEALTH_PASS_WITH_FINAL_IDENTITY_MODULE_LOAD_FAIL` is a separate boundary; it does not establish a release pass, Teams installation, 24/7 worker, mobile, or A2A success.

**FIX REQUIRED.** Add `scripts/azure-release-input.mjs` to the same pipeline-owned temporary directory before `git checkout --detach "$commit"`, assert that it is non-empty, and add a RED regression that executes the snapshotted `azure-deployment-contract.mjs` with a valid fixture receipt after the source checkout. The test must fail if any local relative import required by the helper is missing. Do not solve this by copying arbitrary repository files or by changing the release commit; use an explicit, reviewed helper closure (or an immutable helper bundle).

**CURRENT JUDGMENT.** Run 43 remains `FAIL_AFTER_APPROVAL` with verified non-empty failure evidence. No version bump or Teams upload is justified. Update this record again only after the closure test is GREEN, clean Core passes, and one bounded hosted rerun proves the final identity helper can load and validate the same release.

## 2026-09-07 — Run 44 Azure canary deployment identity verified

**OBSERVED EVIDENCE.** Run 44 / build `20260906.23` used pipeline source `95771889b31b42ffca8a218315e2bff1dfd50557`, deploy-only release commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, version `1.0.103`, and image digest `sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`. It passed handoff, hosted Core `26/26`, environment approval, worker Blob staging, workload deployment, accepted revision readiness, and the final identity contract. The final task log recorded `Azure release deployment verified: 71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a, 1.0.103, sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`.

The independent public health read-back returned HTTP 200 with `ok=true`, version `1.0.103`, source commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, server bundle SHA `c7be7000078e7f1d439c8700cff30445515c1f4a1e34c04152a97b42612948b4`, `environment=production`, `auth=teams-authenticated`, `userAuth=entra-sso`, `bot=teams-sdk`, and `outbound=teams-sdk`. The same health response reported queue submission ready, worker heartbeat `not-observed`, worker readiness `unavailable`, execution boundary `external-linux-worker-unverified`, and A2A `unavailable`; optional/Grok and MCP paths remained disabled.

The existing ACA revision page in the same Ego Lite task space read back `teamsapp-canary-goictvxm--71df02e2ea` as `ScaledToZero`, `Healthy`, traffic weight `100`, replicas `0`. Microsoft documents `minReplicas >= 1` as the always-running condition, so this is an Azure HTTP canary identity pass, not proof of the requested 24/7 Linux worker or live A2A service. Teams portal package registration, installed desktop UI, mobile UI, and live worker evidence are still separate gates.

**CURRENT JUDGMENT.** Run 44 resolves the Run 42/43 helper provenance failures for the tested release identity. No application version bump was made because the changes were CI/release-gate repairs. Continue only with worker 24/7/A2A and same-release Teams package/desktop/mobile verification; do not send a Teams completion report while those gates remain `UNVERIFIED`.

[^okf-spec]: Open Knowledge Format v0.2 specification, sections 1, 3, 4, 5, 8, 9, observed web lines 197-204, 253-327, 370-444, 486-513. https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
[^arm-what-if]: Template deployment what-if, What-if operation and permissions, observed web lines 29-52. https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if
[^az-what-if-help]: Azure CLI az deployment group what-if, option table and examples, observed web lines 1016-1042 and 1071-1092. https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest
[^az-approval]: Pipeline deployment approvals, stage pause and approval sections, observed web lines 37-50 and 56-64. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops
[^az-deployment-jobs]: Deployment jobs, rollout lifecycle hooks and `on: failure` handling, observed web lines 55-76. https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops
[^github-artifacts]: REST API endpoints for GitHub Actions artifacts, artifact lookup/name filtering and response schema including `digest` and `workflow_run.head_sha`, observed web lines 13-18, 34-38, 45-53, 71-78. https://docs.github.com/en/rest/actions/artifacts?apiVersion=2026-03-10
[^github-attestations]: GitHub artifact attestations, provenance fields and verification boundary, observed web lines 25-32 and 58-63. https://docs.github.com/en/actions/concepts/security/artifact-attestations
[^aca-start-failures]: Troubleshoot start failures in Azure Container Apps, revision/log diagnosis and common causes, observed web lines 33-80. https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures
[^aca-exit-failures]: Troubleshoot Container Exit Failures in Azure Container Apps, exit events and diagnostics, observed web lines 31-55. https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-create-failures
[^aca-health]: Health probes in Azure Container Apps, probe types and readiness before traffic, observed web lines 36-41 and 187-188. https://learn.microsoft.com/en-us/azure/container-apps/health-probes
[^key-vault]: Azure Key Vault quickstart, add/retrieve secret sections, observed web lines 80-95. https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli
[^teams-package]: Teams app package, App manifest and publishing choices, observed web lines 45-72. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package
[^teams-upload]: Upload your custom app, upload/access/update sections, observed web lines 48-60 and 84-122. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload

## 2026-09-07 — Run 45 invalid queue parameters

**OBSERVED EVIDENCE.** Run 45 / build `20260907.1` was queued through the Azure DevOps pipeline MCP with empty `githubReleaseCommit`, `azureDevOpsEnvironmentId`, and Codex package template parameters. The run source was `930d4f7125b25a9b96ad2a11df1203a99b397903`, but `ValidateHandoff` failed at `bootstrap` before artifact handoff or Azure mutation. The run was then terminally read back as `Build Failed`.

**CLASSIFICATION.** `CONFIRMED_OPERATOR_INVOCATION_ERROR`, not an application, Azure, or worker failure. The queue response must be read back before accepting a run: source commit, release commit, environment ID, Codex URL, package digest, and package version must all be non-empty and match the intended release. A queue call with missing template parameters is not a valid retry.

**PREVENTION.** The correct Run 46 invocation explicitly supplied all seven template parameters and read them back before monitoring. The pipeline queueing checklist now records this as a separate pre-run gate.

## 2026-09-07 — Run 46 worker runtime readiness gate

**OFFICIAL CONTRACT.** Microsoft documents that Linux VM Run Command executes scripts through the VM agent, supports the `RunShellScript` command, has bounded output/time restrictions, and does not support interactive prompts ([Run scripts in a Linux VM by using action Run Commands](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command), sections Benefits, Restrictions, Available commands, and Azure CLI). The pipeline therefore uses a non-interactive, secret-free probe and never attempts to perform Codex login or MFA itself.

**OBSERVED EVIDENCE.** Run 46 / build `20260907.2` used pipeline source `930d4f7125b25a9b96ad2a11df1203a99b397903`, the same deploy-only release commit `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, app `1.0.103`, and image `sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`. Handoff, hosted Azure Core `29/29`, approval configuration, manual environment approval, workload what-if, worker Blob staging, workload deployment, accepted ACA revision readiness, and public health completed. The new worker runtime probe then failed with:

~~~text
Invalid Azure worker runtime probe: auth_file was "missing"; expected "present"
boundary=worker-runtime exitCode=1
~~~

The Azure DevOps artifact UI showed `azure-deployment-failure-receipt` at `536 B`, containing `471 B` JSON plus a `65 B` SHA-256 sidecar. Ego Lite read back the JSON body with `boundary=worker-runtime`, `exitCode=1`, and `rawErrorPersisted=false`. The sidecar matched the SHA-256 of the JSON bytes (prefix `f8975bcf...`). No worker probe success artifact was published, and no Teams completion message was sent.

**ROOT CAUSE.** The prior pipeline had no VM runtime/auth gate; `Succeeded` therefore meant only the ACA HTTP canary path passed. The live VM service was previously observed `active/running`, but `/var/lib/teamsapp/codex-home/auth.json` was absent. Run 46 converts that silent mismatch into a deterministic release blocker.

**FIX AND VERIFICATION.** Commit `930d4f7` adds `scripts/azure-worker-runtime-probe.mjs`, a RED/GREEN parser and shell-syntax regression, includes it in the 29-test Azure Core inventory, snapshots it before the deploy-only release checkout, invokes Azure `RunShellScript`, validates service/release/Codex/auth metadata without reading auth contents, and retains a success receipt only when `codex login status` passes under `teamsworker`. `npm run test:azure-core` passed `29/29`; Run 46 hosted execution confirmed the gate stops at the correct boundary.

**CURRENT JUDGMENT.** `AZURE_CANARY_HTTP_PASS / WORKER_RUNTIME_GATE_BLOCKED / RELEASE_BLOCKED`. The next action is user-only out-of-band Codex login on the existing VM, followed by a bounded read-only probe. Do not copy a Mac credential, put `auth.json` in Git/artifacts, bypass the probe, bump the Teams version, upload a package, or report 24/7/A2A completion until the same release identity passes the worker probe and terminal execution evidence.

## 2026-09-07 — Remote capture was over-promoted to a lock diagnosis

**OFFICIAL CONTRACT.** Apple documents power/sleep timing and Lock Screen password behavior as separate settings and behaviors ([Set sleep and wake settings for your Mac](https://support.apple.com/en-ie/guide/mac-help/mchle41a6ccd/mac), observed web lines 296-320; [Change Lock Screen settings on Mac](https://support.apple.com/en-euro/guide/mac-help/-mh11784/mac), observed web lines 274-292). Installed `pmset` help defines `-g assertions` as a power-assertion report; installed `screencapture` help defines a screen-capture utility. These contracts do not make a capture/control failure a lock-state read-back.

**OBSERVED EVIDENCE.** In this turn the user supplied a remote-desktop screenshot with the Mac desktop and application windows visible (`USER_REMOTE_VIEW`, valid for the supplied capture time). The local host separately reported Caffeine/`caffeinate` `PreventUserIdleSystemSleep`, `PreventUserIdleDisplaySleep`, and `PreventSystemSleep` through `pmset -g assertions` (`POWER_ASSERTION_ACTIVE`). The local `screencapture` path had previously produced a black frame (`REMOTE_CAPTURE_UNAVAILABLE`), and Computer Use had returned an automatic-unlock/locked error (`CUA_CONTROL_UNAVAILABLE`). These observations came from different surfaces and were not a same-session lock proof.

**CLASSIFICATION.** `REMOTE_SESSION_MISMATCH / CAPTURE_BOUNDARY_UNAVAILABLE`; `CONFIRMED_SCREEN_LOCK` was not established. The previous interpretation that the user's Mac was locked was an evidence overclaim. It was not evidence that Caffeine had stopped working, that the Azure/Teams server was down, or that the user had to unlock the computer.

**PREVENTION.** The workflow now requires host/session/time/surface labels for each signal; `pmset`, black capture, and CUA errors cannot trigger an unlock request on their own. A direct lock-screen/session signal plus an independent same-host/same-session signal is required for `CONFIRMED_SCREEN_LOCK`. If the signals conflict, preserve the conflict, continue command-only/Ego DOM/public HTTP work, and leave only native UI as `DESKTOP_UNVERIFIED`. See [원격 화면·잠금·캡처 증거 판정](../../teams-release-workflow.md#원격-화면잠금캡처-증거-판정) and [Apple Lock Screen settings](https://support.apple.com/en-euro/guide/mac-help/-mh11784/mac).

**CURRENT JUDGMENT.** The supplied remote screenshot is valid evidence of the visible remote desktop at its capture time. Current command/capture/Computer Use surfaces must be reported separately; no further unlock request or lock-setting mutation is justified by the prior signals alone.

## 2026-09-08 — Run 47 exposed the 24/7 what-if allowlist gap

**OFFICIAL CONTRACT.** Azure ARM what-if is a non-mutating preview and its property-change details must be reviewed against the intended template change before mutation ([Template deployment what-if](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if), What-if operation and change details, observed web lines 29-52). The repository's exact-change allowlist is an internal fail-closed policy, not an Azure approval guarantee.

**OBSERVED EVIDENCE.** Run 47 / `20260907.3` used source and release commit `0fff1b2d9195707d8c3363f2249955aed0eb559b`, app `1.0.103`, and passed GitHub handoff, Azure Core/RBAC, and manual approval. The deployment task stopped before Azure mutation at `workload-parameters-and-what-if` after the workload diagnostic recorded `BLOCKED`. The exact Container App change included the previously observed Run 37 legacy env/secret multiset plus `properties.template.scale.minReplicas` / `Modify`. Artifact `268` was reported at `25,531` bytes and failure artifact `269` at `553` bytes; the task recorded failure receipt SHA `33d4245cb056122ade21d5e9c9fe170275efcd54c4ba9562a08805ef062ade37`.

**CLASSIFICATION.** `CONFIRMED_ROOT_CAUSE / WORKLOAD_WHAT_IF_ALLOWLIST_MISSING_MIN_REPLICAS`. The release was blocked because the new intentional 24/7 property was not represented in the exact allowlist. This is not evidence that `minReplicas: 1` is invalid, nor evidence that Azure deployment or 24/7 runtime succeeded.

**FIX AND VERIFICATION.** Added a separate exact Run 47 property multiset and a regression in `scripts/azure-what-if-receipt-test.mjs`; the regression was first RED against the old classifier and GREEN after the minimal `scripts/azure-canary-preflight.mjs` fixture addition. The application version remains unchanged. A fresh clean Core gate and one bounded hosted rerun are required; do not widen the allowlist to arbitrary `Modify` or bypass the what-if gate.

## 2026-09-08 — Run 48 exposed a second exact what-if shape gap

**OFFICIAL CONTRACT.** Azure ARM what-if is a non-mutating preview; its reported resource and property changes must be reviewed against the intended template before a deployment mutation ([Template deployment what-if](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if), What-if operation and change details, observed web lines 29-52). The exact-change allowlist below is an internal fail-closed control and does not replace Azure's deployment contract.

**OBSERVED EVIDENCE.** Run 48 / `20260907.4` was queued with and read back source/release commit `f17e40ac57905735aa5218efcd9399977822fc35`, app `1.0.103`. The hosted log checked out that exact commit and logged Azure CLI `2.89.1`, Azure DevOps extension `1.0.7`, and Bicep `0.46.1`. After the same approval path, the task stopped at `workload-parameters-and-what-if` before workload mutation. The authenticated Ego Lite read-back of workload diagnostic artifact `276` showed `status=BLOCKED`, `whatIf.status=Succeeded`, and `Modify:6`, `NoChange:20`, `Ignore:2`, `Unsupported:9`.

The exact Container App `Modify` multiset was the known Run 37 legacy env/secret reconciliation plus `env[19]` and `env[21]` release identity value updates, `image`, `properties.template.revisionSuffix`, and `properties.template.scale.minReplicas`. The task recorded `Invalid Azure canary preflight: what-if contains disallowed Modify change`; failure receipt artifact `277` was retained and the task recorded receipt SHA `bce72eb23cf742f3bec6722d0091dbbb312a3a7c5b741bd4dac5dcc10c184f3a`.

**CLASSIFICATION.** `CONFIRMED_ROOT_CAUSE / WORKLOAD_WHAT_IF_ALLOWLIST_MISSING_RUN48_RELEASE_IDENTITY_SHAPE`. The Run 47 fixture was an incomplete representation of the provider's next observed state shape. This is not a source-commit mismatch, not evidence that `minReplicas: 1` is invalid, and not evidence of a successful Azure deployment.

**FIX AND PREVENTION.** Added an exact, value-free Run 48 multiset fixture to `scripts/azure-canary-preflight.mjs` and a RED/GREEN regression to `scripts/azure-what-if-receipt-test.mjs`. The fixture names the release identity paths explicitly and continues to reject arbitrary environment, image, and scale edits. The app version remains `1.0.103`; no package upload or completion report is justified. A clean full Azure Core gate and one bounded hosted rerun from the new commit are required before any further mutation.

## 2026-09-08 — Run 49 revision read-back inconsistency

**OFFICIAL CONTRACT.** Microsoft exposes both `az containerapp revision show` for one named revision and `az containerapp revision list --all` for the revisions associated with a Container App ([az containerapp revision](https://learn.microsoft.com/en-us/cli/azure/containerapp/revision?view=azure-cli-latest), `list` and `show` command sections; current page read 2026-09-08). The release gate must still require an exact active/provisioned/running-or-healthy/100%-traffic record; switching from `show` to `list` is only a read-back path, not a readiness relaxation.

**OBSERVED EVIDENCE.** Run 49 / `20260907.5` used source/release commit `fb02f7a7dfa72637cfe19a3784fde0490c576418`, app `1.0.103`, and the newly generated immutable handoff. The workload what-if was `OBSERVED`, the worker Blob was staged with the expected archive SHA, and the task then exhausted the exact revision poll at `revision-and-health`. The logged expected revision was `teamsapp-canary-goictvxm--fb02f7a7df`; the final safe fields were all `null`. The task retained failure artifact `285` (`476 B` JSON plus `65 B` checksum sidecar) and recorded receipt SHA `1147c9218e16ef9788dca1ea6ebb99c7a7c1a33e643ece007d801e990a810d94`.

**INDEPENDENT READ-BACK.** After the run, the existing Azure Portal Container App page showed `latestRevisionName=teamsapp-canary-goictvxm--fb02f7a7df` and Container App `provisioningState=Succeeded`. Public `/api/health` returned HTTP 200 with the same commit, version, immutable image/package/bundle identity, authenticated Teams Core, and reachable queue/state dependencies. The response still reported worker heartbeat/readiness unavailable and A2A unavailable. Because the run did not retain a list response or raw revision body at the failure time, the exact transient cause of the null `show` response remains `ROOT_CAUSE_REVIEW_REQUIRED`.

**CLASSIFICATION.** `CONFIRMED_FAILURE_BOUNDARY / REVISION_READBACK_INCONSISTENCY`; not a source-commit mismatch and not a full 24/7/worker success. The current Azure service is live on the same identity, but Run 49 itself is not a release pass.

**FIX AND PREVENTION.** Add an official `revision list --all` fallback that applies the identical readiness predicate and retain a value-free `azure-revision-state.json` in the always-published workload evidence. Add platform/failure-receipt regressions for the fallback and safe receipt. Keep version `1.0.103`; perform a clean Core gate and one bounded hosted rerun before any Teams completion or worker/A2A promotion.

## 2026-09-08 — Run 50 exposed the steady-state what-if variant

**OFFICIAL CONTRACT.** The Azure CLI documents `az containerapp revision list` as the way to list a Container App's revisions and `az containerapp revision show` as the way to show one named revision ([az containerapp revision](https://learn.microsoft.com/en-us/cli/azure/containerapp/revision?view=azure-cli-latest), `list` and `show` sections; current page read 2026-09-08). The internal gate must compare exact provider-reported property changes with the current template rather than assume the previous attempt's delta repeats.

**OBSERVED EVIDENCE.** Run 50 / `20260907.6` used source/release commit `9cbed6663f34b9e8e0ac88508d5d7a9b63c44a5c`, app `1.0.103`, and a matching immutable handoff. Hosted Core/RBAC and approval passed, but the task stopped before workload mutation at `workload-parameters-and-what-if`. The authenticated Ego Lite read-back of workload diagnostic artifact `292` reported `status=BLOCKED`, `whatIf.status=Succeeded`, and `Modify:6`, `NoChange:20`, `Ignore:2`, `Unsupported:9`.

The exact Container App delta was the Run 37 legacy env/secret reconciliation plus release identity updates at `env[19]`, `env[21]`, `image`, and `properties.template.revisionSuffix`. It did not include `properties.template.scale.minReplicas`, because that intentional change had already been applied by Run 49's workload mutation. Failure receipt artifact `293` was retained; the build summary recorded receipt SHA `21fb7a533cd6350ed7d0a4d5cce62fc1db8f4b3e9dc3e0baa4b5a403bc2adfdd`.

**CLASSIFICATION.** `CONFIRMED_ROOT_CAUSE / WORKLOAD_WHAT_IF_MISSING_STEADY_STATE_VARIANT`. This is not evidence that the source commit was ignored, that the revision list fallback failed, or that the app version must change. It is a deterministic state-transition fixture gap discovered before workload mutation.

**FIX AND PREVENTION.** Add explicit exact, value-free transition and steady-state variants to `scripts/azure-canary-preflight.mjs`, with a RED/GREEN regression for the steady-state shape. Keep arbitrary env/image/scale changes blocked and require a new clean Core gate plus immutable handoff before another hosted run.

## 2026-09-08 — Run 51 revision collection envelope read-back gap

**OFFICIAL CONTRACT.** Microsoft documents `az containerapp revision show` for a named revision and `az containerapp revision list --all` for the revisions of a Container App ([az containerapp revision](https://learn.microsoft.com/en-us/cli/azure/containerapp/revision?view=azure-cli-latest)). The Container Apps revision REST contract models a `RevisionCollection` with a `value` array and exposes the state fields used by the readiness gate: `active`, `healthState`, `provisioningState`, `runningState`, `replicas`, and `trafficWeight` ([Container Apps Revisions - List Revisions - REST API](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revisions/list-revisions?view=rest-resource-manager-containerapps-2026-01-01), `RevisionCollection` and `Revision` schemas).

**OBSERVED EVIDENCE.** Run 51 / `20260907.7` used source/release commit `bb157147b8ddf4f980114dc9a30321274562c734`, app `1.0.103`, and a matching immutable handoff. Hosted Core `30/30`, RBAC, approval, workload what-if, Blob staging, and workload mutation completed. The task then exhausted `revision-and-health` for `teamsapp-canary-goictvxm--bb157147b8`; the value-free artifact recorded `active`, `provisioningState`, `runningState`, `healthState`, `trafficWeight`, and `replicas` as `null`.

The workload artifact `300` contained `azure-revision-state.json` (271 B), the diagnostic (25 KB), and the workload receipt (28 KB). The failure artifact `301` contained a 476-byte JSON receipt and a 65-byte SHA sidecar; the task recorded receipt SHA `ca67a517e84443b38a94a82427b4f86726ac0e01aa43d91c049d4ba51b290b11`. The public FQDN independently returned HTTP 200 with `ok=true`, version `1.0.103`, source commit `bb15714`, server bundle SHA `c7be700...`, and authenticated Teams Core. Worker heartbeat/readiness and A2A remained unavailable.

**CLASSIFICATION.** `CONFIRMED_FAILURE_BOUNDARY / REVISION_READBACK_INCONSISTENCY`. The exact Run 51 `show` and `list` bodies were not retained, so the provider response shape is `ROOT_CAUSE_REVIEW_REQUIRED`, not a confirmed Azure API defect. A confirmed code-path gap existed: the pipeline accepted only a top-level array from `revision list` and could fall back to the named `show` body, which explains how an envelope mismatch could yield a name-only/null safe receipt. This is a remediation hypothesis grounded in the source and official `RevisionCollection.value` contract, not a retroactive claim about the missing raw body.

**FIX AND PREVENTION.** Added `scripts/azure-revision-readback.mjs` with RED/GREEN coverage for top-level arrays, `RevisionCollection.value`, malformed envelopes, and its CLI path. The deployment now snapshots this helper before release checkout, normalizes the list response before applying the unchanged readiness predicate, and records only `revisionListResponseShape` in the value-free receipt. The app version remains `1.0.103`; no Teams package upload or completion message is justified. A fresh immutable handoff and hosted run must pass this gate and the separate worker-runtime gate before release promotion.

## 2026-09-08 — Run 52 exposed a nested-property receipt projection bug

**OFFICIAL CONTRACT.** The current Microsoft Container Apps revision schema places `active`, `healthState`, `provisioningState`, `runningState`, `replicas`, and `trafficWeight` under `Revision.properties`; the list response is a `RevisionCollection` whose revisions are in `value`. The CLI exposes both `revision show` and `revision list --all`: [Azure CLI revision commands](https://learn.microsoft.com/en-us/cli/azure/containerapp/revision?view=azure-cli-latest), [Container Apps revision list REST schema](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revisions/list-revisions?view=rest-resource-manager-containerapps-2026-01-01).

**OBSERVED EVIDENCE.** Run 52 / Azure DevOps build `20260907.8` used source/release commit `39aa6f5b9ef90cb45ecae585e40e741ebf27eaed`, app `1.0.103`, and the matching immutable handoff. Hosted Core, RBAC, approval, workload what-if, Blob staging, and workload mutation passed. The task then failed at `revision-and-health` after the bounded poll for `teamsapp-canary-goictvxm--39aa6f5b9e`. The new normalizer logged `Azure revision list response normalized: array (shape="array")` repeatedly, so this run exercised a top-level array rather than proving a `RevisionCollection.value` envelope. The expected revision name was present in the value-free candidate, but all six candidate state fields were logged as `null`. The build summary recorded `boundary=revision-and-health exitCode=1`; the task recorded receipt SHA `add6d495e1a20aea59e9da1c336e016e94b6ec637556b47a3c47fe628568580f`. The worker-runtime probe was not reached.

**ROOT CAUSE AND LIMIT.** `CONFIRMED_FAILURE_BOUNDARY / RECEIPT_DIAGNOSTIC_BUG`; the actual provider state at the poll time remains `ROOT_CAUSE_REVIEW_REQUIRED`. The null candidate fields were produced by the receipt projection `{name, properties: {active, ...}}`, whose shorthand names refer to the resource root in jq; it did not read `.properties.active`, `.properties.provisioningState`, and the other documented nested fields. Therefore the receipt's nulls are not evidence that Azure returned nulls. Separately, the readiness predicate still failed after 30 attempts, so this correction did not establish a successful revision or release.

**FIX AND PREVENTION.** The pipeline now delegates receipt creation to the snapshotted `scripts/azure-revision-readback.mjs` helper. Its `summarizeAzureRevision` function reads only the documented nested properties and its `createAzureRevisionStateReceipt` supports both normalized lists and a single `revision show` response. The CLI `describe` path now emits an unquoted shape suitable for shell assignment. RED/GREEN coverage includes nested-property preservation, single-show diagnostics, exact shape output, malformed properties, and a pipeline contract assertion that rejects the old root-level shorthand. The version remains `1.0.103`; no package upload or Teams completion message is justified.

**CURRENT JUDGMENT.** Run 52 remains `AZURE_CANARY_REVISION_GATE_FAILED / WORKER_RUNTIME_GATE_UNREACHED / RELEASE_BLOCKED`. Commit and push the fix, run the clean Azure Core gate, create a fresh immutable handoff, and perform one bounded hosted rerun. Until that run passes revision readiness and the separate VM worker receipt, 24/7, A2A, portal, desktop, and mobile remain blocked or unverified.

## 2026-09-08 — Run 53 exposed an observed `RunningAtMaxScale` readiness state

**OFFICIAL CONTRACT.** Microsoft documents the revision state fields below `Revision.properties` and the `revision show` / `revision list --all` commands, but the current REST page's running-state enumeration does not list `RunningAtMaxScale`: [Container Apps revision list REST schema](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revisions/list-revisions?view=rest-resource-manager-containerapps-2026-01-01), [Azure CLI revision commands](https://learn.microsoft.com/en-us/cli/azure/containerapp/revision?view=azure-cli-latest). The omission is recorded as contract drift rather than silently treated as an official guarantee.

**OBSERVED EVIDENCE.** Run 53 / Azure DevOps build `20260907.9` used source/release commit `18d20a7baa2770118d6529dca802a87702e23e26`, app `1.0.103`, and the matching immutable handoff. The run passed handoff, hosted Core `30/30`, RBAC, approval, workload what-if, and Blob staging. The corrected workload artifact `316` contained `azure-revision-state.json` at 332 B. Ego Lite read-back of that file returned the expected revision `teamsapp-canary-goictvxm--18d20a7baa` with `active=true`, `provisioningState=Provisioned`, `runningState=RunningAtMaxScale`, `healthState=Healthy`, `trafficWeight=100`, and `replicas=1`. The task still failed at `revision-and-health` after its bounded poll; failure artifact `317` was 541 B and the task recorded receipt SHA `041423bce6582666dd193634e303a9ed683b79561f67c55516de2e626c0fc77b`.

**ROOT CAUSE.** `CONFIRMED_ROOT_CAUSE / REVISION_READINESS_ALLOWLIST_MISSING_OBSERVED_RUNNING_AT_MAX_SCALE`. The service returned a healthy, active, provisioned, traffic-serving revision with one live replica, but both the inline readiness predicate and the final deployment contract accepted only `Running` or healthy `ScaledToZero`. This is not a source/handoff mismatch, and the corrected receipt proves that the previous all-null diagnostic was fixed. The exact state is an observed provider value that current official documentation does not enumerate, so it remains `CONTRACT_DRIFT_REVIEW_REQUIRED` rather than an unqualified official state.

**FIX AND PREVENTION.** Add a strict `RunningAtMaxScale` branch to the shared readiness contract and both hosted jq predicates, requiring `healthState=Healthy` and `replicas>=1`; retain `active=true`, `Provisioned|Succeeded`, and 100% traffic requirements. Add GREEN/RED coverage for healthy one-replica, zero-replica, and unhealthy variants, plus a pipeline contract assertion. Do not accept arbitrary or unknown running-state strings. The app version remains `1.0.103`; no package upload or Teams completion message is justified.

**CURRENT JUDGMENT.** Run 53 is a confirmed pipeline false-negative at `revision-and-health`; it did not reach the VM worker gate. Commit and push this strict observed-state correction, create a fresh immutable handoff, and execute one bounded hosted rerun. Only after revision readiness, the separate worker receipt, 24/7 identity, and Teams UI evidence pass can release completion be claimed.
