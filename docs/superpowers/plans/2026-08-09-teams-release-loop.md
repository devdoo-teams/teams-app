# Teams Release Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing command-first gate and manual Teams UI checks into one resumable release loop that cannot emit a completion result before every required external proof is present.

**Architecture:** `scripts/release-loop.mjs` owns a redacted state file under `.release/`, pure state/evidence validation helpers, and a CLI that invokes the existing `release-gate.mjs` for machine phases. UI evidence is supplied explicitly by the orchestrator or user and is accepted only when its commit, app version, package SHA, timestamp, and artifact paths match the active run. The loop never controls authentication, unlocks macOS, uploads through guessed credentials, or sends a Teams completion message without a completed state.

**Tech Stack:** Node.js 24 ESM, native `fs`, `crypto`, `child_process`, existing `release-gate.mjs`, npm scripts, Markdown.

## Global Constraints

- Keep public server PID and Dev Tunnel alive; terminate only child groups created by a bounded gate.
- Never store or print tokens, passwords, API keys, bearer values, client secrets, or raw Teams message bodies.
- Never treat API tests, local Activities, Teams web catalog version, or command output as mobile proof.
- Require a clean Git worktree and current commit before `start`, `package`, and `complete`.
- Record UI evidence only when the supplied artifact exists and the evidence identity matches the active package.
- Commit implementation and workflow changes in meaningful Git commits before running upload/UI gates.

### Task 1: Add the state/evidence contract tests first

**Files:**
- Create: `scripts/release-loop-test.mjs`
- Create: `scripts/release-loop.mjs`

**Interfaces:**
- `createInitialState({ runId, commit, shortCommit, version, startedAt })`
- `deriveStatus(state)`
- `validateEvidence(evidence, state, { fileExists })`
- `applyEvidence(state, evidence)`
- `missingGates(state)`
- `completionMessage(state)`

- [ ] **Step 1: Write RED tests for initial state and ordered status.**

  Assert that a fresh state is `INIT`, adding machine/package/public results advances it in order, and a machine failure does not advance status.

- [ ] **Step 2: Run the focused test and verify the expected missing-export failure.**

  Run: `node scripts/release-loop-test.mjs`

  Expected: FAIL because `scripts/release-loop.mjs` does not yet export the contract helpers.

- [ ] **Step 3: Add RED tests for evidence identity and safety.**

  Cover wrong commit, wrong version, wrong package SHA, missing artifact, invalid surface, future timestamp, secret-like summary, and missing desktop/mobile evidence.

- [ ] **Step 4: Run the focused test and verify the same intentional RED failure.**

  Run: `node scripts/release-loop-test.mjs`

  Expected: FAIL on the unimplemented validation helpers, not on a test syntax error.

### Task 2: Implement pure state/evidence helpers

**Files:**
- Modify: `scripts/release-loop.mjs`
- Modify: `scripts/release-loop-test.mjs`

**Interfaces:**
- Surface values are exactly `portal`, `installed`, `desktop`, and `mobile`.
- `validateEvidence` returns a normalized redacted evidence record or throws a named validation error.
- `applyEvidence` replaces the surface record and derives the next state without allowing an out-of-order surface.

- [ ] **Step 1: Implement the minimal initial state and status derivation.**

  Use the ordered machine/package/public milestones followed by portal, installed, desktop, and mobile evidence. Keep `COMPLETE` reserved for the explicit completion command.

- [ ] **Step 2: Run the focused test and verify GREEN for state transitions.**

  Run: `node scripts/release-loop-test.mjs`

  Expected: state transition assertions pass while evidence validation assertions remain RED.

- [ ] **Step 3: Implement strict evidence validation and redaction.**

  Require ISO timestamp not later than the current clock, exact commit/version/SHA matches, non-empty safe summary, absolute existing artifact paths, and at least one artifact for every surface. Reject secret-like patterns and never retain arbitrary input fields.

- [ ] **Step 4: Run the focused test and verify GREEN.**

  Run: `node scripts/release-loop-test.mjs`

  Expected: `Release loop contract tests passed.`

- [ ] **Step 5: Commit the pure contract.**

  ```bash
  git add scripts/release-loop.mjs scripts/release-loop-test.mjs
  git commit -m "feat: add release loop state contract"
  ```

### Task 3: Add the resumable CLI and machine phase adapter

