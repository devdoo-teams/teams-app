# 2026-08-12 Core source-check official research

Scope: investigate the historical Core source-check failure mode where Node-based esbuild async `transform()` could surface `The service was stopped` inside a macOS File Provider-backed checkout, and record the current post-change behavior separately. This note uses only primary sources: official esbuild source/issues, official Node.js docs, official Apple File Provider docs, and official Microsoft Teams docs where they affect release gating.

## Local evidence from this checkout (not web claims)

- This repo wires the Core source check through `package.json` as `"typecheck:core": "node scripts/core-source-check.mjs"`.
- Historical pre-change observation from 2026-08-12: [`scripts/core-source-check.mjs`](/Users/doosansmacbookpro/Documents/TeamsApp/scripts/core-source-check.mjs) then imported async `transform` and `stop` from `esbuild`, checked 9 fixed files, retried once only when the error message matched `service was stopped` or `service is no longer running`, then slept 100 ms and called `stop()`.
- Historical pre-change observation from 2026-08-12: the checker itself was in the same File Provider-backed tree; `scripts/core-source-check.mjs` had `blocks=0 flags=compressed,dataless` at inspection time, while `scripts/esbuild-bounded.mjs` had `blocks=8 flags=-`.
- Historical pre-change observation from 2026-08-12: all 9 checked source files in the Core source-check list had `blocks=0 flags=compressed,dataless` at inspection time:
  - `src/server/codex-capability.ts`
  - `src/server/index.ts`
  - `src/server/genui-response.ts`
  - `src/server/genui-teams.ts`
  - `src/server/teams-tab-link.ts`
  - `src/shared/genui.ts`
  - `src/client/build-flags.ts`
  - `src/client/App.tsx`
  - `src/client/main.tsx`
- Historical pre-change observation from 2026-08-12: additional tracked files in `src/`, `scripts/`, `types/`, and `appPackage/manifest.json` also showed `blocks=0 flags=compressed,dataless`.
- Historical pre-change observation from 2026-08-12: a read-only run of `node scripts/core-source-check.mjs` first emitted `esbuild service stopped while checking src/server/codex-capability.ts; retrying once`, then completed with `PASS: core source compile check covered 9 Teams/CLI files`.
- Current post-change observation: [`scripts/core-source-check.mjs`](/Users/doosansmacbookpro/Documents/TeamsApp/scripts/core-source-check.mjs) is now a thin wrapper around [`scripts/core-source-check-lib.mjs`](/Users/doosansmacbookpro/Documents/TeamsApp/scripts/core-source-check-lib.mjs).
- Current post-change observation: the library imports esbuild `transformSync`, compiles each checked file through the one-shot synchronous path, preserves automatic `blocks === 0` dataless detection for the non-explicit path, and requires a clean tracked worktree plus `git show HEAD:<path>` reads during fallback.
- Current post-change observation: explicit `TEAMS_FILEPROVIDER_SERVER_REUSE=1` fallback now chooses Git fallback before any workspace `stat`/read attempt, while non-explicit fallback still fails closed on checked-source `stat` errors.

## Official-source findings

### 1) What esbuild officially establishes

