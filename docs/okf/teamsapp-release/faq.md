---
type: "Playbook"
title: "TeamsApp release failure FAQ"
description: "Team-facing answers that connect each recurring failure to an official contract, internal line reference, and enforced gate."
resource: /faq.md
tags: [faq, incident-response, release, teams, azure]
generated:
  by: "process:codex-okf/1"
  at: "2026-09-07T18:00:24Z"
verified:
  by: "process:release-faq-reconciliation/1"
  at: "2026-09-07T18:00:24Z"
status: stable
stale_after: "2026-09-14T18:00:24Z"
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
  - id: node-esm
    resource: "https://nodejs.org/api/esm.html"
    title: "Modules: ECMAScript modules - Node.js documentation"
    location: "relative import resolution and mandatory file extensions; observed web lines 212-226 on 2026-09-06"
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
    location: "VM agent, RunShellScript, restrictions, and Azure CLI sections; observed 2026-09-07"
  - id: azure-run-47
    resource: "https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=47"
    title: "TeamsApp Azure DevOps Run 47"
    location: "promoted 24/7 minReplicas what-if boundary and retained failure receipt"
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
  - id: az-storage-blob-cli-source
    resource: "https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/azure/cli/command_modules/storage/commands.py"
    title: "Azure CLI Storage command registration"
    location: "storage blob metadata show transforms get_blob_properties to x.metadata; observed source lines 2688-2693"
  - id: az-storage-blob-reference
    resource: "https://learn.microsoft.com/en-us/cli/azure/storage/blob?view=azure-cli-latest"
    title: "az storage blob"
    location: "metadata show/update and upload options; observed current CLI reference"
  - id: apple-sleep-settings
    resource: "https://support.apple.com/en-ie/guide/mac-help/mchle41a6ccd/mac"
    title: "Set sleep and wake settings for your Mac"
    location: "Set your Mac to go to sleep after inactivity and Specify sleep and wake settings; observed web lines 296-320 on 2026-09-07"
  - id: apple-lock-screen
    resource: "https://support.apple.com/en-euro/guide/mac-help/-mh11784/mac"
    title: "Change Lock Screen settings on Mac"
    location: "Lock Screen options; observed web lines 274-292 on 2026-09-07"
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

## Q16. Why did Run 32 retain an empty Azure failure receipt?

Because the DeployCanary task deliberately checked out the exact deploy-only release commit before running its Azure commands. The receipt helper had been added to the newer pipeline source commit, but was absent from that older release commit. The `ERR` trap therefore tried to execute a missing helper while suppressing the helper's own error; Azure DevOps created the named artifact directory but uploaded zero files.

Evidence:

- Run 32 log 44: the task checked out `71df02e2...` and later failed at `workload-parameters-and-what-if`.
- Run 32 log 46: `Processed 0 files` and `Uploaded 0 out of 61 bytes` for `azure-deployment-failure-receipt`.
- `git show 71df02e2:scripts/azure-deployment-failure-receipt.mjs`: the helper path is absent at the deploy source commit.
- Source fix `9c793d4`: copy the helper to `$(Agent.TempDirectory)` before release checkout and invoke that preserved path.

The fix does not make the Azure deployment successful. It only restores durable failure evidence. The what-if `Modify` mismatch remains a separate fail-closed gate and must not be bypassed by adding an unobserved allowlist rule. This is consistent with Microsoft’s contract that what-if previews predicted changes without applying them, and with Azure Pipelines’ separation of approval from deployment lifecycle and failure evidence.[^arm-what-if][^az-deployment-jobs]

Required regression:

- `npm run test:azure-deployment-failure-receipt` must assert snapshot-before-checkout and preserved-helper execution;
- `npm run test:azure-core` must be GREEN before queuing another hosted run;
- a hosted run must read back a non-empty, schema-valid JSON receipt and its SHA-256 sidecar or keep the failure `UNVERIFIED`.

## Q17. Why did the worker Blob step keep failing after IAM was present?

