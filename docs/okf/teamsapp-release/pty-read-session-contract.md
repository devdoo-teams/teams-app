---
type: "Implementation Contract"
title: "Native PTY session identity and read projection: isolated stage 2a"
description: "Internal owner-scoped PTY observation, bounded redacted reads and native Mac fixture evidence; production execution and terminal transport remain disconnected."
resource: /pty-read-session-contract.md
tags: [teamsapp, terminal, pty, ownership, reconnect, native-fixture]
generated:
  by: "Codex /root"
  at: "2026-10-14T06:15:00Z"
verified:
  by: "Codex /root, contract tests and native node-pty fixtures"
  at: "2026-10-14T06:14:37Z"
status: "local-contract-pass-production-unconnected"
stale_after: "2026-11-13T06:14:37Z"
sources:
  - id: node-pty-api
    resource: "https://github.com/microsoft/node-pty/blob/1def5774632305246fe21f0f69e23a664d6c5910/typings/node-pty.d.ts"
    title: "node-pty v1.1.0 public IPty contract"
    location: "spawn/options and IPty pid/onData/onExit/kill; source lines 16-49, 116-155, 178-187; read 2026-10-14"
  - id: node-pty-license
    resource: "https://github.com/microsoft/node-pty/blob/1def5774632305246fe21f0f69e23a664d6c5910/LICENSE"
    title: "node-pty MIT licenses"
    location: "Entire license file; read 2026-10-14"
  - id: node-pty-native-packaging
    resource: "https://github.com/microsoft/node-pty/issues/850"
    title: "spawn-helper shipped without execute bit in npm tarball"
    location: "Issue description; independently reproduced in private temporary npm1.1.0 installation on 2026-10-14"
  - id: node-pty-stable-packaging
    resource: "https://github.com/microsoft/node-pty/issues/919"
    title: "Stable1.1.0 spawn-helper packaging follow-up"
    location: "Description and stable/beta distinction; report is not a platform readiness guarantee"
  - id: xterm-public-api
    resource: "https://github.com/xtermjs/xterm.js/blob/991857a1b1cacf06f9531ba74a6e927a7a6398bb/typings/xterm.d.ts"
    title: "xterm.js public API"
    location: "ITerminalOptions.disableStdin, linkHandler, scrollback; Terminal.write/dispose; source inspected 2026-10-14"
  - id: xterm-license
    resource: "https://github.com/xtermjs/xterm.js/blob/991857a1b1cacf06f9531ba74a6e927a7a6398bb/LICENSE"
    title: "xterm.js MIT license"
    location: "Entire license file; read 2026-10-14"
  - id: xterm-security
    resource: "https://xtermjs.org/docs/guides/security/"
    title: "xterm.js security guide"
    location: "Are terminals dangerous; HTML/JS threats; websockets; observed web lines 3-11, 53-78; HTML line numbers are not stable"
  - id: xterm-flow
    resource: "https://xtermjs.org/docs/guides/flowcontrol/"
    title: "xterm.js flow control"
    location: "write callback, watermark and WebSocket ACK sections; observed lines 9-33, 89-121; HTML lines not stable"
  - id: conpty
    resource: "https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session"
    title: "Creating a Pseudoconsole session"
    location: "Communication channels, HANDLE lifetime, child startup and teardown sections; observed 2026-10-14; HTML lines not stable"
  - id: teams-tab
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/tab-requirements"
    title: "Teams tab requirements"
    location: "HTTPS, frame-ancestors, app.initialize and sign-in restrictions; observed web lines 31-69; HTML lines not stable"
  - id: teams-mobile
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/design/tabs-mobile"
    title: "Teams mobile tab functions"
    location: "Mobile client tests, authentication, low-bandwidth/intermittent connections; observed lines 31, 45-54; page updated2023-11-17"
  - id: teams-sso
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview"
    title: "Teams tab SSO overview"
    location: "SSO flow and server token validation; read 2026-10-14; HTML lines not stable"
