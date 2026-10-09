---
type: "Concept"
sources:
  - resource: "https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence"
    title: "Codex configuration precedence"
    location: "Configuration precedence section; checked 2026-10-09; HTML positions may change"
  - resource: "https://docs.copilotkit.ai/backend/copilot-runtime"
    title: "CopilotKit TypeScript OSS runtime"
    location: "TypeScript runtime, Express, per-request custom agents and agent keys; lines89–197 observed2026-10-09; HTML positions may change"
  - resource: "https://docs.copilotkit.ai/generative-ui/tool-rendering"
    title: "CopilotKit named tool rendering"
    location: "useRenderTool schema and render lifecycle; checked2026-10-09; HTML positions may change"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/task-modules/task-modules-tabs"
    title: "Use dialogs in Teams tabs"
    location: "TeamsJS v2 dialog.url.open and initialized child iframe; lines36–83 observed2026-10-09; HTML positions may change"
  - resource: "https://learn.microsoft.com/en-us/javascript/api/%40microsoft/teams-js/urldialoginfo?view=msteams-client-js-latest"
    title: "Current TeamsJS UrlDialogInfo"
    location: "Inherited size: DialogSize property; lines43–84 observed2026-10-09; HTML positions may change"
  - resource: "https://developer.microsoft.com/json-schemas/teams/v1.25/MicrosoftTeams.schema.json"
    title: "Canonical Teams manifest1.25 schema"
    location: "composeExtensions.commands.initialRun default=false; lines674–677 observed2026-10-09"
  - resource: "https://microsoft.github.io/teams-sdk/cli/commands/app/update/"
    title: "Teams Developer CLI existing app update"
    location: "Existing app properties, scripted flags and version example; lines95–114 observed2026-10-09; installed teams3.0.3 --version option agrees"
generated: { by: "process:codex", at: "2026-10-09T09:49:30Z" }
verified: { by: "process:installed-contract-and-focused-synthetic-tests", at: "2026-10-09T09:49:30Z" }
status: "INTEGRATION_IN_PROGRESS_LIVE_UNVERIFIED"
stale_after: "2026-10-16T09:49:30Z"
---

# Fixed Teams CLI agents and three saved execution views

## OFFICIAL CONTRACT

CLI arguments have higher configuration precedence than role-home configuration. Installed operational Codex `0.162.0-alpha.2` exposes `--model` and `--config`; actual `debug models --bundled` lists `gpt-6-luna` with `xhigh`. The older shell-default CLI `0.154.0` does not supply this support evidence and must not be substituted. Current Copilot CLI startup fails in the keychain before model support can be measured, so this provider cannot satisfy the fixed-model policy.

Installed CopilotKit Runtime/React are1.66.2, AG-UI client/core0.0.57. Use the OSS TypeScript Runtime and public AbstractAgent/AgentRunner/HttpAgent/useAgent/useRenderTool contracts. Enterprise self-managed agents and development-only agent injection are separate contracts. A Teams chat uses Adaptive Cards1.6; the actual React SDK mounts in an initialized TeamsJS child Dialog on the existing app domain. Current TeamsJS2.54.0 and the current API reference require `size: {width, height}`; the older flattened tutorial example is not the current type contract.

## OBSERVED EVIDENCE

[MP-368](https://devdoo.atlassian.net/browse/MP-368), stable key `teams-core:task:cli-agent-luna-policy`, implements the user's fixed Luna/xhigh instruction for Teams-launched CLI agents. Admission, catalog selection, final argv, isolation lease and queue executor refuse conflicting selections/overrides and unsupported catalogs. Historical jobs keep their recorded selection; incompatible historical execution mutations are refused. Selected configuration never becomes an actual worker observation.

[MP-369](https://devdoo.atlassian.net/browse/MP-369), stable key `teams-core:task:execution-presentation-three-views`, uses one authorized existing job projection for text, summary and SDK views. Owner-derived tenant/requester display preferences persist atomically. Provider preferences remain independent. The optional SDK agent has only an owner-pinned read port and receives strict `{jobId}`; displaying or closing a view cannot submit/retry/approve/cancel a CLI job.

Default `build:core` contains the pure summary component and a disabled loader, with no SDK client/server graph. Explicit `build:copilot-ui` creates a separately hashed, committed-source artifact. `TEAMS_COPILOT_UI_RUNTIME=true` loads it only when commit, file set and hashes match. This feature does not enable the optional Grok/OpenAI/MCP runtime. SDK telemetry is disabled before initialization. Public SDK discovery exposes metadata only; actual run requests require the existing user-auth middleware and owner-pinned lookup. Unsupported thread/connect/stop/provider routes remain closed.

[MP-370](https://devdoo.atlassian.net/browse/MP-370), stable key `teams-core:bug:registration-initialrun-default`, records actual TDP download serializing `delegateMessage.initialRun=false` while the catalog ZIP omits this default. The official1.25 schema makes these equivalent. Registration comparison normalizes only that exact property path and preserves refusal of true, changed context/fetchTask, wrong fields, version/endpoint and icon drift. Same-version synthetic reproduction and negative fixtures pass after the focused RED; the real registered104≠catalog130 version mismatch remains a separate live boundary until an actual existing-app update and download read-back.

## FIXTURE

CLI policy RED/GREEN and preserved authorization tests: `/tmp/teams-luna-policy-20261009`. Shared projection/store/AG-UI tests: `/tmp/teams-execution-presentation-20261009-0928`. Real SDK client/render/bootstrap/type tests: `/tmp/teams-copilot-sdk-view-20261009`. Owner preference route RED/GREEN and real OSS Express/AG-UI run: `/tmp/teams-luna-three-ui-20261009`. These are synthetic tests; no fixture model or receipt is live execution proof.

## LIVE RESULT

Retained release1.0.130 is still served by PID3451 with `teams-authenticated/entra-sso/teams-sdk/teams-sdk`. Its catalog/personal-install/public-runtime and direct Web UI evidence are retained in `/tmp/teams-mp366-p04-p05-execution-20261009-0804/EVIDENCE-INDEX.md`. Its historical SOL selection is not changed by the new policy. Registered Developer Portal metadata remains1.0.104, independently from catalog/installation130; formal registration, native desktop, mobile, exhaustive UI and user acceptance gates remain open. New candidate131 source/build/package/remote/catalog/installed/runtime/actual Luna and three-view UI verification are pending. No Jira Done or Teams completion message is authorized by local GREEN alone.
