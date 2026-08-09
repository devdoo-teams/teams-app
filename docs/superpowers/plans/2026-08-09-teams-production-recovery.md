# Teams Production Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the existing Teams app from stale release evidence and broken Entra SSO, publish version `1.0.15`, and prove the deployed tab and Bot in real Teams before any P1 GenUI expansion.

**Architecture:** Harden the command-first release loop so a stale Git identity or fabricated visual artifact cannot advance a release. Unify runtime configuration validation, then inspect the real Entra registration and align the manifest to that observed contract. Finish through the existing logged-in Teams/Admin tabs and the existing app ID; never create a replacement app or browser session.

**Tech Stack:** TypeScript 5.9, Node.js ESM, React 19, Microsoft Teams JS/Teams SDK, Microsoft Teams CLI, Microsoft Entra, Adaptive Cards, Dev Tunnels.

## Global Constraints

- Reuse the existing `codex/teams-mobile-genui` feature branch and commit every meaningful unit; do not create or replace the Teams app ID.
- Use TDD for every behavior change: add a focused failing test, observe the expected failure, implement the minimum fix, and rerun the focused and full suites.
- Never print or persist credentials, tokens, API keys, browser storage, or provider URLs containing credentials.
- Reuse the existing in-app browser tabs. Do not call `tabs.new`, open a new browser window, close authentication tabs, or replace the current login session.
- Do not guess `APPLICATION_ID_URI`. Inspect the existing Entra registration and align the Entra resource, scope, preauthorization, redirect URI, server environment, and manifest to one observed contract.
- Preserve deterministic mode as the usable no-key default. OpenAI and local modes remain disabled until their server-side providers are truly configured.
- A production process must reject `WEATHER_MODE=demo`; demo weather is permitted only in explicit local/test execution.
- Version `1.0.15` is the next package version. Never reuse the `1.0.14` ZIP.
- The release sequence is exactly `start → machine → package → public → portal → installed → desktop → mobile → complete`.
- No Teams completion message may be sent before `release:loop complete` returns `READY`.

---

### Task 1: Make release identity and UI evidence fail closed

**Files:**
- Modify: `scripts/release-loop.mjs`
- Modify: `scripts/release-loop-test.mjs`

**Interfaces:**
- Consumes: existing `assertCurrentGit`, `validateEvidence`, `runCli`, and `RELEASE_SURFACES` contracts.
- Produces: `status`, `evidence`, and `complete` commands that reject a release whose commit or worktree no longer matches; visual evidence validation that requires at least one real raster image artifact for every UI surface.

- [ ] **Step 1: Add failing identity regression tests**

Add CLI tests that create a release state using a commit different from `git rev-parse HEAD`, then assert that `status`, `evidence --file`, and `complete` exit non-zero with `current Git commit does not match the release run`. Keep a second state using the real current commit to preserve the existing happy-path assertions.

- [ ] **Step 2: Run the release-loop test and observe RED**

Run: `npm run test:release-loop`

Expected: the stale `status` and `evidence` assertions fail because those commands currently accept the stale state.

- [ ] **Step 3: Add failing visual-artifact tests**

Create a minimal valid PNG fixture from the PNG signature bytes and a text file named `fake-proof.png`. Assert that all four surfaces accept the real image and reject the fake image with `evidence artifact must be a real PNG, JPEG, or WebP image`.

- [ ] **Step 4: Run the release-loop test and observe the artifact RED failure**

Run: `npm run test:release-loop`

Expected: the fake `.png` is accepted by the old implementation, so the rejection assertion fails.

- [ ] **Step 5: Implement the minimum fail-closed behavior**

Call `assertCurrentGit(state)` before returning `status`, before reading/applying evidence, and before checking completion gates. Extend `validateEvidence` with an injectable synchronous artifact reader whose production default is `fsSync.readFileSync`; require at least one artifact whose bytes match PNG, JPEG, or WebP magic bytes. Extension alone is never evidence.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:release-loop && npm run typecheck`

Commit: `fix: harden Teams release identity evidence`

---

### Task 2: Make provider and weather configuration truthful

**Files:**
- Create: `src/server/local-model-url.ts`
- Modify: `src/server/response-mode-store.ts`
- Modify: `src/server/response-engine-local.ts`
- Modify: `src/server/index.ts`
- Modify: `scripts/response-mode-store-test.ts`
- Modify: `scripts/local-response-engine-test.ts`
- Modify: `scripts/runtime-test.mjs`

**Interfaces:**
- Produces: `parseLocalModelBaseUrl(value: string | undefined): URL | undefined` and `isLocalModelBaseUrlConfigured(value: string | undefined): boolean`.
- The parser accepts only `http:` or `https:` URLs with a hostname and without username, password, query, or fragment.
- `/api/health` reports distinct `responseProviders.deterministic`, `.openai`, and `.local` configuration booleans plus `weatherMode: "live" | "demo"`; it never includes secret or endpoint values.

- [ ] **Step 1: Add failing URL parity tests**

Extend response-mode availability tests and local-engine tests with the same table: a normal HTTPS base URL is accepted; URLs with credentials, query, fragment, unsupported protocol, or no hostname are rejected by both selection and execution.

- [ ] **Step 2: Observe RED**

Run: `npm run test:response-mode-store && npm run test:local-engine`

Expected: response-mode availability incorrectly marks at least query/fragment/credential URLs configured.

- [ ] **Step 3: Implement one shared parser**

Move the URL contract into `local-model-url.ts`; use it from both the mode store and local engine. Do not log the rejected value.

- [ ] **Step 4: Add failing production demo-weather and health tests**

Extend `runtime-test.mjs` so a production process with `WEATHER_MODE=demo` exits non-zero and names the forbidden setting. Assert that local demo health says `weatherMode: "demo"`, while production/live health says `weatherMode: "live"`; assert the three response-provider booleans without exposing keys or URLs.

- [ ] **Step 5: Observe RED and implement the startup guard/health contract**

Run: `npm run test:runtime`

Expected before implementation: production demo mode starts and health lacks the new fields. Add the startup guard before binding the server and return only safe configuration booleans in health.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:response-mode-store && npm run test:local-engine && npm run test:runtime && npm run typecheck`

