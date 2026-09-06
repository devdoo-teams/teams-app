# ChatGPT Teams Full-Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Follow `superpowers:executing-plans` and `superpowers:test-driven-development` for every implementation slice. Keep the canonical worktree as the only integration worktree.

**Goal:** Make the Teams app a reliable Teams-native client for the supported ChatGPT/agent capabilities, with explicit boundaries for capabilities that require separate OpenAI account, workspace, device, or product permissions. Deliver the work as independently verifiable slices rather than treating a Core agent response as proof of full ChatGPT parity.

**Architecture:** Keep Teams Core as the default API-free product: authenticated Teams SDK bot, React personal tab, Express server, durable job store, Adaptive Cards 1.6 subset, and provider-neutral agent orchestration. Add optional OpenAI/remote-tool capabilities behind measured provider capabilities and feature flags. Use Teams chat for prompts, progress, approvals, and results; use the personal tab for history, files, model controls, provenance, and recovery. Every job remains scoped by server-derived tenant, requester, and Teams conversation identity.

**Tech Stack:** TypeScript, React, Express 5, Microsoft Teams SDK/TeamsJS, Adaptive Cards 1.6, Codex CLI workers, Azure-hosted runtime, Cosmos/JSON persistence adapters, GitHub Actions, GitHub MCP, Azure DevOps MCP, and Atlassian Rovo MCP.

**Spec:** `docs/superpowers/specs/2026-09-06-chatgpt-teams-full-scope-design.md`

## Contract and delivery constraints

- Microsoft Teams documentation is the source of truth for bot cards, tabs, authentication, and mobile behavior. OpenAI documentation is the source of truth for API capabilities, Responses tools, remote MCP, and durable Conversations state. Installed CLI `--version`/`--help` output must be recorded before using a CLI contract.
- Evidence is separated into `OFFICIAL CONTRACT`, `OBSERVED EVIDENCE`, `INFERENCE`, `FIXTURE`, and `LIVE RESULT`. A fixture, source inspection, local health check, or GitHub Actions success is not a live Teams or ChatGPT proof.
- Core build and tests stay API-free. Optional OpenAI/remote provider tests and builds are separate and never silently replace Core behavior.
- Do not claim 100% ChatGPT parity where the official product does not expose an embeddable contract for the ChatGPT UI, account history, memory, or computer-control surface. Surface those capabilities as measured `unsupported`, `unconfigured`, or `unverified` states.
- No version bump is made for this plan or an audit. A release version is increased only for a user-visible feature or reproduced bug fix and is then bound to commit, manifest, ZIP SHA-256, runtime, portal, desktop, and mobile evidence.
- Use GitHub MCP first for repository/commit/PR/Actions read-back and remote source synchronization; use Azure DevOps MCP for Azure pipeline work; use Atlassian Rovo MCP first for Jira mapping. Do not put secrets, MFA, device codes, or bearer values into code, reports, prompts, or tickets.

## Atomic implementation order

### 1. F00 — capability and evidence registry

**Deliverable:** A machine-readable capability matrix that distinguishes supported Core behavior, optional provider behavior, account/workspace-gated behavior, and live verification state.

**Files:** `docs/evidence/chatgpt-teams-capability-matrix.md`, `scripts/capability-matrix-test.mjs`, `src/shared/core-orchestration.ts` only when a new measured capability is needed.

**Acceptance:** Every advertised capability has a source URL, required entitlement, server route/provider, Teams surface, negative state, focused test, and live-evidence status. The matrix does not infer ChatGPT UI parity from a Codex job.

### 2. F04 — explicit conversation creation and resume (first implementation slice)

**Deliverable:** Add `agent new <prompt>` to force a fresh read-only Codex execution and `agent continue <job-id> <prompt>` to resume exactly the selected durable job/thread. Keep natural-language continuation backward-compatible and scoped to the authenticated Teams conversation.

**Files:** `src/server/response-engine-deterministic.ts`, `src/shared/core-orchestration.ts`, `src/server/core-orchestration-service.ts`, `src/server/core-orchestration-route.ts`, `src/client/core-orchestration-client.ts`, `src/server/index.ts`, `src/server/genui-response.ts`, `appPackage/manifest.json`, `scripts/core-orchestration-chat-card-test.ts`, `scripts/core-orchestration-service-test.ts`, `scripts/core-orchestration-route-test.ts`, `scripts/deterministic-response-engine-test.ts`.

**Implementation contract:** `new` calls the same authenticated Core submit path with a fresh idempotency key; it must not consult the latest completed job. `continue` verifies principal ownership, provider capability, and the existing durable thread before calling the AgentService continuation path. No client-supplied tenant/requester/conversation scope is accepted. A missing or cross-principal job returns the existing not-found behavior.

