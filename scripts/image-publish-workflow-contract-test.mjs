import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflowPath = '.github/workflows/publish-image.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');

function requireText(pattern, message) {
  assert.match(workflow, pattern, message);
}

requireText(/^on:\n  workflow_dispatch:\n  push:\n    tags:\n      - ['"]v\*\.\*\.\*['"]$/m, 'publish workflow must require manual dispatch or a version tag');
assert.doesNotMatch(workflow, /pull_request|workflow_run|schedule:/, 'publish workflow must not publish from untrusted or periodic events');
requireText(/packages:\s*write/, 'registry publication requires package write permission');
requireText(/attestations:\s*write/, 'provenance attestation requires attestation permission');
requireText(/id-token:\s*write/, 'provenance attestation requires the OIDC permission');
requireText(/docker\/login-action@[0-9a-f]{40}/, 'registry login action must be pinned to a commit');
requireText(/docker\/metadata-action@[0-9a-f]{40}/, 'metadata action must be pinned to a commit');
requireText(/docker\/build-push-action@[0-9a-f]{40}/, 'image build action must be pinned to a commit');
requireText(/push:\s*true/, 'the promotion workflow must publish the image');
requireText(/TEAMS_SOURCE_COMMIT=\$\{\{ github\.sha \}\}/, 'image build must carry the exact source commit');
requireText(/actions\/attest@[0-9a-f]{40}/, 'attestation action must be pinned to a commit');
requireText(/subject-digest:\s*\$\{\{ steps\.push\.outputs\.digest \}\}/, 'attestation must use the pushed image digest');
requireText(/push-to-registry:\s*true/, 'attestation must be published with the image');
requireText(/npm run typecheck:core/, 'publishing must verify the Core source first');
requireText(/npm run test:core/, 'publishing must verify the Core test suite first');
requireText(/npm run validate:manifest/, 'publishing must verify the Teams manifest');
requireText(/GITHUB_REF_NAME#v/, 'version-tag publication must derive the package version from the tag');
requireText(/package_version.*tag_version/s, 'version-tag publication must compare the package and tag versions');
assert.doesNotMatch(
  workflow,
  /TEAMS_PUBLIC_URL|AZURE_|VERCEL_|FLY_|RENDER_|RAILWAY_|deployment endpoint/i,
  'image publication must not guess or invoke a hosting provider',
);

console.log('PASS: immutable image publish workflow contract');
