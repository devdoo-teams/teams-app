---
type: "Release observation contract"
sources:
  - resource: "https://learn.microsoft.com/en-us/graph/api/userteamwork-list-installedapps?view=graph-rest-1.0"
    title: "List apps installed for user - Microsoft Graph v1.0"
    location: "HTTP request/query/response lines58–78 and expanded teamsAppDefinition example209; read2026-10-08; HTML positions may change"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload#update-your-app"
    title: "Upload your app in Teams"
    location: "Update your app; observed HTML lines 100-122 on 2026-10-06; line positions may change"
  - resource: "https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security#anti-phishing-protection"
    title: "Dev tunnels security"
    location: "Web-forwarding and Anti-phishing protection; observed HTML lines 53-69 on 2026-10-06; updated 2025-03-27; line positions may change"
generated:
  by: "process:teams-release-observation-review"
  at: "2026-10-06T15:25:00Z"
verified:
  by: "process:current124-independent-boundaries-and-client-ui-readback"
  at: "2026-10-08T17:46:32Z"
status: "PARTIAL_LIVE_CLIENT_LABEL_UNVERIFIED"
stale_after: "2026-10-15T17:46:32Z"
---

# Independent installation and runtime observations

OFFICIAL CONTRACT: Teams exposes the installed-app Update/Update now path in
Manage your apps. A catalog upload and a personal installation are distinct
observations. The Dev Tunnels service serves an HTML anti-phishing notice on a
first web visit; this differs from a browser-generated TLS/certificate warning.
The documented non-HTML request behavior explains why health may succeed while
the Teams tab still displays the notice. Do not use skip headers or change
tunnel security to bypass the UI.

OBSERVED EVIDENCE: the 2026-10-06 existing devdoo catalog update returned
1.0.104 while the personal About page still returned 1.0.103. A native Teams
tab later rendered runtime 1.0.104 / source 4f771e1. That tab proves a serving
runtime, not an installed manifest upgrade or the new message command.
Evidence is retained in `/tmp/teams-catalog-update-20261006/update-receipt.json`.
This path is a local receipt, not a durable cloud read-back.

INFERENCE: propagation, client cache and consent may explain the mismatch;
none is established as its cause. An IndexedDB definition is explicitly
client-cache evidence and cannot substitute for a Graph installed-app read-back.

## Executable checks

`scripts/release-observations.mjs` is shared by `release:update complete` and
`scripts/release-observation-test.mjs` in Core CI. Completion additionally needs
`--observations /absolute/path/observations.json` and existing verified
`TENANT_ID` / `TEAMS_CATALOG_APP_ID` values. Do not invent these values or write
them over the runtime environment. Existing surface evidence/coverage gates
still apply; these observations do not replace screenshot artifact validation.

The JSON has separate `portal`, `personalInstall`, `runtime`, `desktop` objects.
Each requires `source`, ISO `observedAt`, `result: PASS`, and the same full
`identity`: tenantId, catalogId, appId, version, sourceCommit, packageSha256,
serverBundleSha256, publicOrigin, assetSha256. Current observations expire after
24 hours; the runtime also requires its still-future `expiresAt` and health
`auth=teams-authenticated`, `bot=teams-sdk`, `outbound=teams-sdk`.

Allowed sources: portal=`admin-center-ui` or `catalog-service`;
personalInstall=`teams-about-ui` or `graph-installed-app`; runtime=`live-health`;
desktop=`native-teams`. Personal installation additionally requires the observed
`installedVersion` to equal the release. Desktop requires `applicationId` and
four current PASS rows: `delegate-message`, `dialog`, `personal-job`,
`detail-deep-link`; each has before/after screenshot, accessibility and runtime
evidence references. Health/assets alone cannot satisfy these rows.

FIXTURE: unit observations are synthetic and must never be registered as LIVE
RESULT. The startup test runs the real `scripts/start-server.mjs` with an inert
entry fixture. The Core smoke additionally runs the actual Core server bundle
with a read guard that throws if the missing/corrupt inactive replay path is
opened. Provider-active missing/invalid replay blocks before entry; valid schema
proceeds to the existing store's full record validation. Core and disabled
provider paths do not inspect replay files. No recovery file is synthesized.

## Current authorization interface

`canContinueTunnelNotice(notice, verifiedOrigin, isCurrentlyAuthorized)` only
recognizes the observed English/Korean service HTML notice at the exact known
origin. Its callback must consult current task authorization. Stored receipts,
copied rules and prior workflow text are not permission. TLS and unknown notices
return false even with an authorization callback. This function performs no UI
action and does not authorize Agree/Add, reinstall, new targets, or policy changes.

REPRODUCTION / RED: `node scripts/release-observation-test.mjs` originally
failed because old installedVersion was accepted; the new independent-boundary
assertion also failed before implementation. `node scripts/runtime-replay-startup-test.mjs`
originally reached the entry with active missing replay. GREEN: both commands
pass after the minimal guards. Installed Node v24.13.1 help confirms `--import`
and `--env-file-if-exists`; Core smoke uses the former only as a test read guard.
Local GREEN is not LIVE RESULT for catalog, personal installation or desktop flow.

## Current124 About boundary without session or policy changes

OFFICIAL CONTRACT: the Update your app section was re-read on2026-10-08 (lines100–122, page updated2025-04-18). It describes Manage your apps > Update > Update now when an update is available. It does not guarantee About-label convergence time or identify a stale label's cause. The Graph installedApps contract independently defines GET, `$expand` and200 response; the expanded definition is a separate observation from the client label.

OBSERVED EVIDENCE: the existing Admin Center catalog and authorized personal Graph installed definition both read1.0.124. Exact public HTTPS health and the actual Teams workhub header also read1.0.124/source`28ecee5626cbd091b2b30375e9710e7532fe598b`. The installed target remains one 백두산 user with org-default availability and no permission change. The same real synthetic private job completed once and its result appeared in the actual Bot card and private detail. These functional WEB observations do not establish native or mobile acceptance.

OBSERVED EVIDENCE: at2026-10-08T17:33Z the existing Teams chat About still displayed1.0.122. At17:44Z the same-session Manage your apps entry had no Update/Update now option. Its personal scope displayed “이 앱을 제거할 수 있는 권한이 없습니다”; the app-level menu offered only details and copy link. The management details displayed1.0.122 too. Evidence: `/tmp/teams-mp347-followup-20261009-0240/about124-final-ax.txt:660`, `apps124-expanded-own-ax.txt:236`, `apps124-own-options-ax.txt:330`, `apps124-own-detail-open-ax.txt:432`, plus directly opened `about124-final.png`, `apps124-own-options.png` and `apps124-about-version-final.png`. Capture files and precise observation times are retained in the supplemental visual index.

INFERENCE: cache or propagation could explain the difference, but the actual client metadata source/cause remains `UNVERIFIED`. No supported current Update control was available. Do not fix a host label by changing the product version text, clearing state, reinstalling, changing policies/permissions or opening a new login session. Keep MP118 In Progress and retain catalog/install/runtime/client-label/native/mobile as independent gates. This read-only diagnosis changes no app artifact and therefore requires no package publication or runtime replacement.
