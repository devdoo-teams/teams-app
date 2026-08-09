# Task 3 final scoped re-review

## Scope

Reviewed:

- `task-3-brief.md`
- `task-3-remediation-report.md`
- `review-30a376b..0896d02.diff`

This final pass is limited to the previously open R-1 and R-2 findings plus any new Critical or Important breakage introduced by `30a376b..0896d02`. No deployment or external-system mutation was performed.

## R-1 verdict — ADDRESSED

Production startup now fails closed for the combined Bot+tab SSO contract:

- `src/server/index.ts:90-93` separates the explicit `BOT_CLIENT_ID`, preserves `CLIENT_ID` fallback only outside production, trims `TAB_DOMAIN`, and bases Bot readiness on non-empty trimmed credentials.
- `src/server/index.ts:160-183` requires an explicit production Bot client ID, requires a non-empty tab domain, validates that hostname through the shared helper, and only then compares `APPLICATION_ID_URI` with `api://<TAB_DOMAIN>/botid-<BOT_CLIENT_ID>`.
- `src/shared/public-hostname.js:1-9` centralizes the bounded hostname contract used by both production startup and deployment validation.
- `scripts/runtime-test.mjs` adds negative startup cases for missing `TAB_DOMAIN`, missing explicit `BOT_CLIENT_ID`, malformed `TAB_DOMAIN` with a matching malformed URI, and Bot-ID mismatch.

Fresh reviewer verification:

- `npm run test:runtime` — exit 0; the focused R-1 startup failures and valid production flow passed.
- `npm run test:deployment-env` — exit 0.
- `npm run typecheck` — exit 0.

No R-1 issue remains.

## R-2 verdict — ADDRESSED

Source-manifest validation now enforces both required domains:

- `scripts/validate-manifest.mjs:19-39` exposes pure validation and requires both `${{TAB_DOMAIN}}` and `token.botframework.com` in source `validDomains`.
- `scripts/validate-manifest-test.mjs:17-27` verifies the checked-in manifest and separately rejects omission of either required domain using in-memory fixtures.
- `package.json:18` exposes the focused test, and `package.json:55` includes it in the full local suite.
- The CLI path remains intact at `scripts/validate-manifest.mjs:60-75`, including real icon checks and non-zero exit on validation errors.

Fresh reviewer verification:

- `npm run test:manifest` — exit 0.
- `npm run validate:manifest` — exit 0.
- `npm run typecheck` — exit 0.

No R-2 issue remains.

## New Critical findings

None.

## New Important findings

None.

## Spec compliance verdict

PASS. R-1 and R-2 are ADDRESSED, and the scoped fix preserves the confirmed combined Bot+tab SSO resource and source/package `validDomains` contract. No new Critical or Important regression was found in `30a376b..0896d02`.

## Task quality verdict

PASS. The remediation report contains focused RED/GREEN evidence, the implementation centralizes the shared hostname rule, the manifest tests avoid mutating checked-in files, and fresh reviewer runs of the scoped runtime, deployment, manifest, and typecheck commands all exited 0. The full `npm test` was not rerun for this scoped review.
