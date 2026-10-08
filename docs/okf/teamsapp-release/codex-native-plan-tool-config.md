---
type: "Concept"
sources:
  - resource: "https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/core/src/config/mod.rs"
    title: "Codex native plan tool configuration, rust-v0.162.0-alpha.2"
    location: "Pinned lines2721–2727, resolve_update_plan_enabled; observed2026-10-08T19:19:23Z"
  - resource: "https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/core/src/tools/spec_plan.rs"
    title: "Codex native PlanHandler registration"
    location: "Pinned lines1153–1155, add_core_utility_tools; same observation"
  - resource: "https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/core/config.schema.json"
    title: "Codex UpdatePlanToolConfig schema"
    location: "Pinned lines6512–6520, boolean enabled default false; same observation"
generated: { by: "process:codex", at: "2026-10-08T19:27:00Z" }
verified: { by: "process:official-source-and-actual-signed-cli", at: "2026-10-08T19:26:30Z" }
status: "UNVERIFIED"
stale_after: "2026-10-15T19:27:00Z"
---

# Core native plan tool availability

## OFFICIAL CONTRACT

The pinned source resolves absent `tools.update_plan.enabled` to false and registers `PlanHandler` only when true. Installed0.162.0-alpha.2 help confirms `--strict-config`, `--ignore-user-config` and `-c KEY=VALUE`. This internal checklist setting does not enable an external connector, browser, filesystem write or network permission.

## OBSERVED EVIDENCE

[MP-358](https://devdoo.atlassian.net/browse/MP-358), stable key `teams-core:bug:codex-update-plan-enabled`, is separate from MP-351's JSONL parser rejection. Core ignores user config and omitted this explicit setting. Actual signed/SHA-pinned native read-only preflight passed, but an explicit plan request returned unavailable with no todo wire events. The model reply alone was not a root-cause determination; pinned registration/default source and the subsequent identical-path run establish the configuration boundary.

The new launch regression failed `0 !== 1` before the product fix. An earlier sandboxed test stopped on loopback `listen EPERM`; that retained environment failure is not the product RED. The same local canary test then passed after adding one provider-owned config pair. A later attempt to disable the plan tool is still rejected before spawn. Auth, signature/pin, filesystem, network, config grammar, external-tool and lease restrictions remain unchanged.

Internal sources: `src/server/codex-permission-profile-isolation-provider.ts:90`; `scripts/codex-native-permission-isolation-test.ts:341`. Receipts under `/tmp/teams-124-continuity-20261009-0409/`: `official-tool-contract-readback.json`, `mp358-native-plan-red-local-probe-receipt.json`, `mp358-native-plan-green-receipt.json`, `plan-success-mp358-green/receipt.json`.

## FIXTURE AND LIVE RESULT

Focused fixture command:

```sh
node --import tsx/esm scripts/run-module-test.mjs scripts/codex-native-permission-isolation-test.ts
```

The actual CLI probe uses the production provider/preflight and a spawn observation adapter calling real `node:child_process.spawn` with unchanged trusted arguments/options. Native preflight, signature verification and child are not fixture replacements. It reads only synthetic `17 25 8`; no Teams message is sent. The uncommitted local source diff is explicitly recorded, so this is not deployed124 UI evidence.

At19:26:30Z, the actual producer emitted eleven events, including start, two updates and completion for the same `item_1` todo list. All eleven callbacks were accepted. Final result was `CONTINUITY124_PLAN_SUCCESS_OK sum=50`, terminal usage was retained, both synthetic files were unchanged, child exited and lease was disposed. Raw synthetic stdout is retained separately. Prior actual cancellation, consumer callback failure and fresh recovery also retained child/lease cleanup receipts; consumer failure is not a remote provider failure.

## REMAINING BOUNDARIES

Complete release acceptance remains `UNVERIFIED` until a new committed package, matching catalog/personal installation, public runtime and required host UI evidence exist. Public124 PID50581 and tunnel52764 continue. Native desktop and mobile remain independent unverified gates. About/ManageApps122's cause is unconfirmed; scoped user-context catalog GET returned403 without new consent or permissions, while installedApps returned124. No cache cause is inferred, Jira Done or Teams completion message is sent.