The hosted Run 39 evidence identifies a query-shape defect, not a missing role. The deployment queried `metadata.sha256` after `az storage blob metadata show`. The official Azure CLI command registration transforms `get_blob_properties` to `x.metadata` (source lines 2688-2693), so the returned user-defined metadata map is top-level and the correct query is `sha256`. The nested query can return an empty value even when the Blob has the expected metadata.

Evidence:

- Run 39 / build `20260906.18`, source `6edcdbc6576ae9585f43ca6dc4fd2241262cc78e`, log 44: `expected fe36475c... observed <empty>` at `worker-blob`.
- Azure Portal: `worker-artifacts` exists and its container-scope role list shows `Storage Blob Data Contributor` for the deployment service principal.
- Official Azure CLI source: [`commands.py`](https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/azure/cli/command_modules/storage/commands.py), lines 2688-2693.
- Official command reference: [`az storage blob`](https://learn.microsoft.com/en-us/cli/azure/storage/blob?view=azure-cli-latest), `metadata show`, `metadata update`, `upload`, and `--auth-mode login`.

Fix:

- `scripts/azure-worker-blob-stage.mjs` now queries `sha256`, keeps the Entra-only path, and verifies the exact value after upload or a concurrent-create race.
- `scripts/azure-worker-blob-stage-test.mjs` is RED for the nested query and GREEN for the corrected query.
- `npm run test:azure-core` must be run from the clean correction commit before the next hosted run.

Do not delete or overwrite a mismatched Blob based only on a false empty query. Read the top-level metadata correctly first; if it then mismatches, retain the exact evidence and treat the object as an independently reviewed immutable-artifact conflict.

## Q18. Why did Run 40 fail even though Azure Portal showed the revision as Healthy?

Two independent defects were exposed. The canary's Bicep template intentionally sets `minReplicas: 0`, so the portal reported `Healthy`, `ScaledToZero`, `traffic 100%`, and `replicas 0`. Azure's current revision guidance defines Scale to 0 as zero running replicas that can be created again by a scale rule, while its scaling guidance says `minReplicas >= 1` is required for an always-running instance. The old pipeline treated only `runningState == Running` as ready, so it produced a false negative for a healthy HTTP canary. This must not be confused with the separate 24/7 requirement.

The same task then executed an explicit `exit 1` after the 30-poll readiness loop. The failure writer was attached only to an `ERR` trap, so it did not run for that explicit exit path. Azure DevOps consequently retained the named failure artifact with `0` bytes even though the helper had been copied before release checkout.

Evidence:

- Run 40 / build `20260906.19`, log 44: worker Blob succeeded, then `Expected release revision did not reach Running/Succeeded/100%: teamsapp-canary-goictvxm--71df02e2ea`, followed by `Script failed with exit code: 1`.
- Existing Ego Lite Azure Container Apps revision read-back: `Healthy`, `ScaledToZero`, `100%`, `0` replicas.
- Run 40 artifact list: artifact `220` (`azure-what-if-workload-receipt`, `51956` bytes) and artifact `221` (`azure-deployment-failure-receipt`, `0` bytes); log 46 recorded `Processed 0 files`.
- Internal sources: `azure-pipelines.yml:497-534,784-805`, `scripts/azure-deployment-contract.mjs:45-53,73-76,125-130`, and the focused regressions in `scripts/azure-deployment-failure-receipt-test.mjs:118-129` and `scripts/azure-deployment-contract-test.mjs:46-63,98-107`.

Fix:

- Accept only `Running`, or `ScaledToZero` with `Healthy`, `Succeeded`, active, and 100% traffic for the HTTP canary; retain public `/api/health` and release-identity verification as separate gates.
- Use one nonzero `EXIT` trap that writes the secret-free JSON receipt and SHA-256 sidecar before cleanup while preserving the original exit code.
- Keep `minReplicas >= 1` as a separate 24/7 promotion gate; changing that setting requires its own what-if and cost/runtime review.

The source tests are GREEN, but Run 40 itself remains failed and cannot verify the fix. Azure Container Apps scaling and revision lifecycle are documented in [Set scaling rules](https://learn.microsoft.com/en-us/azure/container-apps/scale-app), lines 31-56, and [Update and deploy changes](https://learn.microsoft.com/en-us/azure/container-apps/revisions), lines 48-72 and 128-138. Deployment approval and failure lifecycle remain separate according to [Deployment jobs](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops), lines 55-76.

## Q19. What did Run 41 prove, and what remains unverified?

Run 41 proved that the receipt-loss fix is working: after the bounded revision check failed, the Azure DevOps log reported `receiptWriteStatus=READY`, the artifact page showed a 476-byte JSON plus a 65-byte SHA-256 sidecar, and the JSON body read back with `pipelineRunId=41` and `boundary=revision-and-health`. It did not prove the Azure deployment failed to start.

Run 41 used source `3a554977` before the subsequent `Provisioned`-state and redacted revision-diagnostic change. Its exact `revision.json` state was not retained, so the reason the corrected `ScaledToZero + Healthy` predicate still did not match is `REVIEW_REQUIRED`, not a confirmed root cause. The official Microsoft revision contract lists `Provisioned` as the successful provisioning state; the next run must record that field before any further change is accepted.

Required separation:

- `VERIFIED`: same-run source and identity, preflight, approval, worker Blob SHA, and non-empty failure receipt read-back;
- `INFERENCE`: the old `Succeeded`-only provisioning predicate likely rejected the live `Provisioned` state;
- `UNVERIFIED`: hosted success, public `/api/health`, 24/7 `minReplicas >= 1`, worker VM heartbeat/restart recovery, Teams package/desktop/mobile, and live A2A.

The source correction is intentionally bounded: it accepts official `Provisioned` and legacy `Succeeded`, accepts `ScaledToZero` only with `Healthy`, prints only safe revision state fields on failure, and preserves the original exit code through the nonzero `EXIT` trap. It does not raise the application version because this is CI/release-gate behavior, not a user-visible application change. See [Update and deploy changes in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions), lines 48-72 and 128-138.

## Q20. Why did Run 42 reach public health but still fail?

Run 42 used the corrected pipeline-source readiness predicate, so it got past worker Blob staging, Azure deployment, and the revision poll. The final identity check still executed `scripts/azure-deployment-contract.mjs` from the deploy-only release checkout. That older commit required `Running` and `Succeeded`, so it rejected the same healthy scale-to-zero/provisioned revision that the pipeline predicate had accepted. This is a helper-provenance mismatch, not evidence that the public server was down.

Evidence:

- Run 42 log 44: worker Blob SHA succeeded; a public health response was downloaded (`2920` bytes); then `Invalid Azure deployment contract: revision readiness or traffic state is not complete` and `boundary=final-identity-contract`.
- Read-only source comparison: current pipeline contract contains `Provisioned`/`ScaledToZero`, while `git show 71df02e2:scripts/azure-deployment-contract.mjs` contains only `Running`/`Succeeded` checks.
- Public FQDN curl: HTTP 200, `ok=true`, `version=1.0.103`, release `sourceCommit`, `auth=teams-authenticated`, `bot=teams-sdk`, and `outbound=teams-sdk`. This does not prove the final release identity contract, Teams installation, 24/7 worker, mobile, or A2A.

Fix:

- Snapshot the final identity contract before `git checkout --detach "$commit"` and invoke the absolute snapshot path. The platform contract test asserts both ordering and invocation.
- Keep all release-critical helpers that read or classify deployment state in the pipeline-owned snapshot closure, or bind them to an immutable helper bundle; do not let release checkout silently replace them.
- Re-run clean Azure Core and one bounded hosted run. Do not increment `1.0.103` for this CI-only provenance repair.

The focused tests are GREEN, but Run 42 remains failed until a hosted rerun proves the same helper identity through public health and final identity read-back. See [Deployment jobs](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops), lines 37-76, and [Container Apps revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions), lines 128-138.

## Q21. Why did Run 43 fail after the Run 42 helper snapshot fix?

Run 43 exposed the next, narrower provenance defect. The pipeline did snapshot `azure-deployment-contract.mjs` before release checkout, but that module contains `import { readAzureReleaseInput } from './azure-release-input.mjs'`. Only the importer was copied, so after checkout Node could not resolve the relative dependency and the final identity step failed with `ERR_MODULE_NOT_FOUND`. Node's official ECMAScript-module contract resolves relative specifiers from the importing file and requires the explicit file extension ([Node.js ECMAScript modules](https://nodejs.org/api/esm.html), `import Specifiers` and `Mandatory file extensions`, observed lines 212-226).

Evidence:

- Run 43 / build `20260906.22` log 44: `ERR_MODULE_NOT_FOUND` for `/home/vsts/work/_temp/azure-what-if-receipt-tools/azure-release-input.mjs`, imported by the preserved deployment helper.
- The same run passed the updated revision poll and downloaded a 2920-byte public health response before the module-load failure; this is not evidence that the public server was down.
- Failure artifact `245` was listed at `545 B`; the task recorded `receiptWriteStatus=READY` and checksum `2651ec69422d53fa8a0674ff4101c195e16b2fc4c778c61e57a80950dabd2019`.

Fix and gate:

- Copy `scripts/azure-release-input.mjs` into the same pipeline-owned helper directory before `git checkout --detach "$commit"` and assert it is non-empty.
- Add a RED regression that runs the snapshotted deployment helper after release checkout with a valid fixture receipt and fails on any missing local import.
- Keep the closure explicit and minimal; do not copy the whole repository or alter the release commit to hide a missing helper.

Run 43 remains failed. No application version bump or Teams upload is appropriate for this CI-only repair. A clean Core gate and one bounded hosted rerun are required before this release can advance.

## Q22. What did Run 44 actually prove?

Run 44 proved the repaired Azure canary deployment path for the existing `1.0.103` release identity. The hosted final task loaded the complete preserved helper closure and verified the release commit, version, image digest, revision state, traffic, and public health identity in one run. The Azure DevOps build itself is `Succeeded`; this is not inferred from an exit code alone.

Independent read-back:

- The public health endpoint returned HTTP 200 with `ok=true`, version `1.0.103`, source commit `71df02e2…`, server bundle SHA, `auth=teams-authenticated`, `userAuth=entra-sso`, `bot=teams-sdk`, and `outbound=teams-sdk`.
- Ego Lite's existing ACA revision page showed `teamsapp-canary-goictvxm--71df02e2ea`, `ScaledToZero`, `Healthy`, traffic `100`, and replicas `0`.
- The response still reports worker heartbeat `not-observed`, worker readiness `unavailable`, execution boundary `external-linux-worker-unverified`, and A2A `unavailable`.

Therefore Run44 is `AZURE_CANARY_DEPLOYMENT_PASS`, not full product release completion. Microsoft distinguishes scale-to-zero from an always-running instance; `minReplicas >= 1` is still required for the 24/7 gate ([Set scaling rules](https://learn.microsoft.com/en-us/azure/container-apps/scale-app), lines 31-56). Teams package registration, installed desktop UI, mobile UI, and live worker/A2A evidence remain open.

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

## Q23. Why did Run 44 pass while Run 46 failed?

Run 44 passed only the Azure HTTP canary identity. Its health response explicitly reported worker heartbeat `not-observed`, worker readiness `unavailable`, and A2A `unavailable`. The old pipeline had no VM runtime/auth gate, so an ACA revision/public health pass could be mistaken for a 24/7 agent pass.

Run 46 adds the missing boundary. After the same release identity reached public health, Azure VM `RunShellScript` executed a non-interactive probe. The probe checks systemd enabled/active state, installed release commit and manifest, Codex executable digest, owner-only auth-file metadata, and `codex login status` under `teamsworker`. It failed closed at `worker-runtime` because `auth_file=missing`. This is the intended result: the pipeline now exposes the real blocker instead of reporting a false success.

Official basis: Microsoft documents that Run Command uses the VM agent to execute Linux scripts, supports `RunShellScript`, does not support interactive prompts, and has bounded output/time behavior ([Run scripts in a Linux VM by using action Run Commands](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command), Benefits, Restrictions, Available commands, and Azure CLI sections).

## Q24. Why did Run 45 fail immediately?

Run 45 was queued through MCP with empty required template parameters. The run read-back showed blank `githubReleaseCommit`, `azureDevOpsEnvironmentId`, and Codex package fields, so `ValidateHandoff/bootstrap` failed before any Azure mutation. This is an operator invocation error, not a product or Azure runtime error.

The queue gate is now explicit: after every queue call, read back source commit, release commit, environment ID, Codex URL, package version, and package SHA-256. If any is empty or mismatched, cancel/classify the run and do not retry blindly.

## Q25. What is required to unblock the worker gate?

The Codex VM login remains an out-of-band user-presence step. The operator must authenticate the existing VM worker account through the approved Codex device-login flow; the pipeline must never copy a Mac credential, print auth contents, store a device code, or perform MFA. After the user confirms that login is complete, rerun only the bounded worker probe or the same release deployment gate. A successful probe still does not prove 24/7 until the ACA promoted configuration has `minReplicas >= 1` and a real terminal worker receipt is read back.

## Q26. Does a black screenshot or CUA "locked" error prove that the remote Mac is locked?

No. They are separate capture/control boundaries and must not be promoted to a screen-lock fact.

Evidence classification:

- `pmset -g assertions` or Caffeine `Prevent*Sleep` output is `POWER_ASSERTION_ACTIVE`. It shows a power assertion, not whether a remote display session is locked.
- A local `screencapture` black frame is `REMOTE_CAPTURE_UNAVAILABLE`. It shows that this capture path did not deliver pixels, not that the user's remote desktop is locked.
- A Computer Use `locked`/automatic-unlock error is `CUA_CONTROL_UNAVAILABLE`. It shows that this control path cannot operate now, not the state of another session.
- A user-provided remote desktop screenshot showing the desktop is `USER_REMOTE_VIEW` for that capture time. It is evidence of what the user saw then, not a guarantee about a later instant.

Only a direct lock-screen/session signal and an independent signal tied to the same host and session may be recorded as `CONFIRMED_SCREEN_LOCK`. If signals disagree, record `REMOTE_SESSION_MISMATCH`, preserve the original evidence, continue command-only/Ego DOM/public HTTP checks, and keep only the native UI row `DESKTOP_UNVERIFIED`. Do not ask the user to unlock based on one tool error.

Official basis: Apple separates power/sleep timing from Lock Screen password behavior ([Set sleep and wake settings for your Mac](https://support.apple.com/en-ie/guide/mac-help/mchle41a6ccd/mac), observed web lines 296-320; [Change Lock Screen settings on Mac](https://support.apple.com/en-euro/guide/mac-help/-mh11784/mac), observed web lines 274-292). Installed help also defines `pmset -g assertions` as power-assertion reporting and `screencapture` as screen capture. Internal rule: [remote screen evidence section](../../teams-release-workflow.md#원격-화면잠금캡처-증거-판정).

## Q27. Does changing the source to `minReplicas: 1` prove that the Teams app is now 24/7?

No. It makes the promoted source intent match the Azure always-running requirement, but it is still only source evidence until the exact commit is handed off, the non-mutating what-if and cost/runtime review pass, Azure reads back `minReplicas: 1`, the revision is active, public health matches the release identity, and the separate Linux worker gate passes.

The previous `Healthy / ScaledToZero / replicas 0` observation was a valid HTTP canary result, not 24/7 proof. Development/cost profiles may retain scale-to-zero only when explicitly labeled as such. The app version remains unchanged because this is infrastructure-only.

## Q28. Why did the first 24/7 attempt fail after the source change?

Run 47 reached the correct source and release identity, passed the pre-approval checks and manual approval, then stopped before Azure mutation because the exact workload what-if contained a new intentional path: `properties.template.scale.minReplicas` with `Modify`. The fail-closed allowlist knew the older legacy env/secret shape but not this combined shape.

The fix is a separate exact Run 47 multiset fixture plus a regression test. It does not accept arbitrary Container App `Modify` changes. The run remains failed until the clean fix is committed, the full Azure Core gate passes, and a fresh hosted run reads back the exact what-if and subsequent runtime identity.

## Q29. Why did Run 48 fail even though the Run 47 fix was committed?

Because the hosted Run 48 did execute the new f17 commit, but Azure returned a larger exact property-change multiset than the Run 47 fixture represented. The existing Container App reported the Run 37 legacy reconciliation plus two release-identity env updates (`env[19]` and `env[21]`), `image`, `properties.template.revisionSuffix`, and `properties.template.scale.minReplicas`. The source Bicep declares each of those release-controlled fields, but the fail-closed classifier had not yet recorded this combined observed shape.

This is a confirmed allowlist fixture gap, not a source mismatch and not a successful deployment. The prevention is to retain the exact value-free provider multiset as a regression, map each newly accepted path to a current template field, and continue rejecting any extra/unobserved `Modify` entry. Run 48 remains `FAIL_AFTER_APPROVAL` until a clean commit passes the full Azure Core gate and one bounded hosted rerun reaches the next real boundary.

## Q30. Why did Run 49 fail when the Portal and public health later showed the revision?

Run 49's named `revision show` poll exhausted while every safe state field was null. Afterward, the existing Azure Portal read-back showed the exact latest revision name and `provisioningState=Succeeded`, and `/api/health` returned the same release identity. This proves a read-back timing/response inconsistency is plausible, but the original revision body was not retained, so the precise transient cause remains `ROOT_CAUSE_REVIEW_REQUIRED`.

The prevention is to query the exact revision with both the documented `show` and `list --all` paths, apply the same active/provisioned/running-or-healthy/100%-traffic predicate to either response, and retain only a value-free candidate receipt. A healthy public endpoint does not by itself make the failed pipeline run or the worker/A2A gates pass.

## Q31. Why did Run 50 fail before the revision fallback could be tested?

Run 50 reached a different, earlier boundary. After Run 49 had already applied `minReplicas: 1`, Azure's next what-if no longer contained that path; it reported the steady-state release identity delta instead. The exact allowlist intentionally rejected it because only the initial transition shape had been recorded. This confirms that the earlier Run 49 mutation changed the next what-if, rather than proving that the new source or fallback was absent.

The fix is a second exact value-free steady-state variant alongside the initial transition variant. Both are tested independently; arbitrary new property changes remain blocked. The revision list fallback will be evaluated only after this pre-mutation gate passes.

## Q32. Why did Run 51 still fail after the steady-state what-if fix?

Run 51 passed the handoff, hosted Core `30/30`, RBAC, approval, what-if, Blob staging, and workload mutation. It failed later at `revision-and-health`: the safe receipt had the expected revision name but all state fields were `null`. Public `/api/health` independently served the same `bb15714` identity, so this is not evidence of a source mismatch or a server outage.

The exact raw Azure response was intentionally not persisted, so the provider's response shape remains `ROOT_CAUSE_REVIEW_REQUIRED`. The source did, however, have a concrete read-back gap: it accepted only a top-level array from `revision list`, while the official REST contract models `RevisionCollection.value`. The remediation normalizes both forms, records the response shape without raw revision data, and retains the same strict readiness predicate. This does not relax the gate and does not prove the Run 51 raw response had that envelope.

Official basis: [az containerapp revision](https://learn.microsoft.com/en-us/cli/azure/containerapp/revision?view=azure-cli-latest) and [Container Apps Revisions - List Revisions - REST API](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revisions/list-revisions?view=rest-resource-manager-containerapps-2026-01-01).
