# Teams E2E Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make the Teams app’s runtime claims and release evidence match the actual local source, then verify every user-facing branch with current Teams evidence.

**Architecture:** Keep Teams Bot + React personal tab as the primary product. Codex CLI is the only real agent runner in the first slice; deterministic responses are explicitly labeled as deterministic. CopilotKit/MCP are not release-critical. Every release is tied to one clean Git commit, one package SHA, one public runtime, and ordered portal/installed/desktop/mobile evidence.

**Tech Stack:** TypeScript, Node.js, Express, React, Microsoft Teams SDK, Adaptive Cards, Codex CLI, local Git, existing Codex in-app browser tabs, Teams desktop Computer Use.

## Global Constraints

- `/Users/doosansmacbookpro/Documents/TeamsApp` is the original source and only Git history; do not use iCloud, a remote repository, or `/tmp` as source of truth.
- Reuse existing Developer Portal, Teams Admin Center, Teams chat, and public Teams tabs; do not create new browser tabs or login sessions without explicit approval.
- A command/API/unit test never substitutes for a current Teams desktop/mobile screenshot and accessibility-tree proof.
- Every feature branch must record PASS, FAIL, BLOCKED, or N/A for every UI location and branch in the verification matrix.
- Do not report `PORTAL_UPLOAD_UNVERIFIED`, `INSTALLED_VERSION_UNVERIFIED`, `DESKTOP_UNVERIFIED`, or `MOBILE_UNVERIFIED` as complete.
- Do not send a Teams completion message before the ordered release loop and user mobile confirmation are complete.
- Do not add an OpenAI API-key requirement to the core path; CopilotKit/MCP remain optional and non-blocking.

### Task 1: Restore safe build baseline and correct Teams tab deep links

**Files:**
- Modify: `src/server/teams-tab-link.ts`
- Modify: `scripts/teams-tab-link-test.ts`
- Restore: `scripts/build-server.mjs`, `src/server/index.ts`, `src/server/channels-shadow-monitor.ts`, `src/server/copilot-channels-shadow.ts`, `tsconfig.release.json`
- Delete: only the untracked diagnostic files listed by `git status --short`

**Deliverable:** The working tree contains no diagnostic release-only changes; deep links use the same trailing-slash tab URL as the manifest; the focused test completes instead of hanging.

### Task 2: Make provider capability and deterministic-vs-real execution explicit

**Files:**
- Modify: `src/server/response-engine.ts`, `src/server/response-engine-deterministic.ts`, `src/server/codex-runner.ts`, `src/server/agent-service.ts`, `src/server/index.ts`
- Create: `src/shared/runner-capability.ts`
- Test: `scripts/runner-capability-test.ts`, `scripts/agent-service-idempotency-test.ts`

**Deliverable:** The tab and cards can distinguish deterministic data from a real Codex CLI job; Codex login/executable capability is reported before a job is offered; duplicate natural-language submissions do not create duplicate jobs for the same request key.

### Task 3: Remove false release-gate positives

**Files:**
- Modify: `scripts/release-loop.mjs`, `scripts/release-gate.mjs`
- Test: `scripts/release-loop-test.mjs`, `scripts/release-gate-test.mjs`
- Modify: `docs/teams-release-workflow.md`, `docs/teams-ui-verification-matrix.md`

**Deliverable:** Evidence records cannot pass merely because a valid image exists; each evidence record identifies the current run, surface, app version, package SHA, observed screen, and verification matrix rows. Installed evidence must retain the observed installed version and source surface.

### Task 4: Make mobile-safe card and tab branches testable

**Files:**
- Modify: `src/server/genui-teams.ts`, `src/server/genui-response.ts`, `src/client/App.tsx`, `src/client/WorkItemPanel.tsx`, `src/client/CollaborationPanel.tsx`
- Test: `scripts/genui-contract-test.ts`, `scripts/client-location-test.ts`, `scripts/client-bootstrap-test.ts`

**Deliverable:** Cards use the mobile-safe contract, duplicate text is absent, every tab state has visible loading/empty/error/retry/permission handling, and every card has a working tab link or an explicit unavailable state.

### Task 5: Execute ordered runtime evidence collection

**Files:**
- Create/update: `.release/evidence/*.json` only for the current run
- Update: `docs/teams-ui-verification-matrix.md`

**Deliverable:** Existing Teams browser tabs and, after macOS unlock, Teams desktop are used to collect before/after screenshots and fresh accessibility trees for every implemented button and branch. Mobile-specific GPS/WebView/permission rows remain unverified until the user confirms them in the deployed mobile app.

