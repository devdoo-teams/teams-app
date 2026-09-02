using '../main.bicep'

param workloadName = 'teamsapp'
param location = 'koreacentral'
param enableCosmosFreeTier = true

// Azure DevOps replaces this immutable placeholder with the validated receipt image and digest.
param containerImage = 'ghcr.io/devdoo-teams/teams-app@sha256:0000000000000000000000000000000000000000000000000000000000000000'

// This is a non-secret format placeholder. The deployer supplies the approved owner public key.
param workerAdminSshPublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAzureCanaryContractOnly teamsapp@azure-canary'
