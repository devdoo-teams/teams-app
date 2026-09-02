param location string
param appName string
param managedEnvironmentId string
param containerImage string
param registryServer string
param appIdentityResourceId string
param keyVaultUri string

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
              name: 'AZURE_COSMOS_ENDPOINT'
              secretRef: 'azure-cosmos-endpoint'
            }
            {
              name: 'AZURE_STORAGE_QUEUE_ENDPOINT'
              secretRef: 'azure-storage-queue-endpoint'
            }
            {
              name: 'AZURE_STORAGE_FILE_ENDPOINT'
              secretRef: 'azure-storage-file-endpoint'
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
