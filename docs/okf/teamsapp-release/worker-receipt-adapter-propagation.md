---
type: "Concept"
sources:
  - resource: "https://nodejs.org/download/release/v24.13.1/docs/api/process.html#processplatform"
    title: "Node v24.13.1 process.platform"
    location: "process.platform section; HTML lines2216–2239 observed2026-10-09; HTML positions may change"
  - resource: "https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/exec/src/exec_events.rs"
    title: "Pinned Codex exec thread, turn and usage schema"
    location: "source lines36–67; HTML lines909–962 observed2026-10-09; HTML positions may change"
generated: { by: "process:codex", at: "2026-10-09T07:23:00Z" }
verified: { by: "process:source-hash-bound-focused-regressions-and-independent-review", at: "2026-10-09T07:23:00Z" }
status: "LOCAL_VERIFIED_LIVE_UNVERIFIED"
stale_after: "2026-10-16T07:23:00Z"
---

# Worker receipt transport through two adapters

## OFFICIAL CONTRACT

Node `process.platform` identifies the platform for which its binary was compiled. The pinned Codex thread/turn/usage schema supplies no actual model or reasoning-effort observation. Installed Node is v24.13.1. The retained installed CLI0.162.0-alpha.2 help exposes `--json` and `--model`; model selection is not actual execution evidence.

## OBSERVED EVIDENCE

[MP-366](https://devdoo.atlassian.net/browse/MP-366), idempotency `teams-core:bug:worker-receipt-adapter-propagation`. Baseline `225aa2c39f5ec8cb29d8b0361405957c727d9ab8` produces a platform-only receipt at `src/server/codex-runner.ts:659`, but both adapters independently omit it. Existing completed129 synthetic job `task-mv0d5ajb-2179f05d` has no persisted receipt. The repaired CLI boundary at `src/server/cli-agent-runner.ts:356` and neutral boundary at `src/server/provider-neutral-agent-runner.ts:110` call the existing `readExecutionReceipt` before forwarding a detached envelope. `src/server/agent-service.ts:962`, `src/server/agent-job-store.ts:376` and `src/server/agent-job-store.ts:753` retain the receipt through immutable update, clone and reload.

The validator at `src/server/agent-execution-receipt.ts:4` checks shape and bounded fields. A valid `worker-observation` literal is not independent authenticity proof; trust depends on the server-controlled producer path. Preserve the producer's source/time/platform. Do not manufacture observed model/effort from selected configuration, token counts, a host declaration or a fixture. Thrown/cancelled paths gain no invented successful receipt.

## FIXTURE / RED AND GREEN

`node --import tsx/esm scripts/run-module-test.mjs scripts/provider-neutral-agent-runner-test.ts` independently reproduced each adapter loss with exit1, then passed both repaired adapters with exit0. The neutral-only baseline uses `RECEIPT_ADAPTER_CASE=neutral`; normal validation runs all cases. Fixtures cover darwin/linux/win32, original source/time, detached copy, missing legacy receipt and malformed/oversized/credential-shaped fields with generic non-leaking rejection.

P00–P02 hash-matched the current four-file diff to the tested snapshot. Eight GREEN commands cover adapters, real fixture CLI, immutable persistence/reload, terminal privacy, cancellation/process-tree security, atomic store failure, owner/tenant cross-surface isolation and card/tab/conversation rendering. Two expected baseline REDs and all logs/exit receipts remain at `/tmp/teams-receipt-fix-20261009-1235` and `/tmp/teams-mp366-p00-p02-20261009-0708`. The existing independent reviewer reported no Critical/Important/Minor findings. Synthetic renderer/model/platform cases are not live execution proof.

## LIVE RESULT / REMAINING BOUNDARIES

The candidate is1.0.130. Full clean committed-source gates, same-SHA CI, immutable candidate, ZIP/catalog/personal-install/public-runtime and live receipt/UI observations require separate evidence. Last retained catalog129 read-back is02:29:24Z; personal installed definition129 is02:33:27Z. Their age and identity must be explicit. Current actual model/effort remain unobserved. Existing129 server/tunnel, user files and browser/device sessions are preserved. Native/mobile/exhaustive UI/user acceptance remain unverified; no Jira Done or Teams completion follows from local GREEN.
