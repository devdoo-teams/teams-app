param location string
param appName string
param managedEnvironmentId string
param containerImage string
param registryServer string
param appIdentityResourceId string
param appIdentityClientId string
param keyVaultUri string
param cosmosEndpoint string
param cosmosDatabase string
param cosmosContainer string
param agentDispatchQueueEndpoint string
param agentDispatchPoisonQueueEndpoint string
param revisionSuffix string
param releaseSourceCommit string
param releaseVersion string
param releaseImageDigest string
param releaseTeamsPackageSha256 string
param releaseClientBundleSha256 string
param releaseServerBundleSha256 string

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'multiple'
      ingress: {
        external: true
        targetPort: 3978
        transport: 'auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: registryServer
          identity: appIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'azure-cosmos-endpoint'
          keyVaultUrl: '${keyVaultUri}secrets/azure-cosmos-endpoint'
          identity: appIdentityResourceId
        }
        {
          name: 'azure-storage-queue-endpoint'
          keyVaultUrl: '${keyVaultUri}secrets/azure-storage-queue-endpoint'
          identity: appIdentityResourceId
        }
        {
          name: 'azure-storage-file-endpoint'
          keyVaultUrl: '${keyVaultUri}secrets/azure-storage-file-endpoint'
          identity: appIdentityResourceId
        }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          name: 'teams-core'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'AZURE_CLIENT_ID'
              value: appIdentityClientId
            }
            {
              name: 'AZURE_RELEASE_MODE'
              value: 'true'
            }
            {
              name: 'AZURE_COSMOS_ENDPOINT'
              value: cosmosEndpoint
            }
            {
              name: 'AZURE_COSMOS_DATABASE'
              value: cosmosDatabase
            }
            {
              name: 'AZURE_COSMOS_CONTAINER'
              value: cosmosContainer
            }
            {
              name: 'TEAMS_STORAGE_BACKEND'
              value: 'cosmos'
            }
            {
              name: 'AZURE_STORAGE_QUEUE_ENDPOINT'
              value: agentDispatchQueueEndpoint
            }
            {
              name: 'AZURE_STORAGE_POISON_QUEUE_ENDPOINT'
              value: agentDispatchPoisonQueueEndpoint
            }
            {
              name: 'TEAMS_AGENT_DISPATCH_MODE'
              value: 'azure-queue'
            }
            {
              name: 'AZURE_STORAGE_FILE_ENDPOINT'
              secretRef: 'azure-storage-file-endpoint'
            }
            {
              name: 'RELEASE_SOURCE_COMMIT'
              value: releaseSourceCommit
            }
            {
              name: 'RELEASE_APP_VERSION'
              value: releaseVersion
            }
            {
              name: 'RELEASE_IMAGE_DIGEST'
              value: releaseImageDigest
            }
            {
              name: 'RELEASE_TEAMS_PACKAGE_SHA256'
              value: releaseTeamsPackageSha256
            }
            {
              name: 'RELEASE_CLIENT_BUNDLE_SHA256'
              value: releaseClientBundleSha256
            }
            {
              name: 'RELEASE_SERVER_BUNDLE_SHA256'
              value: releaseServerBundleSha256
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
}

output appName string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
output resourceId string = app.id
output revisionName string = app.properties.latestRevisionName
