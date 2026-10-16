---
type: "Implementation contract"
sources:
  - resource: "https://developer.atlassian.com/server/bitbucket/rest/v1005/api-group-pull-requests/"
    title: "Bitbucket Data Center10.5 Pull Requests"
    location: "Embedded OpenAPI: /api/latest/projects/{projectKey}/repos/{repositorySlug}/pull-requests GET; participant filter description, page schema and RestPullRequest"
  - resource: "https://developer.atlassian.com/server/bitbucket/rest/v1005/api-group-repository/"
    title: "Bitbucket Data Center10.5 Repository"
    location: "Embedded OpenAPI: repository GET, REPO_READ and RestRepository; dynamic HTML has no stable lines"
generated: { by: "process:repository-pr-read", at: "2026-10-16T18:00:00Z" }
verified: { by: "process:official-openapi-and-synthetic-contracts", at: "2026-10-16T18:00:00Z" }
status: draft
stale_after: "2026-10-23T18:00:00Z"
---

# Repository PR reading

The existing Work Hub has a **저장소 · PR** panel: select up to5 authorized
repositories, then read My PRs, Review requests or a merged page. A DC-specific
adapter uses the official10.5 contract; it does not reuse the Bitbucket Cloud
client or its broker host allowlist. No dependency, LLM, CLI runner, workspace,
execution DTO, login or credential change is required.

## Boundaries

- Production composition has an empty catalog and displays **운영 연결 미완료**.
  Environment variables do not activate an intranet connection.
- Server authorization grants bind existing validated Teams tenant/requester to
  repository and DC user ID/name. Revalidate grants and the owner-bound catalog
  revision after provider I/O. Denial/drift returns no partial results.
- Only fixed GET repository/PR paths are requested; redirects and unapproved
  URL shapes fail. The transport dependency must already be bound to the
  authenticated DC user; a shared token alone cannot prove that user's access.
- Provider REPO_READ, target repository identity, PR ID/version and full40-hex
  head/base commits are checked. A provider-supplied self link must match the
  approved HTTPS origin and exact repository/PR path. Missing or foreign links
  display **PR 웹주소 미검증** without an action; no URL is invented. The OpenAPI
  schema does not guarantee a returned self link or actual web-page readiness.
  Snapshot fingerprints are checked by
  the browser and native projection. They are correlation/integrity evidence,
  not authentication or a signature from Bitbucket.
- PR titles are plain React text; native Markdown/URLs in titles are escaped or
  omitted. Description/comment/email fields are not retained or projected.
- Recent merges are ordered by closedDate **within the fetched page**. The
  provider's NEWEST ordering does not establish global merge-time completeness.
- The panel clears old data on selection, identity, permission failure and close.
  Abort plus generation guards defeat late responses; duplicate reads coalesce.
- Authentication observed by `apiFetch` invalidates the panel synchronously on
  credential change, auth failure or auth-mode change. Only a memory-only SHA-256
  credential digest is retained for eviction; no raw token, decoded identity or
  digest is persisted or exposed. Token renewal also conservatively clears the
  view. This is not an authorization decision or proof of a host account switch
  that has not yet been observed by an API operation. Reopen/reload under the new
  identity before querying. Late token/fetch/body success and failure cannot
  restore the previous view. No automatic authentication retry is introduced.
  Core mutations separately retain sent-but-unconfirmed request identities;
  see [mutation/auth recovery](mutation-auth-recovery.md). Read eviction does
  not turn a possibly accepted mutation into a definitive auth rejection.
- Page offsets use own properties only, including valid IDs such as `toString`.
  A page failure retains an enabled first-page recovery action outside the
  removed result area. Authorization/catalog failures still clear that scope.
- `repositoryPrCard()` is an authenticated-caller projection only, at most3 PRs,
  Adaptive Cards1.6 and OpenUrl only. It is not automatically sent to Teams.

## Verification

`npm run test:repository-pr` runs the actual read module, mock DC HTTP server,
Express/Entra-claim middleware, DTO/client race checks and React/native projections.
An additional actual React DOM + `apiFetch` suite exercises synthetic credential,
tenant, logout, late-token/fetch/body and page-recovery branches without a browser.
All five files are registered in Core. The finite loopback preview uses the actual
React panel, same CSS, actual routes/auth middleware and synthetic identities;
`scripts/repository-pr-preview.ts` is never the public runtime.

Actual Teams web/desktop/iPhone, native card rendering, production foreground
screens and real intranet access remain **UNVERIFIED**. No company data is sent
to the public Teams server or any external model.

## Required before live composition

1. Approved intranet execution/deployment location and network boundary.
2. Actual DC server version and HTTPS base/context path; recheck that version's
   API contract and exact repository project/slug/numeric IDs.
3. Existing verified Teams-to-DC user mapping and an approved principal-bound
   read transport; current REPO_READ and revocation behavior must be demonstrated.
4. Explicit approval for any new account/token/persistent access or network change.
5. Same-source integration/CI, package/install read-back and actual Teams client
   screenshots before operational readiness is claimed.
