# A2A remote lifecycle / GHCP CLI independent contract review

Date: 2026-08-20

Scope: `src/server/a2a*.ts`, `src/server/ghcp*.ts`, the related focused tests,
and this review note. No provider login, token exchange, release file, manifest,
or `src/server/index.ts` change was made.

## Independent findings

### A2A remote lifecycle and recovery

The existing remote client already uses the A2A v1.0 JSON-RPC method names
`SendMessage`, `GetTask`, `ListTasks`, and `CancelTask`, validates the Agent Card,
keeps authentication fail-closed, and the adapter polls/cancels/reconciles a
remote task. The missing contract branch was the other valid `SendMessage`
response: the v1.0 contract allows `result.task` **or** a direct `result.message`.
The client required `task`, so a valid synchronous response became
`INVALID_RESPONSE`; the adapter also assumed every response had a remote task
ID and would needlessly enter task lifecycle handling.

Selected implementation: accept and validate a bounded text `Message` response,
return it as a typed remote message, and complete the adapter child immediately
without polling or canceling. The local child idempotency key is used as the
binding fallback when the direct message has no `taskId`; this preserves durable
local bookkeeping without pretending that a remote task exists.

Primary source: [A2A v1.0 specification, Send Message outputs](https://a2a-protocol.org/latest/specification/#3-1-1-send-message)
and [JSON-RPC SendMessage response](https://a2a-protocol.org/latest/specification/#9-4-1-sendmessage).

### GHCP CLI executable identity

The existing implementation resolves the configured `copilot` executable once
per resolver/requested command and reuses that immutable path for both health
and execution. Its focused regression test changes `PATH` after health and
asserts execution still uses the same resolved command. It also keeps the
non-interactive `--prompt`, JSONL output, bounded tool permissions, no-login
probe, and redacted diagnostics behavior.

The local `copilot --help` check was read-only. It proves the executable and
documented programmatic flags are present, not GitHub authentication, Copilot
license, organization policy, model entitlement, or a live provider round trip.
Those states remain `unknown` as required.

Primary sources: [GitHub Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference),
[programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference),
and [Copilot CLI overview](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli).

## RED -> GREEN evidence

Before implementation:

- `npm run test:a2a-remote-client` failed with `A2A remote operation failed (INVALID_RESPONSE)` for a valid `result.message`.
- `npm run test:a2a-remote-agent-adapter` failed with `Remote A2A task did not return a valid task ID` for the same direct-response branch.

After implementation:

- `npm run test:a2a-remote-client` passed.
- `npm run test:a2a-remote-agent-adapter` passed.
- The adapter regression asserts no task polling or cancellation and verifies the durable bind fallback.

## Verification boundary

No live A2A provider, external agent card, remote task, GitHub login, token,
license, organization policy, or Copilot model entitlement was contacted.
The current focused fixtures prove protocol handling and local lifecycle
semantics only. The broader Core source gate was not run on the dirty parent
worktree because its FileProvider safety rule correctly requires tracked source
changes to be committed first; unrelated pre-existing tracked changes were
left untouched.
