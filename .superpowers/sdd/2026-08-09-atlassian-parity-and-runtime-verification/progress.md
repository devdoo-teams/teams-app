# SDD ledger — plan: docs/superpowers/plans/2026-08-09-atlassian-parity-and-runtime-verification.md

## Setup

- Existing branch: `codex/teams-mobile-genui`.
- Existing user-owned uncommitted GenUI/workflow edits are preserved; new tasks must avoid overwriting them unless explicitly scoped.
- Confirmed runtime blocker: Work Hub personal tab renders the Teams app-connection loading state and `about:blank` in the Teams desktop AX tree.

## Current implementation checkpoint — 2026-08-09

- Task 1: completed and committed as `afc6c0a`; retry generation fix verified by its focused tests.
- Task 2: reviewer fixes integrated in the shared worktree; late progress suppression and Bot/AG-UI response-mode tests pass.
- Task 3: reviewer fixes integrated in the shared worktree; scoped work-item CRUD, transitions, comments, deep links, persistence, idempotency, and tied-timestamp ordering pass.
- Task 4: collaboration parity domain, HTTP routes, and mobile-responsive panel integrated; focused domain and local HTTP E2E checks pass.
- Task 5: verification matrix remains intentionally BLOCKED until fresh desktop screenshots, AX snapshots, public health, package SHA, and mobile confirmation are collected.
- Runtime checkpoint: the first full runtime run exposed two real issues—Codex cancellation could terminate the server through an unobserved rejection, and the Channels shadow comparator omitted the native prompt action. Both were reproduced, fixed, and covered by the subsequent green run.
- Build/test checkpoint: `npm run build:server` completes in under one second after the cache is warm, `npm run test:runtime` passes 400 assertions, and the full `npm test` chain passes. No test or build process remains running.
- Task 5 remains blocked only for live package upload, public runtime, fresh Teams desktop evidence, installed-version evidence, and mobile confirmation; no UI pass is inferred from the green machine gate.
