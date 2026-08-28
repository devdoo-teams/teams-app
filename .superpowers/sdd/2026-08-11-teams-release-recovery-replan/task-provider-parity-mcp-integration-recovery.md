# Optional MCP provider integration recovery

## Implementation commit

`ac0619bea41585c94987f74bcadd53bf1b60b508`

The commit is limited to the registry, capability inventory, and provider-tool
fixture test. No provider client, manifest, package, release, or live-service
configuration was changed by this worker.

## Delivered surface

- Bitbucket: `bitbucket_branches`, `bitbucket_update_pull_request`,
  `bitbucket_decline_pull_request`, `bitbucket_unapprove_pull_request`, and
  `bitbucket_delete_branch`.
- Confluence: individual footer and inline comment get/update/delete tools,
  plus `confluence_delete_page` with validated `draft` and `purge` flags.
- Zod inputs reject missing mutation payloads, invalid comment update shapes,
  invalid page flags, and oversized JSON before provider access.
- Inventory rows carry least-privilege read/write/delete scopes and explicit
  read-only, destructive, and idempotent annotations. Jira remote-link rows
  use the verified REST API v3 paths without changing the client.
- Fixture coverage checks registration/counts, inventory-to-tool bijection,
  annotations/scopes, exact request paths, query encoding, request bodies,
  credential redaction, and fail-closed credentials.

## Verification

- `npm run test:mcp-provider-tools` — PASS.
- `npm run typecheck:core` — PASS (`22` Teams/CLI files).
- `git diff --check` — PASS.
- A direct release `tsc --noEmit -p tsconfig.release.json` diagnostic was
  bounded and stopped after no progress; the focused command also reported
  existing unrelated declaration/type errors in agent execution policy,
  Codex runner, provider broker/auth-boundary, and the pre-existing generic
  callback boundary. The repository's bounded Core source check passed.

## Official contract references

- Bitbucket pull requests: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/
- Bitbucket refs/branches: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-refs/
- Confluence comments v2: https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-comment/
- Confluence pages v2: https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/
- Jira remote issue links v3: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-remote-links/

## Blockers and boundaries

No live Bitbucket, Jira, or Confluence round-trip was attempted or claimed.
Provider authentication, deployment, public health, portal upload, Teams
desktop/mobile UI verification, and Jira synchronization remain parent-release
gates.
