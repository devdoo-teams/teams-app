import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAzureReleaseInput } from './azure-release-input.mjs';

const commitPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const apiVersion = '2026-03-10';

function fail(message) {
  throw new Error(`Invalid GitHub release handoff: ${message}`);
}

export function validateRepositoryAllowlist(repository, allowedRepositories) {
  if (typeof repository !== 'string' || !repositoryPattern.test(repository)) fail('repository must be owner/name');
  const allowlist = String(allowedRepositories ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!allowlist.includes(repository)) fail(`repository ${repository} is not in the release allowlist`);
  return repository;
}

export function attestationArguments(subject, repository, commit) {
  return [
    'attestation', 'verify', subject,
    '--repo', repository,
    '--signer-workflow', `${repository}/.github/workflows/publish-image.yml`,
    '--source-digest', commit,
    '--deny-self-hosted-runners',
  ];
}

function githubHeaders(token) {
  if (typeof token !== 'string' || token.trim().length < 1) fail('an authenticated GitHub token is required');
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': apiVersion,
    'User-Agent': 'teamsapp-azure-release-consumer',
  };
}

async function responseBody(response, label) {
  if (!response.ok) fail(`${label} returned HTTP ${response.status}`);
  return response;
}

function selectArtifact(payload, repository, commit) {
  if (!payload || !Array.isArray(payload.artifacts)) fail('artifact lookup response is malformed');
  const expectedName = `teams-runtime-identity-${commit}`;
  const matches = payload.artifacts.filter((artifact) => artifact?.name === expectedName && artifact.expired === false);
  if (matches.length !== 1) fail(`expected exactly one unexpired ${expectedName} artifact, found ${matches.length}`);
  const artifact = matches[0];
  if (!Number.isSafeInteger(artifact.id) || artifact.id < 1) fail('artifact id is invalid');
  if (!digestPattern.test(artifact.digest ?? '')) fail('GitHub artifact metadata lacks an immutable SHA-256 digest');
  if (artifact.workflow_run?.head_sha !== commit) fail('artifact workflow head commit does not match the requested commit');
  if (
    !Number.isSafeInteger(artifact.workflow_run?.repository_id)
    || artifact.workflow_run.repository_id !== artifact.workflow_run?.head_repository_id
  ) fail('artifact was produced from a fork or has ambiguous repository provenance');
  const expectedDownloadUrl = `https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`;
  if (artifact.archive_download_url !== expectedDownloadUrl) fail('artifact download URL is outside the allowlisted GitHub repository API');
  return artifact;
}

function validateArchiveEntries(archivePath) {
  const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).split('\n').filter(Boolean);
  if (entries.length === 0 || entries.length > 20_000) fail('artifact ZIP entry count is invalid');
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry);
    if (entry.includes('\\') || entry.includes('\0') || path.posix.isAbsolute(entry) || normalized === '..' || normalized.startsWith('../')) {
      fail(`artifact ZIP contains unsafe entry ${entry}`);
    }
  }
}

function defaultAttestationVerifier(subject, repository, commit, token) {
  execFileSync('gh', attestationArguments(subject, repository, commit), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GH_TOKEN: token },
  });
  return true;
}

export async function consumeGitHubReleaseArtifact({
  repository,
  allowedRepositories,
  commit,
  token,
  outputDirectory,
  fetchImpl = fetch,
  verifyAttestation = defaultAttestationVerifier,
}) {
  validateRepositoryAllowlist(repository, allowedRepositories);
  if (!commitPattern.test(commit ?? '')) fail('commit must be a lowercase full Git object ID');
  if (!outputDirectory || typeof outputDirectory !== 'string') fail('output directory is required');
  const headers = githubHeaders(token);
  const artifactName = `teams-runtime-identity-${commit}`;
  const lookupUrl = `https://api.github.com/repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`;
  const lookupResponse = await responseBody(await fetchImpl(lookupUrl, { headers, redirect: 'error' }), 'artifact lookup');
  const artifact = selectArtifact(await lookupResponse.json(), repository, commit);
  const downloadResponse = await responseBody(await fetchImpl(artifact.archive_download_url, { headers, redirect: 'follow' }), 'artifact download');
  const archiveBytes = Buffer.from(await downloadResponse.arrayBuffer());
  if (archiveBytes.length === 0 || archiveBytes.length > 1024 * 1024 * 1024) fail('artifact ZIP size is outside the 1 GiB release boundary');
  const actualDigest = `sha256:${crypto.createHash('sha256').update(archiveBytes).digest('hex')}`;
  if (actualDigest !== artifact.digest) fail(`artifact digest mismatch: metadata ${artifact.digest}, download ${actualDigest}`);

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-github-artifact-'));
  const archivePath = path.join(temporaryDirectory, 'artifact.zip');
  try {
    fs.writeFileSync(archivePath, archiveBytes, { flag: 'wx' });
    validateArchiveEntries(archivePath);
    fs.mkdirSync(outputDirectory, { recursive: true });
    execFileSync('unzip', ['-q', archivePath, '-d', outputDirectory], { encoding: 'utf8' });
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const receiptPath = path.join(outputDirectory, 'dist', 'evidence', 'azure-release-receipt.json');
  const teamsPackagePath = path.join(outputDirectory, 'appPackage', 'build', 'teams-sdk-mvp.zip');
  const receipt = readAzureReleaseInput(receiptPath);
  if (receipt.commit !== commit) fail('extracted receipt commit does not match artifact lookup commit');
  const teamsPackageSha256 = crypto.createHash('sha256').update(fs.readFileSync(teamsPackagePath)).digest('hex');
  if (teamsPackageSha256 !== receipt.teamsPackageSha256) fail('extracted Teams package SHA-256 does not match the attested receipt');

  const attestedSubjects = [receiptPath, teamsPackagePath, `oci://${receipt.image}@${receipt.imageDigest}`];
  for (const subject of attestedSubjects) {
    if (await verifyAttestation(subject, repository, commit, token) !== true) fail(`GitHub attestation verification failed for ${subject}`);
  }

  const provenance = {
    schemaVersion: 1,
    repository,
    workflow: `${repository}/.github/workflows/publish-image.yml`,
    commit,
    workflowRunId: artifact.workflow_run.id,
    artifactId: artifact.id,
    artifactDigest: artifact.digest,
    attestationVerified: true,
    attestedSubjects: ['azure-release-receipt.json', 'teams-sdk-mvp.zip', `${receipt.image}@${receipt.imageDigest}`],
  };
  const provenancePath = path.join(outputDirectory, 'github-handoff-provenance.json');
  fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx' });
  return { artifact, receipt, receiptPath, teamsPackagePath, provenance, provenancePath };
}

async function main() {
  const [repository, commit, outputDirectory] = process.argv.slice(2);
  if (!repository || !commit || !outputDirectory || process.argv.length !== 5) {
    throw new Error('Usage: node scripts/azure-github-handoff.mjs <owner/repository> <commit> <output-directory>');
  }
  const result = await consumeGitHubReleaseArtifact({
    repository,
    allowedRepositories: process.env.AZURE_RELEASE_ALLOWED_REPOSITORIES,
    commit,
    token: process.env.GITHUB_TOKEN,
    outputDirectory: path.resolve(outputDirectory),
  });
  console.log(`GitHub release artifact verified: ${result.provenance.repository}@${result.provenance.commit}, artifact ${result.provenance.artifactId}, ${result.provenance.artifactDigest}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
