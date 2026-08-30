# Teams Core CI Release Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the known public Teams service running while making the merged GitHub source, Core checks, immutable container image, Teams package, and later A2A/UI evidence prove one release identity.

**Architecture:** The existing Dev Tunnel and `1.0.76` public process remain a preserved reference service, not the next release. GitHub Actions must verify Core, A2A, continuity, Docker runtime, and the package before an image promotion can run; the promotion workflow may publish only a tag or a manual run selected from `main`, and it must retain a machine-readable binding between source commit, package SHA, server bundle SHA, manifest SHA, and image digest. Codex read-only execution remains fail-closed until a separately proven OS boundary and worker authentication contract exists.

**Tech Stack:** GitHub Actions, pinned Docker actions, Node.js 24, TypeScript/React Teams Core, Express/Teams SDK, deterministic ZIP packaging, GHCR digest identity with plan-aware artifact provenance, A2A JSON-RPC contracts, and Jira MP-160 evidence tracking.

**Spec:** `docs/teams-release-workflow.md`, `docs/api-free-teams-roadmap.md`, and `AGENTS.md`.

## Current execution update — 2026-08-29 (supersedes earlier status blocks)

The earlier execution notes below are retained as historical evidence, but they
must not be read as the current release identity. The current integration
candidate and the preserved service are separate:

- Candidate branch: `feature/grok-provider-20260828`, current HEAD
  `b7093b2` (documentation-only after the release candidate), worktree clean
  and pushed. The functional release identity remains the parent commit
  `59a4f4d49bc5f63031dfd15a6df63c8d7e6a12b5` until a new qualifying change
  is implemented and packaged.
- Candidate release artifact: app/package/manifest `1.0.85`, bound to
  functional commit `59a4f4d49bc5f63031dfd15a6df63c8d7e6a12b5`; package SHA-256
  `b5dbdc3828f0aa0d27a3f843e2ee9266d6533779fbe3a8858717b97df67ad77a`.
- Candidate public origin: `https://q3kj3s3z-3980.jpe1.devtunnels.ms`; health
  reports version `1.0.85`, the same source commit, production Teams
  authentication/bot/outbound, and server bundle SHA-256
  `e40d816462637a664144af711a2217666c12aedc1d952d473964bcb1719009cd`.
- Preserved service: the existing `1.0.77` process on port `3981` remains
  running and must not be replaced until every newer release gate passes.
- Teams registration: `teams app get e915b402-eed4-4ee2-ba1f-c31d75c870a5
  --json` currently reports registered version `1.0.76` and the q3
  `/api/messages` endpoint. The candidate ZIP has not been uploaded; no
  installed-app, desktop, or mobile evidence is credited to `1.0.85` yet.
- CI: GitHub Actions run `33202779302` passed the Core, A2A/remote,
  optional/Grok, atomic, and Docker jobs. This is CI evidence only.
- A2A: `main`, `worker-1`, and `worker-2` indexed Codex homes have no
  authenticated `auth.json`; candidate health therefore correctly reports
  `a2aExecution=unavailable`. No auth file may be copied between workers.
- Grok: the optional route and isolated test-key contract pass, but the public
  candidate has no `XAI_API_KEY`, so no live xAI round trip is claimed.

### Current gate order

1. In the existing in-app browser tab, the user completes the actual
   ChatGPT/Codex login and MFA. The orchestrator then verifies each worker
   home by metadata only and runs `check:codex-a2a-isolation`.
2. With the same candidate identity, execute authenticated A2A Agent Card,
   send/task polling, parallel children, cancellation, restart recovery, and
   telemetry checks. Keep unavailable workers unavailable if the boundary is
   not proven.
3. Use the existing Teams Admin Center/Developer Portal session to upload the
   verified `1.0.85` ZIP through the existing-app new-version path. Read back
   the registered version and package identity before UI testing.
4. Verify the public endpoint and installed app in Teams desktop with current
   accessibility trees and screenshots, then obtain separate mobile/GPS
   evidence. Do not reuse screenshots or chat records from `1.0.76`.
