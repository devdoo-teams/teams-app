---
type: "Concept"
sources:
  - resource: "https://learn.microsoft.com/en-us/adaptive-cards/schema-explorer/container"
    title: "Container Element - Adaptive Cards"
    location: "Container Properties lines41-46, style lines161-173, bleed lines533-539 observed2026-10-07; updated2025-12-15; HTML lines may change, use section anchors"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference#card-collections"
    title: "Types of cards"
    location: "Card collections lines741-758 observed2026-10-07; HTML lines may change, section anchor authoritative"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings#update-a-custom-app-using-teams-admin-center"
    title: "Manage custom app policies and settings"
    location: "Existing app update and continued policies lines78-85 observed2026-10-07; updated2026-04-14; HTML lines may change"
generated: { by: "process:codex", at: "2026-10-07T17:11:56Z" }
verified: { by: "process:official-contract-and-red-green-readback", at: "2026-10-07T17:11:56Z" }
status: "CANDIDATE_UI_UNVERIFIED"
stale_after: "2026-10-14T17:11:56Z"
---

OFFICIAL CONTRACT: Container items and emphasis style are supported schema properties; bleed=false keeps content within parent padding. Teams supports up to ten Adaptive Cards in an activity carousel. These contracts do not guarantee Teams-specific padding pixels or navigation arrow geometry.

OBSERVED EVIDENCE: MP-347 reproduces on public1.0.116/e73364e0c22562aa628185d732495021fa7782af. Fresh read-only status of the already completed synthetic task-muyayrzg-0dec1960 returned four cards; no worker task was replayed. /tmp/teams-catalog-update-20261006/followup116/007-carousel-progress-before.png was directly opened at17:07:17Z; 008-carousel-conversation-before.png and009-carousel-result-before.png at17:11:56Z. Progress and conversation text are covered by the left host arrow. Read-only geometry in progress-before-geometry.json locates arrow x344..376 and body text starting x362. Installed Node24.13.1, Teams API2.0.15, ego-browser0.5.1.13.

FIXTURE: node --import tsx/esm scripts/run-module-test.mjs scripts/core-job-card-pages-test.ts failed before the product change (RED: TextBlock instead of Container,17:07:16Z) and passed after it (GREEN17:08:11Z). Exact logs and exit receipts are retained in the same followup116 directory. Assertions cover the container contract plus existing content, masking, actions, owner scope, cursor, historical invoke and refresh behavior. They do not prove pixel clearance.

IMPLEMENTATION: src/server/core-job-card-pages.ts:168 wraps carousel body content in the existing emphasis Container with bleed=false. Title and existing actions remain outside. Historical single-card bodies are unchanged. scripts/core-job-card-pages-test.ts:36 checks the requested inset for each card and reads retained summary facts inside it.

INFERENCE: The host may add enough inset to clear its arrows. Actual clearance remains UNVERIFIED until fresh candidate cards are directly reviewed in Teams. No host arrow, DOM, CSS, permission, authentication or provider configuration is changed.

LIVE RESULT:1.0.116 remains the observed catalog, installation and public runtime identity. Candidate1.0.117 requires a new clean commit, Core/default/source/build/package checks, same-commit CI, exact ZIP, same-scope catalog and installation read-back, authenticated public health and directly opened before/after screenshots. MP-347 remains In Progress. MP-338 actual error-to-success notice clearing remains independently UNVERIFIED; native desktop, exhaustive UI and mobile gates are not established by browser screenshots.
