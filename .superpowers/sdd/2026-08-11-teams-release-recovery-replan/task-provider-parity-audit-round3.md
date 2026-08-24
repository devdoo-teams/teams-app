# Provider parity audit — round 3

Date: 2026-08-19 (Asia/Seoul)
Workspace: `/Users/doosansmacbookpro/Documents/TeamsApp`
Audit type: fresh, read-only repository audit
HEAD observed: `9f9b8e5f5ff19075ba3d54e61064ebd1f619b7e1`
Package version observed: `1.0.51`

## Status and evidence boundary

The audit is complete for the requested narrow scope. No source, package file,
Jira issue, browser tab, credential, provider account, public process, or other
external system was modified. The only artifact written is this report.

The initial `git status --short --branch` showed the pre-existing untracked
files in the workspace. After the read-only test commands, tracked edits were
also visible in `scripts/client-collaboration-panel-test.ts`,
`scripts/runtime-test.mjs`, and `src/server/index.ts`; those files were not
touched or included. The report path is ignored by
`.superpowers/sdd/.gitignore:1`, so it must be force-added if a report-only
commit is desired.

## Executive verdict

The current repository contains real, fixture-tested optional REST clients and
an optional MCP registry for Jira, Confluence, and Bitbucket. It does not have
provider success evidence: all inspected tests replace `fetch`, and the
runtime requires explicit optional/local configuration before registering the
provider tools.

Concrete parity gaps are:

1. Bitbucket workspace/repository permission operations are absent.
2. Bitbucket branch and pull-request mutation coverage is partial; the current
   registry does not represent the full operation classes requested here.
3. Confluence comment read/mutation coverage is partial, and page deletion and
   permission operations are absent.
4. Jira issue-link and remote-link tools are implemented and tested, but most
   are not represented in the parity capability inventory; one remote-link
   path declaration disagrees with the client/tests.

## Core versus optional boundary

- `package.json:8-14` maps the default build to `build:core`; `build:optional`
  only builds the MCP widget. `package.json:32` places the provider suites in
  `test:optional`, not `test:core`.
- `src/server/index.ts:256-268` keeps MCP disabled in a Core build and only
  loads optional runtime graphs behind `TEAMS_OPTIONAL_RUNTIME`/non-Core
  conditions.
- `scripts/build-server.mjs:152-166` externalizes the MCP/provider modules
  from the Core bundle.
- `src/server/index.ts:1852-1898` registers provider tools only under the
  local MCP path and only when `TEAMS_MCP_PROVIDER_TOOLS=true`; tenant,
  requester, and Atlassian site values are required before registration.

Assessment: the Core/optional separation is represented in source and package
scripts. It is not evidence of an authenticated provider runtime.

## Detailed findings

### BB-01 — Bitbucket permission operations are not represented

The client exposes workspace/repository discovery, repository content, pull
requests, pipelines, environments, and selected writes, but no permission
types or methods. The capability inventory has no permission row: its complete
Bitbucket inventory is `src/server/atlassian-rovo-provider-parity.ts:77-108`,
and the registry's Bitbucket registrations are
`src/server/mcp-provider-tools.ts:657-706`. No workspace/repository user,
group, or permission-config tool is registered.

This is a concrete gap for workspace/repository/permission parity, not a claim
that a particular tenant grants or denies any permission. The repository's
earlier contract note correctly says effective capability is the intersection
of scopes and product permissions (`.superpowers/sdd/2026-08-09-atlassian-parity-and-runtime-verification/continuation-2026-08-18/e-integrations-parity-report.md:122-126`).

Proposed stable idempotency key for a future Jira mapping:
`teams-core:task:provider-parity-bitbucket-permissions`.
No new Jira issue was searched, created, or updated in this audit.

### BB-02 — Bitbucket branch and pull-request operation coverage is partial

The client has only branch get/create at
`src/server/bitbucket-cloud-client.ts:148-150` and `207-209`. The registry
represents only `bitbucket_get_branch` and `bitbucket_create_branch` at
`src/server/mcp-provider-tools.ts:672` and `692`.

Pull-request coverage is list/get/comments/diff plus create, merge, approve,
and add-comment (`src/server/bitbucket-cloud-client.ts:88-94`,
`133-145`, `191-205`; registry `661`, `669-671`, `682-691`). There is no
branch list/delete/update operation and no PR decline/reopen/update/comment
edit/delete/unapprove operation in the current surface. The audit records
these as unrepresented operations, not as a demand to invent endpoints.

