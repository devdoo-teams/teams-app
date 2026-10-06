---
type: "Release observation contract"
sources:
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
  by: "process:official-contract-readback-and-focused-tests"
  at: "2026-10-06T15:25:00Z"
status: stable
stale_after: "2026-10-13T15:25:00Z"
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
