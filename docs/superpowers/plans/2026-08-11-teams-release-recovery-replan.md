# Teams Release Recovery and Evidence Replan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover and independently prove the current Teams Core release `1.0.42` from source commit `4d911ae380f20a93f5ac4fe5764786a8f4a3f93d`, then complete the release only if the same package identity is verified in the Admin Center, public runtime, installed Teams desktop app, and the user’s mobile Teams app. Do not reuse archived evidence or treat an API/CLI result as a substitute for a Teams UI observation.

**Architecture:** Preserve one release identity across five boundaries: clean source → deterministic package → existing Admin Center app update → public `npm start` process → Teams host surfaces. Each boundary emits evidence tagged with commit, app version, package SHA-256, manifest identity, and current run ID. A failed boundary stops downstream verification; it does not get bypassed with an older ZIP, stale process, or representative-case claim.

**Tech Stack:** TypeScript/React Teams personal tab, Microsoft Teams SDK, Express/Teams SDK bot, Adaptive Cards, `npm` core release scripts, Dev Tunnel, Microsoft Teams Admin Center, Microsoft Teams desktop via Computer Use (`@oai/sky`), and the existing in-app browser tab.

## Global Constraints

- Core-only commands are the release baseline. Optional OpenAI, CopilotKit, MCP, and local-model paths remain separate and are `N/A` unless explicitly enabled and tested.
- The authoritative source is `/Users/doosansmacbookpro/Documents/TeamsApp`; there is no Git remote. Do not clone, pull, push, or treat `/tmp` as source history.
- Preserve the untracked-at-start user files recorded in the task context. Do not delete, move, upload, or overwrite them.
- Reuse the existing Admin Center tab ID `1` and existing Teams/chat session. Do not create a new browser tab, login session, Teams window, or alternate tenant session.
- Do not close the existing Admin Center, Teams, or authentication windows. Do not clear Teams cache, quit Teams, or remove session data without an explicit user authorization checkpoint.
- Never select or alter the `General 두산` account radio. Use the existing target account and the existing `업무 허브` test conversation only.
- Do not infer credentials, admin permissions, upload completion, installed-client version, mobile GPS behavior, or user message receipt.
- Use official Microsoft documentation for any debugging decision. The Teams CLI doctor warning about a standalone SSO URI is not grounds to change the current combined bot+tab URI; the manifest and deployment validator intentionally use `api://<TAB_DOMAIN>/botid-<BOT_CLIENT_ID>`.
- The current release run is `17e6023d-f1e2-4beb-910f-6dbfcde47f79`, version `1.0.42`, commit `4d911ae380f20a93f5ac4fe5764786a8f4a3f93d`, and ZIP SHA-256 `81ab5ffbb35168a8592fea84a6e3e0e58b4f15aa08409b17e9c9d7caa0ea50c4`. These values are starting facts, not proof that all gates are complete.
- The current release run is `PUBLIC_READY` only in its bookkeeping. Its `portal`, `installed`, `desktop`, and `mobile` evidence fields are null. It must not be reported as complete.
- Every long command has a bounded timeout and a midpoint/termination check containing `process`, `pid`, `elapsed`, `lastActivity`, `health`, and `nextAction`.

## Current findings that change the plan

1. The Dev Tunnel host process is alive as PID `49618`, but no process is listening on local port `3978`. Both the public `/api/health` and canonical `/tabs/home/` currently return HTTP `502`. The prior public `200` result is stale and cannot support current UI evidence.
2. An unrelated old `node scripts/start-server.mjs` process, PID `84835`, is present but does not listen on the release port. It is not evidence for this release and must not be killed merely to make the process list look clean.
3. The existing Admin Center tab is live at the current app detail route and shows `업무 허브`, app version `1.0.42`, and the existing `파일 업로드` update route. The tab is current evidence for the displayed version, but the current browser backend could not produce a screenshot, so the portal gate remains unverified until a supported current-run screenshot plus DOM/AX evidence is captured.
4. A fresh native screenshot of Microsoft Teams shows a blank light-gray app surface. Teams WebView2 child processes are alive, so this is a host-rendering/runtime blocker, not proof that the app is installed or that the tab is healthy. The current screenshot is `/var/folders/q6/hjw2kzp543s99f0rhdm77b5m0000gn/T/codex-shot-2026-08-11_18-28-00.png`.
5. The committed `app.initialize()`/`notifySuccess()` bootstrap fix is already in `4d911ae`. No speculative source change is justified before the public process and current package identity are restored.

