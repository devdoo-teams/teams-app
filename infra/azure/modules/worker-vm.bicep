param location string
param workerName string
param workerIdentityResourceId string
param workerIdentityClientId string
param workerAdminSshPublicKey string
param agentDispatchQueueEndpoint string
param agentDispatchPoisonQueueEndpoint string
param cosmosEndpoint string
param cosmosDatabase string
param cosmosContainer string

var cloudInitTemplate = loadTextContent('../cloud-init/codex-worker.yml')
var renderedCloudInit = replace(replace(replace(replace(replace(replace(
  cloudInitTemplate,
  'SET_AZURE_CLIENT_ID', workerIdentityClientId),
  'SET_AZURE_STORAGE_QUEUE_ENDPOINT', agentDispatchQueueEndpoint),
  'SET_AZURE_STORAGE_POISON_QUEUE_ENDPOINT', agentDispatchPoisonQueueEndpoint),
  'SET_AZURE_COSMOS_ENDPOINT', cosmosEndpoint),
  'SET_AZURE_COSMOS_DATABASE', cosmosDatabase),
  'SET_AZURE_COSMOS_CONTAINER', cosmosContainer)

var virtualNetworkName = '${workerName}-network'
var networkInterfaceName = '${workerName}-nic'

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: virtualNetworkName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.42.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'workers'
        properties: {
          addressPrefix: '10.42.1.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource networkInterface 'Microsoft.Network/networkInterfaces@2024-01-01' = {
  name: networkInterfaceName
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'primary'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: {
            id: '${virtualNetwork.id}/subnets/workers'
          }
        }
      }
    ]
  }
}

resource workerVm 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: workerName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${workerIdentityResourceId}': {}
    }
  }
  properties: {
    hardwareProfile: {
      vmSize: 'Standard_B2ats_v2'
    }
    osProfile: {
      computerName: workerName
      adminUsername: 'teamsworker'
      customData: base64(renderedCloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/teamsworker/.ssh/authorized_keys'
              keyData: workerAdminSshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Standard_LRS'
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: networkInterface.id
          properties: {
            primary: true
          }
        }
      ]
    }
  }
}

output resourceId string = workerVm.id
