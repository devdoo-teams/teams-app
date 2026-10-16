# Repository PR Reading Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. The user supplied the scope and requested implementation, tests and one separate Astra review; do not create another task or repeat scope approval.

**Goal:** Select multiple authorized repositories and read three deterministic PR lists in the existing Work Hub.
**Architecture:** An owner-scoped module coordinates a fixed catalog, fresh authorization grants and a DC read adapter. Authenticated routes and a React panel share strict DTOs; production has no configured intranet connection.
**Tech Stack:** Existing TypeScript, Zod, Express, React and fetch; no dependencies, LLMs or new credentials.
**Spec:** docs/superpowers/specs/2026-10-17-repository-pr-read-design.md

## Global constraints

- Preserve original main50fedfc6, operating152, frozen154 receipt,74 user files and reviewed157 branch/CI.
- New local branch codex/repository-pr-read; candidate158 after version reservation.
- No source execution, PR writing, whole conversation collection or external model/backend connection.
- No actual intranet data, accounts, tokens, persistent access or network/security changes.
- Existing tab/card structures; synthetic UI and actual Teams are separate evidence.

## Review focus

- Revocation during a delayed provider response must hide all data.
- A foreign account/catalog revision must not select another user's repositories.
- Provider records/links naming another repository or lacking full commits must fail.
- Abort-ignoring old responses must never replace a new selection.
- Native titles/links must not turn untrusted PR text into arbitrary navigation.

### Task1: Deterministic read module and DC adapter

**Files:** src/shared/repository-pr.ts; src/server/repository-pr.ts; src/server/bitbucket-dc-read.ts; scripts/repository-pr-test.ts.
**Interfaces:** RepositoryPrService.catalog(principal), query(principal,request,signal?); BitbucketDcReadAdapter.read(repository,grant,category,start,signal?). Shared strict catalog/request/snapshot schemas bind revision and source identity.

- [ ] Write failing tests using synthetic owner/grants and a real loopback mock DC server: lists, multi-selection, paging, role filters and revision/link pins.
- [ ] Add negative tests for wrong owner/tenant, unknown/denied repository, revoked grant, catalog drift, forged records, redirects, timeout and size bounds.
- [ ] Implement bounded GET-only adapter and authorization-before/after module.
- [ ] Run `node --import tsx --test scripts/repository-pr-test.ts`; require0 failures.

### Task2: Authenticated route and existing tab/card projections

**Files:** src/server/repository-pr-route.ts; src/server/repository-pr-card.ts; src/client/repository-pr-client.ts; src/client/RepositoryPrPanel.tsx; src/client/App.tsx; src/client/styles.css; src/server/index.ts; scripts/repository-pr-route-test.ts; scripts/repository-pr-client-test.ts; scripts/repository-pr-view-test.tsx.
**Interfaces:** mountRepositoryPrRoutes(app,{service,authenticate,resolvePrincipal}); createRepositoryPrClient(fetcher); RepositoryPrPanel({client?}); repositoryPrCard(snapshot).

- [ ] Write RED auth-first routes, strict DTOs, no-store/error and unconfigured tests.
- [ ] Write RED stale-result, duplicate-click, cancellation and foreign-scope client tests plus plain-title/native-link projection assertions.
- [ ] Add the existing-tab panel and safe native card projection. Mount production with empty catalog, never a guessed DC endpoint.
- [ ] Run focused route/client/view tests and strict typecheck; commit a meaningful implementation unit.

### Task3: Current-source gates, visual proof and review handoff

**Files:** Core test inventory/contract, package versions, docs/repository-pr-read.md; scripts/repository-pr-preview.mjs and browser fixture only if needed.

- [ ] Register all focused tests in Core with a RED registration assertion; reserve158 and align package/lock/manifest.
- [ ] Commit, run exact-SHA typecheck/Core/build/manifest/determinism/package gates with isolated public inputs and bounded logs.
- [ ] Run desktop/mobile synthetic viewport flows in the actual React panel; directly review captured pixels, or report exact browser access blocker.
- [ ] Prepare diff, source/artifact identity, tests, visualReview and unconfigured live prerequisites for separate Astra review.
- [ ] Recheck original19 file hashes,74 untracked names, main and operating process preservation. Do not push the new feature or deploy before its own review.
