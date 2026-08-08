# Teams Mobile Selectable Response Engines Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a user-selectable deterministic, OpenAI, and local/enterprise response-engine path to the Teams mobile app while preserving one GenUI/MCP contract and completing public Teams runtime verification.

**Architecture:** A server-side ResponseEngineRouter resolves a tenant/requester-scoped mode and delegates to one engine. Every engine returns the existing GenUiEnvelopeV1 plus safe fallback text. Teams Bot renders Adaptive Cards, the Teams tab renders the React GenUI card, and MCP Apps renders the same structured content through the existing ui:// resource.

**Tech Stack:** TypeScript, React, Express, Microsoft Teams SDK, CopilotKit v2/AG-UI, @modelcontextprotocol/sdk, @modelcontextprotocol/ext-apps, Zod, Node test scripts, Git-managed Teams package.

## Global Constraints

- The default user mode is deterministic; it must work without OPENAI_API_KEY.
- A Teams mobile user never enters, receives, or sees an OpenAI or model-provider secret.
- openai uses only server-side OPENAI_API_KEY, OPENAI_MODEL, and optional OPENAI_BASE_URL.
- local uses only server-side LOCAL_MODEL_BASE_URL and optional LOCAL_MODEL_API_KEY; client-supplied endpoint URLs are rejected.
- All engines produce the existing GenUiEnvelopeV1; Teams, CopilotKit, and MCP Apps must not define divergent card contracts.
- Mode selection is feature selection, not authorization. Existing tenant/requester/conversation ACLs remain mandatory for items, Codex jobs, approvals, and cancellation.
- Provider errors, timeouts, malformed tool calls, and missing configuration become safe error envelopes; no fake AI success is allowed.
- MCP UI resources remain sandboxed and read-only for approval actions. Actual write approval remains in the existing Teams tab/Bot approval boundary.
- No new frontend framework or provider SDK is added until an implementer proves the existing HTTP contract cannot support it.
- npm test, typecheck, focused tests, manifest validation, package validation, public health, and real Teams mobile message roundtrip are release gates.
- The final Teams completion message is sent only after the new ZIP is uploaded, the local bypass is stopped, the public process is healthy, and mobile evidence is observed.

---

### Task 0: Review and commit the pending security hardening

**Files:**
- Review and, only when required by tests, modify: src/server/agent-job-store.ts
- Review and, only when required by tests, modify: src/server/genui-action-store.ts
- Review and, only when required by tests, modify: src/server/genui-response.ts
- Review and, only when required by tests, modify: src/server/sensitive-text.ts
- Review and, only when required by tests, modify: scripts/agent-job-store-hardening-test.ts
- Review and, only when required by tests, modify: scripts/genui-action-store-hardening-test.ts
- Review and, only when required by tests, modify: scripts/genui-redaction-test.ts
- Modify when the changed contract requires it: scripts/genui-action-store-test.ts

**Interfaces:**
- Consumes the existing AgentJobStore, GenUIActionStore, and GenUiResponseFactory APIs.
- Produces a clean, committed baseline before response-mode files are added.

- [ ] Step 1: Run the three focused hardening tests and the existing action-store test.

~~~bash
npx tsx scripts/agent-job-store-hardening-test.ts
npx tsx scripts/genui-action-store-hardening-test.ts
npx tsx scripts/genui-redaction-test.ts
npx tsx scripts/genui-action-store-test.ts
~~~

Expected: the three new tests pass. If the existing action-store test asserts the superseded corrupted-scope exception, update that assertion to the safe zero-grant error-card contract.

- [ ] Step 2: Run typecheck and inspect the exact diff.

~~~bash
npm run typecheck
git diff --check
git diff -- src/server/agent-job-store.ts src/server/genui-action-store.ts src/server/genui-response.ts src/server/sensitive-text.ts
~~~

Expected: no TypeScript errors, no whitespace errors, and no changes outside Task 0 files.

- [ ] Step 3: Commit only the hardening baseline.

