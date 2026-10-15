---
type: "Implementation Contract"
title: "Existing GET output monitor: query control and bounded command excerpts"
description: "Observer-only pause/reconnect and the existing server-masked CLI projection; native PTY production wiring remains separate."
resource: /output-monitor-query-control.md
generated: { by: "Codex /root", at: "2026-10-15T03:32:40Z" }
verified: { by: "Codex /root, rendered153 finding and View/session RED/GREEN", at: "2026-10-15T05:02:00Z" }
status: "candidate-focused-pass-local-pixel-retest-required"
stale_after: "2026-11-14T03:30:00Z"
sources:
  - resource: "https://react.dev/reference/react-dom/components/common#mouseevent-handler"
    title: "React common components: mouse event handlers"
    location: "onClick and onDoubleClick; read2026-10-15; HTML lines92-107 observed, unstable"
  - resource: "https://esbuild.github.io/content-types/#css"
    title: "esbuild CSS bundling"
    location: "CSS imports and bundling; read2026-10-15; section anchor used because HTML lines are unstable"
  - resource: "https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable"
    title: "Codex non-interactive JSONL output"
    location: "stdout JSONL and saved authentication; read2026-10-15; HTML lines are unstable"
  - resource: "https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/exec/src/event_processor_with_jsonl_output.rs"
    title: "Pinned Codex exec producer"
    location: "collect_thread_events, source456-471 and547-577; command starts/completions and todo-list updates; read2026-10-15"
  - resource: "https://github.com/microsoft/node-pty/blob/1def5774632305246fe21f0f69e23a664d6c5910/typings/node-pty.d.ts"
    title: "node-pty1.1.0 single output stream"
    location: "IPty onData/onExit; read2026-10-15; independent stdout provenance is not exposed"
---

# Intent and bounded implementation

The existing Teams monitor observes CLI status and saved output through its
current authenticated Core GET API. This change gives that existing flow an
explicit observer pause/reconnect lifecycle and a view of the already available
masked command excerpt, capped at1024characters per command and16recent command
identities per panel. The shorter existing summary and Core job status remain
separate. It does not request new provider, token, permission or deployment scope.

# OFFICIAL CONTRACT and actual boundary

The Codex non-interactive contract identifies stdout as JSONL. The inspected
producer maps command start/completion, whereas its item.updated path here is a
todo-list projection. This does not establish incremental command-byte output.
Installed service CLI0.162.0-alpha.17.2 and its SHA/signature/default permission
preflight were independently exercised in the preceding152native trial. That
trial's merged native PTY frames are observations, not authoritative Core events.
The inspected upstream source is a contract reference, not proof of the exact
installed native binary build source.

Production still lacks all three PTY connections: provider native launch
capability, mounted authenticated PTY read transport, and injected client
capability. Core execution keeps independent stdout/stderr pipes. Supporting a
full production terminal requires a separately reviewed structured-result
channel plus the existing ownership/privacy/lifetime gates; inventing a stderr
port, parsing mixed PTY JSON as authoritative output, or running the same task
twice cannot bridge that boundary. No socket, terminal input or such fallback is
introduced by this slice.

# OBSERVED EVIDENCE: RED/GREEN

- The monitor initially had no bounded command-output projection beyond its
  short128character/3line tool summary. A focused assertion first failed and
  now preserves the existing server-masked1024character excerpt, identity,
  in-progress/terminal status, exit and truncation. A terminal command does not
  complete its running Core job. Legacy names do not invent terminal evidence.
- An observer session was missing. RED then GREEN covers pending-read abort,
  stale response suppression, retained last-read labeling, duplicate reconnect
  coalescing, no reads while paused, poll restart only after a fresh read,
  paused selection replacement and disposal without any mutation capability.
- A pause requested from the loading callback initially still started a GET.
  Its RED/GREEN guard now stops before request creation.
- A401/403 after polling started initially cleared text but did not stop the
  owned timer. The new regression stops it even when the host keeps the
  component mounted; reconnect cannot revive a denied reader.
- A paused failed row initially still promised a retry in3seconds. Its focused
  rendering regression now requires the explicit paused/reconnect message.
- Rendering tests cover2/4panels, mobile selection, empty/error/denied/stale
  selection, text escaping, expanded output beyond the summary and distinct
  CLI observation versus Core outcome. They do not replace pixel review.

Internal code and tests:

- src/client/work-output-monitor.ts:19 (bounded command projection),
  src/client/work-output-monitor.ts:130 (owned observer session).
- src/client/WorkOutputMonitor.tsx:31 (controls),
  src/client/WorkOutputMonitor.tsx:94 (existing masked excerpts).
- scripts/work-output-monitor-test.ts:119 (projection/lifecycle),
  scripts/work-output-monitor-ui-test.tsx:64 (rendering branches).

# Reproduction

## Follow-up: MP-389 rendered153 double reconnect

The synthetic rendered153 UI reproduced a double click issuing four fresh reads
then aborting all four and returning to paused. A new test invokes the actual
View callbacks at the same control position against the real reader/session;
it was RED with `connection=paused,newReads=4,newAborts=4`. The first click
published connected/loading, changing the same button from resume to pause.
The existing `resume()`-twice session test did not reach this View behavior.

Pause and reconnect now keep separate fixed actions/positions. Reconnect is
inactive while connected, while explicit pause remains usable during a pending
read. GREEN requires one read per selected job, zero accidental aborts, one
poller after success, and intentional pause/late-response suppression. This
callback replay is not browser/native event or Teams acceptance; the original
synthetic browser double click must still be repeated on the new candidate.

The standalone synthetic153 HTML also concatenated `styles.css` without its
two local CSS imports, which its `style-src 'unsafe-inline'` CSP blocked. This
is fixture packaging evidence, not a production CSP failure. The fixture
rebuild bundles the CSS import closure inline and uses the same
`shell agent-hub-shell` wrapper as `src/client/App.tsx:175`; no production CSP,
auth or unrelated stylesheet change is part of the reconnect correction.

Official references refreshed2026-10-15: [React click/double-click handlers](https://react.dev/reference/react-dom/components/common#mouseevent-handler)
and [esbuild CSS bundling](https://esbuild.github.io/content-types/#css).
Local RED/GREEN and the three directly reviewed synthetic153 PNGs are retained
under `/private/tmp/teams154-monitor-fix-20261015-qziyr8_u`. Actual153 Teams
Web/Mac remains0/17; iPhone and productionPTY are unverified/disconnected.

```sh
node --import tsx/esm scripts/run-module-test.mjs scripts/work-output-monitor-test.ts
node --import tsx/esm scripts/run-module-test.mjs scripts/work-output-monitor-ui-test.tsx
npm run test:output-monitor
npm run test:core
```

Dirty-source RED/GREEN used the first two direct commands. The pinned test and
source-check runners correctly reject a dirty FileProvider fallback checkout;
that guard is preserved. Full Core/type/build/package and exact-SHA remote CI
must bind the subsequent committed candidate, with immutable receipts in the
release evidence index. No precommit test result is a newer commit's CI pass.

# LIVE RESULT / remaining UI gates

The implementation and focused tests are local candidate evidence. Actual
Teams Web/Mac before/after pixels, AX and runtime read-back must confirm pause,
reconnect, expanded Korean output, no job execution/cancel side effects and
2/4panel behavior for the final release identity. The existing Ego session is
user-owned pending a response; do not take it over. The parent installation/UI
owner has native Computer Use and receives this handoff. Actual iPhone remains
separate and later; About151 is independently tracked under the user's override.
Neither is substituted with a synthetic browser or treated as a blanket hold on
independent approved work.