## Execution plan

### 1. Freeze and reconcile release identity before changing anything

- [ ] Run `npm run release:loop -- status` and record the current run ID, state, missing gates, commit, version, and package SHA in a new execution log under `.release/evidence/` for this run. The expected state is missing `PORTAL_READY`, `INSTALLED_READY`, `DESKTOP_READY`, and `MOBILE_READY`.
- [ ] Run the repository’s bounded source-I/O/release preflight before any build or package command. Confirm the tracked source inputs, `package.json`, `package-lock.json`, manifest, `scripts/`, and `types/` are locally readable, non-dataless, and tied to the current HEAD. If Git inspection hangs or reports unstable FileProvider metadata, record `SOURCE_IO_UNSTABLE`/`SOURCE_IO_BLOCKED` and stop before building.
- [ ] Verify the existing marker and package identity without rewriting them: marker schema `2`, full commit, `mode=core`, `worktree=clean`, manifest version `1.0.42`, app ID `e915b402-eed4-4ee2-ba1f-c31d75c870a5`, canonical content URL with trailing slash, `devicePermissions=["geolocation"]`, combined SSO resource, and the recorded ZIP SHA-256.
- [ ] Verify the old `.release/evidence` files are archive-only (`1.0.12`–`1.0.18`) and exclude them from the current run. No old screenshot, installed record, portal record, or matrix result may be copied into the current run.

**Deliverable:** A current-run identity record proving exactly which source, package, manifest, and evidence directory are allowed to participate. If this step cannot establish source identity, the release is `BLOCKED` and no external mutation occurs.

### 2. Complete the existing Admin Center update gate without re-uploading an unchanged package

- [ ] Reconnect the existing in-app browser tab ID `1`, read its current URL/title, and take a fresh DOM/accessibility snapshot. Do not call `tabs.new`, open a second Admin Center route, or reload the same authenticated page unnecessarily.
- [ ] Confirm the page remains the existing `업무 허브` app detail for app ID `e915b402-eed4-4ee2-ba1f-c31d75c870a5`, and that the displayed published version is `1.0.42`. Treat this as current portal-state evidence, not as proof of installed-client propagation.
- [ ] Do not upload the same `1.0.42` ZIP again. A new upload is authorized only after a real source/version/package identity change and only through the existing app detail → `새 버전` → `파일 업로드` route. Never use top-level `새 앱 업로드` for this app ID.
- [ ] Inspect the existing app detail for a current upload/version record that can be tied to the exact package SHA and current release run. If the page exposes only the version number and upload control, record `PORTAL_UPLOAD_PROVENANCE_UNVERIFIED`; the visible `1.0.42` value is not enough to prove that this exact ZIP was accepted.
- [ ] Capture a current portal-state screenshot, current DOM/AX snapshot, displayed version, app ID, and package identity in the release loop. If the in-app browser screenshot backend still times out, record `PORTAL_SCREENSHOT_UNAVAILABLE` and leave the portal gate `BLOCKED`; do not manufacture a screenshot from DOM text or reuse an archive image.
- [ ] If a genuine source/version/package change later requires an upload, capture the pre-upload and post-upload screenshots, upload response, displayed version, and SHA through the same existing app detail route. Re-run ZIP/manifest checks after that upload and verify the Admin Center still shows the new app ID/version.

**Deliverable:** Current-run Admin Center evidence that the existing app record shows the exact current app identity. The portal gate remains `BLOCKED` when the current page cannot establish exact-package upload provenance; unchanged-version re-upload is not a workaround.

### 3. Recover the public process without changing the tunnel or package identity

