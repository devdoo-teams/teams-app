# Core runtime audit — 2026-08-11

## STATUS

`BLOCKED` for Teams/Entra/UI end-to-end. `PASS` for the bounded Core code and service regression checks listed below.

## EVIDENCE

- Authoritative source at audit start: `HEAD=e6540cc02c361e71dd63b86832e0e753425ea70c`, package/manifest `1.0.40`.
- Active release record: `1.0.39`, commit `0945321…`; portal, installed, desktop, and mobile evidence are all `null`.
- Public health and tab probes refer to the older public `1.0.39`, not the current source.
- Teams web existing tab was inspected with the in-app browser. The active app iframe showed `Teams 연결을 확인하지 못했습니다.`; pressing its existing `다시 시도` control left the same error. No new tab was opened.
- Teams desktop Computer Use was attempted through the existing app. macOS reported that the Mac is locked; no desktop screenshot or AX result was claimed.

## Confirmed code paths

- `AgentService.submit()` persists a job and invokes `CodexRunner` for read-only jobs; workspace-write jobs enter `awaiting_approval` and execute only after `approve`.
- Work-item create/edit/status/assign/comment/watch/delete routes call `WorkItemService` and durable JSON mutations; they are not response-only stubs.
- Git commit is restricted to recorded changed paths and requires a completed workspace-write job.
- Adaptive Card delivery uses attachment-only activity for the card path; the same summary is not intentionally sent as top-level text.

## Confirmed defects and fixes in this audit

1. `cancelStrict()` only enforced operator authorization for workspace-write jobs. It now enforces the operator boundary for all user-facing strict cancellation paths while internal teardown keeps the non-strict path.
2. `retry` existed in the shared/client action schema but not in the server action allow-list or handler. Failed job-status cards now issue a scoped persisted retry grant; the handler creates a new job linked to the failed parent.
3. REST `DELETE /api/work-items/:id/watch` and `DELETE /api/work-items/:id` generated `Date.now()` mutation keys when callers omitted a key. They now reject missing keys with HTTP 400 so retries are explicit and idempotent.
4. Production accepted `mode=demo` on the authenticated weather route even though production startup rejects `WEATHER_MODE=demo`. The route now rejects demo mode in production.
5. Work-item edit accepted an empty title at the client boundary; the UI now rejects it before HTTP mutation.
6. Today summary now aborts its active request on replacement/unmount, suppresses stale rows on error, and renders localized status labels. Weather error state exposes an explicit `다시 시도` label.

## Regression commands

Passing under the FileProvider fallback, run sequentially:

```text
TEAMS_FILEPROVIDER_SERVER_REUSE=1 npm run test:server-build-mode
TEAMS_FILEPROVIDER_SERVER_REUSE=1 npm run test:agent-authorization
TEAMS_FILEPROVIDER_SERVER_REUSE=1 npm run test:agent-transitions
TEAMS_FILEPROVIDER_SERVER_REUSE=1 npm run test:genui-actions
TEAMS_FILEPROVIDER_SERVER_REUSE=1 npm run test:client-work-item-load
TEAMS_FILEPROVIDER_SERVER_REUSE=1 npx tsx scripts/client-today-summary-test.ts
TEAMS_FILEPROVIDER_SERVER_REUSE=1 npm run test:work-item-today-summary
```

The same `tsx` tests without the fallback intermittently failed with esbuild `The service was stopped`; this is recorded as `SOURCE_IO_UNSTABLE`, not a code pass/fail result. A direct `typecheck` invocation remained silent for more than five minutes and was stopped; the workflow now requires bounded execution and source materialization/clean-worktree checks before reuse.

## BLOCKER

No same-release public package, installed Teams version, desktop screenshot/AX, or mobile screenshot/runtime evidence exists. The current Mac lock and active Teams web iframe error prevent those claims.

## NEXT ACTION

Commit the tracked fixes, build a fresh Core server/client/package from that commit, verify the new marker and ZIP identity, then resume existing Teams Admin/Teams tabs and desktop/mobile matrix capture. Do not upload or send a completion message before those evidence classes are populated.