~~~bash
git add src/server/agent-job-store.ts src/server/genui-action-store.ts src/server/genui-response.ts src/server/sensitive-text.ts scripts/agent-job-store-hardening-test.ts scripts/genui-action-store-hardening-test.ts scripts/genui-redaction-test.ts scripts/genui-action-store-test.ts
git commit -m "fix: harden persisted GenUI and agent state"
~~~

### Task 1: Add the response-mode contract and scoped preference store

**Files:**
- Create: src/shared/response-mode.ts
- Create: src/server/response-mode-store.ts
- Create: scripts/response-mode-store-test.ts
- Modify: src/server/atomic-file.ts only to reuse an existing exported atomic helper when necessary

**Interfaces:**
- Produces ResponseMode = deterministic | openai | local.
- Produces ResponseModeSchema, ResponseModeSelection, ResponseModeAvailability, responseModeLabel(), and DEFAULT_RESPONSE_MODE = deterministic.
- Produces ResponseModeScope = { tenantId: string; requesterId: string }.
- Produces ResponseModeStore.get(scope), ResponseModeStore.set(scope, mode), and ResponseModeStore.availability().

- [ ] Step 1: Write failing tests for default, scoped persistence, invalid values, and tenant isolation.

The test must assert that a new scope returns deterministic, setting openai for one tenant/requester does not change another scope, unknown modes are rejected, blank IDs are rejected, and malformed persisted JSON is rejected without overwriting the source file.

- [ ] Step 2: Implement the Zod contract and atomic JSON-backed store.

Persist bounded { tenantId, requesterId, mode, updatedAt } entries. Use the existing atomic file/lease pattern. Do not persist provider URLs, keys, bearer tokens, prompts, or message content.

- [ ] Step 3: Add focused availability checks.

deterministic is always configured. openai is configured only when OPENAI_API_KEY is nonempty. local is configured only when LOCAL_MODEL_BASE_URL is a valid server-side URL. Return booleans and labels only.

- [ ] Step 4: Run tests and commit.

~~~bash
npx tsx scripts/response-mode-store-test.ts
npm run typecheck
git add src/shared/response-mode.ts src/server/response-mode-store.ts scripts/response-mode-store-test.ts src/server/atomic-file.ts
git commit -m "feat: add scoped response mode preferences"
~~~

### Task 2: Define the engine interface and migrate deterministic behavior

**Files:**
- Create: src/server/response-engine.ts
- Create: src/server/response-engine-deterministic.ts
- Create: scripts/deterministic-response-engine-test.ts
- Modify: src/server/copilot-agent.ts
- Modify: src/server/index.ts only at the existing Bot message dispatch boundary

**Interfaces:**
- Consumes ResponseMode, GenUiEnvelopeV1, AgentService, ItemStore, WeatherResponse, and existing identity scope.
- Produces ResponseEngineInput, ResponseEngineOutput, ResponseEngine, and ResponseEngineRouter.
- DeterministicResponseEngine.run(input) uses existing command semantics and existing tool event shapes.

- [ ] Step 1: Write failing tests for help, list, status, weather, write, and unsupported text.

Use in-memory stores and demo weather. Assert exact envelope kind, aiGenerated false, safe fallback text, and no provider network call.

- [ ] Step 2: Extract deterministic request handling from TeamsCodexAgent.

Move command parsing and deterministic tool emission into the new engine without changing existing Korean command behavior. Preserve location-context behavior and the workspace approval boundary.

- [ ] Step 3: Make TeamsCodexAgent delegate through a router seam.

Keep AG-UI event streaming and cancellation behavior intact. The router may initially register only the deterministic engine, with provider slots added by later tasks.

- [ ] Step 4: Run focused tests, existing agent transition tests, and commit.

~~~bash
npx tsx scripts/deterministic-response-engine-test.ts
npx tsx scripts/agent-service-transition-test.ts
npm run typecheck
git add src/server/response-engine.ts src/server/response-engine-deterministic.ts scripts/deterministic-response-engine-test.ts src/server/copilot-agent.ts src/server/index.ts
git commit -m "feat: make deterministic response engine production-ready"
~~~

### Task 3: Add the optional OpenAI provider engine

**Files:**
- Create: src/server/response-engine-openai.ts
- Create: scripts/openai-response-engine-test.ts
- Modify: src/server/response-engine.ts
- Modify: src/server/copilot-agent.ts
- Modify: src/server/index.ts health provider summary

