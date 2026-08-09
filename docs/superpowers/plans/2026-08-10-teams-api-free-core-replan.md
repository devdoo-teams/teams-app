# API-Free Teams Core Incremental Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a Teams-first work hub whose first usable release needs no OpenAI API, CopilotKit runtime, MCP host, or model endpoint, then add one independently verified vertical slice at a time.

**Architecture:** The Core profile is a TypeScript/React personal tab plus a TypeScript Teams SDK bot. The server uses deterministic handlers, file-backed scoped stores, Adaptive Card 1.2-compatible bot messages, and explicitly probed CLI adapters for Codex and GitHub Copilot CLI. Optional model/MCP/CopilotKit code is isolated behind a separate build and never decides Core health or completion.

**Tech Stack:** TypeScript 5.9, React 19, Express 5, `@microsoft/teams-js`, `@microsoft/teams.apps`, `@microsoft/teams.cards`, Adaptive Cards 1.2 subset, Node child processes, JSON stores, Git, Dev Tunnels.

## Global Constraints

- The authoritative source is `/Users/doosansmacbookpro/Documents/TeamsApp`; never use iCloud, `/tmp`, a clone, or an assumed remote repository as source.
- `npm run build:core`, `npm run test:core`, and the default release gate must not require an API key, model endpoint, MCP host, or CopilotKit initialization.
- `npm test` is the API-free suite (`npm run test:api-free`); optional provider and CopilotKit runtime probes are explicit commands only.
- The official GHCP executable is `copilot`; `copilot --help` is not authentication proof and health probes must never start `copilot login`.
- `gh copilot` is accepted only when explicitly configured as a legacy compatibility command; it is not the default.
- Bot cards target the Teams mobile Adaptive Card 1.2 subset. Complex UI belongs in a web tab, not an MCP iframe or Adaptive Card tab.
- Every slice must use the existing in-app-browser tabs, create a new ZIP, commit source changes, switch from local bypass/outbox to public Teams SDK runtime, and verify the installed release before completion.
- Every visible control and branch needs a current-release before/after screenshot, fresh accessibility evidence, and independent server/runtime evidence. A DOM-only observation is not a pass.
- If a screenshot capture times out, record `SCREENSHOT_CDP_TIMEOUT` and keep the row blocked; do not reuse an older screenshot or open a replacement tab.
- Teams mobile confirmation is separate from desktop proof. No mobile-ready or completion message is allowed without current mobile evidence or an explicit `MOBILE_UNVERIFIED` blocker.

## Current Review Decisions

The existing source already contains deterministic handlers, React/TeamsJS bootstrap, scoped work-item stores, location/weather code, Codex approval boundaries, and optional provider flags. The current review found three corrections that guide implementation:

1. Failed WorkItemPanel comment mutations retain their input for retry; busy leases cover overlapping mutations.
2. The verification matrix is stale (`1.0.22` while source is `1.0.24`) and lacks WorkItemPanel and CollaborationPanel rows.
3. The old GHCP probe used `gh copilot --help` as the default and could falsely report availability. It now defaults to `copilot --help` and keeps login `unknown` until a safe real execution proves access.
4. A full test run previously entered the CopilotKit item-seeding probe and stalled/failed while the Core build had the optional route disabled. The default suite now stops at the API-free boundary; the probe is manual and cannot block Core.

## Task 1: Freeze and test the Core profile

**Files:** `src/client/App.tsx`, `src/server/index.ts`, `scripts/core-optional-boundary-test.mjs`, `scripts/core-runtime-smoke.mjs`

**Interfaces:** Core health exposes measured Teams/Entra/Bot/storage/CLI facts and does not advertise optional providers as usable. Core build exports the personal tab and bot without loading the optional CopilotKit/MCP graph.

- [ ] Step 1: Add a failing assertion that a Core build does not render an OpenAI/local provider control, does not call an optional runtime route during bootstrap, and does not ship optional provider chunks in the Core artifact.
- [ ] Step 2: Implement the smallest Core surface: deterministic status, tab link, work-list shell, and CLI capability facts. Keep optional response modes behind `TEAMS_OPTIONAL_RUNTIME=true`.
- [ ] Step 3: Run `npm test`, `npm run test:core-boundary`, `npm run test:core`, and `npm run build:core` and require exit code 0 with no API key or MCP connection.
- [ ] Step 4: Commit with `git add src/client/App.tsx src/server/index.ts scripts/core-optional-boundary-test.mjs scripts/core-runtime-smoke.mjs && git commit -m "refactor: make Teams core independent of optional providers"`.

## Task 2: Correct CLI capability detection

**Files:** `src/server/codex-capability.ts`, `scripts/status-card-test.ts`, `docs/api-free-teams-roadmap.md`

**Interfaces:** `probeCliCapabilities()` defaults to `codex` and `copilot`. Official `copilot` help returns executable `present` and login `unknown` unless a real safe execution proves access. Explicit `gh copilot` retains a compatibility probe using `gh auth status`.

