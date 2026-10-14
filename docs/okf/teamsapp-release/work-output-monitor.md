---
type: "Concept"
sources:
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/tab-requirements"
    title: "Requirements for building Teams tabs"
    location: "HTTPS, TeamsJS initialization, iframe/CSP and host domains; observed 2026-10-14, lines 31-69; page updated 2025-02-06"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/design/tabs-mobile"
    title: "Tabs on mobile"
    location: "Low bandwidth/intermittent connections, timeout feedback and actual client testing; observed 2026-10-14, lines 31-54 and 78-80"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview"
    title: "SSO in Teams tabs with Microsoft Entra ID"
    location: "Tab token acquisition and server-side validation; observed 2026-10-14; HTML lines are not stable"
  - resource: "https://github.com/OfficeDev/microsoft-teams-library-js/blob/cf6c908b9273ef1ccd4f04f096475ec87cd7d122/packages/teams-js/src/public/authentication.ts"
    title: "Microsoft TeamsJS authentication implementation"
    location: "getAuthToken / ensureInitializeCalled / host request, lines 151-215; installed TeamsJS 2.54.0 uses the existing public API"
  - resource: "https://github.com/OfficeDev/microsoft-teams-library-js/blob/cf6c908b9273ef1ccd4f04f096475ec87cd7d122/LICENSE"
    title: "Microsoft TeamsJS MIT license"
    location: "MIT grant and notice requirement; reference only, no new copied implementation or dependency"
generated: { by: "process:codex", at: "2026-10-14T01:59:28Z" }
verified: { by: "process:source-and-focused-synthetic-regressions", at: "2026-10-14T01:59:28Z" }
status: "UNVERIFIED"
stale_after: "2026-10-21T01:59:28Z"
---

# Read-only multi-job output monitor: stage 1

## OFFICIAL CONTRACT AND APPLIED DECISIONS

The feature stays inside the existing initialized, authenticated Teams personal tab. Existing HTTPS/CSP, manifest domains, SSO and owner-scoped Core endpoints remain unchanged. The Microsoft SDK source and MIT license were inspected as a reference; no public sample code, PTY library or new permission was imported. The former `samples/tab-sso/nodejs` sample path returned HTTP 404; it was not treated as verified implementation evidence.

Mobile uses one selectable panel, contextual loading/error feedback and bounded reads. A browser viewport is not proof of native Teams Android/iPhone compatibility. Tab reconnection observes existing jobs only; it neither resumes an interactive process nor creates a CLI execution.

## IMPLEMENTED SOURCE

- `src/client/work-output-monitor.ts`: GET-only reader, four validated/unique IDs, identity equality, one in-flight refresh, abort/generation/timeout, independent missing/error cells. Any 401/403 or existing auth failure clears every private cell and blocks silent recovery.
- `src/client/WorkOutputMonitor.tsx`: two/four desktop panels, mobile single panel and keyboard selection, saved slot/layout selection, safe common execution projection and same-job detail/conversation return. Output is explicitly labeled stored, masked and polled, without PTY/streaming claims. Layout changes never execute a job.
- `src/client/OrchestrationPanel.tsx`: the existing list poll stops while the monitor owns the same 3-second polling controller. Closing/reselecting aborts and disposes the previous reader; returning preserves deliberately loaded rows. Existing submit/cancel/approval/conversation handlers remain the execution boundary.
- `src/client/work-output-monitor.css`: a responsive two-column grid with four cells, bounded scrollable output, one visible mobile panel and visible selected layout/focus.

Current CLI observations are already masked before persistence. The shared projection retains only status, bounded prompt/result/progress and safe tool outcome text. It does not reconstruct raw stdout/stderr, command arguments, internal reasoning or a full terminal transcript.

## FIXTURE / RED-GREEN

Focused tests first failed for missing reader/view/integration, then passed after implementation. Additional RED/GREEN checks cover private option labels after denial, mobile keyboard tab order and refresh while the selection's new reader is pending. A real synthetic Chromium render exposed four panels extending below the 1440x1100 viewport; measured cell heights and screenshots guided a compact layout and output-first ordering. Mobile first-entry RED showed that focus ran while loading cells were still short; the view now positions once after the first completed read, never on subsequent polls. Test-locator/timing failures are distinguished from product failures in the local browser record.

Commands:

```sh
node --import tsx/esm scripts/work-output-monitor-test.ts
node --import tsx/esm scripts/work-output-monitor-ui-test.tsx
node --import tsx/esm scripts/run-module-test.mjs scripts/client-orchestration-panel-test.tsx
```

Coverage includes owner-read endpoint usage and mismatched response ID, server output masking through projection, duplicate reads, 401/403, late responses, disposal, timeout, completed/missing/error/recovery, preserved selection and mobile layout. Both new tests are registered in the Core suite. Local fixture uses cached Playwright and a temporary headless Chrome profile, with only synthetic jobs and mocked host/auth. Existing installation browser space 9 and public 3978 remain separate.

The ordinary workspace typecheck still includes eight errors from pre-existing untracked `* 2.ts` copies. Those files are preserved. A temporary config including tracked production source plus this feature passes; it does not rewrite the user's files or hide a new feature error.

## LIVE RESULT / REMAINING BOUNDARIES

Exact-final-SHA Core/build/CI/package/public release checks and actual Teams screenshots/installation remain separate release gates. Synthetic unit/viewport results cannot mark DESKTOP_READY or MOBILE_READY. The earlier 149 Graph definition/About discrepancy does not block this independent feature's implementation.

PTY/ConPTY, xterm.js, arbitrary shell input, WebSocket byte streaming, persistent terminal sessions and worker restart reattachment are explicitly outside stage 1. No new credentials, access grants, persistent access or deployment target are introduced.
