---
type: "Concept"
sources:
  - resource: "https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/universal-action-model"
    title: "Universal Action Model"
    location: "Schema lines49–60, adaptiveCard/action request/response lines170–216 observed2026-10-06; HTML lines may change, anchors #schema and #response-format"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/sequential-workflows"
    title: "Sequential Workflow for Adaptive Cards"
    location: "Action.Execute replacement-card workflow observed2026-10-06; HTML lines may change"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference"
    title: "Types of cards"
    location: "Support for Adaptive Cards, canonical en-us section, observed2026-10-06"
generated: { by: "process:codex", at: "2026-10-06T17:58:23Z" }
verified: { by: "process:official-document-and-installed-package-read", at: "2026-10-06T17:58:23Z" }
status: "UNVERIFIED"
stale_after: "2026-10-13T17:58:23Z"
---

# Same-message private job card pages

OFFICIAL CONTRACT: Universal Actions require card schema1.4 or greater. The response inner status200/type `application/vnd.microsoft.card.adaptive` returns a replacement for the current card; outer HTTP200 alone does not prove success. Submit fallback is a separate older-client path. Installed Teams SDK2.0.15 exposes `conversations.updateActivity(conversationId,id,params)` in node_modules/@microsoft/teams.api/dist/clients/conversation/index.d.ts:180–181. The workflow example's differently ordered MIME string is not copied: Universal Action Model line216 agrees with the SDK AdaptiveCardActionCardResponse type.

PROJECT CONTRACT: Core cards still declare1.6 and default to Submit/ShowCard/OpenUrl. Page navigation uses Submit with a verified existing activity update, never a new-message fallback. `TEAMS_CARD_UNIVERSAL_ACTIONS=true` is an explicit opt-in for Action.Execute+Submit fallback; its synthetic tests are separate from actual host rendering evidence. This flag grants no permissions and authorizes no deployment. Page actions and fallback specify associatedInputs:none so expanded input forms do not contaminate read requests.

OBSERVED EVIDENCE: the existing public runtime is1.0.104/4f and native installation remained1.0.103 in the fresh desktop About read-back. A local1.0.107 package passed machine/package, but its public identity gate failed104vs107. Public server transition was rejected by approval review as a separate operational change without approval. Local page implementation does not bypass that boundary.

IMPLEMENTATION: private, owner-only atomic `core-job-card-pages.json` beside the existing job store persists only random card key, job/owner/tenant/personal conversation/activity binding, selected page/cursor and seven-day expiry, capped at4096 live records. It stores no prompts/results/raw CLI transcript. A binding requires a connector-returned activity ID; missing/foreign/expired/unbound/tampered keys fail closed. SDK acceptance survives a UI-state bind-write failure, with separate blocked binding observation and no second send.

Summary shows status and existing explicit confirmation controls. Progress shows at most five safe events. Conversation walks at most20 owner-authorized parent jobs, rejects mismatched durable threads/cycles, presents one bounded request/response turn at a time and gives a verified tab deep link. Missing history is labeled. Result displays an observed final result/error or an explicit empty state; unverified artifact URLs are not promoted to links. Group cards never gain private history navigation. Reads never call job mutation, execution, observation-refresh or notification delivery. Submit updates also fail closed before reference/SDK calls when TEAMS_SKIP_OUTBOUND is set; they do not publish a new selected page.

FIXTURE: scripts/core-job-card-pages-test.ts covers same-activity update, invoke no-send, ownership/tenant/conversation/job/key/cursor rejection, unbound IDs, restart/refresh selection, failed update retaining page, masked content, no persisted job text, default Submit and explicit Universal actions, expanded Input.Text with associatedInputs:none, accepted send/bind failure preserving receipt and message count. It does not prove live SDK update/recipient reception/mobile rendering.

LIVE RESULT: not deployed. Public104 preserved; actual card page rendering/reception, full same-identity desktop matrix, mobile and worker-runtime remain UNVERIFIED. Do not report DESKTOP_READY/MOBILE_READY or transition Jira Done from fixtures.
