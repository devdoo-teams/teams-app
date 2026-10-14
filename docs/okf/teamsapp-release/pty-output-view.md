---
type: "Implementation Contract"
title: "Masked PTY output view and same-session reconnect: isolated stage 2c"
description: "Read-only text rendering with cursor validation, bounded replay and display-only resizing; no production terminal transport."
resource: /pty-output-view.md
tags: [teamsapp, pty, redacted-lines, rendering, reconnect, synthetic-preview]
generated:
  by: "Codex /root"
  at: "2026-10-14T07:44:00Z"
verified:
  by: "Codex /root, reader/markup contracts and isolated headless browser"
  at: "2026-10-14T07:41:09Z"
status: "local-contract-pass-foreground-and-production-unverified"
stale_after: "2026-11-13T07:41:09Z"
sources:
  - id: xterm-security
    resource: "https://xtermjs.org/docs/guides/security/"
    title: "xterm.js Security"
    location: "Are terminals dangerous; HTML/JS to terminal and terminal to HTML/JS; websockets. Observed lines 3-11, 53-78 on 2026-10-14. HTML lines are not stable; no page update date is published."
  - id: xterm-flow
    resource: "https://xtermjs.org/docs/guides/flowcontrol/"
    title: "Flow Control for xterm.js"
    location: "How xterm.js processes incoming data; Flow control over websockets. Observed lines 7-33, 89-121 on 2026-10-14. HTML lines are not stable."
  - id: react-children
    resource: "https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html"
    title: "React common DOM components"
    location: "children versus dangerouslySetInnerHTML; Reference props and Dangerously setting the inner HTML sections; read 2026-10-14. HTML lines are not stable."
  - id: playwright-launch
    resource: "https://playwright.dev/docs/api/class-browsertype#browser-type-launch"
    title: "Playwright BrowserType.launch"
    location: "headless, executablePath, chromiumSandbox and isolated browser context contracts; read 2026-10-14. Installed package types/CLI version were checked separately."
---

# Purpose and selected path

The existing registry already produces a bounded `redacted-lines` projection of PTY callbacks. This unit makes that projection inspectable in an independent synthetic page and reconnects the same identity from its last accepted cursor. Production151, existing authenticated jobs, package, permissions and deployment remain preserved.

This is a bounded extension of the existing read contract. The selected rendering path is plain React text children inside a scrollable `pre`. It is **not a terminal emulator**. No xterm implementation or new dependency is installed or copied.

|Path|Output semantics|Decision in this unit|
|---|---|---|
|Raw VT into xterm|Interprets screen/cursor/control sequences; requires privacy, reset/replay and asynchronous write accounting|Deferred; current line masking cannot preserve those semantics|
|Masked lines into an emulator|Already lost cursor/color/alternate-screen information; replay would not reconstruct the original screen|No benefit for the current contract|
|Masked lines into text nodes|Preserves the safe projection and its explicit loss flags; no VT, HTML, links or input interpretation|Selected and tested|

# OFFICIAL CONTRACT

xterm's security guide treats terminal data as untrusted and requires safe DOM updates. It distinguishes page scripting risks from terminal-origin data and warns that WebSocket transport needs its own authorization rather than inheriting HTTP origin controls. Its flow-control guide describes asynchronous `write` processing and explicit acknowledgement accounting. These are requirements for a future raw renderer, not capabilities supplied by this text view.

React's `children` and raw-HTML insertion are different APIs. This view passes strings as children and never uses raw HTML, parser hooks, title handlers, linkifiers or terminal input. This selection reduces the interpreter surface; it does not assert that every possible secret in arbitrary human output can be detected.

# OBSERVED EVIDENCE / implementation

