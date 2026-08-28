# BB-02 Bitbucket branch and pull-request parity

## Scope

This slice is limited to the Bitbucket Cloud client fixture and its implementation. It adds the branch-list endpoint and the missing branch and pull-request lifecycle operations whose HTTP method and endpoint are explicitly documented by Bitbucket Cloud REST API documentation.

## Implemented

| Operation | Method | Path |
| --- | --- | --- |
| List branches | `GET` | `/2.0/repositories/{workspace}/{repo_slug}/refs/branches` |
| Delete branch | `DELETE` | `/2.0/repositories/{workspace}/{repo_slug}/refs/branches/{name}` |
| Update pull request | `PUT` | `/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}` |
| Decline pull request | `POST` | `/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/decline` |
| Unapprove pull request | `DELETE` | `/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve` |

Branch-list `page`, `pagelen`, `q`, and `sort` query values use the existing bounded validation. Pull-request update bodies reject null, arrays, cyclic/non-JSON values, unsafe control characters, and oversized JSON before authentication or fetch is reached. Fixture assertions cover exact URL/method/body, invalid-input short-circuiting, and auth redaction.

## Explicitly unsupported

- Pull-request reopen: no Bitbucket Cloud REST Pullrequests operation or endpoint/method is explicitly documented for reopening a declined pull request.
- Pull-request delete: no Bitbucket Cloud REST Pullrequests operation or endpoint/method is explicitly documented for deleting a pull request.
- Branch update/move: the Refs API documents branch create, get, list, and delete, but no branch-update operation.

No guessed endpoint was added for these operations.

## Official documentation

- [Bitbucket Cloud Refs REST API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-refs/)
- [Bitbucket Cloud Pullrequests REST API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/)

## Validation evidence

- `node --import tsx/esm scripts/bitbucket-cloud-client-test.ts` — PASS (exit 0).
- `./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM src/server/bitbucket-cloud-client.ts` — PASS (exit 0).
- The worker's initial `npm run test:bitbucket-cloud-client` attempt was blocked by its sandbox `tsx` IPC pipe `listen EPERM`; the parent worktree rerun passed with `npm run test:bitbucket-cloud-client` (exit 0). The equivalent direct Node ESM loader also passed without elevated permissions.
