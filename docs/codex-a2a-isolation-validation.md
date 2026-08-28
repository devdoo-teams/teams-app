# Production Codex A2A isolation validation

Run this read-only operator check on the production host before enabling the
native Codex A2A isolation path:

```bash
npm run check:codex-a2a-isolation
```

The command loads `.env.runtime` when present and requires all three values:

- `AGENT_CODEX_HOME`: an absolute, service-owned directory with no group or
  other permissions.
- `CODEX_BIN`: an absolute, regular executable path with no group or other
  write permission.
- `CODEX_BIN_SHA256`: the 64-character SHA-256 pin for that executable.

When `TEAMS_A2A_AGENT_PROVIDERS` is set, every Codex entry is validated with
its indexed home (`AGENT_CODEX_HOME_1`, `AGENT_CODEX_HOME_2`, ...). Indexed
homes must be separate owner-only directories, each with its own owner-only
`auth.json`, and none may alias the ordinary `AGENT_CODEX_HOME`. The
executable and digest are shared; credentials are not copied between workers.

It checks `auth.json` as a non-symlink, owner-only regular file with safe size
and ownership metadata, then verifies the pinned executable and its macOS
OpenAI Developer ID signature. It never parses, prints, copies, or changes the
auth file; diagnostics contain only fixed field-level messages. The command
fails on non-macOS hosts because the production native isolation prerequisite
is macOS-only.

This is an operator configuration preflight, not proof of a live Teams/A2A
round trip. The runtime provider still performs its own fail-closed checks at
job acquisition and launch. The validator does not start or stop services.
