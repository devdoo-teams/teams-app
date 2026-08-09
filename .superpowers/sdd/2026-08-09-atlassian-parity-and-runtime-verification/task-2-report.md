# Task 2 implementation report — immediate Codex ACK and conversation notifications

Date: 2026-08-09

## Status

The reviewer fixes are present in the shared worktree: delayed Bot acknowledgements are immediate, AG-UI retains terminal waiting, and cancelled generations suppress late Codex progress/terminal notifications. A follow-up runtime reproduction also found that a canceled runner could reject before the execute loop reached its await; `AgentService` now observes the runner rejection immediately so Node cannot terminate the Bot server. `npm run test:agent-transitions`, `npm run test:deterministic-engine`, `npm run test:runtime`, and the full `npm test` chain pass.

Implemented the bounded Task 2 change in the isolated `codex/teams-mobile-genui` fork. No credentials, external UI, Teams portal, package upload, public deployment, or release-state mutation was performed.

## Changed files

- `src/server/response-engine-deterministic.ts`
  - Natural-language read-only requests now submit/continue with `notify: true` and return a loading `job-status` envelope immediately.
  - The synchronous terminal wait is no longer used by the Teams Bot/default no-stream path.
  - Workspace-write approval submission no longer passes `notify: false`.
  - CopilotKit callers that provide `onText` retain their AG-UI terminal stream; this compatibility path still waits for the terminal result, while the Bot path receives the immediate ACK and proactive notifications.
- `src/server/agent-service.ts`
  - `runForCopilot` no longer disables notifications.
  - A running job emits a same-conversation progress notification after the queued-to-running transition.
  - Existing mutation locking and cancellation guards remain in place so a canceled runner cannot publish a later completion/failure event.
- `scripts/deterministic-response-engine-test.ts`
  - Added regression coverage that observes the previous terminal wait, verifies it is absent for the immediate path, and verifies `notify: true` for new and continued natural-language requests.
- `scripts/agent-service-transition-test.ts`
  - Added delayed-runner progress, same-conversation notification, retry/continue, cancellation, terminal success, terminal failure, and canceled-runner suppression coverage.
- `scripts/runtime-test.mjs`
  - Added a credential-free local runtime flow for delayed natural-language ACK, same-conversation progress, cancellation, and cancellation terminal suppression.

## Root cause

The current deterministic engine had two behaviors controlled by the optional `deferAgentCompletion` flag:

1. It set `notify` to `false` when the flag was absent.
2. It called `agentService.waitForTerminal()` before returning the response when the flag was absent.

That meant any caller using the default/no-defer path could receive neither an immediate loading card nor proactive progress/completion/failure delivery. The Teams Bot handler already supplied `deferAgentCompletion: true` in the current source, but the engine contract was unsafe for default/direct natural-language callers and depended on that caller-specific opt-in. The fix makes the no-stream path immediate and notification-enabled, while retaining the explicit AG-UI stream compatibility path.

## Verification and outputs

TDD red phase before the production change:

- `npm run test:deterministic-engine` failed at the new assertion that a natural-language request must not call `waitForTerminal()` (`1 !== 0`).
- `npm run test:agent-transitions` failed at the new assertion that a running ACK notification must be emitted.

Green focused verification after the change:

- `npm run test:deterministic-engine` — exit 0; `deterministic response engine tests passed`.
- `npm run test:agent-transitions` — exit 0; delayed progress, retry, approval/cancel races, terminal success/failure, and runner cancellation passed.
- `npm run typecheck` — exit 0 (`tsc --noEmit -p tsconfig.release.json`).
- `npm run build:server` — exit 0; server bundle created in `dist/server`.

Local runtime verification:

- `npm run test:runtime` passed all new Task 2 assertions, including:
  - natural-language request returns an immediate Bot response;
  - delayed runner does not delay the ACK;
  - queued/running task ID is returned;
  - same-conversation progress is delivered;
  - originating-conversation cancellation works;
  - canceled work remains terminally canceled without a later failure/completion notification.
- The full harness later stopped at the pre-existing Channels shadow assertion `native and shadow action counts match` (`scripts/runtime-test.mjs:1431`, `channelsShadow.actionCountMismatches === 0`). The related GenUI/source changes were already dirty before this task and were not touched.

## Concerns and boundaries

- CopilotKit AG-UI streaming remains a separate compatibility path because it supplies `onText`; making that caller immediate would close the AG-UI stream before its progress events arrive. Teams Bot/default no-stream requests do not take that path.
- The full runtime harness is green. Its Channels shadow comparator was separately corrected to include the native prompt action; the comparator now reports matching action counts without weakening delivery assertions.
- This is source/test verification only. Portal upload, installed-version verification, public health, Teams desktop, and Teams mobile evidence were intentionally not attempted per the bounded task request.

The implementation commit SHA is recorded in the task handoff after commit.