5. Reconcile Jira findings and send a Teams completion message only after all
   required gates pass. Until then, report `PARTIAL/BLOCKED`.

## Execution update — 2026-08-27

- Candidate implementation commit on branch `recovery/teams-core-1.0.89` is `a5057df7cb3bc7b4e1948ccfb0eeef4c3c69d50a`; package and manifest remain `1.0.76` because this run contains CI/test/control-plane changes only. The branch also contains the pre-existing product delta from `main`; the current recovery commits are not being represented as a replacement for that broader historical diff.
- Draft PR #1 is open against `main` with merge state `CLEAN`. GitHub Actions run `33062557183` passed for this exact HEAD: A2A collaboration/remote contracts, Core verification, atomic build/runtime continuity, and Docker Core runtime build plus exact-image smoke. The prior 50ms A2A deadline fixture failure in `33061805975` was stabilized in `db54ddd…` before this successful run.
- The preserved public service remains `https://q3kj3s3z-3980.jpe1.devtunnels.ms`, serving `1.0.76` from `944ae3ae2ed90841fd02df8280c895d63d63a822` with production Teams SDK health. It has not been restarted, replaced, or used as evidence for the candidate.
- Tasks 2–4 and 6 are implemented/verified, including same-digest published-image smoke wiring with runtime identity matching, a credential-free two-server authenticated A2A HTTP round-trip fixture, deterministic deadline timing, and setup cleanup. Task 5 remains pending until an approved `main` merge/tag, real deployment variables, stable host, portal update, and authenticated Teams/A2A UI evidence are available. The PR CI run does not publish an immutable release candidate by design.

## Global Constraints

- Preserve the running public `1.0.76` service and do not replace it until a newer release identity is independently proven.
- The authoritative implementation checkout for this run is `/tmp/teams-core-recovery-verify.gJCiJT`; the FileProvider-affected Documents checkout is not used for builds.
- Do not increment the app/package/manifest version for this CI control-plane or documentation change.
- Increment the version only for a reproduced user-visible bug or feature with a failing regression test, passing implementation test, and Core evidence.
- Never publish from an arbitrary branch, a pull request, or a tag that is not an ancestor of `main`.
- Never treat `HTTP 200`, a CLI presence check, a helper/card test, or a local Docker image as Teams desktop/mobile or live A2A proof.
- Do not generate a Seatbelt profile, copy the original Codex auth file, or bypass the provider-owned isolation lease.
- Use existing authenticated in-app browser tabs for later portal work; do not create or close sessions during CI work.
- Keep Jira MP-160 as the existing release-blocker record; add evidence there instead of duplicating it.

---

### Task 1: Synchronize the current execution plan

**Files:**
- Create: `docs/superpowers/plans/2026-08-27-teams-core-ci-release-recovery.md`
- Review: `docs/superpowers/plans/2026-08-11-teams-release-recovery-replan.md`

**Interfaces:**
- Consumes: current checkout `a5057df7cb3bc7b4e1948ccfb0eeef4c3c69d50a`, public health identity `1.0.76`/`944ae3a…`, PR #1, and Jira MP-160.
- Produces: a current plan that does not treat stale `1.0.42` artifacts or old screenshots as current evidence.

- [x] **Step 1: Record the current source and runtime facts.**

  The initial candidate at plan creation was `01052e8f9cbad71767f4536d9773b39f498ca2be`; the current candidate is branch `recovery/teams-core-1.0.89` at `a5057df7cb3bc7b4e1948ccfb0eeef4c3c69d50a`, with package/manifest `1.0.76`. The preserved public origin is `https://q3kj3s3z-3980.jpe1.devtunnels.ms`, currently serving source commit `944ae3ae2ed90841fd02df8280c895d63d63a822` and server bundle `c1a28900f8b9905877a15d80f491ff3bdce5b016b30b42ca6f2fa5e43da09658`.

- [x] **Step 2: Mark stale plan content as historical.**

  The older `2026-08-11` plan remains an archive of the earlier `1.0.42` run. It is not used as evidence or as the current execution source.

### Task 2: Make release-artifact creation depend on Docker runtime verification

