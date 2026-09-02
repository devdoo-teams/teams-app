param location string
param storageAccountName string
param appIdentityPrincipalId string
param workerIdentityPrincipalId string

var storageQueueDataMessageSenderRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'c6a89b2d-59bc-44d0-9896-0f6e12d7b80a')
var storageBlobDataReaderRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')

resource workerQueueLeaseRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscription().id, resourceGroup().id, 'teamsapp-worker-queue-lease')
  properties: {
    roleName: 'TeamsApp Worker Queue Lease ${uniqueString(resourceGroup().id)}'
    description: 'Receive, delete, peek, and renew visibility only on the assigned TeamsApp dispatch queue.'
    type: 'CustomRole'
    permissions: [
      {
        actions: []
        notActions: []
        dataActions: [
          'Microsoft.Storage/storageAccounts/queueServices/queues/messages/read'
          'Microsoft.Storage/storageAccounts/queueServices/queues/messages/process/action'
          'Microsoft.Storage/storageAccounts/queueServices/queues/messages/write'
        ]
        notDataActions: []
      }
    ]
    assignableScopes: [
      resourceGroup().id
    ]
  }
}

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

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  name: '${storageAccount.name}/default'
}

resource workerArtifactContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${storageAccount.name}/default/worker-artifacts'
  properties: {
    publicAccess: 'None'
  }
  dependsOn: [
    blobService
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
  name: guid(agentDispatchQueue.id, workerIdentityPrincipalId, workerQueueLeaseRole.id)
  scope: agentDispatchQueue
  properties: {
    principalId: workerIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: workerQueueLeaseRole.id
  }
}

resource workerArtifactReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(workerArtifactContainer.id, workerIdentityPrincipalId, storageBlobDataReaderRoleDefinitionId)
  scope: workerArtifactContainer
  properties: {
    principalId: workerIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageBlobDataReaderRoleDefinitionId
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

output queueEndpoint string = storageAccount.properties.primaryEndpoints.queue
output dispatchQueueEndpoint string = '${storageAccount.properties.primaryEndpoints.queue}agent-dispatch'
output poisonQueueEndpoint string = '${storageAccount.properties.primaryEndpoints.queue}agent-dispatch-poison'
output fileEndpoint string = storageAccount.properties.primaryEndpoints.file
output resourceId string = storageAccount.id
output accountName string = storageAccount.name
output workerArtifactContainerName string = 'worker-artifacts'
output workerArtifactContainerUrl string = '${storageAccount.properties.primaryEndpoints.blob}worker-artifacts'
