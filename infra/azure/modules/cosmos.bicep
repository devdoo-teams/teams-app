param location string
param accountName string
param enableFreeTier bool
param appIdentityPrincipalId string
param workerIdentityPrincipalId string
param databaseName string
param containerName string

@minValue(1000)
@maxValue(1000000)
param autoscaleMaxThroughput int = 1000

var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: enableFreeTier
    disableKeyBasedMetadataWriteAccess: true
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    capabilities: []
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

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: account
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
    options: {
      autoscaleSettings: {
        maxThroughput: autoscaleMaxThroughput
      }
    }
  }
}

resource runtimeContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: [
          '/partitionKey'
        ]
        kind: 'Hash'
        version: 2
      }
    }
  }
}

resource appDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: '${account.name}/${guid(account.id, appIdentityPrincipalId, cosmosDataContributorRoleId)}'
  properties: {
    principalId: appIdentityPrincipalId
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    scope: '${account.id}/dbs/${databaseName}/colls/${containerName}'
  }
  dependsOn: [
    runtimeContainer
  ]
}

resource workerDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: '${account.name}/${guid(account.id, workerIdentityPrincipalId, cosmosDataContributorRoleId)}'
  properties: {
    principalId: workerIdentityPrincipalId
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    scope: '${account.id}/dbs/${databaseName}/colls/${containerName}'
  }
  dependsOn: [
    runtimeContainer
  ]
}

output endpoint string = account.properties.documentEndpoint
output databaseName string = databaseName
output containerName string = containerName
output resourceId string = account.id
