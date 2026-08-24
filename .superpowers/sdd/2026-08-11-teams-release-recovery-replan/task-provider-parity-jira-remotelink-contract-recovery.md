# Jira remote-link contract recovery

## STATUS

PASS — the Jira issue-link and remote-link CRUD client paths and fixture URL
assertions now use the official Jira Cloud REST API v3 contract.

## Root cause

`AtlassianCloudClient` used `/rest/api/2` for issue-link and remote-link
requests while the provider-parity inventory and the current Atlassian REST
API v3 contract use `/rest/api/3`. The fixture suite consequently encoded the
same stale v2 paths and could not detect the contract drift until its expected
URLs were corrected first.

## Changed files

- `src/server/atlassian-cloud-client.ts`
  - Updated issue-link create/get/delete paths to `/rest/api/3/issueLink`.
  - Updated remote-link list/create-or-update/get/update/delete and
    delete-by-global-ID paths to `/rest/api/3/issue/{issueIdOrKey}/remotelink`.
  - Kept request methods, payload validation, URL encoding, and error boundary
    behavior unchanged.
- `scripts/atlassian-cloud-client-test.ts`
  - Updated exact URL assertions and the invalid-request path assertion to v3.
  - Confluence fixtures were not changed.

No registry, capability inventory, package, manifest, or other provider file
was modified.

## Verification

The test-first RED check was intentional: after changing the fixture
expectations before production code, the test failed at the old v2 request
(`scripts/atlassian-cloud-client-test.ts:46`). After the minimal client change:

```text
npm run test:atlassian-cloud-client                                             exit 0
npx tsc --noEmit --strict --target ES2022 --module NodeNext \
  --moduleResolution NodeNext --esModuleInterop --skipLibCheck --types node \
  src/server/atlassian-cloud-client.ts scripts/atlassian-cloud-client-test.ts  exit 0
git diff --check                                                               exit 0
git diff --cached --check                                                       exit 0
```

The focused fixture suite reported:

`PASS: Atlassian Jira/Confluence client paths, auth redaction, timeout, malformed response, and URL encoding`

## Commit

Implementation commit: `4b95c61ed09a0854356847df6ffc3a66752aebce`
(`fix: align Jira link APIs with REST v3`).

The implementation commit contains only the two source/test paths above. This
report is recorded in a follow-up report-only commit so it can include the
already-resolved full implementation SHA.

## External verification boundary

No live Jira request, credential, browser session, issue mutation, or provider
round trip was performed. The change is validated only by local fixture tests,
focused strict TypeScript compilation, and diff checks.

Official contract references:

- https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-remote-links/
- https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-links/