**Files:**
- Modify: `.github/workflows/core-ci.yml:104-178`
- Test: `scripts/ci-workflow-contract-test.mjs`

**Interfaces:**
- Consumes: `core`, `a2a`, `continuity`, and `container` job conclusions.
- Produces: an immutable artifact job whose `needs` includes `container`, so a failed image build/runtime smoke cannot still emit a release package.

- [x] **Step 1: Add a failing contract assertion.**

  In `scripts/ci-workflow-contract-test.mjs`, extract the `artifact` job header and assert that its `needs` value includes `core`, `a2a`, `continuity`, and `container`.

- [x] **Step 2: Run the focused test and observe the expected failure.**

  Run `node scripts/ci-workflow-contract-test.mjs`.

  Expected result before the workflow edit: failure because the current artifact job declares only `[core, a2a, continuity]`.

- [x] **Step 3: Make the minimal workflow change.**

  Change the artifact job declaration to:

  ```yaml
    artifact:
      needs: [core, a2a, continuity, container]
  ```

- [x] **Step 4: Run the focused test and the workflow contract suite.**

  Run `node scripts/ci-workflow-contract-test.mjs` and `npm run test:docker-build-contract`.

  Expected result: both pass, with no source or application-version change.

- [x] **Step 5: Commit the isolated workflow/test change.** Commit: `a530ab3`.

  Run:

  ```bash
  git add .github/workflows/core-ci.yml scripts/ci-workflow-contract-test.mjs
  git commit -m "ci: gate release artifacts on container verification"
  ```

### Task 3: Restrict image promotion to merged-main source and persist identity

**Files:**
- Modify: `.github/workflows/publish-image.yml:1-120`
- Test: `scripts/image-publish-workflow-contract-test.mjs`

**Interfaces:**
- Consumes: `github.sha`, GitHub repository variables for the Teams manifest, the deterministic package script, the Core server marker, and the pushed image digest.
- Produces: a promotion workflow that (a) runs only for manual `main` or a `vX.Y.Z` tag on a `main` ancestor, (b) builds and packages the exact commit, and (c) uploads `dist/evidence/release-identity.json` containing `sourceCommit`, `version`, `teamsPackageSha256`, `serverBundleSha256`, `manifestSha256`, and `imageDigest`.

- [x] **Step 1: Add failing contract assertions.**

  Extend `scripts/image-publish-workflow-contract-test.mjs` to require all of the following text contracts:

  ```js
  requireText(/if:\s*\|[\s\S]*github\.event_name == 'workflow_dispatch'[\s\S]*github\.ref == 'refs\/heads\/main'/, 'manual promotion must be main-only');
  requireText(/startsWith\(github\.ref, 'refs\/tags\/v'\)/, 'tag promotion must be version-tag-only');
  requireText(/git fetch origin main/, 'tag promotion must fetch main for ancestry verification');
  requireText(/git merge-base --is-ancestor/, 'tag promotion must prove the tag commit is on main');
  requireText(/fetch-depth:\s*0/, 'promotion checkout must retain ancestry metadata');
  requireText(/npm run check:deployment/, 'promotion must require a complete deployment variable contract');
  requireText(/npm run package:app/, 'promotion must package the exact source commit');
  requireText(/teamsPackageSha256/, 'promotion evidence must bind the Teams ZIP digest');
  requireText(/serverBundleSha256/, 'promotion evidence must bind the server bundle digest');
  requireText(/manifestSha256/, 'promotion evidence must bind the manifest digest');
  requireText(/imageDigest/, 'promotion evidence must bind the pushed image digest');
  requireText(/actions\/upload-artifact@[0-9a-f]{40}/, 'promotion identity must be retained as an immutable workflow artifact');
  ```

- [x] **Step 2: Run the focused test and observe the expected failure.**

  Run `node scripts/image-publish-workflow-contract-test.mjs`.

  Expected result before the workflow edit: failure because manual runs are not restricted to `main`, tag ancestry is not checked, and package/image identity is not persisted together.

