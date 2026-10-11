---
type: "Release Gate"
title: "Local preview CSP and authentication boundary"
description: "Records the 1.0.142 local UI failure, the same-origin CSP mismatch, and the separate preview-token boundary fix."
resource: /local-preview-csp.md
tags: [csp, local-preview, authentication, release-gate]
generated:
  by: "process:local-preview-ui-qa/1"
  at: "2026-10-11T05:02:00Z"
verified:
  by: "process:local-preview-ui-qa/1"
  at: "2026-10-11T05:02:00Z"
status: partial
stale_after: "2026-10-18T05:02:00Z"
sources:
  - id: csp3-connect-src
    resource: "https://www.w3.org/TR/CSP3/#directive-connect-src"
    title: "Content Security Policy Level 3"
    location: "§6.1.2 `connect-src`; observed web lines 1370-1393 on 2026-10-11; current publication identifies itself as a Working Draft dated 2026-09-16"
  - id: csp3-multiple-policies
    resource: "https://www.w3.org/TR/CSP3/#multiple-policies"
    title: "Content Security Policy Level 3"
    location: "meta policy enforcement and §8.1 effect of multiple policies; observed web lines 542-544 and 2907-2916 on 2026-10-11"
---

# Local preview CSP and authentication boundary

## Official contract

The W3C CSP Level 3 Working Draft says `connect-src` controls script APIs including `fetch()` and XHR; requests that do not match the directive's source list return network errors (§6.1.2, observed lines 1370-1393). A policy delivered by a meta element is enforced alongside other active policies, and every enforcing policy must allow a request (§3.3 note, lines 542-544; §8.1, lines 2907-2916).

## Observed 1.0.142 local UI

- Target source: `main`, `7b207b6be496481fdd1c3d221e4a6708140e3b57`; app/package and manifest version `1.0.142`.
- Synthetic-only loopback runtime: `http://127.0.0.1:41889/tabs/home/?preview=1`, server PID `66100`, parent PID `66098`, `TEAMS_LOCAL_DEV=true`, `TEAMS_SKIP_AUTH=true`, `TEAMS_SKIP_OUTBOUND=true`, `auth=local-bypass`, `bot=local-handler`, `outbound=local-outbox`. The random test token was stored mode `0600` under `/private/tmp` and never printed.
- `/api/health` returned 200 with the expected synthetic token and 401 without it when called from the Mac host. The page HTML and versioned CSS/JS loaded with 200. Browser-side same-origin `fetch()` to both `/tabs/home/` and `/api/health` returned `TypeError: Failed to fetch`.
- Screenshot: `.teams-ui-qa-1.0.142-22kf1kif/screenshots/142-desktop-initial.png`, SHA-256 `b3281aed6a680c0e1fd072e034c83c1baf1dc5a3b7ff57aa01e93ee38d897ab2`, captured `2026-10-11T04:51:45Z`, directly reviewed by Codex at `2026-10-11T05:02:00Z`. The page view was 1440×1000 in Ego Browser TaskSpace 2, managed page `p6`; it showed `연결 확인 필요` and two `Failed to fetch` errors, with no job list. The page was brought to the front within the browser task space; OS-level foreground-app identity was not independently read back.
- The served HTTP CSP had `connect-src https: wss: blob:` while `src/client/index.html:8-10` declared `connect-src 'self' https://res.cdn.office.net`. For an HTTP loopback page, the HTTP header policy did not allow the same-origin API request; the additional meta policy could not broaden that header policy. This matches the observed network error and is the diagnosed cause. Internal anchors before correction: `src/server/security-headers.ts:14-28`, `src/client/index.html:7-10`.
- The design mock is materialized at `/tmp/teams-work-hub-qa-mock/exec-88294e0d-4fe5-498a-a92f-60b12ab57bd4.png`, SHA-256 `5d0df5ce193b7249604ad0d874c567a3c8e18b14e07107ff4ceac87a88ef8cc5`; all four panels were directly pixel-reviewed in the previous QA round.

## Source correction and test status

- `src/server/security-headers.ts:24` now includes `'self'` in `connect-src`. This permits connections back to the same application origin; the existing CSP still retains its scheme and frame restrictions.
- `scripts/security-headers-test.ts:16` asserts the self-origin source. The test failed before the correction with the previous directive, then passed with `node --import tsx scripts/security-headers-test.ts`.
- `src/client/auth.ts:57-65,76-104,106-121` now captures and uses local preview credentials only when the page and request are on an HTTP(S) loopback origin. The public-page token capture/send regression is covered at `scripts/local-auth-test.ts:100-115`; `node --import tsx scripts/local-auth-test.ts` passed. Server-side local-token validation remains mandatory.
- The package script `npm run test:security-headers` is not runnable in this checkout because the `tsx` executable is absent (`sh: tsx: command not found`). The equivalent test passed through the installed `node --import tsx` loader; hosted clean-commit CI remains required.
- Candidate `1.0.143` was available in `release:prepare --dry-run`; version files, build, ZIP, commit, push, and exact-SHA CI are pending. The stale release state `dcec4088-a257-4ec3-8240-c6ef428faae2` remains `PACKAGE_READY` for 1.0.140 until the official `supersede` transition is executed and archived.

## Remaining gates

The initial 1.0.142 screen is a failure, not a visual pass. Desktop/mobile interaction matrix, corrected-build screenshot verification, public service identity, existing catalog update, installed-app read-back, native Teams Adaptive Card rendering, and native mobile behavior remain `BLOCKED` or `UNVERIFIED`. The operator requested foreground control for iPhone Telemetry testing; the existing browser TaskSpace was handed off without closing or resetting tabs, and screen actions are paused until the operator returns it. Existing public service port `3978` / PID `7583` remains untouched.
