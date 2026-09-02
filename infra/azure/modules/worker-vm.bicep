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
param workerArtifactUrl string
@minLength(64)
@maxLength(64)
param workerArtifactSha256 string
@minLength(64)
@maxLength(64)
param codexBinSha256 string
@minLength(40)
@maxLength(40)
param releaseSourceCommit string

var renderedCloudInit = loadTextContent('../cloud-init/codex-worker.yml')

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

resource workerRuntimeExtension 'Microsoft.Compute/virtualMachines/extensions@2024-03-01' = {
  parent: workerVm
  name: 'teamsapp-worker-runtime'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Extensions'
    type: 'CustomScript'
    typeHandlerVersion: '2.1'
    autoUpgradeMinorVersion: true
    forceUpdateTag: workerArtifactSha256
    protectedSettings: {
      fileUris: [
        workerArtifactUrl
      ]
      managedIdentity: {
        clientId: workerIdentityClientId
      }
      commandToExecute: 'cloud-init status --wait && tar -xOf worker-runtime-${releaseSourceCommit}.tar ./install-worker-runtime.sh > /tmp/install-worker-runtime.sh && chmod 0500 /tmp/install-worker-runtime.sh && /tmp/install-worker-runtime.sh --archive worker-runtime-${releaseSourceCommit}.tar --archive-sha256 ${workerArtifactSha256} --codex-sha256 ${codexBinSha256} --commit ${releaseSourceCommit} --azure-client-id ${workerIdentityClientId} --queue-endpoint ${agentDispatchQueueEndpoint} --poison-queue-endpoint ${agentDispatchPoisonQueueEndpoint} --cosmos-endpoint ${cosmosEndpoint} --cosmos-database ${cosmosDatabase} --cosmos-container ${cosmosContainer}'
    }
  }
}

output resourceId string = workerVm.id