- [x] **Step 3: Add the main/tag promotion guard.**

  Keep `workflow_dispatch` and `push.tags: ['v*.*.*']`, add this job condition, and fetch/check ancestry before installing dependencies:

  ```yaml
      if: >-
        (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') ||
        (github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v'))
  ```

  For tag events, run `git fetch origin main --depth=1` and reject the run unless `git merge-base --is-ancestor "$GITHUB_SHA" origin/main` succeeds. Use `fetch-depth: 0` on checkout.

- [x] **Step 4: Generate the exact package and pre-push identity.**

  Supply the existing repository variables (`TEAMS_APP_ID`, `TEAMS_CATALOG_APP_ID`, `BOT_ID`, `BOT_CLIENT_ID`, `TENANT_ID`, `TAB_DOMAIN`, `CLIENT_ID`, and `APPLICATION_ID_URI`) to the job. Run `npm run check:deployment`, `npm run build:core`, `npm run test:core`, `npm run validate:manifest`, `npm run package:app`, and the deterministic package checks. Compute the ZIP SHA-256, read the ZIP manifest, read `dist/server/.teams-server-build-commit`, and compute the manifest SHA without printing credentials.

- [x] **Step 5: Bind the pushed digest and upload machine-readable evidence.**

  After the `docker/build-push-action` step, write the digest from `steps.push.outputs.digest` into `dist/evidence/release-identity.json`, then upload `dist/evidence` and the verified ZIP with a pinned `actions/upload-artifact` action. The JSON must contain only identity fields and hashes.

- [x] **Step 6: Run the focused test and static workflow contracts.**

  Run `node scripts/image-publish-workflow-contract-test.mjs`, `node scripts/ci-workflow-contract-test.mjs`, and `npm run test:docker-build-contract`.

- [x] **Step 7: Commit the promotion workflow/test change.** Commit: `e38fc06`.

  Run:

  ```bash
  git add .github/workflows/publish-image.yml scripts/image-publish-workflow-contract-test.mjs
  git commit -m "ci: bind image promotion to merged release identity"
  ```

- [x] **Step 8: Require a smoke of the exact pushed image before provenance recording.** Commit: `7fdfe12`.

  The promotion workflow now pulls the digest returned by the push step and runs `scripts/docker-runtime-image-smoke.mjs` before provenance recording. Public repositories run the pinned GitHub artifact attestation action; private Free/Pro/Team repositories record the documented `private-repository-plan` limitation because GitHub requires Enterprise Cloud for private-repository attestations. The script verifies production health, source commit identity, Core auth/bot mode, `/tabs/home/`, and the hashed main asset. The workflow contract requires the digest and shared script; Docker availability is still required for the actual promotion run.

- [x] **Step 9: Close CI-discovered test flakiness before promotion.** Commit: `db54ddd`.

  CI run `33061805975` failed in `a2a-deadline-cancellation-test.ts` because its 50ms deadline could expire during the first durable JSON mutation, producing Node's unsettled top-level-await exit. The regression now uses a bounded 1-second deadline with an explicit reason, and the two-server fixture closes both servers during setup and assertion failures.

- [x] **Step 10: Harden the shared image smoke identity boundary.** Commit: `f2e48cf`.

  The reusable smoke now rejects mutable image references, requires the pre-push release identity file, compares the running health `serverBundleSha256` to that identity, applies bounded Docker pull/run/log/remove timeouts, and uses `--rm`. The promotion identity step also hashes `dist/server/index.js` and validates the marker schema and digest instead of trusting an unverified field.

### Task 4: Re-run FileProvider-independent Core verification

**Files:**
- Inspect only: `package.json`, `package-lock.json`, `appPackage/manifest.json`, `.github/workflows/`, `src/server/`, `scripts/`
- Test: existing Core and release contract commands

**Interfaces:**
- Consumes: the two CI workflow commits from Tasks 2–3.
- Produces: bounded evidence that Core/A2A/continuity contracts still pass without using the Documents/FileProvider checkout.

- [x] **Step 1: Verify the tracked worktree and identity.** Candidate implementation commit `a5057df…`; the tracked worktree is clean; package and manifest both remain `1.0.76`.

  Run `git status --short --branch`, `git rev-parse HEAD`, and compare the package/manifest versions. Do not build if tracked source is dirty or FileProvider reads are unstable.

