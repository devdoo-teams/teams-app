param location string
param appIdentityName string
param workerIdentityName string

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: appIdentityName
  location: location
}

resource workerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: workerIdentityName
  location: location
}

output appIdentityResourceId string = appIdentity.id
output appIdentityPrincipalId string = appIdentity.properties.principalId
output workerIdentityResourceId string = workerIdentity.id
output workerIdentityPrincipalId string = workerIdentity.properties.principalId