---

# Purpose and minimum scope

The151 stored-output monitor is already implemented. The next independently testable unit observes **genuine, already-created native PTYs** through a server-internal capability. It establishes identity, generation, exit, cursor reconnect and a safe read projection before any browser terminal connection.

This unit adds no HTTP/WebSocket route, socket listener, command/spawn API, stdin/resize API, credential, login session or persistent access. Existing Codex `exec --json` pipe execution, isolation leases, cancellation and production151 remain intact. No terminal dependency is added to the production package or lock file. The native test installs pinned node-pty in an owned temporary directory.

# OFFICIAL CONTRACT

- node-pty exposes native `onData`, `onExit`, `pid` and `kill`; the adapter consumes their structural subset. Package1.1.0 resolves to upstream tag `1def5774632305246fe21f0f69e23a664d6c5910`, MIT. Its native process inherits the launching user's privileges; it does not supply the existing application's sandbox/owner boundary.
- xterm.js is the terminal renderer; its public `write`/`dispose`, disabled stdin and bounded scrollback matter for a later renderer. Upstream source and MIT license were inspected at `991857a1b1cacf06f9531ba74a6e927a7a6398bb`. No upstream implementation is copied and xterm is not installed/integrated in this unit.
- xterm's security guide requires explicit authorization around terminal transport; its flow-control guide requires accounting for asynchronous writes. Neither the demo attach addon nor a plain WebSocket inherits the Core HTTP authorization contract.
- ConPTY owns Windows pseudoconsole communication/handle lifetime. A Mac native test does not verify Windows teardown, process-tree control or handle cleanup.
- Teams tabs retain HTTPS, initialization, CSP and server-validated SSO. Mobile interruption and native-client verification are separate gates. No Entra/manifest/domain/security settings change is necessary for this internal unit.

# OBSERVED EVIDENCE

## Existing execution/auth boundary

- `src/server/core-orchestration-route.ts:79`: authentication middleware precedes job handlers; identity is server-derived.
- `src/server/core-orchestration-service.ts:205`: `get` validates the branded server scope, then resolves the existing job through the principal/ownership boundary.
- `src/server/codex-runner.ts:342`: existing launch uses ignored stdin and stdout/stderr pipes. Read-only launch requires an isolation lease. No running pipe process is retroactively described as PTY.
- New `src/server/node-pty-read-process.ts:22` accepts an executor-supplied native process and brands a one-use read/control capability. WeakSets prevent one native process or source being accidentally rebound to different jobs. This is an internal trust boundary, not OS attestation of an arbitrary JavaScript object.
- New `src/server/pty-read-session.ts:50` maintains only process-local observation state; its `read` and `terminate` resolve Core ownership on every call.

## Identity and lifecycle

|Event|Contract|
|---|---|
|Register|Existing authorized running job plus a branded native source; otherwise fail closed. No saved-log fallback.|
|Identity|Random session UUID, job ID, registry-monotonic positive generation. PID is never the session identifier.|
|Reconnect|Read the same full identity and last acknowledged sequence. No process spawn, CLI resume or new lease.|
|Replacement|After observed native exit, a new actual process receives a new UUID and higher generation. Old identity fails.|
|Stop|At most one native kill request. State becomes `terminating`; only `onExit` proves `exited`. Thrown native termination stays `termination_unverified`; no repeated kill.|
|End|Capture normalized exit code/signal, flush final safe line, dispose listeners; ignore late output.|
|Observer disposal|Clear registry/listeners without cancelling executor-owned jobs. The executor retains actual process ownership/reaping responsibility.|
|Server restart|Memory-only registry starts empty. Old clients get no session; no automatic adoption or respawn.|
|Capacity|Default8sessions;256frames/64KiB per session and16KiB pending line. Limits are validated. Only exited records may be evicted at capacity.|

## Output contract

