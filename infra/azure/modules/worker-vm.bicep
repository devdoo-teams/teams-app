param location string
param workerName string
param workerIdentityResourceId string
param workerIdentityClientId string
param workerAdminSshPublicKey string
param initializeWorkerVm bool
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
var workerPrerequisiteRecovery = loadTextContent('../scripts/recover-worker-prerequisites.py')

// This script is part of the trusted ARM template. It must authenticate the
// downloaded bytes before reading or executing any archive-provided program.
var workerArchiveBootstrapScript = '''
set -euo pipefail
umask 077

decode_arg() {
  printf '%s' "$1" | base64 --decode
}

[[ "$#" -eq 10 ]] || { echo 'worker bootstrap argument count is invalid' >&2; exit 1; }
commit=$(decode_arg "$1"); shift
archive_sha256=$(decode_arg "$1"); shift
codex_sha256=$(decode_arg "$1"); shift
azure_client_id=$(decode_arg "$1"); shift
queue_endpoint=$(decode_arg "$1"); shift
poison_queue_endpoint=$(decode_arg "$1"); shift
cosmos_endpoint=$(decode_arg "$1"); shift
cosmos_database=$(decode_arg "$1"); shift
cosmos_container=$(decode_arg "$1"); shift
bootstrap_root=$(decode_arg "$1"); shift

[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'release commit is invalid' >&2; exit 1; }
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo 'archive SHA-256 is invalid' >&2; exit 1; }
[[ "$codex_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo 'Codex SHA-256 is invalid' >&2; exit 1; }
[[ "$bootstrap_root" == /* && "$bootstrap_root" != *'/../'* && "$bootstrap_root" != */.. ]] || {
  echo 'worker bootstrap root is invalid' >&2
  exit 1
}

downloaded_archive="worker-runtime-$commit.tar"
[[ -f "$downloaded_archive" && ! -L "$downloaded_archive" ]] || {
  echo 'downloaded worker archive is missing or unsafe' >&2
  exit 1
}

install -d -m 0700 -- "$bootstrap_root"
stage=$(mktemp -d "$bootstrap_root/runtime.XXXXXXXX")
cleanup() {
  rm -rf -- "$stage"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

archive_tmp="$stage/archive.tar.tmp"
archive_staged="$stage/archive.tar"
install -m 0600 -- "$downloaded_archive" "$archive_tmp"
mv -f -- "$archive_tmp" "$archive_staged"

actual_archive_sha256=$(sha256sum -- "$archive_staged" | awk '{print $1}')
[[ "$actual_archive_sha256" == "$archive_sha256" ]] || {
  echo 'worker archive SHA-256 mismatch' >&2
  exit 1
}

command -v python3 >/dev/null 2>&1 || { echo 'python3 is required for worker archive validation' >&2; exit 1; }
python3 - "$archive_staged" <<'PY'
import sys
import tarfile

archive_path = sys.argv[1]
seen = set()
installer_count = 0
with tarfile.open(archive_path, mode='r:*') as archive:
    for member in archive.getmembers():
        original = member.name
        if any(ord(character) < 32 or ord(character) == 127 for character in original):
            raise SystemExit(f'unsafe worker archive entry: {original!r}')
        normalized = original[2:] if original.startswith('./') else original
        if normalized in ('', '.'):
            if not member.isdir():
                raise SystemExit(f'unsafe worker archive entry: {original!r}')
            continue
        if normalized.startswith('/') or '\\' in normalized:
            raise SystemExit(f'unsafe worker archive entry: {original!r}')
        if normalized.endswith('/'):
            normalized = normalized[:-1]
        parts = normalized.split('/')
        if any(part in ('', '.', '..') for part in parts):
            raise SystemExit(f'unsafe worker archive entry: {original!r}')
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f'unsafe worker archive entry: {original!r}')
        canonical = '/'.join(parts)
        if canonical in seen:
            raise SystemExit(f'unsafe worker archive entry: duplicate {canonical!r}')
        seen.add(canonical)
        if canonical == 'install-worker-runtime.sh':
            if not member.isfile():
                raise SystemExit(f'unsafe worker archive entry: {original!r}')
            installer_count += 1

if installer_count != 1:
    raise SystemExit('unsafe worker archive entry: expected exactly one installer')
PY

installer_tmp="$stage/install-worker-runtime.sh.tmp"
installer="$stage/install-worker-runtime.sh"
tar --extract --to-stdout --file "$archive_staged" -- ./install-worker-runtime.sh > "$installer_tmp"
[[ -s "$installer_tmp" ]] || { echo 'verified worker installer is empty' >&2; exit 1; }
chmod 0500 "$installer_tmp"
mv -f -- "$installer_tmp" "$installer"

TMPDIR="$stage" "$installer" \
  --archive "$archive_staged" \
  --archive-sha256 "$archive_sha256" \
  --codex-sha256 "$codex_sha256" \
  --commit "$commit" \
  --azure-client-id "$azure_client_id" \
  --queue-endpoint "$queue_endpoint" \
  --poison-queue-endpoint "$poison_queue_endpoint" \
  --cosmos-endpoint "$cosmos_endpoint" \
  --cosmos-database "$cosmos_database" \
  --cosmos-container "$cosmos_container"
'''

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
      ...(initializeWorkerVm ? {
        customData: base64(renderedCloudInit)
      } : {})
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
    forceUpdateTag: substring(workerArtifactSha256, 0, 50)
    protectedSettings: {
      fileUris: [
        workerArtifactUrl
      ]
      managedIdentity: {
        clientId: workerIdentityClientId
      }
      commandToExecute: 'if cloud-init status --wait; then :; else bash -o pipefail -c "printf %s ${base64(workerPrerequisiteRecovery)} | base64 --decode | python3 - ${base64(renderedCloudInit)}" || exit 1; fi; bash -o pipefail -c "printf %s ${base64(workerArchiveBootstrapScript)} | base64 --decode | bash -s -- ${base64(releaseSourceCommit)} ${base64(workerArtifactSha256)} ${base64(codexBinSha256)} ${base64(workerIdentityClientId)} ${base64(agentDispatchQueueEndpoint)} ${base64(agentDispatchPoisonQueueEndpoint)} ${base64(cosmosEndpoint)} ${base64(cosmosDatabase)} ${base64(cosmosContainer)} ${base64('/var/lib/teamsapp/bootstrap')}"'
    }
  }
}

output resourceId string = workerVm.id
