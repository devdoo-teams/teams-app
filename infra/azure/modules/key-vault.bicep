param location string
param vaultName string
param cosmosEndpoint string
param storageQueueEndpoint string
param storageFileEndpoint string
param appIdentityPrincipalId string

var keyVaultSecretsUserRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    enablePurgeProtection: true
    enableRbacAuthorization: true
    enableSoftDelete: true
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenant().tenantId
  }
}

resource cosmosEndpointSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'azure-cosmos-endpoint'
  properties: {
    value: cosmosEndpoint
  }
}

resource storageQueueEndpointSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'azure-storage-queue-endpoint'
  properties: {
    value: storageQueueEndpoint
  }
}

resource storageFileEndpointSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'azure-storage-file-endpoint'
  properties: {
    value: storageFileEndpoint
  }
}

resource appSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, appIdentityPrincipalId, keyVaultSecretsUserRoleDefinitionId)
  scope: vault
  properties: {
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleDefinitionId
  }
}

output vaultUri string = vault.properties.vaultUri
output resourceId string = vault.id
