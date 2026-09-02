param location string
param storageAccountName string
param appIdentityPrincipalId string
param workerIdentityPrincipalId string

var storageQueueDataContributorRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
var storageFileDataContributorRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0c867c2a-1d8c-454a-a3db-ab2ea1bdc8bb')

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
  }
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  name: '${storageAccount.name}/default'
}

resource agentDispatchQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  name: '${storageAccount.name}/default/agent-dispatch'
  dependsOn: [
    queueService
  ]
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  name: '${storageAccount.name}/default'
}

resource workerFileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  name: '${storageAccount.name}/default/worker-state'
  properties: {
    shareQuota: 100
  }
  dependsOn: [
    fileService
  ]
}

resource appQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, appIdentityPrincipalId, storageQueueDataContributorRoleDefinitionId)
  scope: storageAccount
  properties: {
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataContributorRoleDefinitionId
  }
}

resource workerQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, workerIdentityPrincipalId, storageQueueDataContributorRoleDefinitionId)
  scope: storageAccount
  properties: {
    principalId: workerIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataContributorRoleDefinitionId
  }
}

resource workerFileRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, workerIdentityPrincipalId, storageFileDataContributorRoleDefinitionId)
  scope: storageAccount
  properties: {
    principalId: workerIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageFileDataContributorRoleDefinitionId
  }
}

output queueEndpoint string = storageAccount.properties.primaryEndpoints.queue
output fileEndpoint string = storageAccount.properties.primaryEndpoints.file
output resourceId string = storageAccount.id
