# Task 1 report: Azure platform contract, Bicep, and pipeline ownership

status: DONE_WITH_CONCERNS

## Scope and boundary

- Worktree: `/Users/doosansmacbookpro/.codex/worktrees/teamsapp-azure-platform-20260903`
- Branch: `codex/azure-platform-20260903`
- No Azure resources were provisioned. No Dev Tunnel, running service, Teams package version, or live endpoint was changed.
- Application/package version remains `1.0.100`.

## RED evidence

1. `npm run test:azure-release-input`

   Exit `1`. The first valid-receipt assertion failed because Node reported:

   ```text
   Error: Cannot find module '.../scripts/azure-release-input.mjs'
   ```

   This was the expected failure: the test executed the required public receipt-validator CLI before that CLI existed.

2. `npm run test:azure-platform-contract`

   Exit `1` with:

   ```text
   AssertionError [ERR_ASSERTION]: Azure platform contract must define infra/azure/main.bicep
   ```

   This was the expected failure: the structural platform seam required the Bicep entrypoint before any infrastructure implementation existed.

## GREEN evidence

- `npm run test:azure-platform-contract`

  ```text
  PASS: Azure platform contract (parsed Bicep fallback: az/bicep unavailable) and Azure DevOps deployment handoff graph are valid.
  ```

- `npm run test:azure-release-input`

  ```text
  PASS: Azure release receipt accepts one complete immutable GitHub handoff and rejects mutable, incomplete, or secret-bearing input.
  ```

- `node scripts/image-publish-workflow-contract-test.mjs`

  ```text
  PASS: immutable image publish workflow contract
  ```

- `ruby -e "require 'yaml'; YAML.load_file('azure-pipelines.yml'); puts 'PASS: Azure DevOps YAML parses'"`

  ```text
  PASS: Azure DevOps YAML parses
  ```

- `npm run typecheck:core`

  ```text
  PASS: core source compile check covered 22 Teams/CLI files
  ```

- `git diff --check`

  Exit `0`.

## Changed files

- `.env.example`
- `.github/workflows/publish-image.yml`
- `azure-pipelines.yml`
- `infra/azure/main.bicep`
- `infra/azure/modules/acr.bicep`
- `infra/azure/modules/container-app.bicep`
- `infra/azure/modules/container-environment.bicep`
- `infra/azure/modules/cosmos.bicep`
- `infra/azure/modules/identities.bicep`
- `infra/azure/modules/key-vault.bicep`
- `infra/azure/modules/monitoring.bicep`
- `infra/azure/modules/storage.bicep`
- `infra/azure/modules/worker-vm.bicep`
- `infra/azure/parameters/canary.bicepparam`
- `package.json`
- `scripts/azure-platform-contract-test.mjs`
- `scripts/azure-release-input.mjs`
- `scripts/azure-release-input-test.mjs`

## Commit

- `99e6637e0e4a14603263b5baa219f33e28cb4b85 feat(infra): add Azure canary platform contract`

## Self-review findings

- The original canary parameter path was corrected to `../main.bicep` before commit.
- The pipeline verifies the approved subscription ID before either deploy or rollback mutation.
- The Bicep graph includes the requested ACA environment/app, ACR, Cosmos account, queue/file-share storage, Key Vault, Log Analytics/Application Insights, user-assigned identities/RBAC, and a private-network Linux `Standard_B2ats_v2` VM.
- Container App configuration uses a user-assigned identity, ACR identity pull, Key Vault secret references, zero minimum replicas, and multiple revisions for rollback. Bicep outputs contain only resource identifiers/names/FQDN; no connection string, key, or secret output was added.
- GitHub produces the immutable receipt with commit, version, image digest, Teams ZIP SHA-256, client digest, and server digest. It performs no Azure deployment. Azure DevOps validates that receipt, awaits the `teamsapp-canary` environment gate, imports/deploys by digest, verifies readiness plus public release identity, and has a prior-succeeded-revision rollback path.

## Remaining unverified boundary

- `az`/Bicep was not installed locally, so no real Bicep compilation was possible. The passing contract test used its documented fallback: parsed resource declarations, module relationships, output names, Bicep token structure, and parsed YAML deployment graph. Real Bicep compilation remains required in a CLI-equipped environment.
- Azure DevOps environment approval, service connection, GHCR import secret variables, Azure subscription access, resource deployment, revision readiness, and public health identity were deliberately not exercised; Task 1 forbids provisioning and live Dev Tunnel changes.
- The changed GitHub Actions workflow was contract-tested locally but has not run in GitHub, so no actual immutable receipt artifact exists yet.
