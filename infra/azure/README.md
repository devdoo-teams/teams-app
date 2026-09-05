# Azure canary deployment boundary

`main.bicep` is the resource-group-scoped source of truth for generated resource names. The Azure DevOps pipeline runs it first with `deployContainerApp=false`, validates and consumes the returned registry outputs, imports the attested image digest, and then runs the same entrypoint with `deployContainerApp=true`. The second deployment outputs the exact Container App name, revision, FQDN, environment, registry, and managed-identity client ID used by readiness and identity checks.

The canary registry intentionally uses the free-first Basic SKU. Basic does not support the untagged-manifest retention policy. Quarantine is also omitted because this design has no supported scanner-to-release transition; enabling it would quarantine imports without a release action and prevent the Container App identity from pulling them. Promotion safety is instead fail-closed at the authenticated GitHub artifact digest and GitHub artifact-attestation boundaries before ACR import.

Azure DevOps approvals are external resource-owner configuration and cannot be created or proven by an `environment:` YAML name. Before either deployment or rollback, `azure-approval-check.mjs` queries the Azure DevOps Checks REST API for the exact `azureDevOpsEnvironmentId`, requires one enabled Approval check with explicit approvers, and writes a pipeline receipt. Operators must create that environment/check outside this repository, pass its immutable numeric ID, enable `System.AccessToken` for scripts, and grant the build identity read access to check configuration. Missing access, a missing ID, a disabled check, or no explicit approver fails before Azure mutation.

The pipeline also requires externally managed values for `githubArtifactUsername`, `githubArtifactReadToken`, and `workerAdminSshPublicKey`. The GitHub token needs repository Actions read, attestations read, and package read access. GitHub artifact attestation generation must be available for the repository plan; otherwise the GitHub workflow and Azure handoff fail closed. No credential or connection string is accepted as a Bicep output.

The worker release additionally requires explicit `codexArtifactUrl` and `codexArtifactSha256` pipeline parameters. The pipeline checks out the exact attested commit, builds the worker, packages the pinned Node runtime and the digest-verified Codex executable, and uploads one deterministic archive to the private `worker-artifacts` container with Entra authentication. The deployment service connection therefore needs Blob Data Contributor access to that container. The VM identity receives only Blob Data Reader on that container and a custom dispatch-queue role containing `messages/read`, `messages/process/action`, and `messages/write`; the last action is required for lease-heartbeat visibility updates. Linux Custom Script Extension 2.1 downloads the private archive with the VM managed identity, verifies both digests, installs an owner-only environment file, and enables the worker service. Authentication material remains out of band and is never placed in Bicep, pipeline YAML, the archive, or cloud-init.

Public `/api/health` currently exposes commit, version, and server bundle SHA-256. Until a later runtime task exposes every release field publicly, the deployment gate combines that public observation with the cryptographically verified GitHub receipt and exact Container App revision metadata. The revision must bind the imported image digest, client digest, server digest, Teams ZIP digest, commit, and version as immutable revision environment values, and all values must match before deployment or rollback succeeds.

State migration and promotion remain separate from Bicep provisioning. Follow [`docs/azure-state-migration-runbook.md`](../../docs/azure-state-migration-runbook.md): export the local AgentJob ledger into an immutable hash manifest, run import dry-run, preserve an immutable pre-import Azure snapshot before explicit apply, and reconcile counts, stable IDs, tenant ownership, and content hashes. `TEAMS_RELEASE_TARGET=azure npm run release:preflight` is the single non-mutating evidence join for Azure configuration, attested GitHub handoff, official Bicep compilation, migration readiness, Core gates, Teams package identity, provider readiness, public canary identity, Azure DevOps approval, and Jira mappings. Fixture evidence remains unverified, and no gate changes or stops the existing Dev Tunnel.

## Non-mutating foundation preflight

Before requesting a foundation deployment, run the dedicated provider-level preflight from a clean tracked worktree. Supply the approved tenant, subscription, operator account, resource group, and region explicitly; never rely on the Azure CLI default subscription.

```sh
npm run azure:canary-preflight -- \
  --tenant-id 32441482-5adf-4438-8a8f-0e15f33b77f1 \
  --subscription-id 0e58c3cb-474d-4e70-978a-4939c586f867 \
  --account-name doosan.baek@devdoo.onmicrosoft.com \
  --resource-group rg-teamsapp-canary \
  --location koreacentral \
  --output-file /private/tmp/teamsapp-azure-canary-preflight.json
```

The command performs only read operations plus `az deployment group what-if`: canonical Git root and two tracked-clean/HEAD checks, exact account/subscription/tenant validation, required provider registration checks, exact resource-group validation, the bounded Azure Core regression suite, and a ResourceIdOnly ARM what-if with both workload switches disabled. Child processes do not inherit token, secret, password, PAT, API-key, authorization, or credential environment variables.

`READY` means the what-if contains only allowlisted non-destructive changes. `REVIEW_REQUIRED` means only dynamic role-assignment changes were `Unsupported`; inspect every listed resource before any deployment request. A wrong identity, dirty source, failed test, out-of-scope resource, unexpected namespace, `Modify`, `Delete`, or unallowlisted `Unsupported` result fails closed. This command never registers providers, creates a resource group, starts a deployment, changes traffic, imports state, or touches the existing Dev Tunnel.
