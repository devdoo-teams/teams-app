# Bitbucket branch and pull-request parity recovery

## Scope

This recovery completed the source methods referenced by the existing partial
scripts/bitbucket-cloud-client-test.ts diff. Only these files are in scope:

- src/server/bitbucket-cloud-client.ts
- scripts/bitbucket-cloud-client-test.ts
- this report

No registry, capability inventory, package, manifest, or other provider file
was changed.

## Official endpoint verification

The implementation uses the Bitbucket Cloud REST API v2 endpoints documented
by Atlassian:

- Branch listing: GET /2.0/repositories/{workspace}/{repo_slug}/refs/branches
  with the documented pagination, q, and sort query parameters.
- Pull-request update: PUT /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}.
- Pull-request decline: POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/decline.
- Pull-request unapprove: DELETE /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve.
- Branch deletion: DELETE /2.0/repositories/{workspace}/{repo_slug}/refs/branches/{name}.

Official references:

- https://developer.atlassian.com/cloud/bitbucket/rest/api-group-refs/
- https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/

The official refs documentation states that the main branch cannot be
deleted; the client delegates that repository rule to Bitbucket's documented
HTTP response rather than attempting to infer the default branch locally.

## Implementation

Added to BitbucketCloudClient:

- branches(workspace, repository, options)
- updatePullRequest(workspace, repository, pullRequestId, input)
- declinePullRequest(workspace, repository, pullRequestId)
- unapprovePullRequest(workspace, repository, pullRequestId)
- deleteBranch(workspace, repository, name)

All methods use the existing safeRequest and request path. Path segments
and numeric IDs retain the existing bounds/encoding checks. Pull-request
update bodies are JSON-bounded and reject malformed, cyclic, or control
character-containing values before fetch is reached.

## Verification

Passed:

    npm run test:bitbucket-cloud-client
    PASS: Bitbucket Cloud client paths, URL encoding, auth redaction, timeout, and malformed response

    npx tsc --noEmit --skipLibCheck --target ES2022 --module NodeNext
      --moduleResolution NodeNext --lib ES2022,DOM --types node
      src/server/bitbucket-cloud-client.ts scripts/bitbucket-cloud-client-test.ts
    exit 0

    git diff --check
    exit 0

The tests are fixture-based and verify exact URLs, HTTP methods, JSON/body
headers, invalid-input fail-closed behavior, and the existing auth/timeout/
response-boundary behavior. No live Bitbucket request was claimed; no
credential or authenticated provider round-trip was available in this worker
scope.

## Commit

Implementation commit: `e8f9a30e61a945fa6d959627a9cd96896508300e`.
The commit contains the Bitbucket source/test/report scope only.