**Interfaces:**
- Consumes ResponseEngineInput and existing LLM_TOOLS semantics.
- Produces OpenAIResponseEngine that performs no fetch when OPENAI_API_KEY is absent and uses server-only configuration when present.

- [ ] Step 1: Write tests with a fake fetch for no-key, success, malformed tool call, timeout, and provider error.

The no-key test must assert zero requests. The success test must assert that a tool call becomes the same GenUiEnvelopeV1 as deterministic mode. No test may print a key or include authorization headers in failure output.

- [ ] Step 2: Move the existing OpenAI request loop behind the provider interface.

Keep OPENAI_BASE_URL, OPENAI_MODEL, bounded messages, one tool-call sequence, and server-side authorization. Validate returned tool names and arguments before invoking any tool.

- [ ] Step 3: Return safe provider status.

Expose only configured, provider label, and model label without secret values. Missing configuration is a setup card, not a deterministic success response.

- [ ] Step 4: Run focused tests and commit.

~~~bash
npx tsx scripts/openai-response-engine-test.ts
npm run typecheck
git add src/server/response-engine.ts src/server/response-engine-openai.ts scripts/openai-response-engine-test.ts src/server/copilot-agent.ts src/server/index.ts
git commit -m "feat: add optional OpenAI response engine"
~~~

### Task 4: Add the local/enterprise OpenAI-compatible provider

**Files:**
- Create: src/server/response-engine-local.ts
- Create: scripts/local-response-engine-test.ts
- Modify: .env.example
- Modify: README.md

**Interfaces:**
- Produces LocalCompatibleResponseEngine using LOCAL_MODEL_BASE_URL, LOCAL_MODEL_NAME, and optional LOCAL_MODEL_API_KEY.
- Does not share OPENAI_API_KEY or silently fall back to the OpenAI endpoint.

- [ ] Step 1: Write a fake HTTP server test.

Verify no API key is accepted, the configured URL is server-side only, successful tool calls produce the shared envelope, invalid URLs are unavailable, and timeout/error responses produce a safe error envelope.

- [ ] Step 2: Implement the provider with URL and response validation.

Accept only http: or https: URLs supplied by process configuration. Reject user-supplied URL overrides. Bound request size, timeout, model name, returned text, and tool arguments.

- [ ] Step 3: Document public Teams limitations.

Document that a mobile Teams client cannot reach a developer laptop’s localhost; local mode requires the model endpoint to be reachable from the server process through a permitted private/public route.

- [ ] Step 4: Run focused tests and commit.

~~~bash
npx tsx scripts/local-response-engine-test.ts
npm run typecheck
git add src/server/response-engine-local.ts scripts/local-response-engine-test.ts .env.example README.md
git commit -m "feat: support local compatible response provider"
~~~

### Task 5: Implement server mode APIs and Teams Bot selection cards

**Files:**
- Create: src/server/response-mode-card.ts
- Create: scripts/response-mode-api-test.ts
- Modify: src/server/index.ts
- Modify: src/server/response-mode-store.ts
- Modify: src/server/response-engine.ts

**Interfaces:**
- Produces authenticated GET /api/response-mode and POST /api/response-mode routes.
- Produces a deterministic mode command and Adaptive Card submit handler.
- Routes every Bot request through ResponseEngineRouter.

- [ ] Step 1: Write failing HTTP tests.

Cover production unauthenticated rejection, default deterministic response, valid selection, invalid mode, cross-tenant isolation, and provider-unconfigured status. Assert that payloads contain no secret or URL credential.

- [ ] Step 2: Add authenticated mode routes.

Use existing user-auth middleware and identity extraction. The body contains only mode; tenant/requester values are derived server-side. Return current mode plus public availability metadata.

- [ ] Step 3: Add Teams Bot mode card and submit handling.

mode returns a card with three buttons and current availability. Submit validates the enum, stores it for the authenticated scope, and replies with a result card. Reuse existing Teams SDK Activity routing and outbound delivery.

- [ ] Step 4: Route Bot commands through ResponseEngineRouter.

