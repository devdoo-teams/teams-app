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

var uniqueSuffix = toLower(take(uniqueString(resourceGroup().id, workloadName), 8))
var compactPrefix = toLower(replace(workloadName, '-', ''))
var acrName = take('${compactPrefix}${uniqueSuffix}', 50)
var keyVaultName = take('${workloadName}-${uniqueSuffix}', 24)
var storageName = take('${compactPrefix}${uniqueSuffix}', 24)
var cosmosName = take('${workloadName}-cosmos-${uniqueSuffix}', 44)
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
    workerIdentityPrincipalId: identities.outputs.workerIdentityPrincipalId
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

module containerApp './modules/container-app.bicep' = {
  name: 'containerApp'
  params: {
    location: location
    appName: appName
    managedEnvironmentId: containerEnvironment.outputs.environmentId
    containerImage: containerImage
    registryServer: registry.outputs.loginServer
    appIdentityResourceId: identities.outputs.appIdentityResourceId
    keyVaultUri: keyVault.outputs.vaultUri
  }
}

module workerVm './modules/worker-vm.bicep' = {
  name: 'workerVm'
  params: {
    location: location
    workerName: workerName
    workerIdentityResourceId: identities.outputs.workerIdentityResourceId
    workerAdminSshPublicKey: workerAdminSshPublicKey
  }
}

output containerAppName string = containerApp.outputs.appName
output containerAppFqdn string = containerApp.outputs.fqdn
output containerAppResourceId string = containerApp.outputs.resourceId
output workerVmResourceId string = workerVm.outputs.resourceId
