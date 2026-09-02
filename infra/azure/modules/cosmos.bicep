param location string
param accountName string
param enableFreeTier bool
param appIdentityPrincipalId string
param workerIdentityPrincipalId string

var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: enableFreeTier
    disableKeyBasedMetadataWriteAccess: true
    publicNetworkAccess: 'Enabled'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
  }
}

resource appDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: '${account.name}/${guid(account.id, appIdentityPrincipalId, cosmosDataContributorRoleId)}'
  properties: {
    principalId: appIdentityPrincipalId
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    scope: '/'
  }
}

resource workerDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: '${account.name}/${guid(account.id, workerIdentityPrincipalId, cosmosDataContributorRoleId)}'
  properties: {
    principalId: workerIdentityPrincipalId
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    scope: '/'
  }
}

output endpoint string = account.properties.documentEndpoint
output resourceId string = account.id