The selected mode controls natural-language interpretation, while ACL and approval checks remain unchanged. Unsupported deterministic input remains explicit and non-AI.

- [ ] Step 5: Run focused API tests, Teams SDK runtime tests, and commit.

~~~bash
npx tsx scripts/response-mode-api-test.ts
npm run test:runtime
npm run typecheck
git add src/server/response-mode-card.ts scripts/response-mode-api-test.ts src/server/index.ts src/server/response-mode-store.ts src/server/response-engine.ts
git commit -m "feat: let Teams users select response mode"
~~~

### Task 6: Add Teams tab mode selector and health display

**Files:**
- Create: src/client/ResponseModeSelector.tsx
- Create: scripts/client-response-mode-test.ts
- Modify: src/client/App.tsx
- Modify: src/client/styles.css
- Modify: src/client/CopilotWorkspaceAssistant.tsx
- Modify: src/client/auth.ts only if the existing same-origin apiFetch needs a typed helper

**Interfaces:**
- Consumes GET/POST /api/response-mode and the existing HealthResponse.
- Produces a mobile-sized selector showing current mode, configured status, and safe error feedback.

- [ ] Step 1: Write tests for rendering and mode changes.

Use the repository’s existing client test conventions. Assert deterministic default, unavailable OpenAI/local states, selection POST body, loading state, and that no secret-like value is rendered.

- [ ] Step 2: Implement the selector.

Use accessible native buttons/select semantics, Teams-friendly contrast, 44px minimum touch targets, and Korean labels. Preserve existing CopilotKit lazy-loading behavior.

- [ ] Step 3: Add current mode to CopilotKit context and health card.

The selected mode is available to agent context and visible in runtime diagnostics without displaying environment values.

- [ ] Step 4: Run client tests, build, and commit.

~~~bash
npx tsx scripts/client-response-mode-test.ts
npm run build:client
npm run typecheck
git add src/client/ResponseModeSelector.tsx scripts/client-response-mode-test.ts src/client/App.tsx src/client/styles.css src/client/CopilotWorkspaceAssistant.tsx src/client/auth.ts
git commit -m "feat: add Teams tab response mode selector"
~~~

### Task 7: Align MCP Apps UI, tool metadata, and fallback behavior

**Files:**
- Create: scripts/mcp-response-mode-test.ts
- Modify: src/server/mcp-genui.ts
- Modify: src/client/mcp/McpGenUiWidget.tsx
- Modify: src/shared/genui.ts only when the existing contract needs a documented mode field
- Modify: scripts/mcp-direct-factory-test.ts

**Interfaces:**
- Consumes router deterministic tool results and current MCP session/auth rules.
- Produces MCP tools retaining _meta.ui.resourceUri = ui://teams-workspace/v1/genui.html, valid text/html;profile=mcp-app resource content, and fallback text for non-MCP-Apps hosts.

- [ ] Step 1: Write MCP contract tests.

Assert tools/list metadata, resource URI, MIME type, structured content schema, deterministic mode tool results, and no approval grant execution from the read-only widget.

- [ ] Step 2: Add safe mode status to the MCP widget.

Display selected mode and public availability only when provided by structured content. Do not call the Teams-only mode API from a generic MCP iframe unless the host supplies the authenticated capability.

- [ ] Step 3: Preserve graceful text degradation.

Ensure a host without MCP Apps UI still receives the same Korean fallback text and no secret-bearing metadata.

- [ ] Step 4: Run MCP focused tests, build widget, and commit.

~~~bash
npx tsx scripts/mcp-response-mode-test.ts
npx tsx scripts/mcp-direct-factory-test.ts
npm run build:mcp
npm run typecheck
git add src/server/mcp-genui.ts src/client/mcp/McpGenUiWidget.tsx src/shared/genui.ts scripts/mcp-response-mode-test.ts scripts/mcp-direct-factory-test.ts
git commit -m "feat: expose selectable modes through MCP GenUI"
~~~

