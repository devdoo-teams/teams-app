---
type: "Concept"
sources:
  - resource: "https://learn.microsoft.com/en-us/adaptive-cards/schema-explorer/container"
    title: "Container Element - Adaptive Cards"
    location: "Container Properties lines41-48, style lines161-173, bleed lines533-539, minHeight lines633-659 observed2026-10-07; updated2025-12-15; HTML lines may change, use section anchors"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference#card-collections"
    title: "Types of cards"
    location: "Card collections lines741-758 observed2026-10-07; HTML lines may change, section anchor authoritative"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings#update-a-custom-app-using-teams-admin-center"
    title: "Manage custom app policies and settings"
    location: "Existing app update and continued policies lines78-85 observed2026-10-07; updated2026-04-14; HTML lines may change"
generated: { by: "process:codex", at: "2026-10-07T19:41:29Z" }
verified: { by: "process:official-contract-and-red-green-readback", at: "2026-10-07T19:43:33Z" }
status: "CANDIDATE_UI_UNVERIFIED"
stale_after: "2026-10-14T19:41:29Z"
---

OFFICIAL CONTRACT: Container items and emphasis style are supported schema properties; bleed=false keeps content within parent padding. Teams supports up to ten Adaptive Cards in an activity carousel. These contracts do not guarantee Teams-specific padding pixels or navigation arrow geometry.

OBSERVED EVIDENCE: MP-347 reproduces on public1.0.116/e73364e0c22562aa628185d732495021fa7782af. Fresh read-only status of the already completed synthetic task-muyayrzg-0dec1960 returned four cards; no worker task was replayed. /tmp/teams-catalog-update-20261006/followup116/007-carousel-progress-before.png was directly opened at17:07:17Z; 008-carousel-conversation-before.png and009-carousel-result-before.png at17:11:56Z. Progress and conversation text are covered by the left host arrow. Read-only geometry in progress-before-geometry.json locates arrow x344..376 and body text starting x362. Installed Node24.13.1, Teams API2.0.15, ego-browser0.5.1.13.

FIXTURE: node --import tsx/esm scripts/run-module-test.mjs scripts/core-job-card-pages-test.ts failed before the product change (RED: TextBlock instead of Container,17:07:16Z) and passed after it (GREEN17:08:11Z). Exact logs and exit receipts are retained in the same followup116 directory. Assertions cover the container contract plus existing content, masking, actions, owner scope, cursor, historical invoke and refresh behavior. They do not prove pixel clearance.

IMPLEMENTATION: src/server/core-job-card-pages.ts:168 wraps carousel body content in the existing emphasis Container with bleed=false. Title and existing actions remain outside. Historical single-card bodies are unchanged. scripts/core-job-card-pages-test.ts:36 checks the requested inset for each card and reads retained summary facts inside it.

INFERENCE: The host may add enough inset to clear its arrows. Actual clearance remains UNVERIFIED until fresh candidate cards are directly reviewed in Teams. No host arrow, DOM, CSS, permission, authentication or provider configuration is changed.

FIXTURE COMPATIBILITY: Candidate117 canonical Core stopped because two existing synthetic chat-runtime fixture readers assumed a top-level FactSet. Their isolated RED commands are retained under /tmp/teams-catalog-update-20261006/release117/mp347-chat-wrapper-RED.log and mp347-confirmation-wrapper-RED.log. Readers now inspect direct body elements and Container items while retaining actual job ID/status, auth/owner, confirmation and worker execution assertions. Product data and controls are unchanged. The initial sandbox listen EPERM is separate environment evidence, not a card or authentication failure.

FIXTURE FOLLOW-UP: Candidate118 reached the receipt-presentation test and exposed a carousel-specific direct-body-only reader at scripts/receipt-presentation-test.tsx:76. The focused RED is retained under /tmp/teams-catalog-update-20261006/release118/mp347-receipt-reader-RED.log. The summary reader now traverses Container items before reading facts; every selected-versus-observed, true-zero and unavailable metadata assertion is retained. The initial single-line search missed the multiline direct-FactSet filter at scripts/core-orchestration-runtime-composition-test.ts:411; candidate119 full Core and its isolated RED caught it. That reader now traverses Container items too, retaining model-selection argv, receipt and owner/auth checks. The corrected direct FactSet/item.facts/element.facts audit enumerated multiline consumers as well; ordinary single-card readers are unchanged.

LIVE RESULT: Candidates117/118/119 failed Core before packaging, publication or activation.1.0.120/681d6ab41fe3a423404af4067dbc057721819fc5 subsequently passed Core/default/source/build/package, same-commit CI and same-scope catalog/install/public gates. Parent directly reviewed all34 previous120 PNG. Body first-character readability improved; this acceptance is retained. New source changes require a new identity and independently verified gates.

OBSERVED EVIDENCE:120 follow-up result without acknowledgment has2px arrow/action vertical gap. Actual refresh produces Teams acknowledgment; previous arrow intersects refresh14x9.5px. Read-only geometry plus actual overlap-center click navigates to conversation3 instead of refreshing result4. Exact receipts: /tmp/teams-catalog-update-20261006/followup120/result-hit-area-with-ack.json:2, overlap-click-receipt.json:2; directly opened004-result120-ack.png and005-overlap-hit-result.png at2026-10-07T19:27:07Z. Keyboard Tab reaches refresh and Enter works; after card update activeElement is BODY, independently tracked as MP-348. No worker was replayed.

OFFICIAL CONTRACT: [Container minHeight](https://learn.microsoft.com/en-us/adaptive-cards/schema-explorer/container#minheight) is a pixels string supported since1.2; the canonical Teams card contract remains1.6. Host arrow centering and focus restoration are not guaranteed by these properties.

FIXTURE/CANDIDATE121: scripts/core-job-card-pages-test.ts:40 derives declared action clearance from the observed120 result geometry and requires at least8px. Its focused RED failed with-9.5px at19:41:29Z; same command GREEN at19:43:33Z after the minimal change, retaining legacy, action, binding, owner, masking, confirmation and no-worker-mutation assertions. Exact logs and command/exit receipts are retained in /tmp/teams-catalog-update-20261006/release121/mp347-clearance-RED.log and mp347-clearance-GREEN.log. src/server/core-job-card-pages.ts:168 requests minHeight96px in the existing Container; no action/binding/legacy/provider/auth/permission/default-reasoning change. The centered-arrow fixture predicts12.5px gap. This is FIXTURE/INFERENCE, not host pixel acceptance. Full Core, clean commit/new package/CI and actual Teams pointer/keyboard read-back are required before claiming this candidate works.

BOUNDARIES: MP-347 and MP-348 remain In Progress until same-release required UI acceptance. MP-338 local load/client/poll/view integration PASS is not public mounted error-to-success proof; LIVE_RECOVERY_UNVERIFIED remains. Native desktop, exhaustive UI and mobile gates are independently BLOCKED/UNVERIFIED. Read-only worker --ignore-user-config and explicit UI reasoning selection are unchanged.
