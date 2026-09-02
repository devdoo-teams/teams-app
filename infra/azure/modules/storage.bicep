param location string
param storageAccountName string
param appIdentityPrincipalId string
param workerIdentityPrincipalId string

var storageQueueDataMessageSenderRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'c6a89b2d-59bc-44d0-9896-0f6e12d7b80a')
var storageQueueDataMessageProcessorRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8a0f0c08-91a1-4084-bc3d-661d67233fed')
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

resource agentDispatchPoisonQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  name: '${storageAccount.name}/default/agent-dispatch-poison'
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
  name: guid(agentDispatchQueue.id, appIdentityPrincipalId, storageQueueDataMessageSenderRoleDefinitionId)
  scope: agentDispatchQueue
  properties: {
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataMessageSenderRoleDefinitionId
  }
}

resource workerQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(agentDispatchQueue.id, workerIdentityPrincipalId, storageQueueDataMessageProcessorRoleDefinitionId)
  scope: agentDispatchQueue
  properties: {
    principalId: workerIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataMessageProcessorRoleDefinitionId
  }
}

resource workerPoisonQueueSenderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(agentDispatchPoisonQueue.id, workerIdentityPrincipalId, storageQueueDataMessageSenderRoleDefinitionId)
  scope: agentDispatchPoisonQueue
  properties: {
    principalId: workerIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataMessageSenderRoleDefinitionId
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
output dispatchQueueEndpoint string = '${storageAccount.properties.primaryEndpoints.queue}agent-dispatch'
output poisonQueueEndpoint string = '${storageAccount.properties.primaryEndpoints.queue}agent-dispatch-poison'
output fileEndpoint string = storageAccount.properties.primaryEndpoints.file
output resourceId string = storageAccount.id
