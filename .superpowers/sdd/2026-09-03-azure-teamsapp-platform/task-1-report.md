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

## Fix Round 1

### Status

FIXED_WITH_EXTERNAL_BOUNDARIES. All ten review findings are addressed in the local platform contract. No Azure resource, Dev Tunnel, public service, browser session, Teams package, or application version was changed. `package.json` and `appPackage/manifest.json` remain `1.0.100`.

### Root-cause corrections

- The Azure pipeline no longer supplies invented ACR or Container App names. It runs `main.bicep` in a foundation phase, validates and consumes the returned registry outputs, imports the immutable digest, runs `main.bicep` in the complete phase, and uses the returned app/revision/FQDN outputs for verification.
- Arbitrary receipt URLs were removed. The handoff consumer authenticates to the allowlisted `devdoo-teams/teams-app` GitHub repository, selects exactly one unexpired artifact by full commit, verifies the REST artifact SHA-256, safely extracts the ZIP, verifies the packaged Teams ZIP hash, and requires GitHub attestations for the receipt, Teams ZIP, and OCI image with repository, signer-workflow, source-commit, and hosted-runner constraints.
- GitHub attestation steps are now unconditional and therefore fail closed when the repository plan cannot produce attestations. The previous self-asserted private-repository provenance fallback was removed.
- Basic ACR quarantine and retention policies were removed. Basic does not support untagged-manifest retention, and quarantine had no scanner-to-release step and would leave imports unpullable. This rationale and the external operator boundaries are documented in `infra/azure/README.md`.
- The user-assigned app identity now outputs `clientId`, and the Container App receives it as `AZURE_CLIENT_ID`.
- Cosmos DB now sets `disableLocalAuth: true` in addition to identity data-plane role assignments.
- A separate preflight queries the Azure DevOps Checks REST API for the exact environment ID/name and requires one enabled Approval check with explicit approvers before deployment or rollback. It writes a durable approval-configuration receipt; the external environment/check remains operator-owned.
- The old regex/line fallback was deleted. `test:azure-platform-contract` now requires an official Bicep CLI, compiles `main.bicep` and the canary parameter file, inspects compiled ARM behavior, and parses the Azure DevOps YAML as a schema. Absence of Bicep or a YAML parser fails closed.
- Rollback identifies the sole active/running/succeeded revision carrying 100% traffic, then chooses the closest succeeded predecessor created before it. It ignores newer non-serving revisions, verifies the target through its revision FQDN before traffic movement, sets target traffic to 100%, and repeats readiness plus public identity verification after rollback.
- Deployment and rollback bind the attested artifact digest, OCI image digest, client digest, server digest, Teams ZIP SHA-256, commit, and version to the exact Container App revision. Public health must independently match commit, version, and server digest. Until a later runtime task exposes every digest publicly, the remaining fields fail closed against the cryptographically verified GitHub receipt plus observed revision metadata instead of being omitted.

### RED evidence

1. `BICEP_BIN=/tmp/teamsapp-bicep-20260903/bicep npm run test:azure-platform-contract`

   Exit `1`:

   ```text
   AssertionError [ERR_ASSERTION]: Basic ACR must not quarantine images without a supported release flow
   actual: 'enabled'
   ```

2. `npm run test:azure-github-handoff`

   Exit `1`:

   ```text
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../scripts/azure-github-handoff.mjs'
   ```

3. `npm run test:azure-approval-check`

   Exit `1`:

   ```text
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../scripts/azure-approval-check.mjs'
   ```

4. `npm run test:azure-deployment-contract`

   Exit `1`:

   ```text
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../scripts/azure-deployment-contract.mjs'
   ```

5. An integration run of `npm run test:image-publish-workflow-contract` then exited `1` because its prior expectation allowed attestations to be skipped for private repositories. The test was corrected to require unconditional image, receipt, and Teams ZIP attestations and to reject the self-asserted fallback.

### GREEN evidence

