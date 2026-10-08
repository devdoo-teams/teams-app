---
type: "Runtime UI Contract"
title: "Personal tab prompt bounds and visible mutation failures"
generated:
  by: "process:codex-release-validation"
  at: "2026-10-08T22:01:00Z"
verified:
  by: "process:root-source-and-fixture-review"
  at: "2026-10-08T22:01:00Z"
status: draft
stale_after: "2026-10-15T22:01:00Z"
sources:
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings#update-a-custom-app-using-teams-admin-center"
    title: "Update a custom app using Teams admin center"
    location: "Update section, observed rendered lines78–85 on2026-10-08; page updated2026-04-14; HTML lines are not stable"
  - resource: "https://learn.microsoft.com/en-us/graph/api/userteamwork-list-installedapps?view=graph-rest-1.0"
    title: "List apps installed for user"
    location: "HTTP request and optional query parameters; observed2026-10-08; HTML lines are not stable"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package"
    title: "Package your app"
    location: "Teams doesn't host your app and package requirements; observed2026-10-08; HTML lines are not stable"
---

OFFICIAL CONTRACT: update the same organization app from its existing details; preserve existing policies. Catalog version, personal installation, host label, public runtime and native/mobile UI are separate observations. Current source/build/package/public/UI evidence must share one release identity.

OBSERVED EVIDENCE: public126 (`51e340350f548af453fe0e28960bb2ef10c9121d`) accepted an exact synthetic2,001-character value in the personal-tab input. One execute click created no job and displayed no guidance in the fresh settled view. `/tmp/teams126-continuation-20261009-0631/overlimit-prepared.json`, `overlimit-submit-ledger.json`, `overlimit-settled.json`, and `overlimit-settled.png` retain this observation. The exact live HTTP response is UNVERIFIED. The notification checkbox was visibly on; the helper's unmatched checkbox selector did not prove it was off. No job or notification was created.

SOURCE CONTRACT: `src/server/core-orchestration-service.ts:490` rejects trimmed prompts beyond the store limit. `src/client/OrchestrationPanel.tsx:119` formerly accepted any nonempty length. `src/client/OrchestrationPanel.tsx:743` caught mutation errors without changing ready phase, while the view rendered errors only for list-load error phase. These are separate causes, tracked by [MP-360](https://devdoo.atlassian.net/browse/MP-360) (`teams-core:bug:tab-prompt-maxlength-validation`) and [MP-361](https://devdoo.atlassian.net/browse/MP-361) (`teams-core:bug:tab-mutation-error-visible`).

FIXTURE: `scripts/client-orchestration-panel-test.tsx:266` checks exactly2,000 accepted, surrounding whitespace trimmed, and2,001 rejected before submission. The rendered-view regression checks visible ready-phase failure, preserved loaded jobs, and one list-load error. Retained RED/GREEN receipts and logs are `/tmp/teams126-continuation-20261009-0631/prompt-limit-{red,green}*` and `mutation-error-{red,green}*`.

MINIMAL CORRECTION: client and store share the canonical2,000 limit; the input provides visible Korean guidance and rejects excess text without truncation or a provider request. A ready-phase mutation failure appears as an alert while the loaded list remains available. No automatic retry, auth, policy, permission or target change.

LIVE RESULT: candidate127 is pending committed clean Core/default/source/build/package, existing catalog update, authenticated public health and fresh Teams verification. Existing126 PID60916 and tunnel52764 remain running until guarded transition. Native Teams desktop, mobile, exhaustive UI, user acknowledgement and cloud24x7 remain independent unverified gates; neither issue is Done.
