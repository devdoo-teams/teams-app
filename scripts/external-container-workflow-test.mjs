import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = await fs.readFile(
  path.join(root, '.github', 'workflows', 'external-container-release.yml'),
  'utf8',
);
const dockerfile = await fs.readFile(path.join(root, 'Dockerfile'), 'utf8');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));

function requireText(pattern, message) {
  assert.match(workflow, pattern, message);
}

requireText(/^name: External container release$/m, 'external workflow must have a distinct name');
requireText(/push:\n\s+branches:\n\s+- main/, 'external release must run only from main pushes');
requireText(/workflow_dispatch:/, 'external release must support manual dispatch');
requireText(/deploy_external:/, 'external deployment must be an explicit manual input');
requireText(/cancel-in-progress:\s*false/, 'external release must not cancel an in-flight deployment');
requireText(/if:\s*github\.ref == ['"]refs\/heads\/main['"]/, 'external jobs must be main-only');
requireText(/needs:\s*verify/, 'image publication must wait for verified inputs');
requireText(/needs:\s*publish/, 'external deployment must wait for the immutable image');
requireText(/environment:\n\s+name: production/, 'deployment must use a protected production environment');
requireText(/actions\/checkout@[0-9a-f]{40}/, 'checkout action must be pinned');
requireText(/actions\/setup-node@[0-9a-f]{40}/, 'Node setup action must be pinned');
requireText(/docker\/setup-buildx-action@[0-9a-f]{40}/, 'Buildx action must be pinned');
requireText(/docker\/login-action@[0-9a-f]{40}/, 'registry login action must be pinned');
requireText(/docker\/build-push-action@[0-9a-f]{40}/, 'image build action must be pinned');
requireText(/azure\/login@[0-9a-f]{40}/, 'Azure login action must be pinned');
requireText(/actions\/upload-artifact@[0-9a-f]{40}/, 'release evidence upload action must be pinned');
requireText(/actions\/download-artifact@[0-9a-f]{40}/, 'release evidence download action must be pinned');
requireText(/ghcr\.io\/\$\{\{ github\.repository \}\}/, 'image repository must be repository-scoped');
requireText(/tags:\s*\$\{\{ env\.IMAGE_REPOSITORY \}\}:sha-\$\{\{ github\.sha \}\}/, 'image tag must be source-commit scoped');
requireText(/TEAMS_SOURCE_COMMIT:\s*\$\{\{ github\.sha \}\}/, 'build must carry source commit identity');
requireText(/push:\s*true/, 'verified image must be published for external deployment');
requireText(/IMAGE_DIGEST:\s*\$\{\{ needs\.publish\.outputs\.image_digest \}\}/, 'deployment must consume the published digest');
const deploySectionStart = workflow.indexOf('\n  deploy:');
assert.notEqual(deploySectionStart, -1, 'external workflow must contain a deploy job');
const deploySection = workflow.slice(deploySectionStart);
assert.doesNotMatch(
  deploySection,
  /^      GITHUB_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}$/m,
  'GHCR credentials must not be exposed at deployment job scope',
);
const mirrorSectionStart = deploySection.indexOf('      - name: Mirror the verified image into Azure Container Registry');
assert.notEqual(mirrorSectionStart, -1, 'deployment must have a dedicated image mirror step');
const mirrorSectionEnd = deploySection.indexOf('\n      - name:', mirrorSectionStart + 1);
const mirrorSection = deploySection.slice(
  mirrorSectionStart,
  mirrorSectionEnd === -1 ? deploySection.length : mirrorSectionEnd,
);
assert.match(mirrorSection, /GHCR_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/, 'GHCR token must be scoped to the mirror step');
assert.match(mirrorSection, /password-stdin/, 'the mirror step must pass the GHCR token through stdin');
requireText(/--image "\$DEPLOY_IMAGE_REPOSITORY@\$IMAGE_DIGEST"/, 'deployment must use an immutable image digest');
requireText(/test "\$deployed_image" = "\$DEPLOY_IMAGE_REPOSITORY@\$IMAGE_DIGEST"/, 'deployment must read back the immutable image reference');
requireText(/az acr login/, 'deployment must authenticate to the target Azure registry');
requireText(/docker pull "\$SOURCE_IMAGE"/, 'deployment must pull the source image by digest');
requireText(/docker push "\$target_image"/, 'deployment must mirror the image into the target registry');
requireText(/test "\$acr_digest" = "\$IMAGE_DIGEST"/, 'registry mirror digest must match the source digest');
requireText(/storage_type=.*storageType/, 'deployment must inspect the configured persistent volume type');
requireText(/storage_name=.*storageName/, 'deployment must inspect the configured storage name');
requireText(/mount_path=.*mountPath/, 'deployment must inspect the data mount path');
requireText(/test "\$mount_path" = "\/app\/data"/, 'the JSON store must use the persistent data mount');
requireText(/test "\$max_replicas" = "1"/, 'file-backed storage must stay single-replica');
requireText(/release-identity\.json/, 'the release identity must be retained and transported');
requireText(/clientAssetSha256/, 'the release identity must bind the exact client asset');
requireText(/assert\.equal\(identity\.clientAssetSha256, assetSha256/, 'public verification must compare the full client asset hash');
requireText(/assert\.equal\(assetUrl\.origin, baseUrl\.origin/, 'public verification must keep assets on the packaged public origin');
requireText(/health\.sourceCommit/, 'public verification must compare source identity');
requireText(/health\.version/, 'public verification must compare application version');
requireText(/health\.serverBundleSha256/, 'public verification must compare server bundle identity');
requireText(/health\.auth.*teams-authenticated/s, 'public verification must require Teams bot auth');
requireText(/health\.userAuth.*entra-sso/s, 'public verification must require Entra user auth');
requireText(/health\.bot.*teams-sdk/s, 'public verification must require Teams SDK bot mode');
requireText(/health\.outbound.*teams-sdk/s, 'public verification must require Teams SDK outbound mode');
requireText(/\/api\/health/, 'public verification must probe the health route');
requireText(/\/tabs\/home\//, 'public verification must probe the Teams tab route');
assert.ok(
  workflow.includes('assets\\/main\\.js') || workflow.includes('assets/main.js'),
  'public verification must probe the built tab asset',
);
requireText(/npm run typecheck:core/, 'external verification must run the bounded Core source check');
requireText(/npm run build:core/, 'external verification must build Core');
requireText(/npm run test:core/, 'external verification must run Core tests');
requireText(/npm run validate:manifest/, 'external verification must validate the Teams manifest');
requireText(/npm run package:app/, 'external verification must build a new Teams package');
requireText(/npm run test:package-determinism/, 'external verification must test package determinism');
requireText(/npm run test:docker-build-inputs/, 'external verification must validate Docker inputs');
requireText(/npm run test:docker-runtime-contract/, 'external verification must validate the Docker runtime contract');
requireText(/activeRevisionsMode/, 'deployment must inspect the Container Apps revision mode');
requireText(/test "\$active_revisions_mode" = "Single"/, 'file-backed deployment must use a single active revision');
requireText(/az containerapp revision list\s*\\\s*--name/s, 'deployment must inspect the created revision readiness');
requireText(/--all\s*\\\s*--only-show-errors\s*\\\s*--output json/s, 'revision readiness must include active revision state');
requireText(/EXPECTED_REVISION_SUFFIX/, 'revision readiness must bind to the source-commit suffix');
requireText(/provisioningState/, 'revision readiness must inspect provisioning state');
requireText(/healthState/, 'revision readiness must inspect health state');
requireText(/runningState/, 'revision readiness must inspect running state');
requireText(/properties\.replicas/, 'revision readiness must inspect replica availability');
requireText(/revision readiness/, 'deployment must report revision readiness explicitly');
requireText(/previous_image/, 'deployment must capture an immutable rollback image');
requireText(/if: failure\(\).*DEPLOYMENT_ATTEMPTED/s, 'failed deployment verification must trigger rollback');
requireText(/rollback-\$\{GITHUB_RUN_ID/, 'rollback must create a traceable revision suffix');
requireText(/TEAMS_APP_ID:\s*\$\{\{ vars\.TEAMS_APP_ID \}\}/, 'Teams deployment variables must remain external');
for (const variable of [
  'TEAMS_CATALOG_APP_ID',
  'BOT_ID',
  'BOT_CLIENT_ID',
  'TENANT_ID',
  'TAB_DOMAIN',
  'CLIENT_ID',
  'APPLICATION_ID_URI',
]) {
  requireText(new RegExp(`${variable}: \\$\\{\\{ vars\\.${variable} \\}\\}`), `${variable} must be supplied as a variable`);
}
for (const variable of [
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'AZURE_SUBSCRIPTION_ID',
  'AZURE_RESOURCE_GROUP',
  'AZURE_CONTAINER_APP',
  'AZURE_CONTAINER_REGISTRY',
  'AZURE_CONTAINER_REGISTRY_REPOSITORY',
  'AZURE_DATA_VOLUME_NAME',
  'PUBLIC_BASE_URL',
]) {
  requireText(new RegExp(`${variable}: \\$\\{\\{ vars\\.${variable} \\}\\}`), `${variable} must be supplied as a protected variable`);
}
assert.doesNotMatch(workflow, /:latest\b/, 'external release must not promote a mutable latest tag');
assert.doesNotMatch(workflow, /secrets\.(?!GITHUB_TOKEN\b)[A-Z0-9_]+/, 'provider credentials must not be passed through GitHub secrets');
assert.equal(packageJson.scripts?.['test:external-container-workflow'], 'node scripts/external-container-workflow-test.mjs');
assert.equal(packageJson.scripts?.['test:docker-runtime-contract'], 'node scripts/docker-runtime-contract-test.mjs');
assert.equal(packageJson.scripts?.['test:docker-build-inputs'], 'node scripts/docker-build-inputs-test.mjs');

assert.match(dockerfile, /COPY scripts\/start-server\.mjs/, 'image must include the runtime loader');
assert.match(dockerfile, /COPY scripts\/runtime-dist\.mjs/, 'image must include the runtime dist resolver');
assert.match(dockerfile, /COPY scripts\/verify-runtime-dist\.mjs/, 'image must verify CI dist provenance');
assert.match(dockerfile, /CMD \["npm", "start"\]/, 'image must start through the npm runtime contract');
assert.match(dockerfile, /TEAMS_RUNTIME_DIST_DIR=\/app\/dist/, 'image must use one explicit runtime dist root');

console.log('PASS: external container workflow is main-gated, digest-pinned, storage-safe, and identity-verifying');