- Official local compiler boundary:

  ```text
  Bicep CLI version 0.46.1 (545b338e2c)
  SHA-256 7e1064cc780e1767822d7f112f25fdbe72c956e40f75c24254ce8530b41d649a
  ```

- `npm run test:azure-release-input`

  ```text
  PASS: Azure release receipt accepts one complete immutable GitHub handoff and rejects mutable, incomplete, or secret-bearing input.
  ```

- `npm run test:azure-github-handoff`

  ```text
  PASS: authenticated GitHub artifact handoff enforces repository, commit, archive digest, safe extraction, and attested provenance.
  ```

- `npm run test:azure-approval-check`

  ```text
  PASS: Azure DevOps approval preflight fails closed unless the exact environment has an enabled operator approval check.
  ```

- `npm run test:azure-deployment-contract`

  ```text
  PASS: Bicep output consumption, traffic-aware rollback, revision readiness, provenance, and full release identity are behaviorally validated.
  ```

- `BICEP_BIN=/tmp/teamsapp-bicep-20260903/bicep npm run test:azure-platform-contract`

  ```text
  PASS: official Bicep compilation, compiled ARM behavior, parsed Azure Pipeline schema, and executable deployment helpers satisfy the Azure platform contract.
  ```

- `npm run test:image-publish-workflow-contract`

  ```text
  PASS: immutable image publish workflow contract
  ```

- `npm run typecheck:core` after the implementation commit made the tracked worktree clean:

  ```text
  PASS: core source compile check covered 22 Teams/CLI files
  ```

- Parsed every Azure Pipeline Bash/`inlineScript` block and ran `bash -n` on all four scripts:

  ```text
  PASS: parsed pipeline inline scripts and Node modules are syntax-valid
  ```

- Azure DevOps YAML parse, version invariant, and whitespace validation:

  ```text
  PASS: Azure DevOps YAML parses
  PASS: package and Teams manifest remain 1.0.100
  git diff --check: exit 0
  ```

### Changed files

- `.github/workflows/publish-image.yml`
- `azure-pipelines.yml`
- `infra/azure/README.md`
- `infra/azure/main.bicep`
- `infra/azure/modules/acr.bicep`
- `infra/azure/modules/container-app.bicep`
- `infra/azure/modules/cosmos.bicep`
- `infra/azure/modules/identities.bicep`
- `infra/azure/parameters/canary.bicepparam`
- `package.json`
- `scripts/azure-approval-check.mjs`
- `scripts/azure-approval-check-test.mjs`
- `scripts/azure-deployment-contract.mjs`
- `scripts/azure-deployment-contract-test.mjs`
- `scripts/azure-github-handoff.mjs`
- `scripts/azure-github-handoff-test.mjs`
- `scripts/azure-platform-contract-test.mjs`
- `scripts/azure-release-input.mjs`
- `scripts/image-publish-workflow-contract-test.mjs`

### Commits

- `37250f46bf1fbbf3065d637ccc9603c7b2cc4331` — `fix(infra): harden Azure release contract`

### Remaining concerns and external boundaries

- Azure DevOps environment ID/approval configuration, `System.AccessToken` visibility, service connection, subscription/resource-group access, GitHub artifact token scopes, GHCR import, SSH public key, and actual resource deployment remain unverified because this task forbids live Azure changes.
- GitHub artifact attestation support depends on repository visibility and plan. The workflow now fails closed when attestations cannot be generated or verified; no live workflow run or real artifact was created in this fix round.
- Existing official Bicep compilation emits non-blocking linter warnings for child-resource `parent` style and the literal VM admin username. These were outside the ten review findings and do not prevent compilation.
- Rollback deliberately rejects legacy revisions that lack the full release identity environment fields or environments without a `teamsapp-platform-current` Bicep deployment record. A first successful hardened deployment is required before this rollback contract can operate.
- Public health still exposes only commit, version, and server bundle digest. The pipeline compensates with attested artifact plus exact revision checks, but a later runtime task should expose a single public release-identity document containing all six release fields.