- [x] Step 1: Add the failing test for `copilot --help` and the no-false-positive login state.
- [x] Step 2: Run `npm run test:status-card` and observe the old default probe fail.
- [x] Step 3: Implement the smallest probe correction without starting a browser/device login.
- [x] Step 4: Run `npm run test:status-card && npm run test:core`.
- [x] Step 5: Commit with `git add src/server/codex-capability.ts scripts/status-card-test.ts docs/api-free-teams-roadmap.md && git commit -m "fix: measure official GitHub Copilot CLI safely"`.

## Task 3: Ship one deterministic `status` card

**Files:** `src/server/genui-response.ts`, `src/server/genui-teams.ts`, `scripts/status-card-test.ts`, `scripts/genui-contract-test.ts`

**Interfaces:** `status` produces one attachment-only Adaptive Card with measured Core facts and one `Action.OpenUrl` tab link. The same summary is not duplicated in top-level activity text.

- [ ] Step 1: Add a failing assertion for the mobile-safe version, tab link, and attachment-only activity.
- [ ] Step 2: Build the smallest card using `@microsoft/teams.cards` or the equivalent typed Teams SDK builder while retaining a JSON 1.2-compatible payload.
- [ ] Step 3: Run `npm run test:status-card && npm run test:genui-contract` and a local `/api/messages` round trip.
- [ ] Step 4: Package and verify one public Teams release before adding another command.

## Task 4: Add `help`, then read-only `list`

**Files:** `src/server/index.ts`, `src/server/genui-response.ts`, `scripts/runtime-test.mjs`, `scripts/genui-contract-test.ts`

**Interfaces:** `help` returns the command list and a tab link. `list` reads the scoped JSON store and distinguishes empty, populated, and store-error states. Each card button maps to a real server action.

- [ ] Step 1: Add failing runtime assertions for empty list, populated list, invalid command, and card button action.
- [ ] Step 2: Implement only those deterministic handlers.
- [ ] Step 3: Run the focused runtime test and prove the attachment and server result independently.
- [ ] Step 4: Release and record one matrix row per command and card button.

## Task 5: Build the React tab read-only shell

**Files:** `src/client/main.tsx`, `src/client/App.tsx`, `scripts/client-bootstrap-test.ts`, `scripts/client-refresh-recovery-test.ts`

**Interfaces:** Teams host initialization, loading, timeout recovery, authenticated status, empty list, error, retry, and refresh are separate states. The tab is a web tab using `contentUrl` and TeamsJS initialization; it is not an Adaptive Card tab or MCP iframe.

- [ ] Step 1: Add failing tests for each bootstrap state and stale response suppression.
- [ ] Step 2: Implement the smallest state machine and render only verified controls.
- [ ] Step 3: Run client tests and `npm run build:core`.
- [ ] Step 4: Capture current-release desktop before/after screenshots and accessibility trees for every state available in the host.

## Task 6: Add one work-item mutation at a time

**Files:** `src/client/WorkItemPanel.tsx`, `src/server/work-item-service.ts`, `scripts/client-item-mutation-test.ts`, `scripts/client-work-item-load-test.ts`, `scripts/work-item-parity-test.ts`

**Order:** create → toggle → title/description edit → assign/watch → comment.

- [ ] Step 1: Add a failing test for one selected mutation’s success, server error, duplicate click, retry, and persisted refresh state.
- [ ] Step 2: Implement one mutation with an idempotency key and server-owned scope.
- [ ] Step 3: Run focused tests and one public runtime check for that mutation only.
- [ ] Step 4: Capture the tab control before and after, then commit before starting the next mutation.

## Task 7: Add the Codex CLI workflow

**Files:** `src/server/codex-runner.ts`, `src/server/agent-service.ts`, `src/server/agent-job-store.ts`, `scripts/codex-runner-security-test.ts`, `scripts/agent-transitions-test.ts`, `scripts/runtime-test.mjs`

**Interfaces:** `run` starts real read-only `codex exec` only when `codex login status` is authenticated. A job is completed only after a non-empty `agent_message`; missing final output is failed. Write requires an approval card, and cancel leaves no running process.

- [ ] Step 1: Add failing tests for unavailable CLI, queued/running, no-final-message, approval, cancel, and restart recovery.
- [ ] Step 2: Implement the smallest read-only path and verify PID, events, thread ID, and final result.
- [ ] Step 3: Add write approval and commit as separate slices.
- [ ] Step 4: Capture every state in public Teams chat and tab, then commit.

## Task 8: Add GHCP CLI only after its real contract is proven

**Files:** Create `src/server/ghcp-runner.ts`; modify `src/server/codex-capability.ts`, `src/server/agent-service.ts`; test `scripts/ghcp-runner-test.ts` and `scripts/status-card-test.ts`