Proposed stable idempotency key:
`teams-core:task:provider-parity-bitbucket-branch-pr-operations`.

### BB-03 — Bitbucket commit/file surface is read-plus-commit-form only

The client represents commit list/get/create and a single `src` read for a
commit/path (`src/server/bitbucket-cloud-client.ts:80-85`, `152-157`,
`211-233`). The registry mirrors these at
`src/server/mcp-provider-tools.ts:660`, `673-674`, and `693-696`.
The only file write/delete semantics are embedded in the commit form
(`files`, `deleteFiles`); there is no separate file metadata/tree operation or
file mutation tool. This is a bounded limitation of the current registry, not
an assertion that the commit form is invalid.

Proposed stable idempotency key:
`teams-core:task:provider-parity-bitbucket-commit-file-operations`.

### CF-01 — Confluence page/search coverage exists, but comment/page mutation coverage is incomplete

The client represents CQL search, page get/create/update, descendants, spaces,
pages-in-space, comment collections/children, and footer/inline comment
creation (`src/server/atlassian-cloud-client.ts:263-347`). The registry exposes
those operations at `src/server/mcp-provider-tools.ts:644-655`.

There is no comment get-by-ID, edit, or delete method/tool; comment operations
are list/children/create only. There is no dedicated page delete/trash method
or page/comment permission operation. `ConfluencePageUpdate.status` accepts
`trashed` (`src/server/atlassian-cloud-client.ts:79-87`), but that is not the
same as a separately gated delete operation and currently has no dedicated
registry contract.

Proposed stable idempotency key:
`teams-core:task:provider-parity-confluence-comment-page-operations`.

### JR-01 — Jira issue-link/remote-link operations exist, but parity metadata is stale/incomplete

The Jira client implements issue-link create/get/delete and remote-link
list/create-or-global-ID-upsert/get/update/delete/by-global-ID-delete at
`src/server/atlassian-cloud-client.ts:174-210`. The MCP registry registers the
same tools at `src/server/mcp-provider-tools.ts:615-629`. The fixture test
asserts a 69-tool registry and explicitly exercises the issue-link and
remote-link paths at `scripts/mcp-provider-tools-test.ts:20-90`,
`129`, and `265-302`.

However, `src/server/atlassian-rovo-provider-parity.ts:48-62` contains no
capability rows for Jira issue-link create/get/delete or remote-link
create/update/get/delete. It has only the remote-link list row at line 50.
Consequently `implementedRovoCapability()` returns no inventory metadata for
those tools, and `src/server/mcp-provider-tools.ts:553-567` / `580-600` marks
them as `parityStatus: legacy-extra` rather than mapping them to an official
capability row. The tools are present; their parity representation is not
complete.

Existing local evidence maps this implementation to MP-99 in
`.superpowers/sdd/2026-08-11-teams-release-recovery-replan/task-optional-provider-hardening-report.md:35-41` and records the focused tests at lines 47-55. That is local evidence, not a fresh live Jira read.

### JR-02 — Jira remote-link API path metadata disagrees with implementation/tests

The parity inventory declares `GET /rest/api/3/issue/{issueIdOrKey}/remotelink`
at `src/server/atlassian-rovo-provider-parity.ts:50`. The actual client uses
`/rest/api/2/issue/{issueIdOrKey}/remotelink` at
`src/server/atlassian-cloud-client.ts:174-175`, and the fixture test asserts
the v2 path at `scripts/atlassian-cloud-client-test.ts:45-46`. The existing
MP-99 local report also records the implementation assumption as Jira REST v2
at `task-optional-provider-hardening-report.md:37-39`.

This audit did not re-fetch official Atlassian documentation. The actionable
gap is the repository's internal contract disagreement: the capability
inventory and client/test need one reviewed version and one consistent
metadata record before parity can be claimed.

Proposed stable idempotency key:
`teams-core:bug:provider-parity-jira-remotelink-contract-version`.

## Auth, redaction, and transport observations

- Client auth providers inject a bearer header only inside the client request
  path (`src/server/atlassian-cloud-client.ts:370-389` and
  `src/server/bitbucket-cloud-client.ts:286-309`).
