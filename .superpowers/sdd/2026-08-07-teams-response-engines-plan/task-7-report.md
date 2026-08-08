# Task 7 report: MCP Apps UI, mode metadata, and fallback alignment

## STATUS

PASS. Task 7 is implemented on `codex/teams-mobile-genui` and is ready for the next release task.

## EVIDENCE

- `npx tsx scripts/mcp-response-mode-test.ts` — PASS
- `npx tsx scripts/mcp-direct-factory-test.ts` — PASS
- `npm run build:mcp` — PASS; `dist/mcp-widget` generated
- `npm run typecheck` — PASS
- `git diff --check` — PASS

The focused contract tests cover:

- canonical `_meta.ui.resourceUri` (`ui://teams-workspace/v1/genui.html`)
- `text/html;profile=mcp-app` resource metadata and HTML content
- `GenUiEnvelopeV1` structured results and identical Korean fallback text
- stable deterministic data-tool output apart from correlation IDs
- optional, provider-neutral public response-mode status only when supplied
- removal of secret/provider URL metadata at the MCP boundary
- read-only MCP rendering with approval/action execution rejected
- no Teams-only `/api/response-mode` call from the generic widget

## CHANGED FILES

- `scripts/mcp-response-mode-test.ts`
- `scripts/mcp-direct-factory-test.ts`
- `src/server/mcp-genui.ts`
- `src/client/mcp/McpGenUiWidget.tsx`
- `src/shared/genui.ts`

The MCP mode field is optional. Generic MCP hosts do not receive or infer a Teams identity; the widget only displays validated structured mode data supplied by the host/server.