**Acceptance:** RED parser/service/route tests fail before the implementation; the focused tests then pass. A new command creates a distinct job even when history exists; an explicit continue reuses the selected thread and preserves the same tenant/requester scope. Existing `agent run`, natural-language follow-up, approval, cancel, retry, and input commands remain green.

### 3. F05 — durable progress, reconnect, and final receipts

**Deliverable:** Make every accepted job expose a durable checkpoint, last activity timestamp, bounded progress, terminal result/error, and reconciliation state to both chat and tab after reconnect.

**Files:** `src/server/agent-job-store.ts`, `src/server/agent-service.ts`, `src/server/genui-response.ts`, `src/server/index.ts`, `src/client/OrchestrationPanel.tsx`, `src/client/core-orchestration-client.ts`, `scripts/agent-service-transition-test.ts`, `scripts/core-orchestration-cross-surface-test.ts`, `scripts/core-orchestration-chat-card-test.ts`.

**Acceptance:** Restart/reconnect tests recover the same job without duplicate execution; an empty result or an exit code alone is never rendered as completion; chat and tab read back the same terminal job identity and redacted error.

### 4. F03 — measured provider and execution capabilities

**Deliverable:** Expose provider facts and worker readiness as measured runtime observations, separating configured, authenticated, executable, and live round-trip states.

**Files:** `src/server/core-orchestration-service.ts`, `src/server/codex-capability.ts`, `src/server/codex-runner.ts`, `src/server/agent-execution-policy.ts`, `src/server/index.ts`, `src/client/OrchestrationPanel.tsx`, `scripts/*provider*test*`, `scripts/*execution*test*`.

**Acceptance:** Provider capability cards are fail-closed; no “ready” state claims live authentication without an observed preflight/round trip. Codex and Copilot remain separate authentication domains.

### 5. F06 — model, reasoning, and token accounting

**Deliverable:** Keep model/reasoning selection and exact terminal usage visible in the card and tab, with account quota explicitly marked unavailable unless measured by an approved provider contract.

**Files:** `src/server/codex-model-catalog.ts`, `src/server/core-orchestration-service.ts`, `src/server/genui-response.ts`, `src/client/OrchestrationPanel.tsx`, `scripts/core-orchestration-chat-card-test.ts`, `scripts/codex-model-catalog-test.ts`.

**Acceptance:** Unsupported model/effort combinations fail before execution; displayed input/output/reasoning counts come from the terminal usage observation and are never called remaining account quota.

### 6. F07 — safe file input/output bridge

**Deliverable:** Support user-selected files through the personal tab and durable job attachments while keeping bot cards text/action-only, because Teams cards do not provide a file upload contract.

**Files:** `src/client/`, `src/server/`, `src/shared/`, `scripts/file-*test*`, `docs/evidence/chatgpt-teams-capability-matrix.md`.

**Acceptance:** Size/type/retention/ownership limits are enforced; secrets and raw access tokens are rejected; chat clearly links to the tab for file selection; a provider that cannot consume the file reports unsupported rather than fabricating a result.

### 7. F08 — optional Responses tools and citations

**Deliverable:** Add an optional provider adapter for officially supported Responses API tools (web search, file search, function calling, and remote MCP where configured), preserving citations and tool provenance.

**Files:** `src/server/response-engine-openai.ts`, new provider adapter modules under `src/server/`, `src/shared/`, `src/client/`, `scripts/optional-*test*`, `.env.example`, `docs/research/`.

**Acceptance:** The optional path is never loaded by default Core; missing API key, workspace entitlement, or tool configuration yields a measured unavailable state; live API evidence includes request/response shape, citations, and redacted tool calls.

### 8. F09 — skills, plugins, MCP, and CLI provenance

**Deliverable:** Show safe, argument-free tool observations per job, including source/provider and timestamps, without claiming that a listed tool executed unless the runtime emitted an observation.

**Files:** `src/shared/core-orchestration.ts`, `src/server/agent-service.ts`, `src/server/genui-response.ts`, `src/client/OrchestrationPanel.tsx`, `scripts/*provenance*test*`.

**Acceptance:** Prompt, tool, provider, and error fields are redacted at every persistence/HTTP/card boundary; absent observations are shown as unavailable, not inferred.

### 9. F10 — project/chat history mapping

**Deliverable:** Provide scoped search, resume, fork, archive, and project mapping for the Teams-visible job history, with explicit distinction from ChatGPT account history.

