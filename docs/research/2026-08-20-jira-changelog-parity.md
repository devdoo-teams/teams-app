# Atlassian REST parity audit: Jira issue changelogs

Date: 2026-08-20

## Scope and decision

This is a bounded audit of the provider surfaces in `src/server/atlassian*.ts`,
`src/server/bitbucket*.ts`, and `src/server/mcp-provider-tools.ts`. It is not a
claim that every Atlassian REST resource is implemented. The existing adapter
already covers a broad set of Jira, Confluence, and Bitbucket operations, so the
highest-value missing operation for the current release/audit workflow was
selected by operational value rather than by adding another generic endpoint.

The selected operation is Jira issue changelog listing:

`GET /rest/api/3/issue/{issueIdOrKey}/changelog`

It gives release and issue audits the authoritative field-change history that
cannot be reconstructed from the current issue snapshot, comments, or worklogs.

## Official contract

The [Jira Cloud REST API v3 Issues reference](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
defines “Get changelogs” with the following contract:

| Contract element | Official requirement | Adapter mapping |
| --- | --- | --- |
| Method and route | `GET /rest/api/3/issue/{issueIdOrKey}/changelog` | `AtlassianCloudClient.jiraGetIssueChangelogs` |
| Path parameter | `issueIdOrKey` is required | `pathSegment` validates and URL-encodes it |
| Pagination | optional `startAt`, `maxResults` | bounded `JiraPageOptions`, max 200 at the client/tool boundary |
| Response | `200` paginated `PageBeanChangelog` | `AtlassianResult<unknown>` with existing bounded JSON handling |
| Permission | Browse projects, subject to issue-level security | provider scope metadata only; no credential or live call in tests |
| Granular OAuth scope | `read:issue-meta:jira`, `read:avatar:jira`, `read:issue.changelog:jira` | tool metadata preserves all three scopes |

The endpoint is a read operation and is therefore annotated as non-destructive
and idempotent. The implementation does not add a token, credential, live
provider call, or version bump.

## Baseline gap and implementation

Before this change, the client had issue snapshots, transitions, comments,
worklogs, and links, but no changelog method. The registry had no changelog
tool. The implementation adds:

| Layer | Addition |
| --- | --- |
| Client | `jiraGetIssueChangelogs(issueIdOrKey, { startAt, maxResults })` |
| Provider registry | `jira_get_issue_changelogs` |
| Capability inventory | `getJiraIssueChangelogs`, `GET` route, `read:issue.changelog:jira`, explicit `rest-extension` provenance |
| Client test | URL encoding, route, method, and pagination assertion |
| MCP registry test | registration, count, scope, annotations, route, and pagination assertion |

This is deliberately marked `rest-extension`, not `rovo-preview`: the local
tool is backed by Atlassian's official REST contract, but the current Rovo
Preview operation-name set in this repository does not publish this operation.

## Comparison with adjacent official REST gaps

The current source is intentionally a bounded adapter, not a full mirror of
every product endpoint. The official references show additional high-value
operations that remain candidates for later slices:

| Product | Official operation not in this slice | Current status | Evidence |
| --- | --- | --- | --- |
| Jira | `POST /rest/api/3/issue/{issueIdOrKey}/changelog/list` (get changelogs by IDs) | not implemented | [Jira Issues reference](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/) |
| Confluence | `GET /wiki/api/v2/pages/{id}/versions` (page version history) | not implemented | [Confluence Version reference](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-version/) |
| Bitbucket | `GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/activity` | not implemented | [Bitbucket Pull Requests reference](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/) |
| Bitbucket | `GET .../pullrequests/{pull_request_id}/commits` | not implemented | [Bitbucket Pull Requests reference](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/) |
| Bitbucket | pull-request tasks and request-changes operations | not implemented | [Bitbucket Pull Requests reference](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/) |

Those are explicit backlog candidates, not silently counted as implemented
parity. The Jira changelog operation was chosen first because the project's
release evidence and Jira issue management depend directly on immutable change
history.

## Acceptance evidence

- RED: before the client implementation, `npm run test:atlassian-cloud-client`
  failed with `TypeError: client.jiraGetIssueChangelogs is not a function`,
  and `npm run test:mcp-provider-tools` failed because the new registry tool
  was absent.
- GREEN: `npm run test:atlassian-cloud-client` passed after implementation.
- GREEN: `npm run test:mcp-provider-tools` passed after implementation.
- No real Atlassian token or live provider request was used.
- No package version was changed by this slice; the current package version
  remains `1.0.77` for the parent release decision.
