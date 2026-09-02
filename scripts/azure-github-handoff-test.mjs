import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attestationArguments,
  consumeGitHubReleaseArtifact,
  validateRepositoryAllowlist,
} from './azure-github-handoff.mjs';

const repository = 'devdoo-teams/teams-app';
const commit = 'a'.repeat(40);
const teamsPackageBytes = Buffer.from('fixture Teams package');
const receipt = {
  schemaVersion: 1,
  source: 'github-actions',
  commit,
  version: '1.0.100',
  image: 'ghcr.io/devdoo-teams/teams-app',
  imageDigest: `sha256:${'b'.repeat(64)}`,
  teamsPackageSha256: crypto.createHash('sha256').update(teamsPackageBytes).digest('hex'),
  clientBundleSha256: 'd'.repeat(64),
  serverBundleSha256: 'e'.repeat(64),
};

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-github-handoff-test-'));
try {
  assert.equal(validateRepositoryAllowlist(repository, repository), repository);
  assert.throws(() => validateRepositoryAllowlist('attacker/fork', repository), /allowlist/i);

  const artifactRoot = path.join(fixtureRoot, 'artifact');
  const receiptPath = path.join(artifactRoot, 'dist', 'evidence', 'azure-release-receipt.json');
  const teamsZipPath = path.join(artifactRoot, 'appPackage', 'build', 'teams-sdk-mvp.zip');
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.mkdirSync(path.dirname(teamsZipPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(teamsZipPath, teamsPackageBytes);
  const archivePath = path.join(fixtureRoot, 'github-artifact.zip');
  execFileSync('zip', ['-q', '-r', archivePath, '.'], { cwd: artifactRoot });
  const archiveBytes = fs.readFileSync(archivePath);
  const artifactDigest = `sha256:${crypto.createHash('sha256').update(archiveBytes).digest('hex')}`;
  const metadata = {
    total_count: 1,
    artifacts: [{
      id: 42,
      name: `teams-runtime-identity-${commit}`,
      expired: false,
      digest: artifactDigest,
      archive_download_url: `https://api.github.com/repos/${repository}/actions/artifacts/42/zip`,
      workflow_run: { id: 99, repository_id: 7, head_repository_id: 7, head_sha: commit },
    }],
  };
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    if (String(url).includes('/actions/artifacts?')) return new Response(JSON.stringify(metadata), { status: 200 });
    if (String(url).endsWith('/actions/artifacts/42/zip')) return new Response(archiveBytes, { status: 200 });
    return new Response('not found', { status: 404 });
  };

  const result = await consumeGitHubReleaseArtifact({
    repository,
    allowedRepositories: repository,
    commit,
    token: 'fixture-token',
    outputDirectory: path.join(fixtureRoot, 'consumed'),
    fetchImpl,
    verifyAttestation: async () => true,
  });
  assert.deepEqual(result.receipt, receipt);
  assert.equal(result.provenance.repository, repository);
  assert.equal(result.provenance.commit, commit);
  assert.equal(result.provenance.artifactDigest, artifactDigest);
  assert.equal(result.provenance.attestationVerified, true);
  assert.equal(JSON.parse(fs.readFileSync(result.provenancePath, 'utf8')).artifactId, 42);

  await assert.rejects(
    consumeGitHubReleaseArtifact({
      repository,
      allowedRepositories: repository,
      commit,
      token: 'fixture-token',
      outputDirectory: path.join(fixtureRoot, 'unattested'),
      fetchImpl,
      verifyAttestation: async () => false,
    }),
    /attestation/i,
  );

  const digestMismatchFetch = async (url, options) => {
    const response = await fetchImpl(url, options);
    if (!String(url).includes('/actions/artifacts?')) return response;
    return new Response(JSON.stringify({
      ...metadata,
      artifacts: [{ ...metadata.artifacts[0], digest: `sha256:${'f'.repeat(64)}` }],
    }), { status: 200 });
  };
  await assert.rejects(
    consumeGitHubReleaseArtifact({
      repository,
      allowedRepositories: repository,
      commit,
      token: 'fixture-token',
      outputDirectory: path.join(fixtureRoot, 'digest-mismatch'),
      fetchImpl: digestMismatchFetch,
      verifyAttestation: async () => true,
    }),
    /artifact digest/i,
  );

  assert.deepEqual(attestationArguments('/tmp/receipt.json', repository, commit), [
    'attestation', 'verify', '/tmp/receipt.json',
    '--repo', repository,
    '--signer-workflow', `${repository}/.github/workflows/publish-image.yml`,
    '--source-digest', commit,
    '--deny-self-hosted-runners',
  ]);

  console.log('PASS: authenticated GitHub artifact handoff enforces repository, commit, archive digest, safe extraction, and attested provenance.');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
