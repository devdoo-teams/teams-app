---
type: "Implementation Contract"
title: "Internal authenticated PTY observation adapter: isolated stage 2d"
description: "Core-owned, policy-checked metadata/output reads and test-injected hub access invalidation; no public transport or native executor integration."
resource: /pty-output-access.md
tags: [teamsapp, pty, authentication, owner, access-generation, read-only]
generated:
  by: "Codex /root"
  at: "2026-10-14T09:25:51Z"
verified:
  by: "Codex /root, focused internal middleware/Core/policy/reader fixtures"
  at: "2026-10-14T09:25:51Z"
status: "internal-contract-pass-production-unconnected"
stale_after: "2026-11-13T09:00:00Z"
sources:
  - id: teams-sso
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-code"
    title: "Add code to enable SSO for tabs"
    location: "When to call getAuthToken, token caching, Pass the access token to server-side code, Validate the access token; observed lines53-58,102-114,137-188 on2026-10-14; page last updated2026-03-16. HTML line numbers are not stable."
  - id: teams-context
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context"
    title: "Get context for your tab"
    location: "User context and session telemetry; observed lines37-47,93-101 on2026-10-14; page last updated2026-03-02. HTML line numbers are not stable."
  - id: entra-tokens
    resource: "https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens"
    title: "Microsoft identity platform access tokens"
    location: "Validate tokens and issuer/key validation; observed lines68-75,191-214 on2026-10-14; page last updated2025-05-14. HTML line numbers are not stable."
  - id: node-pty-security
    resource: "https://github.com/microsoft/node-pty#security"
    title: "Microsoft node-pty Security"
    location: "Parent process permission inheritance; observed lines334-340 on2026-10-14; no stable HTML lines or page update date."
  - id: codex-permissions
    resource: "https://learn.chatgpt.com/docs/config-file/config-reference"
    title: "OpenAI configuration reference"
    location: "default_permissions and permissions.<name>.filesystem/network.enabled; observed lines1032,1212-1225 on2026-10-14, after official developers.openai.com redirect; HTML lines not stable."
---

# Scope and official contract

This bounded follow-up connects the existing [masked text reader](pty-output-view.md) to an internal Core/policy read port and a test-injected hub lifecycle. Production151/source823 and its package are preserved. No default transport, HTTP/WebSocket route, credential, new permission, persistent access, CLI start selection or deployment is added.

Teams requires SSO token acquisition after app initialization, operation-time token use and server validation. The app should leave token caching to Teams. `getContext()` user data and session telemetry are not authentication proof. The existing middleware remains responsible for validated Entra identity; a branded scope object by itself is not proof of a live Teams session.

node-pty children inherit their parent's permissions. Its availability cannot replace the existing isolation lease and process ownership checks. The current Codex permission-profile configuration contract matches the installed CLI's config and sandbox profile options, but help output is not runtime enforcement evidence.

# OBSERVED EVIDENCE / implementation

## Server read port

- `src/server/pty-output-access.ts` exports only `describe(scope, jobId)` and `read(scope, identity, after)`. Every call invokes the existing `CoreOrchestrationService.get` and `AgentExecutionPolicy.authorize(scope, 'read-only')`; dependencies are bound once, decisions are not cached.
- Scope is supplied out of band by trusted server code. A future request adapter must authenticate each request and derive scope from validated server state as the existing Core router does. Tenant/requester/conversation fields are never taken from the session identity.
- `src/server/pty-read-session.ts` adds read-only discovery of an already registered session, repeating Core tenant/owner checks before returning its existing identity. It has no registration/start/resume fallback. The same principal's existing cross-conversation visibility is preserved.
- The read request accepts exactly job/session/generation and a bounded integer cursor. Existing registry masking, buffer bounds and generation checks remain unchanged. Failure details are fixed, value-free `PtyOutputAccessError` codes in `src/shared/pty-read.ts`.
- A missing/foreign session is unavailable without revealing its existence; denied execution permission clears access. Missing isolation configuration remains session-unavailable. Unknown internal diagnostics become read-failed.

## Client and existing hub

