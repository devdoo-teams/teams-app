# 2026-08-12 release machine timeout evidence

Scope: explain why the release-loop `machine` phase blocked even though its four bounded preflight commands can each be healthy.

## Official fact

Node.js documents that a positive child-process timeout causes the parent to send the configured kill signal when the child runs longer than that timeout. The project wrapper in `runWithTimeout()` implements the same contract around `spawn()`: <https://nodejs.org/docs/latest-v24.x/api/child_process.html>.

## Local observations

- The preflight runs four commands sequentially with limits of 60 seconds (`typecheck:core`), 300 seconds (`build:core`), 300 seconds (`test:core`), and 30 seconds (`check:deployment`). Their combined bounded contract is 690 seconds.
- The outer release-loop `machine` timeout was 330 seconds, so it could terminate a valid preflight before the inner limits were exhausted.
- On commit `9774e22bdfe5e816b2291e6998d5921203f493d7`, an independently bounded preflight returned `READY`. Its build evidence recorded 31,851 ms for the client bundle and 225,327 ms for the server bundle; the subsequent Core tests and deployment check also passed. The complete sequential run exceeded the old 330-second outer timeout.
- A regression test now requires the outer machine timeout to cover at least the 690-second sum. The implementation uses 720 seconds, leaving 30 seconds for process startup and cleanup.
- A subsequent retry reached the inner 300-second `build:core` limit. Inspection then showed `blocks=0` and `compressed,dataless` on `package-lock.json`, `appPackage/manifest.json`, `scripts/release-loop.mjs`, `src/server/index.ts`, and `src/client/App.tsx`.
- The release loop now records an explicit `TEAMS_FILEPROVIDER_SERVER_REUSE=1` request as `sourceIoMode=index-tree-fileprovider-fallback`. This preserves the selected source-I/O mode in the release identity while the existing clean tracked-worktree gate remains enforced.

## Conclusion

The first block was a timeout-contract defect in the release orchestrator, not a failed Core build or test. The change does not loosen any inner command limit; it lets those existing fail-closed limits run to completion. The later bounded build timeout is separately classified as FileProvider source-I/O instability and uses the project's existing Git-materialized fallback.