**Interfaces:** The adapter invokes the installed official `copilot` CLI through a bounded subprocess and records its actual command result. It never treats `gh auth status`, `copilot --help`, or a stored flag as proof that a Copilot request will succeed. Missing subscription, policy denial, login, timeout, and non-zero exit are explicit failures and never become Codex success.

- [ ] Step 1: Add a fake-executable contract test for final result, non-zero failure, timeout, and cancellation.
- [ ] Step 2: Run the test and observe failure because no GHCP runner exists.
- [ ] Step 3: Implement the bounded runner with no token logging and no automatic login.
- [ ] Step 4: If the real CLI is installed and the user has confirmed login, run one read-only task in the original workspace; otherwise mark this slice `N/A` without blocking Core.

## Task 9: Add location/weather after Core converges

**Files:** `src/client/location.ts`, `src/client/App.tsx`, `src/server/weather-service.ts`, `scripts/client-location-test.ts`, `scripts/weather-service-test.ts`

- [ ] Step 1: Add failing tests for allow, deny, cancel, timeout, unsupported provider, invalid coordinates, network failure, and retry.
- [ ] Step 2: Implement Teams native location → browser geolocation fallback with no coordinate guessing.
- [ ] Step 3: Verify desktop separately from iOS/Android; keep `MOBILE_UNVERIFIED` until actual mobile evidence exists.

## Task 10: Make evidence and release gates truthful

**Files:** `scripts/release-loop.mjs`, `scripts/release-gate.mjs`, `scripts/teams-ui-matrix-validate.mjs`, `docs/teams-ui-verification-matrix.md`, `docs/teams-release-workflow.md`, `scripts/release-loop-test.mjs`, `scripts/release-gate-test.mjs`

**Interfaces:** Evidence can be registered incrementally per surface (`portal`, `installed`, `desktop`, `mobile`) without requiring every surface to pass before the first one is recorded. Every record carries capture/run/row identity, app version, source commit, ZIP SHA, tab/window identity, screenshot SHA, AX SHA, and runtime event IDs. CDP timeout is `SCREENSHOT_CDP_TIMEOUT`, never a pass.

- [ ] Step 1: Add failing tests for incremental surface evidence, stale matrix identity, capture mismatch, and screenshot timeout.
- [ ] Step 2: Implement strict row-to-capture validation and current-release identity checks.
- [ ] Step 3: Rebuild the matrix from current Core surfaces; move optional CopilotKit/OpenAI/MCP rows to an optional appendix.
- [ ] Step 4: Run `npm run release:preflight`, `npm run release:package`, and `npm run release:public` with exact SHA capture.
- [ ] Step 5: Reuse existing Developer Portal, admin, chat, and tab browser tabs; verify installed version, then capture desktop and user-confirmed mobile evidence.
- [ ] Step 6: Send a Teams completion message only after required Core rows pass or have evidence-backed `N/A` decisions.

## Self-review and decision gate

This plan intentionally does not add CopilotKit, OpenAI, local-model, MCP Apps, Jira, Trello, or another messenger to the Core product. MCP Apps is a future adapter only when a concrete compliant host and server contract are available. The first implementation gate is the deterministic status/list/card/tab path, followed by one mutation and one real CLI workflow at a time.

At this review point, “optional” means both runtime-disabled and release-gate-excluded. The remaining physical bundle task is still open because esbuild currently leaves optional dynamic chunks in the Core output even though the Core process does not load them. That is an artifact hygiene issue, not evidence that an API-backed feature is required; it must be resolved or explicitly recorded before calling the Core package minimal.

## Review checkpoint: 2026-08-10

- `npm test` now runs `npm run test:api-free`; it passed without an API key, model endpoint, MCP host, or CopilotKit initialization.
- The test isolation fix assigns all six JSON store paths to temporary directories in runtime-spawning tests, so the already-running local server on port 3978 is not stopped or used as a shared lease.
- The official GHCP probe correction passed: `copilot --help` identifies the executable, while login remains `unknown` until a real, user-authorized CLI execution is proven. No browser/device login is started automatically.
- The Core build is runtime-safe but not yet physically minimal: the build log still contains `CopilotWorkspaceAssistant`, `copilot-agent`, `mcp-genui`, and `copilot-channels-shadow` chunks. The next implementation slice must remove those chunks from `build:core` or produce a separately audited Core artifact before package upload.
- No Teams portal upload, public release, desktop screenshot, mobile screenshot, or completion notification is claimed from this checkpoint. Those remain release-gate work after the Core artifact is minimal and the current-release evidence matrix is rebuilt.
- Jira Cloud tracking is now an operations lane only. It may record Core blockers and release evidence before the first external-platform product expansion, but the Teams app must not call Jira or require Jira authentication at runtime. Live Jira writes wait for verified site/project key/workflow details from the existing signed-in Jira tab.

No external-platform work starts until the Teams Core matrix has no unverified Core rows and the user has confirmed the installed Teams mobile behavior.
