# Slice 0A report — deterministic status card

## STATUS

Implementation complete for the requested Slice 0A code scope. No Teams upload, deployment, browser, installed-version, desktop, mobile, or runtime evidence was attempted.

## EVIDENCE

Fresh bounded focused tests, run with the direct TypeScript loader:

| Command | Exit | Result |
|---|---:|---|
| `perl -e 'alarm 20; exec @ARGV' -- node --import tsx/esm scripts/status-card-test.ts` | 0 | PASS: measured CLI capability mapping, fail-closed invalid state, `/tabs/home/` deep link, attachment-only activity, and no API-key dependency |
| `perl -e 'alarm 30; exec @ARGV' -- node --import tsx/esm scripts/genui-contract-test.ts` | 0 | PASS: GenUI contract/card tests |
| `perl -e 'alarm 20; exec @ARGV' -- node --import tsx/esm scripts/teams-tab-link-test.ts` | 0 | PASS: personal tab deep-link contract |
| `perl -e 'alarm 30; exec @ARGV' -- node --import tsx/esm scripts/genui-action-store-test.ts` | 0 | PASS: existing GenUI action contract |
| `perl -e 'alarm 30; exec @ARGV' -- node --import tsx/esm scripts/deterministic-response-engine-test.ts` | 0 | PASS: existing deterministic response engine |

Additional bounded checks:

- `perl -e 'alarm 60; exec @ARGV' -- npm run typecheck`: no normal exit observed; `tsc --noEmit -p tsconfig.release.json` remained silent beyond the 60-second bound and was terminated.
- `perl -e 'alarm 60; exec @ARGV' -- node scripts/build-server.mjs`: no normal exit observed; the esbuild service remained silent beyond the bound and was terminated after the user checkpoint.
- `git diff --check`: exit 0.

## COMPLETED

Changed files:

- `src/server/codex-capability.ts`: bounded, read-only Codex and GHCP probes. Codex uses `login status`; GHCP uses `copilot --help` and, only when supported, `auth status`. Missing, unauthenticated, timeout, and probe-error states never become usable; unknown remains explicit.
- `src/server/genui-response.ts`: status envelope now contains only runtime facts for Teams SDK, local/production environment, auth mode, file storage, deterministic mode, Codex CLI, and GHCP CLI. Invalid capability values normalize to `unknown`.
- `src/server/index.ts`: exact `status` command and GenUI status command use the measured facts. Existing `buildTeamsPersonalTabDeepLink` output remains the card's tab action, including `/tabs/home/`.
- `scripts/status-card-test.ts`: focused coverage for capability mapping, fail-closed behavior, card deep link, attachment-only Teams activity, and absence of API-key dependency.

The React UI, release loop, manifest/version, MCP/CopilotKit runtime, deployment files, and unrelated commands were not modified.

## BLOCKER

The focused code-level tests pass. Full typecheck and server bundle build did not produce a normal exit within their bounded windows, so those gates remain unresolved for the parent review. No deployment or Teams runtime claim is made.

## NEXT ACTION

Parent should independently rerun the bounded typecheck/build and complete the required release/evidence workflow if those gates finish.
