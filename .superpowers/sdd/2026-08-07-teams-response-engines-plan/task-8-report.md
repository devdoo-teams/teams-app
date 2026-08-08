# Task 8 report — selectable Teams response engines v1.0.7 release candidate

STATUS: RELEASE CANDIDATE READY (local validation green; external release is Task 9)

SCOPE:

- package and lockfile version aligned to `1.0.7`.
- Teams manifest version aligned to `1.0.7`.
- `npm test` now includes the Task 0–7 hardening, response-mode, provider, client, MCP, existing contract, and runtime test commands.
- Release runtime assertions cover no-key provider health, deterministic default selection, authenticated response-mode access, unavailable provider selection, MCP `GenUiEnvelopeV1`/fallback parity, CopilotKit discovery, Teams SDK routing, ACL/approval boundaries, and production auth guards.
- README documents the three modes, server-only secrets, mobile selection flow, local endpoint reachability, package checks, and the mandatory upload → stop local bypass → public health → mobile roundtrip workflow.
- Provider-backed and deterministic natural-language write requests now use the server-owned approval factory, so Teams cards receive real approve/cancel action grants instead of action-free approval envelopes.
- Provider/MCP/deterministic output boundaries now redact credential-shaped text and structured values, and deterministic weather never invents a demo location when the Teams location context is absent.

EVIDENCE:

- `npm run build:client` — PASS (executed in the attempted npm test run).
- `npm run build:mcp` — PASS (executed in the attempted npm test run).
- `npm run build:server` — PASS (executed in the attempted npm test run and independently before runtime validation).
- `npm run typecheck` — PASS.
- `npm run validate:manifest` — PASS; manifestVersion `1.25`, package/manifest release version `1.0.7`, geolocation permission, required icons and tab fields validated.
- `npm test` — PASS; aggregate exit code `0` after all focused tests and the final runtime gate.
- `npm run test:runtime` — PASS; local, MCP, CopilotKit, Bot/Teams SDK, ACL, approval, recovery, timeout, and production-auth flows completed with `Runtime verification complete.`
- Additional focused regression tests — PASS: natural-language approval action count, provider output redaction for Bearer/API-key/credentialed URLs, MCP job-result redaction, and no-location deterministic weather behavior.
- Focused tests — PASS: troubleshooting, atomic stores, AgentJob/GenUI action/item/process-lease hardening, redaction, agent transitions, GenUI/channels contracts, response-mode store/API, deterministic/OpenAI/local engines, client auth/GenUI/selector, local auth, weather, MCP response-mode/direct factory.
- `git diff --check` — PASS.
- Branch diff whitespace cleanup — PASS; the plan and GenUI CSS files no longer add a blank line at EOF.
- Version alignment check — PASS for `package.json`, `package-lock.json` root, `package-lock.json` package entry, and `appPackage/manifest.json` at `1.0.7`.
- Missing-values deployment check — EXPECTED FAIL (exit 1) with all seven required deployment variables reported missing; no credentials were invented.
- Deterministic package/manifest simulation — PASS for resolved version `1.0.7`, `devicePermissions: ["geolocation"]`, resolved domain/IDs, and no unresolved placeholders.

NPM TEST NOTE:

- A final aggregate `npm test` run completed with exit code `0`; the earlier interrupted attempt is superseded by this observed release-gate run.

PACKAGING:

- `npm run package:app` was not run because the real deployment environment is not available. A ZIP, upload result, and SHA-256 therefore do not exist for this local-only release-candidate commit.
- External Developer Portal upload, public process health, and real Teams mobile roundtrip remain intentionally unperformed and belong to Task 9.

COMMIT:

- Exact required message: `release: selectable Teams response engines v1.0.7`.
- Release candidate commit: `2733602`.
- Aggregate-gate documentation commit: `ec39ecf`.
- Provider/approval/redaction hardening commit: `5521657`.
- The release candidate remains on branch `codex/teams-mobile-genui`.

BLOCKER:

- External deployment values and the authenticated Developer Portal/public HTTPS runtime are required before packaging/upload and mobile E2E. Do not send the Teams completion message until Task 9 observes those gates.
