---
type: "UI regression contract"
sources:
  - resource: "https://html.spec.whatwg.org/multipage/forms.html#the-label-element"
    title: "HTML Living Standard: the label element"
    location: "4.10.4; observed lines 975-976 on 2026-10-08; page updated 2026-10-07; HTML lines may change"
  - resource: "https://www.w3.org/TR/css-flexbox-1/#flex-items"
    title: "CSS Flexible Box Layout Module Level 1: Flex Items"
    location: "Flex Items and anonymous text items; observed lines 541-565 on 2026-10-08; HTML lines may change"
  - resource: "https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json"
    title: "Chrome DevTools Protocol browser schema"
    location: "Emulation.setDeviceMetricsOverride / clearDeviceMetricsOverride and Accessibility.getFullAXTree; version 1.3 schema observed 2026-10-08"
generated:
  by: "process:mp349-layout-regression"
  at: "2026-10-08T08:50:00Z"
verified:
  by: "process:actual-react-fixture-and-direct-visual-review"
  at: "2026-10-08T08:50:00Z"
status: draft
stale_after: "2026-10-15T08:50:00Z"
---

# MP-349 personal notification option

OFFICIAL CONTRACT: a label without `for` associates with its first labelable
descendant. A dedicated flex row and text span can control placement while
preserving that native association. This contract does not prove Teams host
behavior, keyboard focus, or a screen reader result.

OBSERVED EVIDENCE: both parent and delegated reviewer inspected the current
1.0.121 checkbox centered above its label. Generic detail labels use grid and
generic inputs use width 100% (`src/client/styles.css:43`). The real view wraps
the checkbox in its native label (`src/client/OrchestrationPanel.tsx:403`).

FIXTURE: `scripts/personal-notification-layout-fixture.tsx:40` measures actual
browser rectangles and native label association independently of CSS classes.
Build with `node scripts/build-personal-notification-layout-fixture.mjs
/tmp/<owned-fixture-output>`; serve that synthetic output on loopback with a
bounded lifetime and reuse an authorized existing Ego tab. Do not start another
browser or use this fixture as public Teams evidence. Supported tools observed:
Node 24.13.1, esbuild 0.28.1, Ego CLI 0.5.1.13, Chromium 152.0.7977.54, SDK
Page snapshot/screenshot/evaluate/cdp/keyboard. Stop on ownership loss, missing
checkbox/label, geometry failure, unexpected submit, or changed tool contract.

RED: before the source fix the native checkbox rectangle was 686px wide and
above its label. Actual geometry failed adjacency, first-line alignment and
horizontal containment. GREEN: the same browser measurement passed with a
16px checkbox; normal, 280/320px viewport, 200% CSS zoom, combined narrow/zoom
and disabled states passed. Label click, Tab, Space, repeated toggle and direct
click updated the real controlled React state without submitting. CSS zoom in
this fixture is not proof of native Teams or iPhone zoom behavior.

LIVE RESULT: new package, catalog/installation/public identity and actual Teams
UI acceptance remain pending. About-label cause, native desktop control and
mobile validation remain independent. MP-349 stays In Progress until its
required release evidence is verified; no Teams completion message is implied.

Internal evidence: `/tmp/teams-mp349-release122-20261008/layout-RED-metrics.json:1`,
`layout-GREEN-metrics.json:1`, `viewport-GREEN-metrics.json:1` and
`interaction-metrics.json:1` in the same directory, with directly reviewed PNGs.
