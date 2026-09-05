using '../main.bicep'

param workloadName = 'teamsapp'
param location = 'koreacentral'
param deploymentPrincipalId = '11111111-1111-1111-1111-111111111111'
param enableCosmosFreeTier = true
param deployContainerApp = false

// Azure DevOps replaces this immutable placeholder with the validated receipt image and digest.
param containerImage = 'ghcr.io/devdoo-teams/teams-app@sha256:0000000000000000000000000000000000000000000000000000000000000000'
param releaseSourceCommit = '0000000000000000000000000000000000000000'
param releaseVersion = '1.0.100'
param releaseImageDigest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
param releaseTeamsPackageSha256 = '0000000000000000000000000000000000000000000000000000000000000000'
param releaseClientBundleSha256 = '0000000000000000000000000000000000000000000000000000000000000000'
param releaseServerBundleSha256 = '0000000000000000000000000000000000000000000000000000000000000000'

// This is a non-secret format placeholder. The deployer supplies the approved owner public key.
param workerAdminSshPublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAzureCanaryContractOnly teamsapp@azure-canary'
param deployWorkerVm = true
param workerArtifactUrl = 'https://teamsapp.invalid.blob.core.windows.net/worker-artifacts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/worker-runtime-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tar'
param workerArtifactSha256 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
param codexBinSha256 = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