- [x] **Step 2: Run the bounded Core gate.** The standalone bundle-boundary fallback remains fixed in `d3b77e7`, image-smoke hardening is covered by focused contracts from `f2e48cf…`, and the two previously unregistered admission/process-controller security tests now run through the Core runner.

  Local bounded checks pass at current HEAD: `npm run typecheck:core`, workflow/image/docker contract tests, `npm run build:core`, `npm run test:core`, `npm run test:runtime-dist`, `npm run validate:manifest`, and `npm run test:package-determinism`. GitHub Actions run `33062557183` independently passed the Core, A2A, continuity, and Docker image-smoke jobs. The local Docker CLI is unavailable, so the actual Docker image smoke is credited only to the GitHub runner.

- [x] **Step 3: Verify A2A contract coverage separately.** Existing A2A contracts pass, and `db54ddd…` retains the local two-server HTTP fixture covering authenticated Agent Card, SendMessage/GetTask/ListTasks/CancelTask, and wrong-token rejection. This remains fixture evidence, not public live remote or Teams evidence.

  Run the existing A2A contract, lifecycle, authorization, JSON-RPC, and telemetry scripts. Treat these as contract evidence only until a public authenticated multi-agent round trip is observed.

- [x] **Step 4: Preserve the current public service.** Public health and `/tabs/home/` remain HTTP 200 on the old `1.0.76` identity; local server and tunnel processes remain alive.

  Confirm the local server PID, Dev Tunnel host PID, public `/api/health`, and `/tabs/home/` remain the preserved `1.0.76` identity. Do not restart or replace it during this CI-only work.

### Task 5: Resolve external promotion gates without guessing

**Files:**
- Update only through existing systems: GitHub PR #1, GitHub variables/secrets, approved hosting, existing in-app browser tabs, Jira MP-160.

**Interfaces:**
- Consumes: successful merged-main CI and the uploaded identity artifact.
- Produces: an immutable image deployment and an existing Teams app update tied to the same identity.

- [ ] **Step 1: Keep PR #1 Draft until the user explicitly authorizes merge.**

  Confirm all checks pass and review the diff; do not merge or mark ready automatically.

- [ ] **Step 2: Configure the approved stable host and durable storage.**

  Do not select Vercel, Fly.io, Railway, Render, or another host by inference. The host must support one persistent process/replica and durable storage for the current file-JSON contract, or the store must be migrated before scaling A2A workers.

- [ ] **Step 3: Publish only from the merged commit.**

  Use the guarded workflow, record the image digest and identity artifact, and deploy by digest. Verify `/api/health`, `/tabs/home/`, hashed assets, and the release identity before any Teams upload.

- [ ] **Step 4: Reuse the existing in-app browser update tab.**

  Update the existing app through Admin Center → existing app → new version → file upload only after a qualifying version/package change. Read back the published version and preserve the login session.

- [ ] **Step 5: Complete desktop/mobile and live A2A gates.**

  Use Computer Use for Teams desktop accessibility/screenshot evidence, then obtain current mobile screenshots from the user. For A2A, require authenticated Agent Card, SendMessage/GetTask/ListTasks/CancelTask, independent provider identities, persistence, cancellation/restart recovery, telemetry, and Teams UI evidence.

### Task 6: Keep Codex read-only execution fail-closed until its real boundary is proven

**Files:**
- Inspect: `src/server/production-agent-isolation.ts`, `src/server/agent-execution-policy.ts`, `src/server/codex-runner.ts`, `scripts/production-agent-isolation-test.ts`
- Track: Jira MP-160

**Interfaces:**
- Consumes: actual worker authentication and OS isolation evidence supplied by an approved deployment.
- Produces: either a separately reviewed provider implementation with regression/Core evidence or a measured unavailable state; never a silent security relaxation.

- [x] **Step 1: Preserve current invariants.**

  Provider-owned leases, canonical projection, denied entries, TOCTOU/symlink/hardlink checks, isolated `HOME/CODEX_HOME`, and process-tree control remain required.