- esbuild’s async Node API is backed by a long-lived child process. In the official Node binding source, `ensureServiceIsRunning()` calls `child_process.spawn(...)` with `--service=<version> --ping` and communicates over `stdin`/`stdout` via `createChannel(...)` ([`lib/npm/node.ts`](https://github.com/evanw/esbuild/blob/main/lib/npm/node.ts)).
- In that same file, esbuild explicitly treats several transport failures as “service stopped” conditions: write-to-stdin callback errors, `child.stdin` `'error'`, `child` `'error'`, and `stdout` `'end'` all route into the shared close path ([`lib/npm/node.ts`](https://github.com/evanw/esbuild/blob/main/lib/npm/node.ts)).
- esbuild’s service implementation says it is a “simple long-running service over stdin/stdout,” and multiple request/response sites return `errors.New("The service was stopped")` when the JS side no longer gets a valid response ([`cmd/esbuild/service.go`](https://github.com/evanw/esbuild/blob/main/cmd/esbuild/service.go)).
- The official synchronous service path is materially different: `runServiceSync()` uses `execFileSync(...)` for a one-shot service invocation instead of reusing the long-lived async child ([`lib/npm/node.ts`](https://github.com/evanw/esbuild/blob/main/lib/npm/node.ts)).
- Official esbuild issues show that the exact same message is not root-cause-specific:
  - spawn failure / missing executable path: [issue #2165](https://github.com/evanw/esbuild/issues/2165)
  - SIGINT / graceful shutdown race with rejected promises: [issue #3219](https://github.com/evanw/esbuild/issues/3219)
  - SIGINT with logged error despite silent logging: [issue #3480](https://github.com/evanw/esbuild/issues/3480)
  - heavy build / many entry points: [issue #320](https://github.com/evanw/esbuild/issues/320)

### 2) What Node.js officially establishes

- `child_process.spawn()` creates pipes for `stdin`, `stdout`, and `stderr` by default, and those pipes have limited, platform-specific capacity ([Node child_process docs](https://nodejs.org/api/child_process.html)).
- For child processes, Node documents that:
  - `'error'` fires if the process could not be spawned, could not be killed, message sending failed, or the child was aborted by the `signal` option.
  - `'close'` fires after the process has ended and stdio streams have closed.
  - `'close'` always comes after `'exit'` or after `'error'` when spawn failed ([Node child_process docs](https://nodejs.org/api/child_process.html)).
- For the parent Node process, `'exit'` means the process is about to terminate because `process.exit()` was called or the event loop has no more work, and Node says there is no way to prevent exit at that point; queued async work will not continue from an `'exit'` handler ([Node process docs](https://nodejs.org/api/process.html)).
- Node’s `'unhandledRejection'` event is emitted when a promise is rejected without a handler within one event-loop turn ([Node process docs](https://nodejs.org/api/process.html)). That matches the failure shape documented in esbuild issue #3219.

### 3) What Apple File Provider docs officially establish

- Apple’s File Provider documentation says a dataless copy stores metadata only, while a materialized document has local contents available; Apple describes this on the official “Synchronizing the File Provider Extension” page ([Apple doc](https://developer.apple.com/documentation/fileprovider/synchronizing-the-file-provider-extension)).
- Apple’s TN3150 says a file containing only metadata is a dataless file and that its content typically lives on a remote server until needed ([TN3150](https://developer.apple.com/documentation/technotes/tn3150-getting-ready-for-data-less-files)).
- Apple’s `fetchContents(...)` API documentation says this method is the mechanism that tells the provider to download the requested item from remote storage, and its completion handler is called after downloading the item ([Apple API doc](https://developer.apple.com/documentation/fileprovider/nsfileproviderreplicatedextension/fetchcontents%28for%3Aversion%3Arequest%3Acompletionhandler%3A%29)).
- Apple’s “Synchronizing files using file provider extensions” page says when users or system APIs access a dataless item, the system calls into the provider to fetch the file contents ([Apple doc](https://developer.apple.com/documentation/fileprovider/synchronizing-files-using-file-provider-extensions)).
- Apple’s `materializedItemsDidChange(...)` documentation says the materialized-item set changes when the system downloads the content of a dataless item ([Apple API doc](https://developer.apple.com/documentation/fileprovider/nsfileproviderreplicatedextension/materializeditemsdidchange%28completionhandler%3A%29)).

### 4) What official Teams docs establish for release gating

- Microsoft says a Teams app package is only the manifest plus icons; Teams does not host the app logic, which is hosted elsewhere over HTTPS ([Teams app package](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package)).
- Microsoft also says code changes can be reflected without re-uploading, but app configuration changes require reinstall/update flows in Teams ([Upload your custom app](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload)).

## What the official sources do establish

- The esbuild async API failure string `The service was stopped` is a transport/process-channel symptom, not a unique diagnosis.
- The esbuild async path specifically depends on a long-lived child process and open stdio pipes.
- A File Provider dataless file is officially a metadata-only local placeholder whose contents may need on-demand download from remote storage.
- Therefore, if a source-check reads many dataless tracked files and also uses esbuild’s long-lived async service, the overall system includes two moving parts that can fail independently:
  1. source content availability/materialization
  2. the esbuild child-service transport

## What the official sources do not establish

- No official esbuild source or issue found here states that macOS File Provider dataless files are a known direct cause of esbuild service shutdown.
- No official Apple doc found here maps Finder/`stat` observations such as `blocks=0` or `flags=dataless` to a guarantee about how quickly a third-party Node process will receive file bytes.
- No official source here proves whether the esbuild child exited because of unreadable source input, a spawn/runtime problem, signal handling, or some other channel break in this repo.
- No official Teams document makes package/upload success a substitute for a passed source compile check.

## Implications for a bounded, fail-closed Core source compile check

These are inferences from the official sources plus the local evidence above:

- Treat `The service was stopped` as an indeterminate infrastructure failure, not as a syntax result. It should fail closed unless a bounded retry completes successfully.
- Record the exact file being checked when the service stops. The local checker already does this, which is useful because the error string itself is generic.
- Because the async esbuild path uses a reused long-lived child over stdio, a bounded checker should prefer one of two patterns:
  - keep the current single retry, but escalate to hard failure immediately after the retry; or
  - reduce shared-process state further by moving the source compile check to a one-shot/synchronous invocation path, since esbuild’s own source shows the sync path uses `execFileSync(...)` instead of the reused async service ([`lib/npm/node.ts`](https://github.com/evanw/esbuild/blob/main/lib/npm/node.ts)).
- In a File Provider-backed tree, preflight should separately classify source availability before calling the compiler. Official Apple docs support the distinction between metadata-only and materialized content; local `stat` evidence can be used as heuristic evidence, but not as Apple-guaranteed semantics.
- Release gating should keep source-check success separate from Teams packaging/upload status, because official Teams docs define package/install artifacts, not TypeScript/esbuild correctness.

## Unsupported assumptions to avoid

- Assuming `The service was stopped` means “esbuild parser found bad TypeScript.”
- Assuming it means “File Provider definitely killed esbuild.”
- Assuming one successful retry proves the underlying storage/materialization problem is gone.
- Assuming `blocks=0` or `flags=dataless` alone are an official Apple guarantee of future read failure timing.
- Assuming Teams package generation or upload evidence can compensate for a failed or indeterminate Core source check.

## Source list

1. esbuild Node binding source: <https://github.com/evanw/esbuild/blob/main/lib/npm/node.ts>
2. esbuild service source: <https://github.com/evanw/esbuild/blob/main/cmd/esbuild/service.go>
3. esbuild issue #2165: <https://github.com/evanw/esbuild/issues/2165>
4. esbuild issue #3219: <https://github.com/evanw/esbuild/issues/3219>
5. esbuild issue #3480: <https://github.com/evanw/esbuild/issues/3480>
6. esbuild issue #320: <https://github.com/evanw/esbuild/issues/320>
7. Node child_process docs: <https://nodejs.org/api/child_process.html>
8. Node process docs: <https://nodejs.org/api/process.html>
9. Apple “Synchronizing the File Provider Extension”: <https://developer.apple.com/documentation/fileprovider/synchronizing-the-file-provider-extension>
10. Apple TN3150: <https://developer.apple.com/documentation/technotes/tn3150-getting-ready-for-data-less-files>
11. Apple `fetchContents(...)`: <https://developer.apple.com/documentation/fileprovider/nsfileproviderreplicatedextension/fetchcontents%28for%3Aversion%3Arequest%3Acompletionhandler%3A%29>
12. Apple “Synchronizing files using file provider extensions”: <https://developer.apple.com/documentation/fileprovider/synchronizing-files-using-file-provider-extensions>
13. Apple `materializedItemsDidChange(...)`: <https://developer.apple.com/documentation/fileprovider/nsfileproviderreplicatedextension/materializeditemsdidchange%28completionhandler%3A%29>
14. Microsoft Teams app package docs: <https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package>
15. Microsoft Teams upload/update docs: <https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload>