- `src/client/pty-output-access.ts` coordinates up to four existing text readers through injected reads. It has no URL, fetch, socket, bearer cache, process start/input/stop or native resize capability.
- Current `ApiAuthError`, Core401/403, the existing `PtyOutputReadError('access-denied')` sentinel or internal access-denied clears every reader and aborts observation before calling the hub with a sanitized `ApiAuthError`. An old success or denial cannot publish or notify again after cancellation/invalidation.
- Missing session/Core404/410 and invalid cursor clear the affected reader. A transient read failure retains only explicitly stale masked text through the existing reader. Error diagnostics are not copied into view state.
- The group pins the parent's access generation. `invalidate()` immediately clears/aborts all readers; methods and returned snapshots also check generation. The host must invalidate on an observed identity/access transition. This is not a claim of instantaneous Entra revocation detection.
- `src/client/OrchestrationPanel.tsx` accepts an optional test factory, supplies its actual `privateAccessGeneration` and existing private-access handler, invalidates on hub denial, and disposes on lifecycle cleanup. A fresh group is created only after a deliberate authorized load reaches ready. Production supplies no factory or PTY transport.
- Default UI surfaces/buttons and the existing event/log output monitor retain their meaning. Saved logs/progress are never relabelled native PTY output.

# FIXTURE / RED-GREEN

Behavioral RED receipts cover retained text on authentication failure, duplicate notification from a late denial, retained old-generation output, ignored execution-policy withdrawal, client scope fields, missing hub lifecycle injection, unbounded observation slots and the existing reader denial sentinel bypass. Independent review identified the last case; its failing receipt and passing fix are retained. Each is followed by the same focused command GREEN.

Focused interfaces:

- `scripts/pty-output-access-server-test.ts`: actual Core owner/brand checks; policy re-evaluation, cross-tenant/owner rejection, metadata discovery, strict identity/cursor validation, closure and sanitized failures.
- `scripts/pty-output-access-client-test.ts`: group-wide privacy invalidation, sibling aborts, stale success/denial suppression, parent generation, fixed error mapping, bounded reusable slots and callback fault containment.
- `scripts/client-orchestration-panel-test.tsx`: actual production hook handlers with a test-only factory; hub-to-PTY and PTY-to-hub denial, pending reads and explicit recovery. Hook fixture evidence is not actual browser/Teams pixels.
- `scripts/pty-output-access-integration-test.ts`: actual middleware, Core, execution policy, provider lease, registry/redaction and client group. One instrumented provider factory call creates a synthetic managed source before observation. Read/duplicate/reconnect/display resize leave that measured count at one; pipe fallback remains zero. No OS process is created by this fixture.

The integration fixture explicitly replaces token validation, executable trust, permission preflight and native process/controller events. It is not a signed/authenticated Codex PTY, real Entra token validation or operating worker claim.

```sh
node --import tsx/esm scripts/pty-output-access-server-test.ts
node --import tsx/esm scripts/pty-output-access-client-test.ts
node --import tsx/esm scripts/pty-output-access-integration-test.ts
node --import tsx/esm scripts/client-orchestration-panel-test.tsx
npm run test:core
```

These new adapter tests are in the Core inventory. Exact committed-source Core, CI, source hashes, preserved original user files and operating/package identity are recorded independently in the task evidence; a fixture result is never substituted for an exact SHA CI run.

# LIVE RESULT / remaining gates

- **PUBLIC_TRANSPORT_UNCONNECTED**: neither server index nor default client constructs this read port/group. A future authenticated output response is a separate externally visible capability even if it reuses a URL; it requires its own scope and release review.
- **NATIVE_CODEX_PTY_UNVERIFIED**: production provider composition supplies no PTY capability and CodexRunner remains pipe/JSONL based. Native package/addon/helper provenance, signed executable digest, existing service authentication and real profile enforcement, JSONL/PTY stream compatibility and owned process cleanup must pass independently.
- **TEAMS_WEB/DESKTOP/IPHONE_UNVERIFIED** for this adapter. The earlier standalone synthetic text-view foreground inspection is separate evidence.
- **WINDOWS_CONPTY_UNVERIFIED**, raw VT/input/native resize remain outside this read-only text contract.
- Existing151 server/package/permissions/model settings and original user files remain preserved. MP-387 tracks this source slice as In Progress; no release completion/Done or Teams completion notification is justified by these internal tests.