### Task 8: Aggregate tests, update documentation, version, and package

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Modify: appPackage/manifest.json
- Modify: scripts/runtime-test.mjs
- Modify: scripts/validate-deployment-env.mjs
- Modify: scripts/validate-manifest.mjs only if new mode metadata is validated
- Modify: README.md
- Create: scripts/response-engine-runtime-test.mjs when the existing runtime harness cannot express provider switching cleanly

**Interfaces:**
- Produces version 1.0.7 consistently in the Teams manifest, runtime assertions, and package output.
- Produces npm test coverage for every focused test from Tasks 0–7.

- [ ] Step 1: Add all focused tests to npm test.

Do not remove existing tests. Include hardening, response-mode, deterministic, OpenAI fake-provider, local fake-provider, API, client, and MCP tests.

- [ ] Step 2: Update runtime assertions.

Assert that no-key production deterministic mode is healthy, OpenAI availability is false without a key, mode selection is ACL-protected, and MCP/Teams/CopilotKit contracts remain valid.

- [ ] Step 3: Align versions and docs.

Set the app manifest and runtime expectation to 1.0.7. Document the three modes, server-only secrets, local endpoint reachability, and the exact mobile selection flow.

- [ ] Step 4: Run the complete local gate.

~~~bash
npm test
npm run check:deployment
npm run validate:manifest
~~~

Expected: all tests pass, no placeholders remain, no secret is printed, and deployment validation reports real configured environment values without revealing them.

- [ ] Step 5: Create and inspect a new ZIP.

~~~bash
npm run package:app
unzip -l appPackage/build/*.zip
shasum -a 256 appPackage/build/*.zip
~~~

Verify the ZIP contains the v1.0.7 manifest, devicePermissions, valid domains, and no local-only token or placeholder.

- [ ] Step 6: Commit the release candidate.

~~~bash
git add package.json package-lock.json appPackage/manifest.json scripts/runtime-test.mjs scripts/validate-deployment-env.mjs scripts/validate-manifest.mjs README.md scripts/response-engine-runtime-test.mjs
git commit -m "release: selectable Teams response engines v1.0.7"
~~~

### Task 9: External release and Teams mobile E2E gate (orchestrator-owned)

**Files:**
- No source-file changes. Evidence is recorded in docs/teams-release-workflow.md or the release report only after observation.

**Interfaces:**
- Consumes the committed v1.0.7 ZIP and the user’s authenticated in-app Developer Portal session.
- Produces upload evidence, public health evidence, and Teams mobile message screenshots/observations.

- [ ] Step 1: Upload the new ZIP in the Codex in-app browser.

Confirm the portal shows the new version and successful validation. Do not reuse an old ZIP.

- [ ] Step 2: Stop local bypass processes and start the public Teams SDK process.

Remove TEAMS_SKIP_AUTH, TEAMS_SKIP_OUTBOUND, and local-only mode flags from the public launch. Verify /api/health reports auth=teams-authenticated, userAuth=entra-sso, bot=teams-sdk, and outbound=teams-sdk.

- [ ] Step 3: Verify public HTTPS runtime.

Open the public tab in the Codex in-app browser and verify deterministic mode, response-mode selector, current tasks, weather, and mode status. Confirm MCP endpoint behavior separately because MCP Apps host support is distinct from Teams rendering.

- [ ] Step 4: Verify Teams mobile roundtrip.

In the user’s Teams mobile app, send mode, choose 키 없음·결정형, send list, status, and weather, and observe GenUI/Adaptive Card responses. If an OpenAI key is configured later, repeat with OpenAI. If a reachable local endpoint is configured, repeat with 로컬/사내 모델.

- [ ] Step 5: Send the Teams completion message only after all evidence.

Include version, commit SHA, ZIP hash, upload result, public health summary, mode-selection evidence, mobile response evidence, and any unverified provider mode as an explicit blocker.

## Review checkpoints

- Task 0 is reviewed before response-mode code is added.
- Every implementation task receives a fresh task reviewer for specification compliance and code quality.
- Any Critical/Important finding enters a fix-and-scoped-rereview loop; it is not silently ignored.
- After Task 8, a whole-branch reviewer receives the full branch diff and deferred-minor ledger.
- Task 9 is not marked complete from local tests alone; it requires observed Developer Portal, public health, and Teams mobile evidence.
