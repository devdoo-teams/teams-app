---
type: concept
sources:
  - url: https://learn.chatgpt.com/docs/non-interactive-mode
    title: Codex non-interactive mode
    section: Ephemeral runs and JSON events; HTML line numbers are unstable, observed 943–981 on 2026-10-10
  - url: https://learn.chatgpt.com/docs/developer-commands?surface=cli
    title: Codex developer commands
    section: exec --model/--config/--json/--ephemeral; HTML line numbers are unstable, observed 2288–2302 on 2026-10-10
  - url: https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/exec/src/exec_events.rs
    title: Pinned OpenAI Codex exec events
    section: Source lines 36–67; ThreadStartedEvent, TurnStartedEvent, TurnCompletedEvent and Usage; observed HTML 909–960
generated: 2026-10-10
verified: 2026-10-10
status: IMPLEMENTED_LOCAL_GATES_PENDING
stale_after: 2026-10-17
---

# Safe CLI launch metadata

## OFFICIAL CONTRACT

The installed signed/pinned worker is Codex CLI `0.162.0-alpha.2`. Its `exec --help` defines `--model`, `--config`, `--json`, and `--ephemeral`. Ephemeral mode does not persist session rollout files. The pinned JSONL thread/turn/usage schema does not supply the provider's effective model or reasoning effort. CLI arguments therefore cannot establish those provider facts.

## OBSERVED EVIDENCE

MP-377 (`teams-core:task:cli-launch-metadata`) follows the saved133 observation audit. That historical job retains selection and platform/tool/usage observations, but has no retained final launch arguments or CLI version. Current implementation evidence is `/tmp/teams-cli-invocation-20261010/red.log:4` and the matching focused GREEN log. Historical actual model/effort remain unverified.

## IMPLEMENTATION AND FIXTURE

`src/server/agent-cli-invocation-receipt.ts:1` extracts only the single model and reasoning switch before the prompt delimiter and observes the same executable's version with a five-second bounded `--version` probe. Only source, observation time, model argument, reasoning argument, version status, and a strictly bounded version string can be retained. Probe errors yield an explicit unavailable version without retaining diagnostics. Cancellation remains fatal. Full argv, prompt, paths, environment, credentials and version stderr are omitted.

`src/server/codex-runner.ts:1` registers cancellable preparation before asynchronous observation and awaits the durable metadata callback before the execution spawn. A failed callback or preparation cancellation prevents launch. `src/server/agent-job-store.ts:1` validates, clones, preserves on reload and prevents replacement/removal of the receipt. Existing authenticated worker queue checkpoints use the same whitelist and preserve the receipt across later heartbeats and completion. A valid shape is not independent proof of producer authenticity.

`src/shared/receipt-presentation.ts:1` presents selection, launch arguments/version, and provider observations independently. Existing provider-returned receipt fields remain separate and pass through both adapters. Missing provider fields retain their unknown text; unsupported JSONL fields are not invented. Legacy jobs remain readable with launch metadata marked uncollected.

`scripts/agent-cli-invocation-test.ts:1` uses a controlled subprocess and real durable store to require persistence before launch. It separately checks restart/immutability/foreign ownership, prompt-delimiter spoofing, malformed/private fields, selected-versus-argument-versus-provider values, durable-write failure and preparing cancellation. Adapter and worker tests preserve source/time and provider facts independently. These are fixtures, not live provider or Teams UI proof.

## LIVE RESULT AND INFERENCE

New committed package, remote CI, actual CLI, catalog/personal installation, public runtime and native/mobile UI evidence must each be read back for their own identity. The existing133 public process and tunnel stay running during this work. Mac foreground is reserved for the user's iPhone. No new auth, persistent sessions, grants or deployment targets are introduced. Native isolation's default preflight includes an additional authenticated model canary; it must not be silently skipped to meet a one-call synthetic budget.
