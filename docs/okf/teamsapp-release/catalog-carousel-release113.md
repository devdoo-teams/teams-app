---
type: "Concept"
sources:
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings#update-a-custom-app-using-teams-admin-center"
    title: "Manage custom app policies and settings"
    location: "Update a custom app using Teams admin center, observed lines78-85 on2026-10-07; page updated2026-04-14; HTML lines may change, use section anchor"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference#card-collections"
    title: "Types of cards"
    location: "Support for Adaptive Cards lines145-152 and Card collections lines741-775, observed2026-10-07; HTML lines may change, section anchors authoritative"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability#update-cards"
    title: "Send and receive messages"
    location: "Update messages and Update cards sections observed2026-10-07; HTML lines not stable; existing conversationId/activityId and incoming replyToId"
generated: { by: "process:codex", at: "2026-10-07T13:01:00Z" }
verified: { by: "process:official-contract-and-focused-fixture-readback", at: "2026-10-07T13:01:00Z" }
status: "LIVE_CANDIDATE_UNVERIFIED"
stale_after: "2026-10-14T13:01:00Z"
---

OFFICIAL CONTRACT: Teams Bot card collections permit Adaptive Card attachments with activity attachmentLayout=carousel, at most10 cards. Four separate cards are used; inner AdaptiveCard Carousel/CarouselPage is not asserted supported. Canonical en-us mobile support is AdaptiveCards1.6, with no positive/destructive styles. An existing Bot activity can be updated by conversationId/activityId/replyToId. Catalog updates use existing app details Upload file and retain existing policies.

OBSERVED EVIDENCE: installed Node24.13.1/npm11.8.0, Teams API2.0.15. node_modules/@microsoft/teams.api/dist/clients/conversation/index.d.ts:180-181 declares updateActivity(conversationId,id,params); src/server/index.ts:4318 forwards the complete collection via this existing method. Existing112 public service was restored untimed at2026-10-07T12:42:06Z, PID99068/tunnel52764, commit a9f9bbe75c35739533451db82a1c387750d32073. Its catalog/Graph installation and20PNG review are112 evidence only.

IMPLEMENTATION: src/server/core-job-card-pages.ts:62 creates new layout=carousel records. Four cards render in summary/progress/conversation/result order. New page controls remain Submit, and refresh/cursor updates send all attachments to the existing authenticated bound activity. Historical records without layout remain single-card list/invoke compatible. Keys and owner/tenant/conversation/activity/expiry checks remain unchanged; page reads never grant approval tokens. Existing summary confirmation controls remain. MP338 src/client/OrchestrationPanel.tsx:29 tags refresh versus mutation notices; a successful non-aborted load clears only the stale refresh error. MP336 scripts/teams-catalog-ui-gates.mjs:9 makes existing-control recovery bounded and explicit-scoped; :24 blocks mismatching scope and duplicate or unknown upload transfers. See docs/skills/teams-catalog-update/SKILL.md:1.

FIXTURE: clean pinned-source MP338 recovery RED then GREEN; MP339 four-attachment RED then GREEN with full-activity updates, historical invoke, scope/cursor rejection and grant preservation; MP336 RED/GREEN pressure tests plus canonical release handoff GREEN. These commands are in Core and logs retained under /tmp/teams-catalog-update-20261006/release112. The new collection pending-projection fixture now refreshes through Submit, retaining four attachments and removing cancelled approval data without changing the durable job (scripts/personal-approval-projection-test.ts:41 and :77). Whole Core passed at5633f99bbad01be44d501ab8d8c088e9b9951c8c on2026-10-07T13:24:49Z. A fixture does not establish candidate UI or upload.

INFERENCE: About-label delay may coexist with a fresh Graph installed version and working runtime/menu. Cause is UNVERIFIED; do not block independent functional testing solely on the label, and never claim a matching label while it differs.

LIVE RESULT:113 and114 were local preflight identities only and were never uploaded or activated. The corrected source requires a new higher-version identity under scripts/release-loop.mjs:2443; candidate115 build/package/CI/catalog/runtime/Teams carousel screenshots remain separate gates. Public112 remains unchanged. Automatic approval review rejected git push origin main before execution because exact shared/default-branch publication authorization was not established (MP-343); do not bypass it or claim candidate remote CI. Latest observed remote Core CI is successful for a9f9bbe75c35739533451db82a1c387750d32073 (112), run37613741283. Running112 has none of the candidate source changes. Native desktop, exhaustive same-identity UI and mobile remain independent gates. Keep requested public service untimed; do not terminate it because a synthetic test ends. Older Azure concepts are stale historical knowledge, not an operational decision for this Teams/DevTunnel release.