- [x] **Step 2: Do not equate CLI presence/authentication with worker readiness.**

  A server-level `codex login status` does not prove that an isolated worker can authenticate or complete a bounded turn. The status surface must remain conservative until a real bounded probe is implemented.

- [x] **Step 3: If an approved provider becomes available, use TDD.** Current provider remains read-only/fail-closed; no security relaxation was made.

  Add a failing test for the exact provider command/environment invariants, verify the red result, implement the minimum provider, run the focused and Core tests, and only then consider a qualifying version bump and release.

---

## Self-review

- CI provenance: Tasks 2–4 cover job dependencies, merged-main promotion, package/image identity, Core/A2A tests, and preservation of the current service.
- Product runtime: Task 5 covers stable hosting, Admin Center update, desktop/mobile UI, and live A2A gates that CI cannot prove.
- Security: Task 6 prevents the screenshot error from being “fixed” by removing the isolation requirement or copying user credentials.
- Version policy: Tasks 1–4 are documentation/control-plane changes and do not increment `1.0.76`; a later functional change must satisfy the global release policy.
- No placeholders or guessed provider credentials are required by this plan.

## Continuation addendum — 2026-08-30

The historical checkpoints above are retained for provenance. The current
release baseline and execution state are:

- Preserved public release: `v1.0.95`, source commit
  `051b2f5b74fcbf630c0160fe5b35e8097abae91e`, ZIP asset SHA-256
  `2023b9638215a692d3b451b949dd70297f34c3178896648901e864444439594b`.
- Preserved public health currently reports `1.0.95`, the same source/server
  identity, production Teams authentication, and configured Codex A2A workers.
  Its A2A telemetry counter is still zero; this is configuration evidence, not
  live authenticated multi-agent proof.