- The principal-scoped boundary rejects credential-bearing caller headers/query
  parameters and redacts response values (`src/server/mcp-provider-auth-boundary.ts:73-120`).
- The HTTP broker enforces provider-origin allowlists, server-side bearer
  injection, request/response bounds, and redaction
  (`src/server/mcp-provider-http-broker.ts:62-104`, `242-345`).
- MCP result rendering applies recursive sensitive-value redaction and bounded
  output (`src/server/mcp-provider-tools.ts:416-451`).
- The production wiring uses the broker and server environment credentials at
  `src/server/index.ts:1866-1886`; the registry still supports a legacy direct
  resolver at `src/server/mcp-provider-tools.ts:36-45`, `528-543`.

The tests support these controls, but they are fixture tests. They do not prove
provider permission scope, token validity, tenant binding to a real account,
or production response behavior.

## Existing Jira evidence and mappings

- Exact tracked-file search for `MP-99` and `MP-100` returned no match. The
  ignored local hardening report is the current repository evidence for those
  labels: MP-100 request-body bounds at
  `task-optional-provider-hardening-report.md:27-33`, and MP-99 Jira link
  parity at `:35-41`.
- Historical integration mapping records MP-36 Jira read adapter, MP-37 Jira
  write adapter, MP-38 Confluence adapter, MP-39 Bitbucket adapter, MP-40 Rovo
  MCP adapter, and MP-41 integration observability at
  `.superpowers/sdd/2026-08-09-atlassian-parity-and-runtime-verification/progress.md:55-64`.
- The same historical ledger says MP-39 remained `To Do` and the optional
  provider remained disabled after a read-only Bitbucket SSH banner probe at
  `progress.md:77-78`. That probe did not prove workspace, repository,
  visibility, clone URL, or API scope.
- New findings in this report have proposed stable idempotency keys above;
  none is represented as a live Jira key. The local Jira workflow explicitly
  requires `JIRA_SYNC_UNVERIFIED` when the authenticated Jira surface is not
  used (`docs/jira-issue-tracking-workflow.md:102-125`).

## Commands actually run

Read-only inspection included `rg --files`, targeted `rg -n` searches,
`git grep -n -E 'MP-(99|100)'`, `git ls-files`, `git log --oneline -- <provider files>`,
`git rev-parse HEAD`, `git branch --show-current`, `git status --short --branch`,
`git diff --stat`, `git check-ignore -v <report path>`, `wc -l`, `nl -ba ... | sed ...`,
and `node -p "require('./package.json').version"`.

Focused fixture commands, all exited 0:

```text
npm run test:atlassian-cloud-client
npm run test:bitbucket-cloud-client
npm run test:mcp-provider-tools
npm run test:mcp-provider-auth-boundary
npm run test:mcp-provider-http-broker
```

Observed results were PASS for client URL/method/payload/encoding/error,
timeout/response bounds, registry registration, principal scoping, auth
redaction, broker origin enforcement, and bounded transport. No command above
performed a live Jira, Confluence, or Bitbucket round trip.

## Explicit unverified external-runtime limits

- No live Jira connector, browser tab, Jira issue search, issue creation,
  transition, comment, or link read/write was performed. MP-99/MP-100 and
  historical MP-36–MP-41 references are not revalidated external state.
- No Bitbucket credential, workspace, repository, branch, commit, file, PR,
  permission, or API-scope identity was observed in this audit.
- No Confluence site, cloud ID, space, page, comment, permission, or search
  response was observed from a live account.
- No Rovo remote MCP client/authentication/resource discovery was exercised;
  the repository's local MCP Apps server is a different server-side contract.
- No Teams host, public HTTPS provider route, production health state, or
  installed app state was used as provider evidence.
- Official API documentation was not fetched during this audit. Endpoint and
  scope conclusions above are repository-contract comparisons; the v2/v3
  Jira remote-link disagreement remains explicitly unresolved.

## Final classification

`BLOCKED_FOR_EXTERNAL_PROVIDER_SUCCESS; LOCAL_CONTRACTS_TESTED`

The next safe step is a separately authorized parity implementation/review
that first reconciles the capability inventory and Jira remote-link version,
then adds the missing Bitbucket permission/branch/PR and Confluence
comment/page operation contracts behind the existing optional, principal-scoped
broker. This audit itself made no source or external-system changes.
