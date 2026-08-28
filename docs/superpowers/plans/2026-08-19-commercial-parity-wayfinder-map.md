# Commercial parity Wayfinder map

Date: 2026-08-19
Owner: Codex orchestrator
Source of truth: `/Users/doosansmacbookpro/Documents/TeamsApp`

## Destination

Deliver a commercially deployable Teams Core product whose release identity is
provable end to end, then add independently verifiable optional capabilities:

1. Teams Core: Teams SDK, React/TeamsJS personal tab, deterministic Express
   server, Adaptive Cards, authenticated production runtime, and reproducible
   package.
2. Agent execution: provider-neutral contracts with Codex CLI and the official
   GitHub Copilot CLI as explicit adapters, with capability attestation,
   bounded execution, redaction, approval, and failure visibility.
3. A2A collaboration: durable parent/child task identity, leases, restart
   recovery, cancellation acknowledgement, timeout, and observability for
   independently dispatched agents.
4. Optional Atlassian parity: typed, permission-bounded Jira, Confluence, and
   Bitbucket operations through a provider adapter; optional loading must never
   change the Core runtime.
5. Teams UX: accessible tab/card states and a complete feature matrix whose
   screenshots, runtime responses, package SHA, and installed version identify
   the same release.

The destination is not “all integrations are present.” It is “each supported
capability has a declared boundary, evidence, failure mode, and release
identity.” Hindsight is a future provider/adapter seam, not an implementation
dependency in this release.

## Why the previous sequence was wrong

The previous direction expanded A2A, provider parity, tunnel, portal, and
mobile verification before freezing one release identity and its acceptance
contracts. That allowed local tests, an old public process, and a different
Teams installation to be discussed as if they were one build. The corrected
sequence is:

```text
destination/contracts
  -> Core provenance and release baseline
  -> independent provider adapters
  -> durable A2A orchestration
  -> optional Atlassian surfaces
  -> Teams UI and full branch matrix
  -> package/public runtime/portal/install
  -> desktop then mobile evidence
  -> Jira/Teams completion report
```

## Fixed decisions

- Core does not load OpenAI, CopilotKit, local models, or MCP. Optional
  commands and feature flags are required.
- Codex CLI and the official `copilot` executable are execution adapters, not
  proof of login, license, or model availability. A bounded real result is
  required for authenticated status.
- A2A cancellation is asynchronous where the protocol requires it: a parent
  remains non-terminal until child cancellation is acknowledged or a bounded
  terminal failure is recorded. Missing jobs and provider cancellation failures
  remain observable; fabricated task IDs are forbidden.
- JSON persistence is atomic with rollback on save failure. A failed save must
  not become evidence for a subsequent response.
- Adaptive Card responses are attachment-only; duplicate top-level text is not
  a valid mobile result. Cards target the supported Teams subset.
- Jira is an evidence tracker, not a Core runtime dependency. Bitbucket is an
  optional remote/provider and must not be inferred from GitHub configuration.
- The pre-existing untracked baseline is recorded as `untrackedAtStart`; it is
  preserved and excluded from staging, packaging, and upload.
- Live Jira/Teams connector calls are currently `JIRA_SYNC_UNVERIFIED` and
  `TEAMS_DATA_UNVERIFIED` after reauthentication failure. No issue transition,
  upload, or completion message is claimed from local fixtures.

## Decision frontier

Each row is a local decision ticket until the existing Jira session can be
reauthenticated and the real MP project metadata/workflow is observed. Stable
keys must not include commit hashes or version numbers.

| Stable key | Decision | Acceptance evidence | State |
| --- | --- | --- | --- |
| `teams-core:architecture:module-boundaries` | Choose package boundaries for client/server/shared and enforce imports without a speculative package migration. | Architecture map, boundary rule, positive/negative checks, no Core regression. | `wayfinder:research` |
| `teams-core:a2a:durable-lifecycle` | Finalize task identity, lease, restart, timeout, and cancel acknowledgement semantics. | Focused contract tests, crash/restart fixture, observable failure and metrics. | `wayfinder:task` |
| `teams-core:agent:provider-capability` | Define one attestation contract for Codex and official GHCP adapters. | Negative auth/policy tests, bounded JSONL result, no auto-login, redacted logs. | `wayfinder:task` |
| `teams-core:atlassian:provider-boundary` | Define Jira/Confluence/Bitbucket read/write/approval scopes and idempotency. | Typed optional registry, auth boundary, pagination/rate-limit/error tests, no Core import. | `wayfinder:task` |
| `teams-core:teams:ui-matrix` | Enumerate every user-visible branch and host-specific limitation. | Feature matrix with before/after screenshot, AX tree, runtime evidence, or explicit N/A. | `wayfinder:task` |
| `teams-core:release:identity` | Bind commit, manifest, package SHA, public health, installed version, and UI evidence. | Deterministic package, public health/tab/assets, portal/install version, desktop evidence. | `wayfinder:task` |
| `teams-core:future:hindsight-adapter` | Decide whether and how Hindsight is introduced after Core stability. | Separate design/spec and opt-in proof; no Core dependency. | `wayfinder:research` |

## Out of scope for this release

- Treating MCP Apps as the Teams mobile UI.
- Automatically creating or adding a Bitbucket remote without authenticated
  workspace, repository slug, visibility, and clone URL evidence.
- Creating Jira issues, changing Jira workflow, or sending Teams completion
  messages while the existing authenticated session is unavailable.
- Calling a stale public PID, old tunnel, old ZIP, or old mobile chat as current
  release evidence.
- Implementing Hindsight before the Core/provider/A2A contracts are stable.

## Release acceptance

A slice is implemented only when its focused tests, review report, commit, and
tracked issue/local fallback are present. A release is complete only after the
mandatory workflow in `AGENTS.md` passes: fresh versioned package, verified
manifest and device permissions, clean tracked worktree, public production
health and tab/assets, portal upload/install identity, Teams desktop evidence,
user mobile evidence where required, full feature matrix, and final Jira/Teams
report.

## Official contract anchors

- [Microsoft Teams tabs](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/design/tabs?tabs=mobile)
- [Microsoft Adaptive Card design](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/design-effective-cards)
- [A2A specification](https://a2a-protocol.org/latest/specification/)
- [A2A task lifecycle](https://a2a-protocol.org/latest/topics/life-of-a-task/)
- [Atlassian Rovo MCP overview](https://developer.atlassian.com/cloud/rovo-mcp/)
- [Atlassian Rovo MCP getting started](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/)
- [GitHub Copilot custom agents](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents)
- [OpenAI Codex CLI](https://help.openai.com/en/articles/11096431)
