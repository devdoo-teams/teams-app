# Task 5 report — Teams UI verification matrix

## STATUS

`BLOCKED` for live Teams UI evidence; the requested matrix, validator, and focused test are complete and structurally valid. This task did not use external credentials or Teams UI, so it makes no claim that a deployed Teams desktop/mobile flow passed.

## Changed files

- `docs/teams-ui-verification-matrix.md`
  - Machine-readable JSON block with 149 independent rows.
  - Covers 149 required coverage keys across Teams chat commands/scopes, Adaptive Card buttons and states, personal-tab sections, filters, item CRUD, weather permission/provider branches, authentication expiry/retry, Copilot approval/cancel/retry paths, narrow mobile surfaces, Codex lifecycle states, and deep links.
  - Every row includes `feature`, `surface`, `location`, `branch`, `precondition`, `action`, separate `visibleControl` and `serverAction` objects, `expected`, fresh before/after screenshot slots, fresh AX slot, runtime slot, and a `result` status/reason.
  - Current evidence state: 148 `BLOCKED`, 1 evidence-backed `N/A` for the non-rendered GenUI retry button. No row is marked `PASS` or `FAIL` without fresh evidence.
- `scripts/teams-ui-matrix-validate.mjs`
  - Extracts the marked JSON block, validates row schema, duplicate IDs, required coverage, evidence freshness/identity gates, visible-control/server-result separation, and result reasons.
  - Default CLI validates the matrix structure; `--require-pass` additionally rejects unresolved `BLOCKED`/`FAIL` rows.
- `scripts/teams-ui-matrix-validate.test.mjs`
  - Focused Node test covering valid exhaustive input, missing evidence, stale `PASS`, collapsed proof boundaries, duplicate IDs, and strict readiness.
- `.superpowers/sdd/2026-08-09-atlassian-parity-and-runtime-verification/task-5-report.md`
  - This report.

## Test/output

The focused test was written first and observed failing because the validator artifact did not exist. After implementation:

```text
node --test scripts/teams-ui-matrix-validate.test.mjs
6 tests passed, 0 failed
```

```text
node scripts/teams-ui-matrix-validate.mjs docs/teams-ui-verification-matrix.md
Teams UI matrix valid: rows=149 PASS=0 FAIL=0 BLOCKED=148 N/A=1 coverageMissing=0
```

`git diff --check` for the three implementation/test files completed with no output. No production code, manifest, AGENTS.md, release documentation, package, upload state, credentials, or environment configuration was changed.

The full repository suite was also attempted with `npm test`, but it stopped at the existing dirty parity implementation during `npm run typecheck`:

```text
src/server/index.ts(1144,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
```

This failure is outside the Task 5 docs/validator scope and was not changed.

## Concerns / blockers

- Fresh screenshots, fresh AX trees, live server/runtime evidence, deployed package SHA, installed Teams version, portal upload, public health, Teams desktop, and Teams mobile evidence are intentionally not captured. The matrix therefore remains `BLOCKED` and must not be promoted to a release-ready result.
- The current source worktree already contained unrelated dirty changes from the other parity tasks; they were preserved and excluded from this task's commit.
- The current GenUI card renderer does not emit a Codex retry button. That branch is explicitly `N/A`; the implemented retry path is the `continue <task-id> <additional request>` chat command and has its own blocked row.
- The full application/release suite was attempted but stopped at the existing `src/server/index.ts:1144` type error before later application/release tests. External deployment was not attempted because the task explicitly prohibits external credentials/UI and production/release-state changes.

## Commit

- Implementation commit: `a650968` (`docs: add Teams UI verification matrix validator`).
- Report commit before the final suite note: `b44a360` (`docs: record Task 5 matrix verification report`).
- The final suite-note update is committed separately; no upload or external integration was performed.
