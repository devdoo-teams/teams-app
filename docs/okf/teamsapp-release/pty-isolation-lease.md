---
type: "Implementation Contract"
title: "Provider-owned PTY start and bounded lease teardown: stage 2b"
description: "Optional PTY capability through existing lease identity, executable and permission-profile guards, with owned tree cleanup and separate native/fixture/live evidence."
resource: /pty-isolation-lease.md
tags: [teamsapp, pty, lease, lifecycle, cancellation, isolation]
generated:
  by: "Codex /root"
  at: "2026-10-14T07:05:57.792Z"
verified:
  by: "Codex /root, focused contracts and actual Mac native fixtures"
  at: "2026-10-14T07:05:57.792Z"
status: "local-contract-pass-production-unconnected"
stale_after: "2026-11-13T07:05:00Z"
sources:
  - id: node-pty-api
    resource: "https://github.com/microsoft/node-pty/blob/1def5774632305246fe21f0f69e23a664d6c5910/typings/node-pty.d.ts"
    title: "node-pty1.1.0 reference API"
    location: "IPty onData/onExit/kill; source lines116-187; read2026-10-14; installed declaration also inspected"
  - id: node-pty-macos-session
    resource: "https://github.com/microsoft/node-pty/blob/1def5774632305246fe21f0f69e23a664d6c5910/src/unix/pty.cc"
    title: "node-pty native macOS session creation"
    location: "pty_posix_spawn, POSIX_SPAWN_SETSID; reference source lines645-738; real PID/PGID is independently read back"
  - id: node-child
    resource: "https://nodejs.org/download/release/v24.13.1/docs/api/child_process.html#subprocesskillsignal"
    title: "Node24.13.1 ChildProcess lifecycle and kill"
    location: "kill, exit/close, detached and subprocess group sections; read2026-10-14; HTML line numbers not stable"
  - id: xterm-security
    resource: "https://xtermjs.org/docs/guides/security/"
    title: "xterm security and terminal transport ownership"
    location: "Basic access rules, browser/terminal and WebSocket boundaries; inspected in stage2a; no transport added here"
  - id: conpty
    resource: "https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session"
    title: "Windows pseudoconsole lifecycle"
    location: "Process and communication handle lifetime/teardown; read2026-10-14; Windows execution remains unverified"
  - id: teams-sso
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview"
    title: "Teams tab SSO"
    location: "Server token validation; read in stage2a; no authentication/permission changes"
  - id: darwin-kill
    resource: "https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html"
    title: "Darwin kill manual, corroborating reference"
    location: "Archive is corroboration only; current host installed `man -P cat 2 kill` was read2026-10-14: negative PID targets a process group; EPERM is denied; ESRCH means no matching target"
---

# Scope and official contract

This follows [stage2a native read sessions](pty-read-session-contract.md). Existing authenticated Core ownership and isolation leases remain the authority. A PTY is an actual process resource; a signal request, native exit, process-tree absence, registry observer disposal and provider reservation release are distinct facts.

node-pty reference APIs/source and MIT license were inspected at the pinned reference commit above. Installed npm1.1.0 metadata, native addon/helper hashes and actual TTY behavior are retained in local receipts. No exact build-source provenance for the upstream native binary is inferred from a tag name alone. No dependency or upstream implementation is copied into the production package.

Node's documented signal/lifecycle distinction and the installed Darwin manual govern the cleanup contract. Signal denial is not success. The Open Group kill page returned HTTP403 during this investigation; it is not used as fetched evidence. The current host manual and Node24 documentation were available.

# Implementation

|Boundary|Contract|
|---|---|
|Capability|`AgentIsolationLease.spawnPty` exists only when its provider supplies a preflighted PTY/tree-control capability. Default production composition supplies none.|
|Preparation|Existing subject/tenant/requester/conversation/job/TTL/workspace/protected-root checks precede creation. The Codex provider reuses pinned executable/hash/auth metadata and the same strict read-only/fixed-model grammar for pipe and PTY.|
|Atomic start|Preparation cannot create a child. The subsequent synchronous factory either returns a branded managed process or leaves `PTY_START_UNVERIFIED`, preventing reservation release. No unrestricted spawn fallback.|
|Duplicate start|A PTY-capable lease reserves one execution before preparation yields/reenters. Concurrent PTY and pipe starts are rejected. No new child is created by cursor reconnect.|
|Cancellation|Capture the original AbortSignal. Check cancellation/disposal/expiry again after trusted preparation and before handoff; cancel any created resource before rejecting a stale publication.|
|Lifetime|Managed process has separate `exited` and `finished` promises. `finished` requires observed native exit plus successful bounded tree cleanup. Natural parent exit also invokes owned-tree cleanup.|
|Dispose/TTL|Close the start gate, await an in-flight handoff, terminate/reap the managed resource, then release provider reservation. Timeout, cleanup error or uncertain native start keeps it quarantined.|
|Observer|Stage2a registry keeps the same session ID/generation for reads. Late observation receives an already-observed native exit instead of a false running state. Observer detach does not cancel the job.|
|Controller|A minimal pid/close/error event target lets native onExit feed the existing process-tree controller without pretending to have ChildProcess streams or stdin. Existing pipe behavior and signal-error classification are preserved.|

