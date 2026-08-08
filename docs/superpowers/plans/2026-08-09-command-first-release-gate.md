# Command-First Teams Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, command-first release gate and update the Teams workflow so macOS lock blocks only UI evidence, not repeatable package and runtime checks.

**Architecture:** A dependency-free Node script owns command execution, timeout/process-group cleanup, ZIP manifest inspection, and public health validation. Existing package and test scripts remain the source of truth; the new gate composes them and emits structured evidence. Documentation maps each release step to CLI, browser, Computer Use, or mobile UI.

**Tech Stack:** Node.js 24, npm scripts, `child_process`, native `fetch`, `zip`/`unzip`, Markdown, existing TypeScript/Teams test suite.

## Global Constraints

- Never bypass macOS lock, passwords, Authenticator approval, browser security warnings, or Teams policy controls.
- Never print credentials, tokens, API keys, or environment values that are not required evidence.
- Terminate only child process groups created by the release gate; never terminate the public Teams server.
- Keep Teams Admin Center/Developer Portal upload, installed-version consent, native desktop screenshots, and iPhone GPS as explicit UI gates.
- Preserve the existing Git branch and commit every meaningful change.

---

### Task 1: Define the release-gate contract with failing tests

**Files:**
- Create: `scripts/release-gate-test.mjs`
- Create: `scripts/release-gate.mjs`
- Modify: `package.json`

**Interfaces:**
- `scripts/release-gate.mjs` exports `parseDotEnv`, `assertPackagedManifest`, `assertPublicHealth`, and `runWithTimeout` for direct tests.
- CLI syntax: `node scripts/release-gate.mjs <preflight|package|public|all> [--url <public-base-url>] [--timeout-ms <milliseconds>]`.
- Output contract: one final JSON object with `status`, `phase`, `evidence`, `blocker`, and `nextAction`; non-zero exit for `BLOCKED` or `FAILED`.

- [ ] **Step 1: Write failing contract tests**

  Add assertions for:

  ```js
  assert.deepEqual(parseDotEnv('A=one\nB="two words"\n'), { A: 'one', B: 'two words' });
  assert.doesNotThrow(() => assertPackagedManifest(validManifest, expected));
  assert.throws(() => assertPackagedManifest({ ...validManifest, devicePermissions: [] }, expected), /geolocation/);
  assert.doesNotThrow(() => assertPublicHealth(validHealth, '1.0.12'));
  assert.throws(() => assertPublicHealth({ ...validHealth, outbound: 'local-outbox' }, '1.0.12'), /outbound/);
  await assert.rejects(runWithTimeout(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 25 }), /timed out/);
  ```

- [ ] **Step 2: Run the focused test and verify the expected RED failure**

  Run: `node scripts/release-gate-test.mjs`

  Expected: FAIL because `scripts/release-gate.mjs` does not yet export the contract functions.

- [ ] **Step 3: Add the minimal exported helpers and timeout runner**

  Implement dotenv parsing without expanding shell syntax, manifest assertions without secret output, health assertions for production fields, and process-group timeout cleanup using `detached: true` on POSIX.

- [ ] **Step 4: Run the focused test and verify GREEN**

  Run: `node scripts/release-gate-test.mjs`

  Expected: `Release gate contract tests passed.`

- [ ] **Step 5: Add npm entry points**

  Add:

  ```json
  "release:preflight": "node scripts/release-gate.mjs preflight",
  "release:package": "node scripts/release-gate.mjs package",
  "release:public": "node scripts/release-gate.mjs public",
  "release:gate": "node scripts/release-gate.mjs all"
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add scripts/release-gate.mjs scripts/release-gate-test.mjs package.json
  git commit -m "feat: add bounded command-first release gate"
  ```

### Task 2: Implement preflight, package, and public phases

**Files:**
- Modify: `scripts/release-gate.mjs`
- Modify: `scripts/release-gate-test.mjs`

**Interfaces:**
- `preflight` runs `npm run typecheck`, `npm test`, and `npm run check:deployment` with default timeouts of 60s, 300s, and 30s.
- `package` runs `npm run check:deployment`, `npm run validate:manifest`, and `npm run package:app`, then reads `appPackage/build/teams-sdk-mvp.zip` through `unzip -p`.
- `public` reads `--url` or `TEAMS_PUBLIC_URL`, checks `/api/health` and `/tabs/home`, and compares health version to the packaged manifest version.
- `all` runs phases in order and stops on the first command blocker; it reports UI gates as `DESKTOP_UNVERIFIED` and `MOBILE_UNVERIFIED` rather than fabricating evidence.

