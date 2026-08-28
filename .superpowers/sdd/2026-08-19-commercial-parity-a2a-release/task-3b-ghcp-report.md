# Task 3B — Official GHCP executable identity alignment

## Scope

MP-115 Task 3B only. Health and execution now derive the official GitHub
Copilot CLI command from the same immutable `GHCP_BIN` and optional
`GHCP_SCRIPT` environment values. The legacy `COPILOT_BIN` execution split
and health-only `--help` inference are removed from this path. Codex remains
on its existing `CODEX_BIN`/`CODEX_SCRIPT` path.

The dedicated GHCP adapter performs the existing bounded executable/help
check and then a bounded, read-only official CLI turn. Capability is
`available` only after validating the JSONL lifecycle records for a session,
turn, non-empty assistant message, and turn end. Missing, authentication,
policy, timeout, malformed, and other inconclusive results remain unavailable
or unknown. No login command is automated, and diagnostics remain redacted.

## Official contract sources

- [GitHub Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
  documents `-p`/`--prompt` for programmatic execution and
  `--output-format json` as JSONL output.
- [GitHub Copilot CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
  documents non-interactive prompt execution and bounded automation options.

These sources establish command/output semantics only. They do not establish
that this workspace has a live GitHub Copilot authentication, license, or
organization entitlement.

## Changed paths

- `src/server/ghcp-cli-adapter.ts`
- `src/server/codex-capability.ts`
- `src/server/cli-agent-runner.ts`
- `scripts/ghcp-cli-adapter-test.ts`
- `scripts/codex-ghcp-capability-regression-test.mjs`
- `scripts/cli-agent-runner-test.ts`
- `.superpowers/sdd/2026-08-19-commercial-parity-a2a-release/task-3b-ghcp-report.md`

## Verification

- `node --import tsx/esm scripts/codex-ghcp-capability-regression-test.mjs` — PASS (8 tests)
- `node --import tsx/esm scripts/ghcp-cli-adapter-test.ts` — PASS
- `node --import tsx/esm scripts/cli-agent-runner-test.ts` — PASS
- `git diff --check` and staged diff check — PASS
- `npm run typecheck:core` — BLOCKED before commit by the repository's
  FileProvider clean-tracked-worktree gate (`EWORKTREEDIRTY`). Existing
  unrelated tracked changes in Bitbucket, Atlassian, MCP, and other files were
  preserved and are outside this slice.

The focused runner regression records the exact execution request for
`GHCP_BIN=/opt/copilot` and `GHCP_SCRIPT=node`: `/opt/copilot node --prompt
<prompt> --output-format json --stream off --no-color --no-auto-update
--no-ask-user --allow-tool=<bounded-tools>`. The capability regression records
the same prefix and documented probe arguments on the health path.

## Live limitation

No live GHCP provider call, authentication, license, organization policy, or
Teams deployment was performed or inferred. Capability remains unknown unless
the bounded official JSONL turn succeeds in the running environment. This
report is not a review pass.

## Fix round 1 — exact capability sentinel

The independent review finding was valid: a structurally valid JSONL lifecycle
with any non-empty assistant message could previously become `available` and
then be mapped to authenticated health. The adapter now requires an assistant
message whose trimmed content is exactly `GHCP_CAPABILITY_OK`; valid JSONL
containing authentication-required or organization-policy text is rejected
from the success path and classified accordingly. The stale comment now
describes the bounded `--help` plus capability-turn sequence.

### Fix-round focused verification

- Command: `node --import tsx/esm scripts/ghcp-cli-adapter-test.ts` — PASS;
  observed output: `GHCP CLI adapter tests passed`. This includes the
  `testValidJsonlWithoutCapabilitySentinelStaysUnknown` negative case and the
  `testValidJsonlAuthAndPolicyTextCannotClaimAvailability` negative cases.
- Command: `node --import tsx/esm scripts/codex-ghcp-capability-regression-test.mjs`
  — PASS; observed output: `PASS: 8 Codex/GHCP capability regression tests`.
- Command: `node --import tsx/esm scripts/cli-agent-runner-test.ts` — PASS;
  observed output: `PASS: provider-neutral CLI runner selects independent
  Codex and official Copilot JSONL adapters`.
- No re-review pass is claimed by this report.

## Post-commit validation

- First fix commit: `5b87a03141f49d74dca0c937e17b09b0c3070c2e`.
- Command: `npm run typecheck:core` — PASS; observed output: `PASS: core
  source compile check covered 22 Teams/CLI files`.
- Command: `git diff --check` — PASS (exit 0).
- The post-commit tracked worktree was clean before validation. Existing
  baseline untracked files remain preserved.
