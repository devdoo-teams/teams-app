targetScope = 'resourceGroup'

@description('Short, globally unique prefix for the canary platform resources.')
@minLength(3)
@maxLength(14)
param workloadName string = 'teamsapp'

@description('Azure region for this resource-group-scoped deployment.')
param location string = resourceGroup().location

@description('Immutable OCI image reference supplied by the GitHub release handoff and Azure DevOps deployment.')
param containerImage string

@description('Public SSH key for the owner-controlled Linux worker bootstrap account.')
param workerAdminSshPublicKey string

@description('Creates the account with the Cosmos DB free tier when the subscription remains eligible.')
param enableCosmosFreeTier bool = true

@description('Foundation-only deployments provision shared resources and expose their exact outputs before the image import.')
param deployContainerApp bool = true

@description('Provision the worker VM only after an immutable worker archive has been staged.')
param deployWorkerVm bool = true

@description('Private Blob URL for the immutable worker runtime archive.')
param workerArtifactUrl string = 'https://invalid.example/worker-runtime.tar'

@description('SHA-256 of the immutable worker runtime archive.')
@minLength(64)
@maxLength(64)
param workerArtifactSha256 string = '0000000000000000000000000000000000000000000000000000000000000000'

@description('Approved SHA-256 of the Codex executable contained in the worker archive.')
@minLength(64)
@maxLength(64)
param codexBinSha256 string = '0000000000000000000000000000000000000000000000000000000000000000'

@description('Full source commit from the attested GitHub release receipt.')
@minLength(40)
@maxLength(40)
param releaseSourceCommit string

@description('Application version from the attested GitHub release receipt.')
param releaseVersion string

@description('Immutable OCI digest from the attested GitHub release receipt.')
@minLength(71)
@maxLength(71)
param releaseImageDigest string

@description('Teams package SHA-256 from the attested GitHub release receipt.')
@minLength(64)
@maxLength(64)
param releaseTeamsPackageSha256 string

@description('Client bundle SHA-256 from the attested GitHub release receipt.')
@minLength(64)
@maxLength(64)
param releaseClientBundleSha256 string

@description('Server bundle SHA-256 from the attested GitHub release receipt.')
@minLength(64)
@maxLength(64)
param releaseServerBundleSha256 string

var uniqueSuffix = toLower(take(uniqueString(resourceGroup().id, workloadName), 8))
var compactPrefix = toLower(replace(workloadName, '-', ''))
var acrName = take('${compactPrefix}${uniqueSuffix}', 50)
var keyVaultName = take('${workloadName}-${uniqueSuffix}', 24)
var storageName = take('${compactPrefix}${uniqueSuffix}', 24)
var cosmosName = take('${workloadName}-cosmos-${uniqueSuffix}', 44)
var cosmosDatabaseName = 'teamsapp'
var cosmosContainerName = 'runtime-records'
var appName = take('${workloadName}-canary-${uniqueSuffix}', 32)
var environmentName = take('${workloadName}-env-${uniqueSuffix}', 40)
var workerName = take('${workloadName}-worker-${uniqueSuffix}', 64)

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    workspaceName: '${workloadName}-logs-${uniqueSuffix}'
    applicationInsightsName: '${workloadName}-insights-${uniqueSuffix}'
  }
}

module identities './modules/identities.bicep' = {
  name: 'identities'
  params: {
    location: location
    appIdentityName: '${workloadName}-app-${uniqueSuffix}'
    workerIdentityName: '${workloadName}-worker-${uniqueSuffix}'
  }
}

module registry './modules/acr.bicep' = {
  name: 'registry'
  params: {
    location: location
    registryName: acrName
    appIdentityPrincipalId: identities.outputs.appIdentityPrincipalId
  }
}

module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    storageAccountName: storageName
    appIdentityPrincipalId: identities.outputs.appIdentityPrincipalId
    workerIdentityPrincipalId: identities.outputs.workerIdentityPrincipalId
  }
}