`source='pty'` records the native callback origin. **`outputMode='redacted-lines'` is a lossy text projection, not a raw VT stream or a reconstructed terminal screen.**

- Complete lines are held before masking; reading between split credential chunks returns no prefix. Final partial line is masked at observed exit.
- Existing credential-shaped masking is reused. Private-key blocks and lines containing control sequences are omitted. CRs are removed; cursor rewrites, ANSI colors, alternate screens, clipboard/link controls and exact terminal screen state are not represented.
- Overlong unfinished lines suppress subsequent output for that session with `outputSuppressed=true`; the private-key boundary must not be guessed after being lost.
- Retained frames have increasing sequence numbers. Missing replay history sets `truncated=true`; byte-clipped lines set `outputClipped=true`. UTF-8 codepoints are preserved. No raw chunks are persisted or logged.
- These mechanisms handle the tested credential patterns; they do not claim arbitrary terminal output is automatically safe for public disclosure. An operational raw VT transport needs its own privacy and ownership design.

# FIXTURE / LOCAL RESULT

- `node --import tsx/esm scripts/pty-read-session-test.ts`:27checks PASS using deterministic synthetic native-event drivers and the real Core service/job-store ownership code. Includes missing auth, owner/tenant separation, authorization recheck, same-principal conversation changes, stale identity/cursor, bounded replay/loss flags, split secrets, key blocks, controls, termination uncertainty, duplicate-source protection and no observer-triggered cancellation.
- RED observations included the missing module, missing clipping-loss flag and duplicate native-process wrapping. Minimal fixes made the same commands GREEN. Production and test-source strict TypeScript checks are recorded independently of pre-existing untracked copies.
- Native Mac arm64, Node24.13.1, node-pty1.1.0:9checks PASS at `2026-10-14T06:14:37.119Z`. Two direct Node fixtures reported `stdin.isTTY=true` and `stdout.isTTY=true` with per-run nonces. Natural exit7 and native termination were read through the registry; both child PIDs were independently observed gone. Synthetic fixtures use a minimal environment, no shell, login, credential, real Codex execution or production job.
- Initial native invocation failed with exact `Error: posix_spawnp failed.` The installed darwin-arm64 helper had0644/no owner execute bit. This matched upstream#850/#919. A preflight now fails clearly without automatic repair. Only the owned `/tmp` dependency's helper was repaired0644→0744; contents stayed SHA256`21c589109bca43e287df884f3c34ab888033a83927ea7d273949ac5030583f26`. The same native command then passed. No OS security policy, production dependency or user access changed.

Native reproducible command (module must be the pinned real package; helper preflight must pass):

```sh
node --import tsx/esm scripts/pty-native-read-smoke-test.ts /absolute/temporary/node-pty /absolute/receipt.json
```

# LIVE RESULT / UNVERIFIED BOUNDARIES

- **Production integration unconnected**: the current isolation lease returns a ChildProcess with pipes. A provider-specific authorized PTY capability and process-tree teardown must be designed/tested before changing that executor. There is no permissive spawn fallback.
- **Raw VT/xterm renderer unimplemented**: stream redaction and cursor/ACK/replay/reset semantics require separate verification. A plain text projection must not be labelled full terminal fidelity.
- **Windows/ConPTY unverified**: require a real Windows runner with native process/handle cleanup evidence. Mac and interface fixtures cannot substitute for it.
- **Teams terminal UI unverified**: no screen control in this task; the existing installation owner has the Mac slot. About148 remains an independently unresolved observation; it does not block this isolated unit.
- **Approval boundary**: a new externally reachable terminal, interactive command input, persistent execution access, credential or security-policy expansion is not authorized by this step. Do the independent code/tests first; identify the concrete new boundary before seeking its approval.
- Current production151/tag/package are preserved at source823. This is an internal follow-up development commit, not a new deployment/package or completed terminal release. Full local Core results and the final commit are attached in the local evidence index after running the pinned suite.