No server index/CodexRunner runtime selection, public HTTP/WebSocket endpoint, interactive input, persistent access, actual credential, Entra/manifest/security setting or model configuration is changed. The package/operating151 release is preserved at823. This is internal source work and not a new deployed terminal.

# OBSERVED EVIDENCE / RED-GREEN

- Missing provider PTY method first failed the contract assertion. New lease contracts cover duplicate starts, dispose-before-publication, cancellation, expiry, ownership, dimension/path checks, same-generation reconnect and no pipe fallback.
- A failed atomic native factory initially exposed its original diagnostic and could release a reservation without a cleanup receipt. RED→GREEN now yields only `PTY_START_UNVERIFIED` and retains reservation.
- Mutation of the caller's cancellation object and cancellation/disposal inside trusted preparation have dedicated regressions. No child may start after preparation has cancelled/closed the lease.
- A late native exit after cleanup timeout initially left its lifecycle listener attached. The late exit now disposes it; cleanup failure itself remains failed/quarantined.
- The existing native permission-profile suite first hit sandbox `listen EPERM 127.0.0.1`; the same bounded fixture passed through the normal approved escalation path. This was not a Teams server failure or a reason to change authentication.

# FIXTURE RESULT

- `scripts/pty-isolation-lease-test.ts`:14contracts PASS with synthetic native/control events, real provider-owned lease guards and existing Core ownership service.
- `scripts/pty-codex-provider-test.ts`:6contracts PASS through the actual Codex provider's command/identity/snapshot/reservation code. Signatures, permission-enforcement preflight and auth contents are synthetic fixtures; this is not a live Codex login/enforcement proof.
- `scripts/pty-read-session-test.ts`:prior27contracts PASS after the controlled lifecycle adapter change.
- Strict production-source plus new fixture/test-source TypeScript check passes, excluding only pre-existing untracked user copies. Their8existing worktree errors are preserved; exact commit CI is recorded independently.

# Actual Mac native lifecycle result

`scripts/pty-isolation-native-smoke-test.ts` uses installed node-pty1.1.0/Node24.13.1 and a temporary pinned synthetic executable. It passes through the actual Codex provider's lease/argument/snapshot gates but uses explicitly synthetic signature/auth/permission preflight. The program is not Codex. It uses real native TTYs and the existing real process-group controller.

Final native fixture:3PTYs,2descendants that explicitly ignore both SIGTERM and SIGHUP,9checks PASS. Before a group signal, its new PID/PGID and live members are read back. The wait and natural-parent-exit cases both successfully send scoped SIGKILL to resistant descendants. Direct parent/child PIDs and all owned groups are gone. The dispose-during-start case reaps an unpublished native process. Cleanup/request counts remain one; raw IPty.kill calls remain zero.

## Signal failure investigation, kept separate

The original native attempt failed `PTY_CLEANUP_UNVERIFIED`. Added diagnostics observed natural-exit group signals returning **EPERM**, followed by an empty group-members snapshot. No cause such as OS policy, sandbox behavior or kernel timing was proved. The original failed receipts are retained, not relabelled PASS.

The test-only native control adapter now reads the exact PGID before each signal: an already absent target needs no signal; a live target's EPERM remains blocked and is never ignored/retried as a privileged operation. It independently verifies native close, parent/child PID absence and full group absence. The product process controller's EPERM classification was not relaxed.

The first resistant-child fixture ignored only SIGTERM; TTY SIGHUP could also finish it, so its assumption that SIGKILL must occur was invalid. The strengthened fixture explicitly ignores SIGHUP too. Fresh final native evidence has successful actual SIGTERM/SIGKILL sends and no signal denial. All this is synthetic local validation; no existing operating process was signalled.

# Reproduction and remaining gates

```sh
node --import tsx/esm scripts/pty-isolation-lease-test.ts
node --import tsx/esm scripts/pty-codex-provider-test.ts
node --import tsx/esm scripts/pty-read-session-test.ts
node --import tsx/esm scripts/pty-isolation-native-smoke-test.ts /absolute/temp/node-pty /absolute/native-receipt.json
npm run test:core
```

Exact source SHA, native source hashes, complete Core output, remote CI job states and preserved151runtime/ZIP identity are joined in the task's ignored local evidence index. Native Mac receipts are not substituted for CI or Windows results.

Remaining: operational signed/authenticated Codex PTY enforcement and process/handle receipts; Windows/ConPTY; raw VT privacy/flow-control/renderer; actual terminal Teams UI. Any new externally reachable terminal/input or persistent access/security expansion remains outside this step's approval. Continue independent internal slices without turning that future boundary into a blanket approval wait. The iPhone task owns the Mac screen; this task performs no screen control.