- [ ] **Step 1: Add failing tests for phase behavior**

  Cover a timeout result, a mismatched health version, a local-bypass health response, and a manifest with unresolved `${{...}}` placeholders.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `node scripts/release-gate-test.mjs`

  Expected: FAIL on the new phase assertions.

- [ ] **Step 3: Implement phase runners**

  Keep command output capped in the final evidence while retaining the last diagnostic lines. Report the exact command, timeout, exit code, and next action for failures. Do not invoke Computer Use or browser automation from this script.

- [ ] **Step 4: Run focused tests and verify GREEN**

  Run: `node scripts/release-gate-test.mjs`

  Expected: all contract and phase tests pass.

- [ ] **Step 5: Run the gate against the current project**

  Run: `npm run release:preflight`.

  Expected: either a complete preflight result or a bounded `BLOCKED` result identifying the hanging command; no process remains after timeout.

- [ ] **Step 6: Commit**

  ```bash
  git add scripts/release-gate.mjs scripts/release-gate-test.mjs
  git commit -m "test: cover release gate phases and timeouts"
  ```

### Task 3: Update project-wide workflow and troubleshooting guidance

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/teams-release-workflow.md`
- Modify: `docs/remote-codex-troubleshooting.md`

**Interfaces:**
- Document the command-first phase before any Computer Use action.
- Define `COMMAND_ONLY`, `DESKTOP_UNVERIFIED`, `MOBILE_UNVERIFIED`, and `BLOCKED` states.
- Require bounded commands and explicit process cleanup.
- State that UI-only evidence remains mandatory for uploads, policy/consent, installed version, native desktop screenshots, and mobile GPS.

- [ ] **Step 1: Add the command/UI surface matrix and locked-mode path**

  Keep existing upload and completion gates, but insert `release:preflight`, `release:package`, and `release:public` before UI work.

- [ ] **Step 2: Add the timeout troubleshooting case**

  Explain that a hanging `tsc`/npm/esbuild process is a command gate failure, how to rerun the bounded phase, and that killing the gate's child group must not stop the public server.

- [ ] **Step 3: Verify documentation consistency**

  Run: `rg -n "COMMAND_ONLY|DESKTOP_UNVERIFIED|MOBILE_UNVERIFIED|release:preflight|release:package|release:public|timeout|잠금|lock" AGENTS.md docs/teams-release-workflow.md docs/remote-codex-troubleshooting.md`

- [ ] **Step 4: Commit**

  ```bash
  git add AGENTS.md docs/teams-release-workflow.md docs/remote-codex-troubleshooting.md
  git commit -m "docs: make Teams release workflow command-first"
  ```

### Task 4: Verify, publish evidence, and hand off UI gates

**Files:**
- Modify: none unless verification exposes a defect

**Interfaces:**
- Evidence must include the commit SHA, ZIP SHA-256, packaged version, public health fields, Teams web message round-trip, and explicit desktop/mobile states.

- [ ] **Step 1: Run focused gate tests and full tests**

  Run: `node scripts/release-gate-test.mjs` and `npm test` through the bounded gate.

- [ ] **Step 2: Run package and public phases**

  Run: `npm run release:package` and `TEAMS_PUBLIC_URL=https://dxshc7dx-3978.jpe1.devtunnels.ms npm run release:public`.

- [ ] **Step 3: Re-check Git and package evidence**

  Run: `git status --short --branch`, `git log -5 --oneline`, `sha256sum appPackage/build/teams-sdk-mvp.zip`, and `unzip -p appPackage/build/teams-sdk-mvp.zip manifest.json`.

- [ ] **Step 4: Verify public Teams web runtime**

  In the existing authenticated Teams web tab, send `status`, observe the Adaptive Card reply and tab link, and retain the installed-version mismatch as a blocker if the client still reports v1.0.11.

- [ ] **Step 5: Report without premature completion**

  Use `STATUS / EVIDENCE / COMPLETED / BLOCKER / NEXT ACTION`. Do not send the Teams completion message until installed version, desktop evidence, and user mobile confirmation satisfy the global workflow.

