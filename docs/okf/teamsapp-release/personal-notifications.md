---
type: "Concept"
sources:
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages"
    title: "Proactive messages"
    location: "Get the conversation ID and Send the message, observed lines 37–39, 72, 94–106, 154–157 on 2026-10-06; HTML lines may change"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference"
    title: "Types of cards"
    location: "Support for Adaptive Cards, observed lines146–152 on2026-10-06; HTML lines maychange"
generated: { by: "process:codex", at: "2026-10-06T16:29:00Z" }
verified: { by: "process:mp359-client-request-boundary", at: "2026-10-08T19:58:07Z" }
status: "UNVERIFIED"
stale_after: "2026-10-15T19:58:07Z"
---

# Personal notification destination and receipt

CORE CARD CONTRACT: the project declares personal Core notifications as Adaptive Cards1.6. The canonical Microsoft page above supports bot/mobile cards up to1.6 and rejects positive/destructive action styling. The personal producer now preserves the existing masked notification content while upgrading the top-level and nested ShowCard card declarations to1.6, restricting actions toSubmit/ShowCard/OpenUrl and inputs toText/ChoiceSet. It sends attachments only; the already-masked fallback text is used only for explicit legacy or confirmed card rejection. Synthetic actualproducer RED1.2→GREEN1.6 covers progress/result/error/cancelled, nested cards, limited actions and masked text. This does not prove mobile rendering or live receipt.

REVIEW FIXTURE: schema2 persists only enabled/kind/phase/message, without duplicating the private job snapshot. The send callback reads the owned job again and constructs a public SDK ApiClient from the authenticated reference serviceUrl, cloning the existing SDK authenticated HTTP client with a 10-second timeout. A still-unsettled transport blocks additional dispatch even after the receipt becomes ambiguous. Startup recovers explicitly enabled terminal REST jobs missing an outbox event; legacy absent intent and existing ambiguous receipts are excluded. Synthetic recovery, incomplete payload rejection, inherited false override and hung transport tests passed; this is not live Teams evidence.

OFFICIAL CONTRACT: Microsoft requires the installed app and actual conversation ID/reference, captured from that context. Email/UPN is not an outbound address. Updating a message requires the actual returned activity ID. See the source above.

OBSERVED EVIDENCE: installed `@microsoft/teams.apps` is 2.0.15. Candidate node_modules/@microsoft/teams.apps/dist/app.js:344–360 constructs `App.send` with the supplied conversation ID and SDK service URL. dist/activity-sender.js:17–40 chooses create/update from activity.id. This does not establish receipt in the Teams UI.

IMPLEMENTATION: src/server/personal-notification.ts `PersonalNotificationBroker` records only SDK-authenticated personal inbound activities with Entra owner/tenant and exact bot recipient. REST body/header scope never binds a destination. The opaque `rest-*` job scope remains the authorization scope, separate from the outbound personal reference. The private atomic file is derived beside the existing agent job store. It is single-process, capped at2048 references/4096 receipts, and has no horizontal-safe or exactly-once claim. Corrupt/unknown store data fails closed at startup. No new Graph permissions, session, installation, group recipient, or login is created.

New jobs persist notification intent. A tab checkbox supplies a validated boolean included in request identity; explicit false cannot be overridden, and followup/retry continue to inherit it. Legacy missing intent does not enable this personal broker. Accepted duplicate events remain suppressed across restart. Missing reference is waiting-personal-chat. Ambiguous/exception/timeout and interrupted sending remain ambiguous and are not automatically resent. Send waits at most10 seconds; flush has one in-flight batch, at most10 entries, and does not queue duplicate flushes. Platform acceptance is separate from actual recipient read-back. Delivery failure never changes completed execution into failure.

FIXTURE: personal-notification-test.ts tests synthetic reference, owner/tenant isolation, bot/group/fallback rejection, notify:false, legacy missing intent, duplicate/restart, pending and ambiguous outcomes. agent-service-notify-false-regression-test.ts reproduced execution failure caused by a rejected notification before the fix; after the fix the controlled runner completes with its authoritative result. Existing false/approval/followup/retry branches remain tested. core-orchestration-route-test.ts and service-test.ts cover validated opt-out and durable replay identity.

LIVE RESULT (updated2026-10-07): the implementation is deployed in public111/ad1e78f; authenticated health and the exact hosted111 client asset were read back. This proves deployed code, not opt-in personal broker receipt in the actual Teams chat. The real old failed job is not retried. Its historic REST ID and absence of stored notification intent do not prove an SDK rejection or notify:false. Personal notification delivery and each UI branch remain UNVERIFIED until same-release authenticated synthetic work in the existing personal chat. The earlier A2A completion acceptance is a separate outbound path. See [current functional boundaries](functional-version-boundaries.md).


## Tab request serialization boundary (MP-359, 2026-10-08)

OBSERVED EVIDENCE: source d013d38e0df0488f4cbda874fc8b0595dcb0d26f / public125. OrchestrationPanel.tsx:767 includes notifyPersonal in submission identity, but core-orchestration-client.ts:144–154 omits it from JSON. A read-only controlled request adapter reproduced omission for both false and true without real fetch/jobs. The earlier statement that a tab checkbox supplies the boolean describes the intended contract; current125 does not satisfy this client transport boundary. The server route accepts and validates notify; this is distinct from the personal reference/broker boundary in MP-314 and checkbox layout in MP-349.

FIXTURE: scripts/client-orchestration-panel-test.tsx:172 checks the real client's exact POST body for false and true, while the earlier omitted-input case remains unchanged. Before production change the false case failed with missing notify (exit1,2026-10-08T19:56:49Z). The minimum client serialization change includes notify only when !==undefined; the same test passed (exit0,19:57:14Z). Existing synthetic route regression passed19:58:07Z. Authentication, server-derived scope, notification destination, and server boolean validation are unchanged. CoreOrchestrationService normalizes notify into request identity, so a changed preference cannot silently replay the prior request. Local controlled request output does not prove actual notification receipt.

LIVE RESULT: the fix is a1.0.126 candidate, not deployed. Public125/d013d38/PID93234 and tunnel52764 remain untouched. A current About readback on19:56:49Z displays122 while the separate personal Graph installation readback displays125; cause remains UNVERIFIED. No native desktop/mobile/notification delivery acceptance or Done is claimed. Retained RED/GREEN and route receipts: /tmp/teams-124-continuity-20261009-0409/mp359-client-json-red-receipt.json, mp359-client-json-green-receipt.json, mp359-route-regression-receipt.json.
