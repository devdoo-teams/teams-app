# Teams End-to-End Orchestrator Audit and Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a release-identity-bound audit that verifies every implemented Teams surface, control, and user-visible branch with runtime evidence, screenshots, and accessibility state before completion.

**Architecture:** Keep the local TeamsApp checkout as the only source of truth. Separate code/runtime verification from external Teams UI evidence, and bind every result to one run ID, commit, package version, and ZIP SHA. Parallel agents audit disjoint domains; the orchestrator integrates their reports, rejects stale or indirect evidence, and only then updates the release workflow.

**Tech Stack:** TypeScript, React, Express, Teams SDK, Adaptive Cards, Node.js scripts, Git, existing in-app browser, macOS Computer Use (`@oai/sky`).

## Global Constraints

- Core must work without OpenAI API, CopilotKit, MCP, or local-model credentials.
- `/Users/doosansmacbookpro/Documents/TeamsApp` is the original source and the only Git history.
- Existing in-app browser tabs must be reused; no new tab or login session is created by default.
- Every implemented UI branch needs before/after screenshot, latest accessibility tree, and runtime result.
- A release is not complete until portal, installed version, desktop Teams, and mobile Teams evidence refer to the same release identity.
- Existing untracked user files are preserved and never deleted or uploaded implicitly.

---

### Task 1: Establish the authoritative baseline

**Files:**
- Read: `.release/current.json`, `package.json`, `appPackage/manifest.json`, `docs/teams-ui-verification-matrix.md`
- Read: `AGENTS.md`, running-process table, public `/api/health` and `/tabs/home/`
- Record: `docs/superpowers/evidence/2026-08-11-baseline.md`

- [x] Capture current branch, HEAD, package version, manifest version, ZIP SHA, release run ID, process PIDs, tunnel ID, and source file materialization flags.
- [x] Mark every identity mismatch and every missing portal/installed/desktop/mobile evidence as `BLOCKED`, not as a pass.
- [ ] Commit the baseline record without changing user-owned untracked files.

### Task 2: Audit core runtime and response contracts

**Files:**
- Read: `src/server/index.ts`, `src/server/agent-service.ts`, `src/server/work-item-service.ts`, `src/server/genui-teams.ts`
- Read: `src/client/App.tsx`, `src/client/WorkItemPanel.tsx`, `src/client/TodaySummary.tsx`
- Test: existing `scripts/*test*.ts`, `scripts/core-runtime-smoke.mjs`
- Record: `docs/superpowers/evidence/2026-08-11-core-runtime-audit.md`

- [x] Enumerate each command, API route, card attachment, tab route, and mutation.
- [x] For each, classify success, empty, invalid input, permission/auth failure, retry, approval, cancel, duplicate submission, and boundary behavior as `PASS`, `FAIL`, `BLOCKED`, or `N/A` with evidence.
- [x] Verify that bot responses do real mutations or real Codex job calls rather than returning stored/demo text.

### Task 3: Audit Teams UI surfaces and screenshot coverage

**Files:**
- Read: `src/client/App.tsx`, `src/client/styles.css`, `src/client/WorkItemPanel.tsx`, `src/client/TodaySummary.tsx`, `src/client/CopilotWorkspaceAssistant.tsx`
- Read: `docs/teams-ui-verification-matrix.md`, `docs/teams-desktop-runtime-verification.md`
- Record: `docs/superpowers/evidence/2026-08-11-ui-coverage-audit.md`

- [x] Build a location-by-location inventory for chat, Adaptive Cards, tab navigation, work-item controls, weather/location controls, response-mode controls, and GenUI surfaces.
- [x] Identify controls present in code but absent from the active mobile/desktop route, and controls visible but not wired to a server mutation.
- [x] Mark desktop-only evidence and iOS-only behavior separately; never infer mobile success from desktop or old screenshots.

### Task 4: Audit release, packaging, process, and source-I/O gates

**Files:**
- Read: `scripts/build-server.mjs`, `scripts/core-source-check.mjs`, `scripts/core-test-runner.mjs`, `scripts/release-loop.mjs`, `scripts/package-app.mjs`
- Read: `scripts/process-lease.ts`, `scripts/fileprovider-runtime-deps.mjs`, `docs/teams-release-workflow.md`
- Record: `docs/superpowers/evidence/2026-08-11-release-gate-audit.md`

- [x] Reproduce each timeout, stale-process, dataless-source, package-identity, and evidence-gate failure with bounded commands.
- [x] Verify whether a failed child process can survive its parent and whether a second server/tunnel can be mistaken for the active run.
- [x] Verify that release status cannot become ready when package, public, installed, desktop, or mobile evidence is missing or stale.

### Task 5: Perform existing-surface runtime verification

**Files:**
- Use: existing in-app browser tabs only
- Use: Teams desktop app through Computer Use only if the app is unlocked and already authenticated
- Record: `docs/superpowers/evidence/2026-08-11-runtime-ui-evidence/` and matrix updates

- [x] Inspect the current focused tab and existing Teams tabs without opening or closing tabs.
- [x] For each reachable surface, capture a pre-action screenshot and accessibility tree, perform one action with a freshly resolved control index, then capture post-action screenshot/tree and response.
- [x] If authentication, file selection, desktop unlock, or mobile GPS is unavailable, record the exact blocker and do not substitute an API-only pass.

### Task 6: Integrate findings into enforced workflow

**Files:**
- Modify only after Tasks 1–5: `AGENTS.md`, `docs/teams-release-workflow.md`, relevant release/matrix validators
- Test: release-loop and matrix validator regression tests

- [x] Convert each confirmed recurrence into a machine-checkable gate or an explicit blocker state.
- [ ] Add run identity, process ownership, evidence freshness, and per-branch screenshot requirements to the release record.
- [ ] Keep Core and optional provider paths separate and preserve the original-source/no-remote constraint.
- [ ] Run the full relevant test set, review the diff, commit each coherent change, and report unverified external evidence explicitly.

### Completion audit

- [ ] Every implemented feature and every user-visible branch has a matrix row with a non-empty result.
- [ ] Every `PASS` has same-release screenshot, accessibility, and runtime evidence.
- [ ] All four release evidence classes are present: portal, installed, desktop, mobile.
- [ ] Current HEAD, package manifest, ZIP, public runtime, and evidence all share one release identity.
- [ ] No completion message is sent to Teams until the user confirms the deployed app behavior.
