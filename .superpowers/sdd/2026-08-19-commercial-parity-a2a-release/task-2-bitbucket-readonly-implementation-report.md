# Task 2 — Bitbucket Cloud read-only commit/file slice

Date: 2026-08-19

## Implemented boundary

- `commitsForRevision`: `GET /2.0/repositories/{workspace}/{repo_slug}/commits/{revision}` with bounded `path`, repeated `include`/`exclude`, and pagination queries.
- `fileHistory`: `GET /2.0/repositories/{workspace}/{repo_slug}/filehistory/{commit}/{path}` with bounded `renames`, `q`, `sort`, and pagination queries.
- `sourceRoot`: `GET /2.0/repositories/{workspace}/{repo_slug}/src/{commit}/` with the required trailing slash and bounded `format` (`meta` or `rendered`).

All three operations are registered as optional, read-only MCP tools with `read:repository:bitbucket`. File paths reject empty, oversized, traversal, and control-character input before provider access; query values are bounded and reject control characters. No diff, patch, mutation, or approval operation was added.

## Official contracts

- [Bitbucket Cloud Commits REST API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commits/)
- [Bitbucket Cloud Source REST API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/)

## Provenance

- Implementation commit: `10d76c58eda39227f5fa835042e6d5b0f95c169e`
- Redaction regression test fix commit: `f3aee0b0564da7d76b32331aacc30bd169472a10`
- Report-fix commit: `2ea40b39b43fd555299aa711ecce08f8252f8383`

The shared formatter was already using `boundedOutput(response.data)` for the
successful `structuredContent.data` value as well as the text content at the
implementation commit. The regression test in the fix commit exercises the
new `bitbucket_file_history` read tool with an oversized provider payload and
proves that `structuredContent` uses the redacted, truncated 48,000-character
representation rather than the raw provider response.

## Verification limitation

Verification is fixture-based with injected fetch implementations. No live Bitbucket Cloud provider, credentials, or network call was used or claimed; missing credential tests assert fail-closed behavior with no fetch.

## Finish verification — 2026-08-19

The final Task 2 review retained only the documented, read-only Bitbucket
Cloud operations and their optional MCP exposure. The source-root MCP schema
is strict: it accepts only `workspace`, `repository`, `commit`, and optional
`format`, rejecting unsupported pagination rather than accepting and
discarding it.

Fresh fixture-only verification passed:

- `npm run test:bitbucket-cloud-client`
- `npm run test:mcp-provider-tools`

These tests assert encoded official routes, GET/no-body semantics, bounded
input and response handling, registry/inventory parity, and no-network
missing-credential failures. No live provider, credential, or network
assertion is included in this report.

## Post-commit validation — 2026-08-19

Exact command results from the implementation-round validation for
`10d76c58eda39227f5fa835042e6d5b0f95c169e`:

```text
$ npm run typecheck:core

> teams-sdk-mvp@1.0.51 typecheck:core
> node scripts/core-source-check.mjs

PASS: core source compile check covered 22 Teams/CLI files

$ git diff --check
(no output; exit 0)
```

No live Bitbucket Cloud provider validation was run. The verification used
injected fetch fixtures only; no Bitbucket credential was supplied and no
network request was sent to a live Bitbucket endpoint.

## Review round 1 report-only update — 2026-08-19

Report-only commit: 13e33ea899efb09aabd82d8d6417a3be0e10e14d

The report-only provenance update records the regression-test result. It
does not claim a new `npm run typecheck:core` result: the attempted command was
blocked by unrelated tracked GHCP changes in
`scripts/ghcp-cli-adapter-test.ts` and `src/server/ghcp-cli-adapter.ts`
(`EWORKTREEDIRTY`). Those paths were not staged or modified for this round.