Commit: `fix: align Teams provider runtime configuration`

---

### Task 3: Align the observed Entra SSO contract and package version 1.0.15

**Files:**
- Modify only after observing Entra: `.env.runtime` (ignored secret/runtime file)
- Modify only if the observed contract requires it: `scripts/validate-deployment-env.mjs`
- Modify only if the observed contract requires it: `scripts/deployment-env-test.mjs`
- Modify: `appPackage/manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `appPackage/README.md`
- Modify: `docs/teams-release-workflow.md`
- Modify: `docs/remote-codex-troubleshooting.md`

**Interfaces:**
- Consumes: the actual Entra `Expose an API` Application ID URI for bot client `32127cdd-f19d-4fce-95c9-431e27cca739`.
- Produces: one consistent SSO contract containing the Application ID URI, `access_as_user` scope, Teams web/desktop preauthorization, Bot Framework redirect URI, manifest `webApplicationInfo.resource`, and runtime `APPLICATION_ID_URI`.

- [ ] **Step 1: Capture the current Entra contract without changing it**

Use Teams CLI/Graph-capable CLI first. If no API is available, reuse the existing authenticated Admin/Entra browser tab. Record only non-secret identifiers and Doctor results in the SDD report; do not save tokens or browser storage.

- [ ] **Step 2: Compare the observed registration to the runtime failure**

Confirm whether the registered URI is the standalone Teams SDK form `api://botid-<BOT_CLIENT_ID>` or the combined bot+tab FQDN form `api://<TAB_DOMAIN>/botid-<BOT_CLIENT_ID>`. Confirm the `access_as_user` scope, authorized Teams client IDs, and `https://token.botframework.com/.auth/web/redirect`.

- [ ] **Step 3: Apply only the confirmed Entra changes**

Add the missing scope, preauthorized clients, and redirect URI; change the identifier URI only when the observed registration and selected Microsoft workflow require it. Immediately rerun: `teams app doctor e915b402-eed4-4ee2-ba1f-c31d75c870a5 --json`.

- [ ] **Step 4: Add/adjust the failing deployment-contract test if the URI form changes**

Run: `npm run test:deployment-env`

Expected: RED only when the newly confirmed contract differs from the current hard-coded validator.

- [ ] **Step 5: Align code/docs and bump the package**

Set `appPackage/manifest.json`, `package.json`, and `package-lock.json` to `1.0.15`. Update `webApplicationInfo.resource`, `.env.runtime`, validator, tests, and documentation to the same confirmed URI. Do not touch client secrets.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:deployment-env && npm run validate:manifest && npm test`

Inspect `git diff --check` and the package versions.

Commit: `fix: recover Teams tab SSO release`

---

### Task 4: Publish and prove the existing Teams app

**Files:**
- Generated: `appPackage/build/teams-sdk-mvp.zip`
- Generated: `.release/current.json`
- Generated: `.release/evidence/*`
- No source edits after the release run starts.

**Interfaces:**
- Produces: a `COMPLETE` release run for version `1.0.15` whose portal, installed, desktop, and mobile evidence all refer to the same commit and ZIP SHA-256.

- [ ] **Step 1: Start the release from a clean commit**

Run sequentially: `npm run release:loop -- start`, `npm run release:loop -- machine`, `npm run release:loop -- package`, `npm run release:loop -- public`.

- [ ] **Step 2: Inspect the generated ZIP**

Verify the internal manifest version is `1.0.15`, the existing Teams app ID is unchanged, `devicePermissions` contains `geolocation`, the tab origin is the live Dev Tunnel host, and the SSO resource is the confirmed Entra URI. Record the SHA-256.

- [ ] **Step 3: Upload through the existing app detail page**

Reuse the current Teams Admin Center app-detail tab. Use the existing app's `새 버전`/file-upload path, confirm validation, and register real portal image evidence.

- [ ] **Step 4: Verify the actual installed version**

Reuse the existing Teams app/chat tab, open the app information surface, and confirm `installedVersion` is exactly `1.0.15`. If propagation is stale, update or reinstall the same app before proceeding. Register installed evidence only after the UI confirms the version.

- [ ] **Step 5: Run desktop E2E**

In the deployed Teams host, verify successful tab SSO, non-empty task data, create/toggle/delete CRUD, deterministic response-mode persistence, `help/status/list`, Adaptive Card de-duplication, and the location button/error state. Capture accessibility and screenshot evidence.

- [ ] **Step 6: Run mobile E2E and finish**

Have the user verify the same deployed version from Teams mobile, grant location when prompted, and confirm the weather widget plus Bot reply. Register mobile evidence, run `npm run release:loop -- complete`, and only then send the Teams completion card with version, commit, ZIP SHA, health, and verified surfaces.
