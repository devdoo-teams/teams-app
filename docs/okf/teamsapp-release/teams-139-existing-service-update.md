---
type: "Release observation"
title: "Teams 1.0.139 existing-service update"
description: "Evidence-bounded update of the existing Teams service and organization catalog, with data preservation and UI gates kept separate."
resource: /teams-139-existing-service-update.md
tags: [teamsapp, teams, release, 1.0.139, installation, runtime]
generated:
  by: "process:teams-139-existing-service-update"
  at: "2026-10-10T18:42:00Z"
verified:
  by: "process:teams-139-existing-service-readback"
  at: "2026-10-10T18:42:00Z"
status: "PACKAGE_VERIFIED_SERVICE_UPDATE_PENDING"
stale_after: "2026-10-17T18:42:00Z"
sources:
  - id: teams-admin-update
    resource: "https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings"
    title: "Manage custom apps in Microsoft Teams admin center"
    location: "Update a custom app using Teams admin center, observed HTML lines 78-85 on 2026-10-10; page last updated 2026-04-14"
  - id: dev-tunnels-cli
    resource: "https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands"
    title: "Dev tunnels command-line reference"
    location: "Public preview warning and host command sections, observed HTML lines 31-38 and 64-85 on 2026-10-10; page last updated 2025-03-27"
  - id: node-v24-cli
    resource: "https://nodejs.org/download/release/v24.13.1/docs/api/cli.html"
    title: "Command-line API - Node.js v24.13.1 Documentation"
    location: "--env-file-if-exists and --env-file semantics, observed HTML lines 835-855 on 2026-10-10"
  - id: exact-sha-ci
    resource: "https://github.com/devdoo-teams/teams-app/actions/runs/38074683657"
    title: "TeamsApp exact-SHA CI run 38074683657"
    location: "Push/main run for source commit 39a987522d72380c17b6194324a4419145cf8325; value-free read-back in .release/evidence/benchmark-1.0.139-final/ci-run-38074683657.json"
  - id: staging-workflow
    resource: "file:docs/teams-release-workflow.md"
    title: "TeamsApp release workflow"
    location: "Local Mac public-process staging gate, file:docs/teams-release-workflow.md:142-173"
  - id: runtime-loopback
    resource: "file:src/server/index.ts"
    title: "TeamsApp server startup and storage paths"
    location: "Loopback-only Teams SDK adapter and runtime data paths, file:src/server/index.ts:318-333,1595-1610"
  - id: job-recovery
    resource: "file:src/server/agent-job-store.ts"
    title: "TeamsApp agent job recovery behavior"
    location: "Interrupted queued/running jobs are failed during startup recovery, file:src/server/agent-job-store.ts:511-526"
  - id: notification-recovery
    resource: "file:src/server/personal-notification.ts"
    title: "TeamsApp personal notification outbox"
    location: "Accepted/rejected/ambiguous outbox receipts and startup recovery behavior, file:src/server/personal-notification.ts:101-150"
  - id: package-receipt
    resource: "file:.release/evidence/benchmark-1.0.139-final/package-receipt.json"
    title: "Teams 1.0.139 package receipt"
    location: "Local package identity and build-marker read-back, file:.release/evidence/benchmark-1.0.139-final/package-receipt.json:1"
  - id: existing-runtime-health
    resource: "file:.release/evidence/benchmark-1.0.139-final/public-readback-now.json"
    title: "Existing public runtime read-back"
    location: "Local public health response, file:.release/evidence/benchmark-1.0.139-final/public-readback-now.json:1"
---

# Teams 1.0.139 existing-service update

## OFFICIAL CONTRACT

Microsoft Teams updates an existing organization custom app by opening its app
details and selecting **Upload file**. Existing policies applied to the previous
version continue to apply to the updated version. This operation does not
authorize changing the app's users, policies, permissions, or availability.

Microsoft describes Dev Tunnels as a public-preview CLI feature with no service
level agreement and says it is not recommended for production workloads. Its
`host` command exposes a local server port through the tunnel. This existing
endpoint is retained as the user's requested update target; its continued
availability is not evidence of a production hosting guarantee.

The installed Node.js version is `v24.13.1`. Node's matching official CLI
documentation says `--env-file` paths resolve relative to the current directory,
and an inherited environment variable takes precedence over the file. Preserve
the exact current command, environment file, runtime distribution directory,
and explicit store paths when restarting the existing process.

## OBSERVED EVIDENCE

