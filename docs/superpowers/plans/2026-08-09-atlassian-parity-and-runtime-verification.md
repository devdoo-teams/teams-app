# Teams Work Hub parity and runtime verification plan

## Objective

Bring the Work Hub to functional parity with the observed Jira Cloud, Trello, and Atlassian Home Teams apps, while preserving the Codex-agent workflow. No feature is complete until its real Teams desktop and mobile surfaces, every visible action location, and every applicable success/error/permission/retry branch have fresh screenshot evidence.

## Global constraints

- Use `/Users/doosansmacbookpro/Documents/TeamsApp` as the original local source. Do not infer or use an external repository, iCloud copy, or remote mirror.
- Reuse the existing Teams desktop window and existing in-app browser tabs. Do not create a new browser tab or authentication window for convenience.
- Keep chat, personal tab, and app-info surfaces consistent. Every card action must have a server-result check; visual presence alone is not a pass.
- Keep Teams mobile Adaptive Cards at schema version 1.2 compatibility and provide a web-based tab.
- Preserve no-key deterministic mode and the Codex read-only/write approval boundary. Never report a task complete before the real terminal state and evidence exist.
- Each release must be committed, packaged once with a recorded SHA-256, publicly health-checked, updated in the existing Teams app, and verified in the deployed Teams desktop and mobile app before the completion message.

## Tasks

### Task 1 — Restore the personal tab runtime

Find and fix the confirmed `Teams 앱 연결을 확인하고 있습니다` / `about:blank` failure. Verify TeamsJS initialization, public origin reachability, iframe/CSP/valid-domain configuration, manifest URLs, and Entra SSO without changing the user's credentials. Add regression coverage for loading, ready, auth failure, public-origin failure, retry, and refresh-preserving state.

### Task 2 — Preserve immediate bot ACK and real Codex progress

Ensure natural-language work requests return an immediate queued/running Adaptive Card and then deliver real progress/completion/failure notifications to the same Teams conversation. Remove any synchronous wait or `notify:false` path that makes mobile appear silent. Cover delayed runner, cancel, retry, and terminal-state branches.

### Task 3 — Implement Work Hub parity domain and commands

Add scoped work-item operations equivalent to the benchmark: create, search/filter, edit, status transition, assign, comment, watch/follow, recent/assigned views, and calendar-oriented view data. Expose them through chat commands and actionable cards with stable deep links. Keep Codex jobs and work items distinct but linkable.

### Task 4 — Implement collaboration and notification parity

Add personal/channel subscriptions, follow/unfollow, proactive updates, reminders, weekly/monthly digest data, and project/goal/topic-to-channel connections. Every mutation requires idempotency, ownership/tenant scope, and explicit failure feedback.

### Task 5 — Mobile-first GenUI and verification matrix

Make the home tab and cards responsive for narrow Teams mobile webviews. Add a machine-readable UI verification matrix covering every location and branch: chat commands, prompt menu, all card buttons, tab sections, filters, CRUD, weather permission allow/deny, auth expiry, loading/empty/error/retry, Codex approval/cancel/retry, and deep links. Each row records fresh before/after screenshots, AX evidence, runtime evidence, and PASS/FAIL/BLOCKED/N/A.

### Task 6 — Integrate, review, release, and prove

Review each task diff, run focused and full tests, resolve conflicts, commit the integrated branch, build one deterministic package, update the existing Teams app, and run the complete desktop/mobile matrix. Do not send the completion message until all required rows pass or have evidence-backed N/A decisions.
