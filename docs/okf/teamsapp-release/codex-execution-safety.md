---
type: "Implementation Contract"
title: "Codex pipe provenance, cooperative reservation and supervised preflight"
description: "Bounded source and synthetic regression work before any shared-auth Codex trial."
resource: /codex-execution-safety.md
tags: [teamsapp, codex, process, reservation, stdout, preflight]
generated:
  by: "Codex /root"
  at: "2026-10-14T10:33:00Z"
verified:
  by: "Codex /root, primary contracts and synthetic regressions"
  at: "2026-10-14T10:33:00Z"
status: "source-fixture-only-live-shared-auth-unverified"
stale_after: "2026-11-13T10:33:00Z"
sources:
  - id: codex-json
    resource: "https://learn.chatgpt.com/docs/non-interactive-mode"
    title: "Codex non-interactive mode"
    location: "--json JSONL on stdout and normal diagnostics on stderr; observed lines944-949,971-985 on2026-10-14; HTML line numbers are not stable"
  - id: codex-auth
    resource: "https://learn.chatgpt.com/docs/auth"
    title: "Codex authentication"
    location: "Credential storage and refresh; observed lines1052-1072 on2026-10-14; no auth contents are source evidence"
  - id: codex-config
    resource: "https://learn.chatgpt.com/docs/config-file/config-reference"
    title: "Codex configuration reference"
    location: "default_permissions, permissions and legacy sandbox conflict; observed lines1032,1212-1225 on2026-10-14; installed service CLI help remains a separate gate"
  - id: node-pty-api
    resource: "https://github.com/microsoft/node-pty/blob/1def5774632305246fe21f0f69e23a664d6c5910/typings/node-pty.d.ts"
    title: "node-pty1.1.0 public API"
    location: "IPty onData and spawn options; no separate stdout/stderr fd option; pinned source read2026-10-14"
  - id: node-pty-fds
    resource: "https://github.com/microsoft/node-pty/blob/1def5774632305246fe21f0f69e23a664d6c5910/src/unix/pty.cc"
    title: "node-pty Unix descriptor setup"
    location: "macOS child stdio mapping; local packaged source lines746-748 maps stdin/out/err to the PTY slave; source inspection is not native binary provenance"
  - id: node-child
    resource: "https://nodejs.org/download/release/v24.13.1/docs/api/child_process.html"
    title: "Node24.13.1 child_process"
    location: "options.stdio, options.detached, close versus exit, kill and AbortSignal; read2026-10-14; HTML lines are not stable"
---

# Scope

MP-388 / `teams-core:task:codex-pipe-preflight-reservation` follows the internal
[PTY lifecycle](pty-isolation-lease.md) and [authenticated read service](pty-output-access.md).
This slice changes source and synthetic fixtures. It does not start installed
Codex, a model request, a native PTY, or a browser/Teams session. Existing runtime,
credentials, package, tag, release, access settings and production composition
remain separate operational gates.

# OFFICIAL CONTRACT

Codex documents `exec --json` as stdout JSONL. Normal stderr diagnostics are a
different channel. node-pty exposes one data stream; its inspected Unix source
maps stdout and stderr to the same slave. Its public spawn API does not offer a
separate stdout pipe while retaining a genuine PTY for the same child.

Node supports independent pipes and detached POSIX process groups. Parent close,
a requested signal and verified descendant absence are different facts. An
AbortSignal or timeout alone is not a process-tree cleanup receipt.

# Design and implementation

| Boundary | Contract |
|---|---|
| Structured result | Provider pipe launches require detached ownership and exactly ignore/pipe/pipe stdio. CodexRunner rejects missing or identical stdout/stderr ports. Only stdout feeds the JSONL parser. |
| Merged output | Neither ANSI filtering nor dropping non-JSON lines restores stream origin. A JSON-shaped stderr diagnostic in a merged stream can still resemble a final message. The structural port check cannot attest an arbitrary adapter that lies about its origin. |
| Display | Existing bounded, masked output/read models can display observations separately. No pipe-backed display is relabelled as a native PTY; no live transport or native executor is connected here. |
| Reservation | The canonical private service home owns a private coordination child. Atomic mkdir claims the final reservation path before preflight. Empty, malformed, foreign and dead-owner reservations all block acquisition. |
| Cooperative scope | Providers using this protocol exclude one another per canonical home, across instances and OS processes. The protocol does not constrain old services, unrelated CLI invocations, different homes sharing an account, or a malicious process with the same OS file privileges. |
| Release | Validate owner token, path, private file metadata and open-file identity before mutation. Keep the final directory in place while unlinking our owner file, then rmdir only the empty directory. Never move an unverified owner aside or recursively delete unknown contents. |
| Quarantine | Uncertain child creation, cleanup failure/timeout, missing pipe cleanup receipt or canary cleanup failure retains the reservation. Process exit does not synchronously release it. No automatic dead-owner reclaim. |
| Recovery | An operator must independently establish owner and descendant absence and validate the exact reservation before any stale cleanup. This change provides no automatic cleanup or permission repair. |
| Preflight | Closed stdin; separate bounded UTF-8 output; 45s per command,120s aggregate command signal and15s cleanup deadline. Detached owned group is terminated/reaped on natural parent close as well as failure. Results/errors are published only after cleanup. |
| Pipe lifetime | Existing process-tree controller mints an object-bound cleanup receipt only after successful close/group checks. Lease disposal requires this receipt for every spawned pipe child. A close event alone cannot release the service home. |

