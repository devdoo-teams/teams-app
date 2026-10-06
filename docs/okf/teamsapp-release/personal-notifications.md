---
type: "Concept"
sources:
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages"
    title: "Proactive messages"
    location: "Get the conversation ID and Send the message, observed lines 37–39, 72, 94–106, 154–157 on 2026-10-06; HTML lines may change"
generated: { by: "process:codex", at: "2026-10-06T16:29:00Z" }
verified: { by: "process:official-document-and-installed-package-read", at: "2026-10-06T16:29:00Z" }
status: "UNVERIFIED"
stale_after: "2026-10-13T16:29:00Z"
---

# Personal notification destination and receipt

OFFICIAL CONTRACT: Microsoft requires the installed app and actual conversation ID/reference, captured from that context. Email/UPN is not an outbound address. Updating a message requires the actual returned activity ID. See the source above.

OBSERVED EVIDENCE: installed `@microsoft/teams.apps` is 2.0.15. Candidate node_modules/@microsoft/teams.apps/dist/app.js:344–360 constructs `App.send` with the supplied conversation ID and SDK service URL. dist/activity-sender.js:17–40 chooses create/update from activity.id. This does not establish receipt in the Teams UI.

IMPLEMENTATION: src/server/personal-notification.ts `PersonalNotificationBroker` records only SDK-authenticated personal inbound activities with Entra owner/tenant and exact bot recipient. REST body/header scope never binds a destination. The opaque `rest-*` job scope remains the authorization scope, separate from the outbound personal reference. The private atomic file is derived beside the existing agent job store. It is single-process, capped at2048 references/4096 receipts, and has no horizontal-safe or exactly-once claim. Corrupt/unknown store data fails closed at startup. No new Graph permissions, session, installation, group recipient, or login is created.

New jobs persist notification intent. A tab checkbox supplies a validated boolean included in request identity; explicit false cannot be overridden, and followup/retry continue to inherit it. Legacy missing intent does not enable this personal broker. Accepted duplicate events remain suppressed across restart. Missing reference is waiting-personal-chat. Ambiguous/exception/timeout and interrupted sending remain ambiguous and are not automatically resent. Send waits at most10 seconds; flush has one in-flight batch, at most10 entries, and does not queue duplicate flushes. Platform acceptance is separate from actual recipient read-back. Delivery failure never changes completed execution into failure.

FIXTURE: personal-notification-test.ts tests synthetic reference, owner/tenant isolation, bot/group/fallback rejection, notify:false, legacy missing intent, duplicate/restart, pending and ambiguous outcomes. agent-service-notify-false-regression-test.ts reproduced execution failure caused by a rejected notification before the fix; after the fix the controlled runner completes with its authoritative result. Existing false/approval/followup/retry branches remain tested. core-orchestration-route-test.ts and service-test.ts cover validated opt-out and durable replay identity.

LIVE RESULT: new implementation not yet deployed. The real old failed job is not retried. Its historic REST ID and absence of stored notification intent do not prove an SDK rejection or notify:false. New personal notification delivery and UI read-back remain UNVERIFIED until same-release authenticated synthetic work in the existing personal chat.
