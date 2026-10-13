---
type: "Concept"
title: "Module test completion and failure propagation"
description: "A successful module import is not proof that its asynchronous tests completed."
sources:
  - resource: "https://nodejs.org/docs/latest-v24.x/api/process.html#processexitcode"
    title: "Node.js v24 process documentation"
    location: "process.exit and process.exitCode sections; observed lines 1292-1357 on 2026-10-13; HTML lines are not stable"
  - resource: "https://nodejs.org/docs/latest-v24.x/api/process.html#processargv"
    title: "Node.js v24 process.argv"
    location: "process.argv section; executable, entrypoint, and remaining arguments"
generated:
  by: "process:module-runner-regression/1"
  at: "2026-10-13T03:40:44Z"
verified:
  by: "process:module-runner-regression/1"
  at: "2026-10-13T03:40:44Z"
status: stable
stale_after: "2026-10-20T03:40:44Z"
---

# Official contract

An explicit `process.exit(code)` terminates pending asynchronous work and
overrides an existing `process.exitCode`. Natural exit retains a failure code
and lets pending work settle. `process.argv[1]` identifies the entrypoint.

# Observed evidence

At `dcfb6b8`, `scripts/run-module-test.mjs:12` unconditionally exited zero after
dynamic import. The real `a2a-orchestrator-test.ts:755` used an unawaited async
main: its wrapped invocation returned zero without its completion output.
Direct execution reached that output. The wrapper also left its own path in
`argv[1]`, preventing the nested Azure Core runner's entrypoint guard from running.

# Fixture and local result

Node v24.13.1, installed help `--import`: the new real-process regression has
eleven cases for success, nonzero exitCode, sync throw, awaited rejection,
unawaited failure, unhandled rejection, delayed exit, failing child, delayed
success, guarded entrypoint/arguments, and signal termination. Before the fix,
eight cases failed. After the fix all eleven passed and the wrapped real A2A
orchestrator test reached its completion output.

Commands:

```sh
node scripts/run-module-test-test.mjs
node --import tsx/esm scripts/run-module-test.mjs scripts/a2a-orchestrator-test.ts
```

The wrapper now canonicalizes the module path, restores entrypoint arguments,
and lets Node terminate naturally. Tests must dispose their own resources;
the existing parent timeout still bounds and reaps a hung process. A timeout
must be investigated, never changed into success or skipped.

# Release boundary

The focused result is local fixture evidence. Re-run every affected Core/Azure
and pinned TypeScript test, resolve newly exposed failures, and check CI for
the final full SHA before accepting a release. Prior GitHub success alone does
not establish completion of tests affected by this defect. Native A2A component
execution, Teams host UI, installation, and session survival remain separate gates.
