---
type: "Implementation Contract"
title: "Local first-slot Core and PTY observation composition"
description: "Explicit read-only injection into the existing work output monitor; authoritative pipe results remain separate."
resource: /work-output-pty-slot.md
tags: [teamsapp, output-monitor, pty, local, observation]
generated:
  by: "Codex /root"
  at: "2026-10-14T13:23:00Z"
verified:
  by: "Codex /root, focused runtime/SSR and headless synthetic fixture"
  at: "2026-10-14T13:23:00Z"
status: "local-injection-pass-production-unconnected"
stale_after: "2026-11-13T13:23:00Z"
sources:
  - id: react-effects
    resource: "https://react.dev/reference/react/useEffect"
    title: "React useEffect"
    location: "setup/dependency cleanup and development Strict Mode; observed lines73-90,128-145 on2026-10-14. Current docs label19.3; installed19.2.8 runtime/type fixtures validate only the existing effect contract. HTML lines not stable."
  - id: teams-sso
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-code"
    title: "Add code to enable SSO for tabs"
    location: "app initialization, operation-time token use and server validation; read2026-10-14. No auth/token-cache changes in this slice."
  - id: node-pty-output
    resource: "https://github.com/microsoft/node-pty/blob/1def5774632305246fe21f0f69e23a664d6c5910/src/unix/pty.cc#L700-L704"
    title: "node-pty macOS descriptor setup"
    location: "stdin/stdout/stderr mapped to one PTY slave; reference source, not npm native-build attestation"
  - id: codex-json
    resource: "https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable"
    title: "Codex non-interactive mode"
    location: "--json stdout JSONL contract; read2026-10-14, observed lines971-985; HTML lines not stable"
---

# Scope

This follows the internal [read access](pty-output-access.md) and
[masked view](pty-output-view.md). One explicitly injected local read client
enables observation beside the first existing Core output slot. Default
production composition supplies no such client. No public endpoint, session
producer, command input, credential, permission, actual Codex/native process,
operating151 restart, package or catalog change is added.

# Contract and implementation

- `work-output-pty.ts` accepts only `describe(jobId,signal)` and
  `read(identity,after,signal)` plus the hub's access-group/generation getters.
  It does not receive Core mutation, start/resume, URL or token capabilities.
- Opening is explicit and concurrent opens share one bounded discovery.
  Identity must contain exactly job/session/generation and match the selected
  Core job. A missing session is unavailable; a failed discovery exposes no raw
  diagnostics and never starts a replacement process.
- Reconnect uses the existing reader/identity/cursor. Display resize and close
  are observation operations. Close/unmount/job replacement abort pending
  discovery and clear frames; late results cannot publish. Discovery has a
  bounded deadline even when its injected port ignores cancellation.
- Discovery denial invalidates the existing access group and invokes the hub's
  sanitized private-access handler. Parent generation changes permanently
  invalidate old observers. Existing read-denial handling stays in the shared
  group; token caching and real Entra validation are unchanged.
- `OrchestrationPanel` passes an optional local client and its actual access
  generation/group to `WorkOutputMonitor`. The first successfully loaded Core
  slot alone renders `WorkOutputPtyObservation`; missing/failed/stale/denied
  Core entries cannot display old PTY text.
- Core status, result and usage continue through the existing validated pipe
  runner and Core job projection. PTY frames remain masked text. A native
  process exit or a JSON-shaped completion/usage line is not a Core mutation.
- React effects create/dispose only observers. Effects and reads cannot launch
  jobs. Existing unprovided/default monitor UI remains the saved Core view.

# RED / GREEN and evidence limits

1. The missing one-job observer failed a behavioral assertion before its
   implementation. The first-slot renderer separately failed before wiring.
2. Reentrant close from the discovering callback reproduced one unwanted
   metadata request; a post-publication cancellation check made the same test
   pass. Pending/late metadata, identity mismatch, missing session, denial,
   generation invalidation and deadline cases are covered by the observer suite.
3. Actual hub hook handlers demonstrate the local client reaches the first-slot
   capability and the hub's private-access failure clears that observer. These
   are synthetic Core/auth fixtures, not Teams-host authentication evidence.
4. The standalone browser fixture uses the real monitor/observer/view with
   retained masked frames from an earlier genuine synthetic native process.
   Core data is separately synthetic. It creates no new native or model process.
   Headless pixels require individual direct review; foreground/Teams/iPhone
   acceptance is not implied.

Exact-source Core/build, focused semantic checks, original failures, source
hashes and direct screenshot reviews are recorded in the task evidence. A broad
strict diagnostic check also preserves the seven reproduced HEAD baseline
diagnostics in pre-existing optional/test code; no unrelated fix is folded in.

# Remaining gates

The default server still does not mount a PTY read transport or create a live
PTY session. A future transport must derive authenticated scope server-side and
repeat Core owner/policy checks per read. Real Codex PTY stdout provenance stays
blocked by the current merged-output API; no fabricated stderr port or second
model execution substitutes for it. Native foreground, actual Teams Web/desktop/
iPhone, installed-version and new-version release gates remain separate.
