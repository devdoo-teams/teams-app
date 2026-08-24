# Task 3 — A2A v1 scalar/null DataPart compatibility

Date: 2026-08-20

## Scope

Fix the reproduced A2A v1 JSON-RPC `SendMessage` defect tracked by Jira
[MP-150](https://devdoo.atlassian.net/browse/MP-150), idempotency key
`teams-core:bug:a2a-v1-scalar-data-parts`. The v0.2.6 route was kept unchanged.

## Official contract

The current [A2A specification](https://a2a-protocol.org/latest/specification/)
defines a Part `data` field as an arbitrary JSON value: object, array, string,
number, boolean, or null. The previous Core parser accepted only non-null
objects and arrays, so a valid scalar/null DataPart was rejected as invalid
parameters.

## RED evidence

Added scalar and null DataPart requests to
`scripts/a2a-index-integration-test.mjs` before changing production code.

```text
npm run test:a2a-index-integration
exit 1
error: {"code":-32602,"message":"Invalid parameters"}
```

The failure occurred for an authenticated `SendMessage` request at
`/a2a/v1` with `a2a-version: 1.0` and
`parts: [{"data":"hello","mediaType":"application/json"}]`.

## Implementation

- Added the bounded `A2AJsonData` type for JSON scalar, object, array, and null
  values.
- Updated the shared A2A contract validator to accept JSON values while still
  rejecting undefined, non-JSON runtime values, oversized/non-serializable
  values, and existing unsupported part forms.
- Updated only the v1 JSON-RPC mapper to accept the same value domain. The
  legacy v0.2.6 mapper remains object/array-only for its existing compatibility
  contract.

## GREEN evidence

```text
npm run test:a2a-index-integration     PASS
npm run test:a2a-jsonrpc-route         PASS
npm run test:a2a-official-contract-audit PASS
```

The integration test now receives submitted tasks for both scalar and null
DataParts and preserves the existing task, auth, cancellation, and
orchestration assertions.

`npm run typecheck:core` was intentionally attempted before commit and stopped
with the repository's FileProvider safety gate (`EWORKTREEDIRTY`). The source
changes must be committed before the bounded Core source/build checks can run.

## Verification boundary

No external A2A provider, Teams host, login, token, or live remote task was
contacted. The fix proves local mounted-route protocol behavior; public
authenticated interoperability remains a separate release/UI gate.
