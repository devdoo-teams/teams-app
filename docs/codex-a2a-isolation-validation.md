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
its indexed home (`AGENT_CODEX_HOME_1` through `AGENT_CODEX_HOME_8`). Indexed
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

## Repeatable login bootstrap

Prepare one worker at a time with the operator helper:

```bash
npm run a2a:login -- --worker 1
npm run a2a:login -- --worker 1 --run-login
```

Use `--worker main` or `--worker 1` through `--worker 8` for one independent
Codex home. `--all --run-login` processes `main`, then `1` through `8`
sequentially and stops at the first failed login; it never shares credentials
or runs login flows concurrently. Without `--run-login`, the command is a dry
run and does not create credentials.

The helper requires the operator-provided absolute `CODEX_BIN` and its
64-character `CODEX_BIN_SHA256`; it does not guess an executable. With
`--run-login`, the official `codex login --device-auth` process inherits the
terminal so the operator can complete the browser login, password, and MFA.
The child receives only the documented bootstrap environment: fixed `CI=1`,
the selected worker's `CODEX_HOME`, and any present terminal/runtime values
from `PATH`/`Path`, `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`,
`LOCALAPPDATA`, `APPDATA`, `SYSTEMROOT`/`SystemRoot`, `WINDIR`, `PATHEXT`,
`TMPDIR`, `TMP`, `TEMP`, `TERM`, `COLORTERM`, `LANG`, `LC_ALL`, `LC_CTYPE`,
`SSL_CERT_FILE`, `SSL_CERT_DIR`, and `NODE_EXTRA_CA_CERTS`. Other parent
environment values, including access tokens, API keys, worker-roster values,
and executable pins, are not forwarded. The selected executable and digest
are revalidated immediately before each login child is spawned, including a
retry, and the executable must remain a single private regular file.

Each login attempt has a bounded timeout (10 minutes by default, capped at one
hour). On POSIX hosts the login child runs in its own process group; a timeout
or cancellation signals that group with SIGTERM and then SIGKILL if needed.
The helper waits for the child to be reaped before allowing the single
deterministic retry; an unreaped child fails closed. Windows uses the child
handle fallback. This does not automate the device flow or handle credentials.
The helper reports only whether `auth.json` metadata is valid. Empty,
owner-unreadable, symlinked, or hardlinked auth files are invalid, and an
indexed worker may not alias the legacy unsuffixed `AGENT_CODEX_HOME`, even
when bootstrapped alone. After all homes are authenticated, run
`npm run check:codex-a2a-isolation`; that gate is still required before
enabling live A2A execution.