- `src/shared/pty-read.ts:1` owns the unchanged snapshot/identity types. The server re-exports its former public types; registry ownership, masking and process control behavior remain unchanged.
- `src/client/pty-output-reader.ts:27` consumes only an injected read capability. There is no URL, HTTP route, socket, authentication bypass, CLI launch, write or process control.
- Identity is copied by explicit fields and the original read function is pinned. Every response must match job/session/generation, `source=pty`, `outputMode=redacted-lines`, contiguous sequence/cursor boundaries, limits and field types before cursor advancement.
- Control-bearing or bidi-control-bearing frames, raw VT, malformed/foreign responses and regressed terminal states/loss flags fail closed. An authorization/session error removes retained output. Fixed error codes prevent raw diagnostic/credential disclosure.
- One request is reserved before the loading callback, including reentrant/duplicate clicks. Timeout, disconnect and close abort only the observer. An epoch rejects late responses, and reconnect uses the same identity/cursor. No process resume or new generation is created.
- Retention is bounded by frames and UTF-8 bytes. Eviction drops complete already-masked frames, sets an explicit history-loss flag and cannot silently join a replay gap. Returned frame/exit objects are copied/frozen.
- `src/client/PtyOutputView.tsx:17` renders accessible read/reconnect/close controls and explicit empty/loading/stale/blocked/exit/loss states. Links and HTML-shaped strings remain text. Closing hides private text/identity and removes component controls.

## Resize contract

The viewport is **display-only**: integer columns20..240, rows4..80, default80x24. It changes the text region's maximum width and height; CSS wraps lines to the actual browser width. It preserves frames, cursor and the current read attempt. There is no `IPty.resize`, signal, transport message or claim that a process's terminal dimensions changed. Native PTY resizing remains unimplemented and needs its own lease/host contract.

# FIXTURE / LOCAL RESULT

- Reader:21 checks PASS using the real existing registry/Core scope/redaction and synthetic event source plus injected read transport. Covers split secrets/controls, same-generation cursor reconnect, duplicate/reentrant reads, late response, gaps/limits, denial, timeout, invalid identity/mode/cursor, state regression, immutable projection and observer-only close/resize.
- Static React markup:9 checks PASS. Covers escaped HTML, no links/inputs, Korean/emoji, empty/loading/stale/blocked/closed, process states, loss flags and display bounds.
- Initial isolated headless Chromium run:11 checks PASS and10 screenshots directly opened by `/root`. Viewports1280x960 and390x844; no horizontal overflow, external request, console/page error, dialog or input/process-control call. This first run used a dirty development tree and is retained as draft evidence; final exact-commit evidence is bound in the handoff.
- The fixture uses three precomputed snapshots from a private temporary Core job/registry: initial output, one appended line, and synthetic exit7 with final partial-line masking. It creates no OS PTY/process. The browser bundle is checked to contain no server code. Its `file://` HTML has no listener and CSP `connect-src 'none'`; synthetic HTML-like payloads are escaped in the embedded data.
- Direct image review found a fixture header font fallback after reload. The fixture now sets a system body font. The exit capture explicitly scrolls the text region to show the final masked line. These change only the test artifact/harness.

## Reproduce

```sh
node --import tsx/esm scripts/pty-output-view-test.ts
node --import tsx/esm scripts/pty-output-view-ui-test.tsx
node --import tsx/esm scripts/pty-output-preview-fixture.ts
# Use the new fixture index.html/receipt path printed above, an existing Playwright
# installation, a private evidence directory and an installed Chromium executable.
node scripts/pty-output-view-browser-test.mjs /fixture/index.html /existing/playwright /private/evidence /existing/chrome
npm run test:core
```

No dependency installation or public browser session is needed. The headless invocation uses its own temporary browser context with Chromium sandbox enabled and blocks remote requests. It never attaches to a user profile or operates the shared Mac screen.

# LIVE RESULT / independent gates

- **FOREGROUND_UNVERIFIED**: the iPhone owner has the Mac screen slot. Headless pixels are page-surface evidence, not a foreground Mac window, popup or native Teams verification. A later owner must foreground the independent synthetic page, capture/open its pixels and record matching source/fixture identity.
- **TEAMS_WEB/DESKTOP/IPHONE_UNVERIFIED for this unit**: the component is not wired into the deployed Teams app. A390px browser viewport is not native Teams mobile testing.
- **PRODUCTION_TRANSPORT_UNCONNECTED**: no route, socket or production credential/job connection is added. Future authenticated transport must independently validate access revocation, identity, replay and bounded response handling.
- **RAW_VT_UNIMPLEMENTED**: no exact terminal fidelity, terminal resize, write/ACK/backpressure, clipboard/title/link handling or command input is claimed. Their authorization/privacy contracts remain separate.
- **WINDOWS_CONPTY_UNVERIFIED**: this page is not a Windows process/handle cleanup test.
- Existing151 operating identity/tag/ZIP/install state is preserved. No version/package/deployment/release/catalog mutation or Teams completion message belongs to this internal follow-up. Original user files remain excluded from the commit.
