# Release and process gate audit — 2026-08-11

## Root cause

The recurrence was primarily a workflow/provenance problem, not context length alone:

1. The source was `1.0.40` while the active public/release identity was `1.0.39`.
2. The existing server bundle marker contained only the same Git commit and therefore authorized reuse even when tracked changes were still uncommitted. In FileProvider fallback mode the build materializes `HEAD`, so a same-commit dirty worktree could silently produce an older artifact.
3. `tsx`/esbuild and Git worktree inspection both became unstable when source files were exposed as dataless FileProvider placeholders. Parallel or unbounded commands amplified the symptom: `The service was stopped` and long no-output waits looked like application progress.
4. Public server PID `98678` and Dev Tunnel PID `49618` were alive, but they served the older release. An older local server PID `84835` also existed. Process liveness was therefore not release identity evidence.
5. The existing UI matrix had 226 rows with `BLOCKED=199`, `N/A=27`, `PASS=0`; all current release portal/installed/desktop/mobile evidence fields were empty.

## Preventive gates added

- Server marker schema now includes full commit, build mode, and `worktree=clean`; legacy/dirty markers cannot authorize reuse.
- FileProvider fallback refuses tracked dirty worktrees and reports a bounded source-I/O error if clean inspection itself times out.
- API-free and Core test runners apply per-child timeouts and report the exact timed-out command.
- The global instructions now require sequential FileProvider fallback tests, process ownership checks, release identity matching, and explicit `SOURCE_IO_UNSTABLE`/`STALE_PROCESS_SUSPECTED` states.

## External state

No package upload or public process restart was performed in this audit. Existing user tabs and processes were preserved.