No raw credential contents are read, copied or hashed by coordination. Existing
private directory/auth metadata checks, pinned executable/signature checks,
read-only permission grammar, fixed Teams CLI model policy, projection and Core
ownership checks remain in force. A trusted injected controller is a fixture
seam, not an OS enforcement attestation.

# OBSERVED EVIDENCE: RED and corrections

1. Merged stdout/stderr ports initially passed the runner. The regression now
   rejects them. Separate stderr JSON cannot replace a valid stdout final result.
2. Two provider instances/processes initially lacked a shared service-home gate.
   The second preflight now cannot begin while the first reservation is active.
3. Parent close initially did not require owned-descendant cleanup before result.
   The supervisor now waits for cleanup; rejection and nonsettling cleanup yield
   the fixed value-free `PREFLIGHT_CLEANUP_UNVERIFIED` error.
4. Independent review reproduced POSIX rename overwriting an empty final lock.
   Atomic mkdir now preserves that lock and blocks the contender.
5. An interleaving fixture reproduced a competing acquisition while release had
   renamed a replacement owner's directory away. Private execution release now
   validates in place; a separate fixture checks the empty-owner-file window is
   still blocked until the directory is removed.
6. A replaced canary caused secondary finally cleanup to downgrade the failure
   and release a reservation. Cleanup failure now always preserves quarantine,
   including when a prior process cleanup error is already pending.
7. Existing synthetic spawn fixtures now explicitly produce a controller cleanup
   receipt. A displaced service-home fixture expects unverified release and checks
   that the original reservation remains. Product guards were not weakened.

The first canary rerun hit sandbox `listen EPERM 127.0.0.1`. This was retained as
an environment-limited attempt. The normal approved execution boundary then
reproduced the actual cleanup-classification failure. Neither is a Teams server
failure or a reason to change authentication.

# FIXTURE RESULT and reproduction

Node24.13.1 runs the following through the existing module harness:

```sh
node --import tsx/esm scripts/run-module-test.mjs scripts/codex-output-stream-contract-test.ts
node --import tsx/esm scripts/run-module-test.mjs scripts/codex-service-reservation-test.ts
node --import tsx/esm scripts/run-module-test.mjs scripts/codex-preflight-supervision-test.ts
npm run test:core
```

The output suite covers Korean/emoji UTF-8 chunking, CRLF/LF, no final newline,
stderr, malformed merged/ANSI diagnostics and the unrecoverable merged-JSON
provenance characterization. Reservation fixtures use synthetic auth files and
trust/preflight seams, including another OS process and actual pipe runner
cleanup. Supervision fixtures use synthetic Node parents/descendants; resistant
children are absent as an owned group after natural parent exit and timeout.
They are not Codex/model/native-PTY trials.

Focused strict TypeScript includes tracked production sources and this slice's
test files, preserving pre-existing untracked user copies. Final exact-commit
Core, remote CI, review findings, original failures and preservation read-back
are joined in the ignored task evidence index. Do not substitute precommit
results for exact-SHA CI.

# LIVE RESULT / remaining trial conditions

Shared-auth Codex execution, installed service CLI help/version, real permission
enforcement, actual model result, native PTY and Teams Web/desktop/iPhone UI are
**UNVERIFIED / NOT RUN** in this slice.

Before a real pipe trial:

1. All users of the chosen canonical auth home must participate in the new
   reservation protocol, or an independently coordinated exclusive window must
   prove that old service/CLI jobs cannot overlap. Existing production151/823
   does not participate, so this source change alone cannot establish exclusion
   against that service. No production restart is performed in this slice.
2. Reconfirm signed executable/hash and the exact installed CLI version/help
   against the current permission-profile and stdout contracts. Existing auth
   file metadata must remain private and unchanged; validity is not inferred
   from metadata. Do not create credentials or log secret diagnostics.
3. Use one bounded read-only projected pipe job, with normal stdin closed and
   stdout JSONL separated from stderr. Record launch identity, timeouts, result,
   owned group absence and reservation release independently. Preflight itself
   includes an authenticated exec call and must be counted as a model call.
4. A genuine native-PTY trial remains blocked on an explicit supported protocol
   for structured stdout provenance. node-pty's current public API does not
   provide the desired split. No undocumented fd/shell wrapper is introduced.

Any new credentials, persistent access, security changes or external transport
require their own authorization. Screen/front-window proof and installed Teams
UI evidence remain independent; synthetic process/viewport results cannot fill
those gates.