**Files:** `src/server/agent-job-store.ts`, `src/server/agent-service.ts`, `src/server/response-engine-deterministic.ts`, `src/client/OrchestrationPanel.tsx`, `src/server/index.ts`, `scripts/history-*test*`.

**Acceptance:** Search and archive are principal-scoped and durable; fork creates a new job identity; no ChatGPT account history is claimed without an official authenticated API contract and live proof.

### 10. F11 — artifacts and document workflows

**Deliverable:** Add bounded artifact creation/read-back for supported documents, spreadsheets, slides, and code outputs through the tab, with download links and integrity hashes.

**Files:** `src/server/artifacts/`, `src/client/`, `src/shared/`, `scripts/artifact-*test*`, `docs/evidence/`.

**Acceptance:** Generated files are stored with owner/job identity, MIME/size limits, SHA-256, and expiry; binary output is not embedded in cards; read-back verifies the actual file.

### 11. F12 — memory and instructions boundary

**Deliverable:** Add explicit project/user instruction records only where an approved storage and authorization contract exists; otherwise show the capability as unavailable.

**Files:** `src/server/`, `src/client/`, `src/shared/`, `scripts/instruction-*test*`, `docs/evidence/`.

**Acceptance:** No silent copying of ChatGPT memory or global instructions; updates are auditable, scoped, reversible, and redacted.

### 12. F13/F14 — media, voice, realtime, and device capabilities

**Deliverable:** Integrate only supported Teams/browser/device contracts. Keep voice, realtime, image/video generation, GPS, and screen control independently gated.

**Files:** capability-specific modules under `src/server/` and `src/client/`, `appPackage/manifest.json` only for an evidenced permission, focused tests, and live device evidence.

**Acceptance:** Unsupported Teams mobile/card flows remain explicit; no desktop test is promoted to mobile proof; no location permission is reintroduced for a removed weather feature.

### 13. F15/F16 — schedules and interactive surfaces

**Deliverable:** Add durable scheduled jobs, notification policy, canvas-like artifact surfaces, and computer-control adapters only behind explicit provider and tenant policy gates.

**Files:** `src/server/`, `src/client/`, `.github/workflows/`, Azure deployment definitions, focused tests, and evidence docs.

**Acceptance:** Schedules have owner, timezone, idempotency, cancellation, retry, and audit records. Computer-control never runs from an unverified or user-unapproved target.

### 14. F01/F02/F17 — Azure, Teams identity, and release equivalence

**Deliverable:** Repair and verify the Azure runtime, package and registered Teams identity, then release only a same-identity build whose Core/optional gates and required desktop/mobile evidence pass.

**Files:** `.azure/`, `.github/workflows/`, `appPackage/`, `scripts/release-*`, `docs/teams-release-workflow.md`, Jira MP issue mapping.

**Acceptance:** `main` is clean and the only integration branch; GitHub MCP read-back matches the local commit/tree; Azure DevOps MCP read-back matches the pipeline run; ZIP manifest/SHA, public `/api/health`, registered package, installed desktop, and user mobile evidence all match. Only then may a Teams completion message be sent.

## First-slice execution checklist

1. Confirm the canonical worktree, current `main` SHA, installed Node/npm/tsx/Teams/Codex tool versions, and official Microsoft/OpenAI contract URLs.
2. Add parser/service/route regression tests for `agent new` and explicit `agent continue`; run the focused test and record the RED result.
3. Implement the smallest shared-service and chat change; rerun focused tests and Core typecheck/build.
4. Review `git diff`, run the relevant Core test suite, and commit only the functional slice. Do not bump the app version or package until a release candidate is intentionally prepared.
5. Use GitHub MCP to read back the resulting tree/commit and Actions checks. Keep Azure/Teams deployment evidence separate until the release gate is actually run.

## Release gate commands

```bash
npm run test:core
npm run typecheck:core
npm run build:core
npm run validate:manifest
npm run release:preflight
npm run release:package
npm run release:public
npm run release:gate
```

The release commands are evidence-producing gates, not proof by exit code alone. Preserve the release identity, package SHA-256, runtime health, portal read-back, desktop screenshot/AX evidence, and mobile evidence before reporting completion.

## Official references

- Microsoft Teams bot design: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/designing-your-bot
- Microsoft Teams tabs and mobile: https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context
- Microsoft Teams Adaptive Cards: https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference
- Microsoft Teams card actions: https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions
- OpenAI Apps in ChatGPT: https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- OpenAI tools: https://platform.openai.com/docs/guides/tools
- OpenAI conversation state: https://platform.openai.com/docs/guides/conversation-state