**Files:**
- Modify: `scripts/release-loop.mjs`
- Modify: `scripts/release-loop-test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- CLI: `node scripts/release-loop.mjs <start|machine|package|public|status|evidence|complete> [--file path]`
- State path defaults to `.release/current.json`; tests may set `RELEASE_LOOP_STATE_PATH` to a temporary path.
- Machine phases invoke `node scripts/release-gate.mjs <phase>` with bounded process cleanup and persist only summarized JSON evidence.

- [ ] **Step 1: Add failing CLI tests for state persistence and blocked completion.**

  Use a temporary state path and fixture state. Assert `status` reports missing gates, `complete` exits non-zero with `BLOCKED`, and a failed phase leaves the previous successful state intact.

- [ ] **Step 2: Run the CLI-focused tests and verify RED.**

  Run: `node scripts/release-loop-test.mjs`

  Expected: FAIL because the CLI handlers and persistence are absent.

- [ ] **Step 3: Implement atomic state persistence and Git snapshot checks.**

  `start` creates a run only from a clean worktree; `machine`, `package`, and `public` invoke the existing gate and persist success only after a zero exit code and `status=READY`; state writes use a temporary file and rename.

- [ ] **Step 4: Implement `status`, `evidence`, and `complete`.**

  `status` prints the next required gate. `evidence` reads one JSON file and applies the validated record. `complete` rechecks the current commit/worktree, requires all four UI surfaces, writes `COMPLETED`, and prints a redacted Teams-ready report without sending it.

- [ ] **Step 5: Add npm entry points and ignore transient state.**

  Add:

  ```json
  "release:loop": "node scripts/release-loop.mjs",
  "test:release-loop": "node scripts/release-loop-test.mjs"
  ```

  Add `.release/` to `.gitignore`.

- [ ] **Step 6: Run contract and CLI tests and verify GREEN.**

  Run: `npm run test:release-loop`

  Expected: all state, identity, safety, persistence, and blocked-completion checks pass.

- [ ] **Step 7: Commit the CLI.**

  ```bash
  git add scripts/release-loop.mjs scripts/release-loop-test.mjs package.json .gitignore
  git commit -m "feat: orchestrate Teams release loop"
  ```

### Task 4: Make the project workflow use the loop

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/teams-release-workflow.md`
- Modify: `docs/remote-codex-troubleshooting.md`
- Modify: `docs/teams-desktop-runtime-verification.md`

- [ ] **Step 1: Document the single-loop command sequence.**

  Require `start → machine → package → public → portal/installed evidence → desktop evidence → mobile evidence → complete`, with explicit resume behavior and no UI evidence fabrication.

- [ ] **Step 2: Document evidence file examples and gate meanings.**

  Include a safe JSON example with commit/version/SHA/artifact paths and state that the raw Teams message is never saved by the loop.

- [ ] **Step 3: Document failure recovery.**

  Explain how to resume a failed machine phase, how stale installed versions invalidate later evidence, and how to keep existing browser tabs and public processes.

- [ ] **Step 4: Run documentation consistency checks.**

  Run: `rg -n "release:loop|PORTAL_READY|INSTALLED_READY|DESKTOP_READY|MOBILE_READY|complete|잠금|Auth" AGENTS.md docs`

- [ ] **Step 5: Commit the workflow update.**

  ```bash
  git add AGENTS.md docs/teams-release-workflow.md docs/remote-codex-troubleshooting.md docs/teams-desktop-runtime-verification.md
  git commit -m "docs: enforce one Teams release loop"
  ```

### Task 5: Verify the loop against the current project

**Files:**
- Modify: none unless a verification defect is found

- [ ] **Step 1: Run focused tests and typecheck.**

  Run: `npm run test:release-loop && npm run test:release-gate && npm run typecheck`.

- [ ] **Step 2: Start a real loop from the clean committed source.**

  Run: `npm run release:loop -- start`, then `machine`, `package`, and `public`. Confirm the active state records the current commit, version `1.0.12`, package SHA, and production health without secrets.

- [ ] **Step 3: Run the existing full bounded preflight.**

  Run: `npm run release:preflight`.

  Expected: READY or a reproducible BLOCKED result; do not claim completion from a partial command.

- [ ] **Step 4: Verify the public server remains healthy after the loop.**

  Run: `npm run release:public` and confirm the existing server process and Dev Tunnel are still present.

- [ ] **Step 5: Verify blocked completion from the real state.**

  Run: `npm run release:loop -- complete` before UI evidence is available.

  Expected: non-zero `BLOCKED` with the missing UI gates and no Teams message sent.

- [ ] **Step 6: Review Git and commit verification evidence.**

  Run: `git status --short --branch` and `git log -5 --oneline`. Keep the worktree clean.

### Task 6: External UI handoff and final completion gate

**Files:**
- Modify: none

- [ ] **Step 1: Reuse existing logged-in browser tabs.**

  Confirm Developer Portal, Teams Admin Center existing-app detail, public Teams tab, and Teams chat. If reauthentication or unlock is required, hand it to the user without creating a login loop.

- [ ] **Step 2: Upload and register portal evidence.**

  Upload the exact ZIP recorded by the loop through the existing app's `새 버전 → 파일 업로드` path, then register a `portal` evidence file with the observed version and screenshot path.

- [ ] **Step 3: Confirm installed version and register evidence.**

  Verify the installed Teams app reports the same package version and register `installed` evidence. A catalog-only version is insufficient.

- [ ] **Step 4: Run desktop verification.**

  Use the existing Teams desktop window, latest accessibility tree, screenshot, actual `help/status/list` messages, card de-duplication, tab UI, and changed feature. Register `desktop` evidence.

- [ ] **Step 5: Have the user verify the deployed mobile app.**

  Ask the user to send the changed-feature command from the installed mobile app and observe the reply/screenshot. Register `mobile` evidence only from that deployed app interaction.

- [ ] **Step 6: Run `complete` and send the Teams completion message.**

  Run: `npm run release:loop -- complete`.

  Only after it returns READY may the orchestrator send the generated redacted report to Teams. If any UI surface is unavailable, leave the run active and report the exact gate.
