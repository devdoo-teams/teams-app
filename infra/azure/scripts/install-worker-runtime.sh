#!/usr/bin/env bash
set -euo pipefail

archive=''
archive_sha256=''
codex_sha256=''
commit=''
target_root='/'
azure_client_id=''
queue_endpoint=''
poison_queue_endpoint=''
cosmos_endpoint=''
cosmos_database=''
cosmos_container=''

while (($#)); do
  case "$1" in
    --archive) archive=$2; shift 2 ;;
    --archive-sha256) archive_sha256=$2; shift 2 ;;
    --codex-sha256) codex_sha256=$2; shift 2 ;;
    --commit) commit=$2; shift 2 ;;
    --root) target_root=$2; shift 2 ;;
    --azure-client-id) azure_client_id=$2; shift 2 ;;
    --queue-endpoint) queue_endpoint=$2; shift 2 ;;
    --poison-queue-endpoint) poison_queue_endpoint=$2; shift 2 ;;
    --cosmos-endpoint) cosmos_endpoint=$2; shift 2 ;;
    --cosmos-database) cosmos_database=$2; shift 2 ;;
    --cosmos-container) cosmos_container=$2; shift 2 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[[ -f "$archive" ]] || { echo 'worker archive is missing' >&2; exit 1; }
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo 'archive SHA-256 is invalid' >&2; exit 1; }
[[ "$codex_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo 'Codex SHA-256 is invalid' >&2; exit 1; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'release commit is invalid' >&2; exit 1; }
[[ "$azure_client_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo 'Azure client ID is invalid' >&2; exit 1; }
[[ "$queue_endpoint" == https://*.queue.core.windows.net/* ]] || { echo 'dispatch queue endpoint is invalid' >&2; exit 1; }
[[ "$poison_queue_endpoint" == https://*.queue.core.windows.net/* ]] || { echo 'poison queue endpoint is invalid' >&2; exit 1; }
[[ "$cosmos_endpoint" == https://*.documents.azure.com/ ]] || { echo 'Cosmos endpoint is invalid' >&2; exit 1; }
[[ "$cosmos_database" =~ ^[A-Za-z0-9_-]+$ && "$cosmos_container" =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Cosmos resource name is invalid' >&2; exit 1; }

actual_archive_sha256=$(sha256sum "$archive" | awk '{print $1}')
[[ "$actual_archive_sha256" == "$archive_sha256" ]] || { echo 'worker archive SHA-256 mismatch' >&2; exit 1; }

while IFS= read -r entry; do
  [[ "$entry" == './' ]] && continue
  normalized=${entry#./}
  [[ -n "$normalized" && "$normalized" != /* && "$normalized" != '..' && "$normalized" != ../* && "$normalized" != */../* ]] || {
    printf 'unsafe worker archive entry: %s\n' "$entry" >&2
    exit 1
  }
done < <(tar -tf "$archive")

stage=$(mktemp -d "${TMPDIR:-/tmp}/teamsapp-worker-install.XXXXXX")
trap 'rm -rf "$stage"' EXIT
tar --extract --file "$archive" --directory "$stage" --no-same-owner --no-same-permissions
[[ -z "$(find "$stage" -type l -print -quit)" ]] || { echo 'worker archive may not contain symbolic links' >&2; exit 1; }
for required in \
  manifest.json \
  dist/worker/index.js \
  dist/worker/composition.js \
  node/bin/node \
  codex-runtime/bin/codex \
  codex-runtime/bin/codex-code-mode-host \
  codex-runtime/codex-package.json \
  codex-runtime/codex-path/rg \
  codex-runtime/codex-resources/bwrap \
  codex-runtime/codex-resources/zsh/bin/zsh \
  validate-worker-runtime-manifest.mjs; do
  [[ -f "$stage/$required" ]] || { printf 'worker archive missing %s\n' "$required" >&2; exit 1; }
done
node_version=$($stage/node/bin/node --version)
[[ "$node_version" == 'v24.19.0' ]] || { printf 'worker Node version mismatch: %s\n' "$node_version" >&2; exit 1; }
manifest_values=$(
  "$stage/node/bin/node" \
    "$stage/validate-worker-runtime-manifest.mjs" \
    "$stage/manifest.json" \
    "$stage/codex-runtime/codex-package.json" \
    "$commit" \
    "$codex_sha256"
)
[[ "$manifest_values" == *:* ]] || { echo 'worker manifest validation result is invalid' >&2; exit 1; }
codex_package_version=${manifest_values%%:*}
codex_package_sha256=${manifest_values#*:}
[[ "$codex_package_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo 'Codex package SHA-256 is invalid' >&2; exit 1; }
actual_codex_sha256=$(sha256sum "$stage/codex-runtime/bin/codex" | awk '{print $1}')
[[ "$actual_codex_sha256" == "$codex_sha256" ]] || { echo 'Codex executable SHA-256 mismatch' >&2; exit 1; }
codex_version=$($stage/codex-runtime/bin/codex --version)
[[ "$codex_version" == "codex-cli $codex_package_version" ]] || { printf 'Codex executable version mismatch: %s\n' "$codex_version" >&2; exit 1; }

release_root="$target_root/opt/teamsapp/releases"
release_path="$release_root/$commit"
current_path="$target_root/opt/teamsapp/current"
env_dir="$target_root/etc/teamsapp"
auth_home="$target_root/var/lib/teamsapp/codex-home"
workspace="$target_root/var/lib/teamsapp/workspace"
install -d -m 0755 "$release_root"
install -d -m 0750 "$env_dir"
install -d -m 0700 "$auth_home"
install -d -m 0700 "$workspace"
rm -rf "$release_path"
install -d -m 0755 "$release_path"
cp -R \
  "$stage/dist" \
  "$stage/node" \
  "$stage/codex-runtime" \
  "$stage/manifest.json" \
  "$stage/validate-worker-runtime-manifest.mjs" \
  "$release_path/"
chmod 0555 "$release_path/node/bin/node"
chmod 0500 \
  "$release_path/codex-runtime/bin/codex" \
  "$release_path/codex-runtime/bin/codex-code-mode-host" \
  "$release_path/codex-runtime/codex-path/rg" \
  "$release_path/codex-runtime/codex-resources/bwrap" \
  "$release_path/codex-runtime/codex-resources/zsh/bin/zsh"
chmod 0400 "$release_path/codex-runtime/codex-package.json"
chmod 0400 "$release_path/validate-worker-runtime-manifest.mjs"

umask 077
env_tmp="$env_dir/worker.env.tmp"
cat > "$env_tmp" <<EOF
AZURE_CLIENT_ID=$azure_client_id
AZURE_STORAGE_QUEUE_ENDPOINT=$queue_endpoint
AZURE_STORAGE_POISON_QUEUE_ENDPOINT=$poison_queue_endpoint
TEAMS_STORAGE_BACKEND=cosmos
AZURE_COSMOS_ENDPOINT=$cosmos_endpoint
AZURE_COSMOS_DATABASE=$cosmos_database
AZURE_COSMOS_CONTAINER=$cosmos_container
NODE_ENV=production
TEAMS_SOURCE_COMMIT=$commit
AGENT_CODEX_HOME=/var/lib/teamsapp/codex-home
CODEX_BIN=/opt/teamsapp/current/codex-runtime/bin/codex
CODEX_BIN_SHA256=$codex_sha256
TEAMS_WORKER_COMPOSITION_MODULE=/opt/teamsapp/current/dist/worker/composition.js
TEAMS_WORKER_WORKSPACE=/var/lib/teamsapp/workspace
EOF
chmod 0600 "$env_tmp"
mv -f "$env_tmp" "$env_dir/worker.env"
ln -sfn "$release_path" "$current_path"

if [[ "$target_root" == '/' ]]; then
  chown -R teamsworker:teamsworker "$release_path" "$auth_home" "$workspace"
  chown root:root "$env_dir/worker.env"
fi
systemctl daemon-reload
systemctl enable --now teamsapp-worker.service