module cosmos './modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    accountName: cosmosName
    enableFreeTier: enableCosmosFreeTier
    appIdentityPrincipalId: identities.outputs.appIdentityPrincipalId
    workerIdentityPrincipalId: identities.outputs.workerIdentityPrincipalId
    databaseName: cosmosDatabaseName
    containerName: cosmosContainerName
  }
}

module keyVault './modules/key-vault.bicep' = {
  name: 'keyVault'
  params: {
    location: location
    vaultName: keyVaultName
    cosmosEndpoint: cosmos.outputs.endpoint
    storageQueueEndpoint: storage.outputs.queueEndpoint
    storageFileEndpoint: storage.outputs.fileEndpoint
    appIdentityPrincipalId: identities.outputs.appIdentityPrincipalId
  }
}

module containerEnvironment './modules/container-environment.bicep' = {
  name: 'containerEnvironment'
  params: {
    location: location
    environmentName: environmentName
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
  }
}

module containerApp './modules/container-app.bicep' = if (deployContainerApp) {
  name: 'containerApp'
  params: {
    location: location
    appName: appName
    managedEnvironmentId: containerEnvironment.outputs.environmentId
    containerImage: containerImage
    registryServer: registry.outputs.loginServer
    appIdentityResourceId: identities.outputs.appIdentityResourceId
    appIdentityClientId: identities.outputs.appIdentityClientId
    keyVaultUri: keyVault.outputs.vaultUri
    cosmosEndpoint: cosmos.outputs.endpoint
    cosmosDatabase: cosmos.outputs.databaseName
    cosmosContainer: cosmos.outputs.containerName
    agentDispatchQueueEndpoint: storage.outputs.dispatchQueueEndpoint
    agentDispatchPoisonQueueEndpoint: storage.outputs.poisonQueueEndpoint
    revisionSuffix: take(releaseSourceCommit, 10)
    releaseSourceCommit: releaseSourceCommit
    releaseVersion: releaseVersion
    releaseImageDigest: releaseImageDigest
    releaseTeamsPackageSha256: releaseTeamsPackageSha256
    releaseClientBundleSha256: releaseClientBundleSha256
    releaseServerBundleSha256: releaseServerBundleSha256
  }
}

module workerVm './modules/worker-vm.bicep' = if (deployWorkerVm) {
  name: 'workerVm'
  params: {
    location: location
    workerName: workerName
    workerIdentityResourceId: identities.outputs.workerIdentityResourceId
    workerIdentityClientId: identities.outputs.workerIdentityClientId
    workerAdminSshPublicKey: workerAdminSshPublicKey
    agentDispatchQueueEndpoint: storage.outputs.dispatchQueueEndpoint
    agentDispatchPoisonQueueEndpoint: storage.outputs.poisonQueueEndpoint
    cosmosEndpoint: cosmos.outputs.endpoint
    cosmosDatabase: cosmos.outputs.databaseName
    cosmosContainer: cosmos.outputs.containerName
    workerArtifactUrl: workerArtifactUrl
    workerArtifactSha256: workerArtifactSha256
    codexBinSha256: codexBinSha256
    releaseSourceCommit: releaseSourceCommit
  }
  dependsOn: [
    storage
  ]
}

output registryName string = acrName
output registryLoginServer string = registry.outputs.loginServer
output containerEnvironmentName string = environmentName
output appIdentityClientId string = identities.outputs.appIdentityClientId
output cosmosEndpoint string = cosmos.outputs.endpoint
output cosmosDatabase string = cosmos.outputs.databaseName
output cosmosContainer string = cosmos.outputs.containerName
output containerAppName string = appName
output containerAppFqdn string = deployContainerApp ? containerApp!.outputs.fqdn : ''
output containerAppRevisionName string = deployContainerApp ? containerApp!.outputs.revisionName : ''
output containerAppResourceId string = resourceId('Microsoft.App/containerApps', appName)
output workerVmResourceId string = deployWorkerVm ? workerVm!.outputs.resourceId : ''
output workerArtifactStorageAccountName string = storage.outputs.accountName
output workerArtifactContainerName string = storage.outputs.workerArtifactContainerName
output workerArtifactContainerUrl string = storage.outputs.workerArtifactContainerUrl
