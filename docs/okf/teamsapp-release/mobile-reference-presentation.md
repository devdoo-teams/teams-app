---
type: "Concept"
sources:
  - resource: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details"
    title: "HTML details disclosure"
    location: "open / Usage notes, observed lines 186–187 and 231–251 on 2026-10-10; HTML positions may change"
  - resource: "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit"
    title: "CSS object-fit"
    location: "contain / cover values, observed lines 245–269 on 2026-10-10; page modified 2026-07-21"
  - resource: "https://docs.copilotkit.ai/reference/components/CopilotChatView"
    title: "CopilotKit ChatView public slots and layout"
    location: "Styling slots / Behavior, observed lines 179–218 on 2026-10-10; HTML positions may change"
generated: { by: "process:codex", at: "2026-10-10T08:28:57Z" }
verified: { by: "process:primary-documents-and-installed-sdk", at: "2026-10-10T08:28:57Z" }
status: "CANDIDATE_LOCAL_VALIDATION_PENDING_LIVE_UNVERIFIED"
stale_after: "2026-10-17T08:28:57Z"
---

# Mobile reference presentation in existing execution views

## OFFICIAL CONTRACT

Native HTML details is closed without the boolean `open` attribute and supports keyboard activation. `object-fit: contain` preserves the entire object's aspect ratio. Image width/height stay automatic, constrained by available body width and a height ceiling; the Trello reference's observed 55–60% width is not a universal sizing contract.

Installed Node 24.13.1, React 19.2.8 and CopilotKit 1.66.2 are retained. ChatView supports its public root className and composer sendButton className. The installed SDK has an absolute input overlay and calculated scroll padding (`node_modules/@copilotkit/react-core/dist/v2/index.umd.js:7681` and `:7754`). Scoped CSS puts that same controlled composer in normal flow and removes reserved overlay space. No agent API, provider call, authentication or execution callback changes.

The current online custom-layout example mentions an `inputContainer` child which the installed SDK does not return. This candidate does not use that example; that layout API remains `CONTRACT_DRIFT_BLOCKED` pending a matching installed contract.

## OBSERVED EVIDENCE

The approved four-reference comparison is `/tmp/teams137-mobile-reference-review-20261010/Teams137_모바일참고화면_배치비교_20261010.md`. MP-383 tracks `teams-core:task:mobile-reference-presentation`. Shared result rendering previously displayed image syntax literally; `/tmp/teams-mobile138-20261010/presentation-content-RED.log` records that failure. The matching GREEN checks bounded same-origin raster rows, literal HTML escaping, rejected remote/traversal/query/SVG paths, full long result retention, and mandatory failure outside collapsed diagnostics. Shared renderer: `src/client/PresentationContent.tsx:1`; result and diagnostics: `src/client/ExecutionPresentationCard.tsx:8`.

## FIXTURE

MP-384 records the mobile settings failure in the first 138 candidate: the installed SDK's later stylesheet kept `display:flex`, a block label and a 68px selector inside a 336px settings container. `/tmp/teams-mobile138-20261010/controls-RED.json` and `controls-RED.png` bind the retained old DOM to commit `784572a4b41c01e3d79d8e0ab2fb9ea1369fadb0`. The correction pins the grid after the SDK base rule and places the location label above its full-width selector (`src/client/copilot-job-view.css:35`, `src/client/execution-presentation.css:59`). New committed-source captures replace the first candidate's screenshots; old captures are not current acceptance evidence.

Narrow and wide mobile viewport captures must run actual committed production components and installed SDK against synthetic owner API responses. All requested screenshots require direct visual review with file, time, reviewer, observation and verdict. Browser viewport emulation is not an actual Teams mobile host, keyboard, permission or iOS WebView test.

## LIVE RESULT

Existing public 1.0.135 is retained. Candidate 1.0.138, package identity, source checks, visual review and exact SHA CI have independent receipts. No public runtime replacement, catalog switch, new permissions, real CLI jobs, new login/tab or Simulator operation is authorized here. Native Teams desktop tools are unavailable in this executor; actual desktop/mobile acceptance remains `UNVERIFIED`. MP-383 remains open until required same-release host evidence exists.