- [ ] Confirm the tunnel identity with `devtunnel show h7vc6jc6-3978.jpe1 --json` and compare its actual `ports[].portUri` with `dxshc7dx-3978.jpe1.devtunnels.ms`. Do not guess a replacement hostname. If the port URI changed, stop and open a new release-identity branch requiring environment/manifest/version/package/update work.
- [ ] Start the public server only with `npm start`, using the repository’s bounded process-monitoring convention. Do not run `node dist/server/index.js`, do not use the stale PID `84835`, and do not set `TEAMS_SKIP_AUTH=true` or `TEAMS_SKIP_OUTBOUND=true`.
- [ ] At the midpoint and end of startup, identify the parent PID, child PID, listening port, and latest log timestamp. Confirm that the process listening on `3978` is the new `npm start` process and not an older server.
- [ ] Probe the same public origin in sequence: `/api/health`, `/tabs/home/`, `/`, the HTML-referenced hashed client asset, and `/api/messages` readiness as applicable. Require HTTP `200` for health/tab/root/asset and require health fields `environment=production`, `auth=teams-authenticated`, `userAuth=entra-sso`, `bot=teams-sdk`, and `outbound=teams-sdk`.
- [ ] Compare the public release identity to the package and current HEAD: version `1.0.42`, commit `4d911ae...`, build ID, manifest hash, and asset hash. Save all probe responses and PID/port observations in the current run evidence directory.
- [ ] If any probe is `502`, `404`, stale, or mismatched, stop the downstream release loop. Do not re-upload, regenerate a ZIP, or use the public result as a partial pass until the process/runtime problem is fixed and the probes pass together.

**Deliverable:** A live public origin whose health, canonical tab, root, and asset all prove the current release identity in one bounded verification window.

### 4. Establish installed-client version and diagnose the blank desktop host safely

- [ ] After the public gate passes, use Computer Use in the existing Microsoft Teams app. First call `sky.get_app_state` with `com.microsoft.teams2`; use `sky.list_apps` only if that identifier fails. Capture a pre-action accessibility tree and screenshot.
- [ ] Do not treat `teams app get` or Admin Center version `1.0.42` as installed-client proof. Read the actual Teams app installation/details surface and require the installed app version to equal `1.0.42` before testing SSO, tabs, or Bot messages.
- [ ] If the native Teams surface is still blank, record the blank screenshot and AX tree as `DESKTOP_UNVERIFIED`, correlate it with the public health/asset probes and WebView2 process list, and stop interaction attempts. Do not repeat stale-index clicks, create a new Teams session, or select `General 두산`.
- [ ] Request an explicit user authorization checkpoint before any Teams quit/restart or cache reset. If authorized, follow Microsoft’s current Teams cache-clearing/restart guidance, preserve the existing Admin Center tab and chat, then capture a fresh AX tree and screenshot before and after reopening. If not authorized, leave the gate blocked with the exact safe next action.
- [ ] Once the app surface renders, verify the target account, existing `업무 허브` chat, `채팅 / 업무 허브 / 정보` tabs, current app version, and the initial tab UI. After every click, message send, or tab transition, read a fresh AX tree and capture the resulting screenshot; never reuse an old `element_index`.

**Deliverable:** Either a current installed-version match with a rendered Teams desktop baseline, or a reproducible `DESKTOP_UNVERIFIED` blocker with screenshots, AX evidence, public identity, and a user-authorized recovery decision recorded.

### 5. Execute the full Core UI verification matrix against this release only

- [ ] Generate a new matrix instance keyed to run ID `17e6023d-f1e2-4beb-910f-6dbfcde47f79`, commit `4d911ae...`, version `1.0.42`, and the current package SHA. Do not reuse the old matrix’s `226` rows as results; its prior `199 BLOCKED / 27 N/A / 0 PASS` summary is historical context only.
- [ ] Enumerate every implemented Core surface and branch from the current source and manifest: personal-tab bootstrap/loading/success/error, home/navigation/info, task/list input/add/refresh/filter/status, location/permission/denial, authentication expiry/retry, malformed/empty/boundary input, duplicate submit, card prompt/actions, Bot progress/completion/fallback, and visible mobile-alternative guidance. Mark truly absent optional-provider branches `N/A` with source evidence.
- [ ] For each row record all required fields: `feature`, `surface`, `location`, `branch`, `precondition`, `action`, `expected`, `screenshotBefore`, `screenshotAfter`, `accessibilityEvidence`, `runtimeEvidence`, and `result` (`PASS`, `FAIL`, `BLOCKED`, or `N/A`). The screenshot must show the current app version or be linked to a same-run identity record.
- [ ] Execute each desktop-visible button, link, tab, input, card action, approval/cancel state, retry, permission response, and duplicate-click branch through the actual Teams host. For every action, refresh AX state and capture before/after evidence. API-only tests may supplement runtime evidence but cannot close a UI row.
- [ ] If a row fails or the UI/server result diverges, record the failure and root cause, make a minimal TDD fix only when the defect is reproduced, then increment version, rebuild, package, commit, update, and restart verification from the affected row. Never patch an old ZIP or keep the old release identity.