At 2026-10-10T18:38:25Z the existing local and public health endpoints returned
HTTP 200 with app version `1.0.138`, source commit
`a2ca2106fefd63135b54429714de2a2f3a340611`,
`auth=teams-authenticated`, `bot=teams-sdk`, and `outbound=teams-sdk`. The
service is Node `v24.13.1`, PID `7583`, working directory
`/private/tmp/teamsapp-public138-a2ca210`, runtime distribution directory
`/tmp/teamsapp-public138-a2ca210/dist`, and port `3978`. The existing Dev Tunnel
host is PID `8391` for `h7vc6jc6-3978.jpe1`; the established URL remains
`https://dxshc7dx-3978.jpe1.devtunnels.ms`. No tunnel configuration or access
control was changed.

The service's actual data root is
`/private/tmp/teams-local-ready-20261005-0ng2szzn/data`, selected by inherited
`*_STORE_PATH` values. The adjacent runtime directory's `data/.gitkeep` is not
the active store. A value-free pre-update fingerprint is retained in
`.release/evidence/benchmark-1.0.139-final/data-preservation-before.json`.
It records 12 data files without copying or printing their contents: 37 agent
jobs (26 completed, 4 cancelled, 7 failed), zero queued/running/approval jobs,
2 completed A2A tasks, 2 connector-accepted A2A outbox entries, 17 accepted
personal notifications, and 4 work items. User prompts, results, notification
text, identities, and tokens are not reproduced in the receipt.

The candidate ZIP is
`.release/evidence/benchmark-1.0.139-final/teams-sdk-mvp-1.0.139.zip`, SHA-256
`561fa93224336db7f1078415e328b265aaab4171da59f997699bafbd009269c6`. Its
manifest has app ID `e915b402-eed4-4ee2-ba1f-c31d75c870a5`, version `1.0.139`,
manifest version `1.25`, `devicePermissions=[]`, and the `delegateMessage`
command titled `업무 허브에 맡기기`. The validated manifest scopes match 1.0.138.
Exact-source CI `38074683657` passed all seven executable jobs for
`39a987522d72380c17b6194324a4419145cf8325`; the Docker job built and smoked the
image without publishing it. Package and CI receipts are local evidence, not a
catalog or installation read-back.

## INFERENCE

The exact process environment and separate data root make it possible to
replace the existing runtime while retaining its stores. Before stopping PID
7583, stage both complete candidate `dist/server` and `dist/client` trees into a
separate temporary runtime, use loopback binding and isolated synthetic stores,
and verify the exact release identity, tab HTML, and every referenced asset.
Then re-read active job and notification state, preserve the data files, stop
only the exact service PID, replace the runtime artifacts, and restart the same
command with the same explicit store paths. Keep a code-only rollback copy and
restore it if the new health or assets fail. Never point the staged process at
the user's stores or change the Dev Tunnel.

The candidate source contains a `TEAMS_BIND_HOST=127.0.0.1` startup path that
patches the Teams SDK Express adapter to bind loopback. This is a local staging
mechanism, not an access-control change for the existing service.

## FIXTURE AND RELEASE VERIFICATION

The prior test-fix commit `39a9875` changed only expected regression counts and
a bounded expiry wait. Exact-SHA CI for its parent `a7276bb` had two failures;
the fixes passed local `npm run test:core` and `npm run test:azure-core`, and
exact-SHA CI run `38074683657` passed. The current 1.0.139 build markers and ZIP
bind to the verified candidate. Stage checks must run with a new empty synthetic
data directory and no message submission; a loopback health/asset probe is a
fixture, not a Teams-host UI result.

## LIVE RESULT

Existing public service is verified at 1.0.138. Candidate staging, service
replacement, catalog upload, personal installed-version read-back,
`delegateMessage` menu visibility, and the optional bounded synthetic dialog,
personal-job, and deep-link test are pending. Do not report those gates as
passed until their exact 1.0.139 evidence is retained and directly reviewed.

## Reproduction and local tool contract

Installed tools: Node.js `v24.13.1`; `devtunnel` `1.0.2014+3c9645ccd8`; its
installed `host --help` exposes `--port-number`, `--protocol`, and
`--allow-anonymous`. Do not run host/login/access commands for this update.
Current exact-SHA verification: `gh run list --commit
39a987522d72380c17b6194324a4419145cf8325` and `npm run test:core`.
The service candidate stage uses the release workflow's loopback, complete
server/client tree, isolated-store, health, tab, and asset checks.
