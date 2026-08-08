# Command-First Teams Release Gate Design

**Date:** 2026-08-09

## Goal

Make repeatable Teams release checks runnable from the terminal while keeping browser, native desktop, and mobile verification as explicit UI gates.

## Context

The project already validates the manifest, builds a Teams ZIP, runs runtime tests, and checks the public health endpoint. Those checks are currently invoked as separate commands. In this session, a project `typecheck` process remained alive without output for more than three minutes, showing that an unbounded command can become a blocker even when the Mac lock is unrelated.

The project must never bypass macOS lock, Microsoft login, Authenticator approval, or browser security warnings. A command-first gate therefore removes avoidable UI work; it does not try to impersonate a user or unlock the operating system.

## Design

### 1. One deterministic release gate

Add `scripts/release-gate.mjs` and npm entry points for these phases:

- `preflight`: run typecheck, the existing full test suite, and deployment-environment validation with per-command timeouts and process-group cleanup.
- `package`: run manifest/environment checks, create the ZIP, inspect the ZIP's real `manifest.json`, and verify version, app ID, tab origin, SSO resource, and `geolocation` without printing secrets.
- `public`: fetch a supplied public base URL, follow the tab redirect, and require production health fields (`auth=teams-authenticated`, `userAuth=entra-sso`, `bot=teams-sdk`, `outbound=teams-sdk`) plus the expected app version.
- `all`: run the available command phases and report machine-readable `READY` or `BLOCKED` evidence. UI-only gates are reported separately and cannot be silently marked complete.

The runner must terminate a timed-out child and its descendants, return a non-zero exit status, and identify the exact command and timeout in the report. It must not kill the long-running public Teams server because only its own process group is terminated.

### 2. Verification surface matrix

| Surface | Command-first check | UI-only check |
| --- | --- | --- |
| Source and package | Git, typecheck, tests, manifest, ZIP, SHA-256 | None |
| Runtime | HTTPS tab, `/api/health`, redirect, process mode | None |
| Admin/Developer Portal | Optional URL/status evidence | Login, upload, policy, consent, installed version |
| Teams desktop | None | Accessibility tree, screenshot, native tab/card rendering |
| Teams mobile | None | iOS permission, GPS, WebView layout, user message confirmation |

The command gate can continue while the Mac is locked. The final release gate retains `DESKTOP_UNVERIFIED` and `MOBILE_UNVERIFIED` until their respective UI evidence exists.

### 3. Workflow and troubleshooting updates

Update `AGENTS.md`, `docs/teams-release-workflow.md`, and `docs/remote-codex-troubleshooting.md` to require:

- command-first execution before any Computer Use action;
- bounded commands and process cleanup;
- explicit `COMMAND_ONLY`, `DESKTOP_UNVERIFIED`, and `MOBILE_UNVERIFIED` states;
- UI handoff only for authentication, policy, upload, installed-version, desktop, and mobile gates;
- no repeated browser-login loops or OS-lock bypass attempts;
- the final Teams completion message only after public health, installed version, desktop gate, and user mobile confirmation satisfy the project policy.

## Error handling

- A timeout is a failed command gate, not a successful test.
- A public health mismatch is a release blocker even if the tab returns HTTP 200.
- A stale installed Teams version blocks SSO/UI claims even when Admin Center and Developer Portal show the new catalog version.
- A locked Mac blocks only native desktop evidence; it does not block command, public HTTPS, or already authenticated browser work.

## Acceptance criteria

1. `release-gate` returns structured evidence and fails fast on a hanging command.
2. ZIP inspection catches unresolved placeholders, wrong version, wrong SSO resource, missing `geolocation`, and wrong tab origin.
3. Public health validation rejects local bypass/outbound states.
4. Documentation clearly assigns every step to CLI, browser, Computer Use, or mobile UI.
5. Existing tests remain green when run under the bounded gate, or the gate reports a reproducible blocker without claiming completion.

## Non-goals

- Unlocking macOS or automating password/Auth app entry.
- Replacing the Teams Admin Center/Developer Portal upload UI without an explicitly provisioned Microsoft Graph credential and admin scope.
- Treating Teams web as proof of iOS GPS or mobile WebView behavior.
