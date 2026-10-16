# Multiple repository PR reading

## Approved outcome

Add repository multi-selection and deterministic **My PRs / Review requests /
Recently merged** lists to the existing Work Hub. The user approved this first
slice on 2026-10-17 KST. Implement inline, test synthetic data and a mock Bitbucket
Data Center server, then prepare a separate Astra review. The existing157 source
and exact-SHA remote CI are already frozen; this is a subsequent local change.

## Scope and architecture

Use a new repository-reading module, independent of AgentService, AGENT_WORKSPACE,
execution DTOs, LLMs and conversation collection. The existing tab renders one
compact panel using the existing card styles; an Adaptive Card projection is
available for an authenticated caller, without sending messages automatically.

`RepositoryPrService.catalog(principal)` exposes only authorized descriptors.
`query(principal, request, signal?)` accepts 1-5 server-owned repository IDs, one
list category, a catalog revision and bounded per-repository page offsets. IDs,
tenant/requester identity, DC user identity and HTTP origins are never selected
by untrusted body fields. The existing Entra authentication precedes JSON parsing.

The module consumes a server-owned repository catalog, an authorization callback
and read adapters. Each grant binds tenant, requester, repository, DC user ID/name
and policy revision. Check grants before I/O and again before returning any
response. Revocation or a changed catalog/grant invalidates the whole result.
The response includes an opaque owner scope key; the client refuses another
scope's result. Nothing is persisted in browser storage.

## Bitbucket DC adapter contract

Use the current official DC10.5 REST contract, independently of the Cloud client:

- GET `/rest/api/latest/projects/{projectKey}/repos/{repositorySlug}` verifies
  repository identity and provider-enforced REPO_READ using the caller's transport.
- GET the repository's `/pull-requests`, with INCOMING, state OPEN/MERGED,
  order NEWEST, limit20, bounded start and server-mapped `username.1`/`role.1`.
- My PRs use AUTHOR. Review requests use REVIEWER and approved.1=false; validate
  returned author/reviewer identities and state as well as provider filters.
- A merged page is sorted by closedDate within the returned page. The UI says
  this is a page, never an exhaustive global merge-time ordering.

Each adapter has an explicitly supplied HTTPS base/context path and a trusted
principal-bound request dependency. There is no environment-variable switch from
Cloud to DC, credential creation, login, policy change or real intranet request.
Only fixed GET paths are used; redirects, credentials in URLs, traversal,
oversized bodies, malformed responses and timeouts fail closed. The mock transport
maps the approved synthetic HTTPS origin to a loopback-only fixture server.

Each item pins target repository ID, PR ID/version, full source/target commit,
observedAt and canonical API/source URLs. Browser links are built from the approved
base and verified API identity; provider-supplied arbitrary links are ignored.
No descriptions, comments, emails or conversation bodies are collected. Titles
are bounded plain text; native Markdown is escaped. Unknown revisions fail closed.

## UI and race behavior

Show repository checkboxes (maximum5), three category controls, refresh, per-repo
next-page controls, empty/error/loading states and expandable revision/source
facts. Clear prior results before a selection/category/identity change or failed
refresh. Abort and a monotonically increasing request generation both prevent
late responses from replacing current state. Duplicate query clicks share one
active request. On auth/permission failure, clear retained data and reload catalog
only through an explicit retry. Closing the panel stops its reads.

Production composition uses an empty catalog and no DC adapter until an approved
intranet deployment, server version/base URL, repository IDs and existing verified
identity/transport mapping are provided. Display **운영 연결 미완료**. Synthetic
screens display **합성 데이터 · 운영 연결 미완료**. No real Teams or service-clone
claim is made.

## Verification

Contract tests use actual Express/auth/module and a mock DC HTTP server. Cover
tenant/owner isolation, body identity injection, permission denial/revocation,
grant/catalog drift, selected repositories, filters/pagination, revision/link
validation, redirects, timeout/body limits, stale responses, repeated clicks,
errors/empty/unconfigured states and native card bounds. Render real React in
desktop/mobile browser viewports and directly review screenshots if a supported
browser is available; otherwise retain the exact screen-access blocker. Actual
Teams web/desktop/iPhone and native card rendering remain separate gates.

Source: https://developer.atlassian.com/server/bitbucket/rest/v1005/api-group-pull-requests/
and api-group-repository, current10.5 OpenAPI embedded in the official page, read
2026-10-16 UTC. Web reader hit its4MiB limit; bounded direct public HTML retrieval
and `window.__DATA__.schema` extraction supplied the contract. Installed Node24.13.1.