**Deliverable:** A complete current-release matrix with no blank result cells and no claimed pass based solely on representative cases or API harnesses.

### 6. Obtain actual mobile Teams evidence without overstating desktop results

- [ ] After desktop and public gates pass, obtain current evidence from the deployed Teams mobile app for the same app version. The provided Korean iPhone screenshot remains reference context only; it cannot prove the current package or current response.
- [ ] Verify the mobile-installed version, personal-tab rendering, card/text non-duplication, permission/denial behavior, GPS behavior, and mobile-specific alternative guidance. Capture the user-visible before/after screens and record the device/app context without recording credentials.
- [ ] Mark all iOS WebView, Teams mobile permission, and real iPhone GPS rows `MOBILE_UNVERIFIED`/`BLOCKED` until actual mobile evidence exists. Do not convert a desktop pass into `MOBILE_READY`.

**Deliverable:** Current mobile evidence tied to the same package identity, or an explicit mobile blocker that prevents completion.

### 7. Close the release and report only after every gate is current

- [ ] Update the release loop with portal, installed, desktop, mobile, matrix, and user-message evidence only from this run. Confirm the loop reaches its actual complete state; `PUBLIC_READY` is insufficient.
- [ ] Before completion, re-run the final identity table: source commit, package version, ZIP SHA-256, ZIP manifest, `devicePermissions`, public health fields, canonical tab/root/assets, Admin Center version, installed Teams version, desktop evidence, mobile evidence, and matrix counts.
- [ ] Use the existing `업무 허브` Teams chat only after the user’s deployed-app message and Bot response have been observed. Send one completion message containing version, commit SHA, package SHA, update evidence, public health result, user message/response evidence, matrix result, and any explicitly marked `MOBILE_UNVERIFIED` items. Do not send a completion message while any required gate is `BLOCKED` or `null`.
- [ ] Report in the required format: `STATUS / EVIDENCE / COMPLETED / BLOCKER / NEXT ACTION`. If any gate remains blocked, report the exact blocker, PID/URL/tab/identity evidence, and one safe next action; do not call it a release completion.

**Deliverable:** A verifiable Teams release completion message, or a truthful blocked report that leaves existing user sessions and deployable state intact.

## Conditional source-change protocol

No source change is planned at the start because the `notifySuccess()` fix is already committed and the immediate observed failure is the dead public process plus blank desktop host. If a later gate produces a reproducible source defect, use this exact sequence:

1. Add a focused failing test beside the affected Core test, run only that bounded test, and save the red result.
2. Make the smallest source change in the owning file (`src/client/main.tsx`, `src/client/App.tsx`, server route/adapter, or the relevant manifest validator).
3. Run the bounded Core test and source compile checks, then `npm run release:preflight` with the required timeouts.
4. Commit the source/manifest/runtime change after reviewing the tracked diff. Do not reuse the `1.0.42` marker, bundle, ZIP, public process, or evidence.
5. Increment the app version, run `npm run release:package`, verify the ZIP contents and deterministic SHA-256, upload only through the existing app update route, start a fresh `npm start` release process, and repeat all identity gates from Step 2 onward.

## Official references governing the decisions

- [Microsoft Teams app update experience](https://learn.microsoft.com/en-us/microsoftteams/apps-update-experience) — admin-uploaded custom app updates and user consent/propagation.
- [Upload custom apps in Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload) — custom app update/upload flow.
- [Bot SSO manifest](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/bot-sso-manifest) and [tab SSO AAD registration](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-register-aad) — combined bot+tab resource URI and valid domains.
- [Teams troubleshooting](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/troubleshoot) — blank tab, iframe, manifest propagation, and cache considerations.
- [TeamsJS app API](https://learn.microsoft.com/en-us/javascript/api/%40microsoft/teams-js/app?view=msteams-client-js-latest) and [Stageview readiness](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/open-content-in-stageview) — initialization and `notifySuccess()` readiness behavior.
- [New Teams and WebView2](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/teams-updates) and [WebView2 process diagnostics](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/measures) — host/runtime diagnosis boundary.
- [Clear Teams cache](https://learn.microsoft.com/en-us/troubleshoot/microsoftteams/teams-administration/clear-teams-cache) — only for an explicitly authorized recovery action.
