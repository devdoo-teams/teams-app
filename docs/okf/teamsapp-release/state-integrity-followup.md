---
type: "Concept"
title: "Private UI state, notification persistence and worker cancellation"
sources:
  - resource: "https://react.dev/learn/preserving-and-resetting-state#option-2-resetting-state-with-a-key"
    title: "Preserving and Resetting State"
    location: "State position and key identity sections; read 2026-10-13; HTML lines are not stable"
  - resource: "https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrenameoldpath-newpath"
    title: "Node.js v24 File system"
    location: "Promise-based API and fsPromises.rename; read 2026-10-13; HTML lines are not stable"
generated:
  by: "process:state-integrity-followup/1"
  at: "2026-10-13T16:54:00Z"
verified:
  by: "process:focused-state-integrity-regressions/1"
  at: "2026-10-13T16:54:00Z"
status: "LOCAL_FOCUSED_PASS_HOST_UNVERIFIED"
stale_after: "2026-10-20T16:54:00Z"
---

# Official contract

React associates state with component position and key. Changing a key resets
that subtree. Node filesystem promises must settle before the caller proceeds;
a rejected pre-send persistence operation must not invoke transport.

# Observed evidence and minimal corrections

The completed independent review at `2481304` supplied six static findings.
Follow-up work reused those findings rather than starting another review.

* `5a253ec`: page/detail/mutation denials share private-state invalidation. An
  access generation prevents an older mutation from restoring or clearing a
  newly authorized view. Automatic reads cannot unlock denied state.
* `d951abb`: failed pre-send persistence restores the previous receipt. The
  existing ambiguity protection after transport begins remains applicable.
* `eed38ed`: detail selection does not restart the list query. Loaded rows are
  revalidated in owner-scoped batches of at most 50 IDs with the active server
  filter, preserving loaded order and the server paging cursor.
* `e594fe6`: a logical conversation retains its Workspace, SDK and controller
  identities when a child job is acknowledged. An ID transition clears the
  submitted draft once; subsequent reads preserve the new draft.
* `b9c7b91`: an external cancellation acknowledgement records immutable
  `cancellationRequestedAt`, retains running/queued status and admission, and
  keeps polling. Only a worker terminal receipt settles the job. Legacy local
  cancellations retain their earlier notification behavior.

# Fixture results

The focused regressions reproduced: page/401 retaining a private list;
pre-send write failure leaving `sending` with zero sends; detail selection
shrinking 60 rows to 30; a child continuation changing the Workspace key; and
worker cancellation acceptance incorrectly returning terminal `cancelled`.
All focused regressions passed after the corresponding corrections.

The connected conversation fixture runs production components/controllers
with synthetic Teams/browser and SDK display slots. It checks 60→61 turns,
a preserved new draft, and one continuation. It is not a native Teams test.
The notification fixture fails the sending-state atomic rename, then persists
an unrelated reference and restarts; recovery sends exactly once. The queue
fixture covers pending restart, held capacity, duplicate request suppression,
and cancelled/completed/failed worker outcomes. The existing Azure integration
fixture now distinguishes request acknowledgement from worker termination.

Commands use the production bounded module entrypoint:

```sh
node --import tsx/esm scripts/run-module-test.mjs scripts/client-orchestration-panel-test.tsx
node --import tsx/esm scripts/run-module-test.mjs scripts/personal-notification-test.ts
node --import tsx/esm scripts/run-module-test.mjs scripts/copilot-conversation-continuity-test.tsx
node --import tsx/esm scripts/run-module-test.mjs scripts/agent-durable-reconciliation-test.ts
node --import tsx/esm scripts/run-module-test.mjs scripts/azure-index-integration-test.ts
```

# Live release boundary

Fresh registered-package read-back is required before allocating the next
version. The existing CLI was logged out; browser-control rejection must not
be bypassed. Source regression results do not establish package installation,
native desktop/mobile behavior, Azure workload execution, or release readiness.