- PR [#16](https://github.com/devdoo-teams/teams-app/pull/16) is still Draft.
  Branch `codex/fix-runtime-deps-lifecycle-20260829` is clean at
  `db9b28300ae33dab0e8992fff5d21d6ee9832e45`. The FileProvider runtime
  dependency cache/staging hardening is in `afe18aa833b90820c78cda037593994fe29ff0f4`,
  with the Core and API-free runner registrations in the same PR. GitHub run
  `33287338176` passed Core, A2A, atomic continuity, Docker Core runtime, and
  optional/Grok checks; its immutable-release job was skipped because it was a
  pull-request event.
- Jira `MP-13` is the confirmed issue for the external runtime-dependency
  closure. Evidence was added there; it remains open because same-release
  portal, installed, desktop/mobile, and live A2A evidence are not complete.
- `teams status` reports the Teams account logged in but TDP token unavailable.
  Computer Use currently lists no Teams desktop application, so portal upload
  and desktop UI verification remain blocked. Existing browser/session state
  must be reused if it becomes visible; do not create a replacement login
  session.

The next execution order is therefore: preserve `v1.0.95`; obtain the existing
Teams update-tab/TDP authorization without handling credentials; only after a
qualifying user-visible or reproduced-bug change passes the functional and
Core gates, create a new package and bind its commit, ZIP SHA, public runtime,
portal, installed, desktop, and mobile evidence. Do not close the Jira issue or
send a Teams completion message from CI/health/card evidence alone.

## Current execution addendum — 2026-08-31

The 2026-08-30 block above is historical. The functional implementation
baseline for this continuation is commit
`d7ac22fe7b21d024395da1753faeb5b676b2bec7`; the clean worktree branch
`codex/agent-ledger-20260830` also contains the documentation-only current
state addendum commits below. The original
`/Users/doosansmacbookpro/Documents/TeamsApp` checkout remains dirty user work
and was not modified, cleaned, or used as release source.

- Functional changes include scoped/redacted agent lifecycle event persistence,
  legacy A2A startup isolation, configured remote identity/endpoint pinning,
  standard Agent Card compatibility, and immutable external-container
  readiness/rollback gates.
- The package, lockfile, and Teams manifest are synchronized at `1.0.101`.
  The candidate ZIP is generated only after the functional change and its
  regression/Core evidence; its SHA-256 is
  `d1a9c92cbe52de24c6cbd9430fa67923a48e0762bcb4fbc90921ee8520144718`.
- `release:preflight` and `release:package` are READY for the Core profile.
  The local candidate identity includes server bundle SHA-256
  `40eedfb2c46aa600ba0248629140b9db22e75dbe30e92f23bd3f99c1506d0e61`,
  client asset SHA-256
  `929e7f80e16ac7ae2c718d8ba8c8529a307644f102e479d3953d27bae997d625`,
  and packaged manifest SHA-256
  `8205e4baeccbb86874b8c3c9b369224aaa1f8f8ef5e164891958dc3fd62b49d5`.
- PR [#17](https://github.com/devdoo-teams/teams-app/pull/17) remains Draft.
  PR CI run `33319097244` passed Core, A2A, Optional/Grok contract, atomic
  continuity, and Docker runtime jobs. The immutable release candidate is
  intentionally skipped for pull-request events.
- The preserved q3 public host is not replaced. Read-only public verification
  reports `1.0.100`, source `fbddeaa299d88d2e80ce75b9ca39bfcefa6bc515`,
  `genAI=not-configured`, and `a2aExecution.state=unavailable`; comparing it
  with the `1.0.101` candidate correctly fails the public identity gate.
- The official hosting research is bounded, not a literal inventory of every
  provider. It covers Cloudflare Workers/Containers/Tunnel/D1/R2/Queues,
  Cloud Run, Azure Container Apps/Files, Render, Railway, Koyeb, Fly.io,
  Oracle Always Free VM, Deno, Vercel, Netlify, Lambda, DigitalOcean,
  Northflank, Zeabur, IBM Code Engine, App Engine, Azure App Service/Static
  Web Apps, Hugging Face, and Supabase. The detailed record is
  `docs/research/2026-08-30-external-hosting-free-tier-audit.md`.
- Current recommendation remains Azure Container Apps + Azure Files as the
  primary external target, with Cloud Run as the alternative. Cloudflare is a
  possible future edge-native redesign, not a free drop-in host for the
  current Express/file-JSON/Codex-worker architecture.
- Jira evidence was appended to existing MP-93 comment `10428` and MP-160
  comment `10427`; no duplicate issue was created. Both remain open pending
  live A2A and same-release external/Teams evidence.

Remaining gates are unchanged: approved production cloud resource/OIDC
configuration, merged-main immutable publish, stable public runtime, Portal
and installed package read-back, Teams desktop/mobile evidence, and live
authenticated A2A/Grok verification. No Teams completion message is justified
until those gates pass.

## Verification checkpoint — 2026-08-31

The exact current HEAD `42eb00fa7b65b2ff17f796e4c1d134f3323f87d8` was rechecked
in the clean implementation worktree after the hosting audit:

- `npm run typecheck:core`, `npm run test:core`,
  `npm run test:external-container-workflow`,
  `npm run test:ci-workflow-contract`,
  `npm run test:image-publish-workflow-contract`, and
  `npm run test:docker-runtime-contract` passed.
- PR [#17](https://github.com/devdoo-teams/teams-app/pull/17) remains Draft.
  The exact-head PR run is
  [33319928376](https://github.com/devdoo-teams/teams-app/actions/runs/33319928376);
  Core, A2A, optional/Grok contract, continuity, and Docker jobs passed, while
  the immutable release job was skipped because the event was a pull request.
- Historical external workflow failures on earlier commits were retained as
  evidence; they do not prove a failure of the current HEAD. No current-main
  external publish run exists.
- The preserved public host still reports `1.0.100`; the locally packaged
  candidate is `1.0.101`. `release:public` therefore fails closed on identity
  mismatch, and the existing service was not restarted or replaced.
- The hosting audit remains bounded official-document research, not a literal
  inventory of every Internet provider. Cloudflare Free is not a drop-in host
  for the current Express/Codex-worker process; Azure Container Apps + Azure
  Files remains the primary candidate and Cloud Run the alternative.
