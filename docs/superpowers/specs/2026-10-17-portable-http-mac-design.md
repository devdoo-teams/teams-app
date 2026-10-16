# Portable HTTP / Mac execution: first implementation

Approved direction: implement the diagnosed public HTTP / existing Mac split and
prepare an exact-source local candidate, then obtain Astra review before promotion.

## Scope

- Keep the original main checkout, its 74 pre-existing untracked files, the 3978
  server, DevTunnel, current credentials and model/config untouched.
- Build an opt-in composition with the existing AgentExecutionDispatcher seam,
  a durable single-writer JSON handoff ledger, authenticated HTTP routes and an
  outbound Mac connector. The existing production index remains unchanged until
  host, identity and authorization configuration can be reviewed together.
- Reuse existing delegated authentication via injected authenticate/identity
  resolvers. Worker identity never comes from the request body. No registration,
  token issuance, credentials file, new inbound Mac endpoint or tunnel is added.
- First slice accepts read-only jobs. Workspace-write jobs require the existing
  local approval workflow and are rejected by this transport; remote approval
  cannot become local mutation authority.
- Bind task ID, tenant/requester/conversation, provider, prompt and model selection
  immutably. Every read/mutation checks the authenticated worker and owner.
- Claim is durable before response; begin is durable before execution. Expired
  unstarted claims can be reclaimed. Started/ambiguous work is quarantined after
  lease expiry and is never automatically reassigned.
- Duplicate dispatch/claim/begin/completion is idempotent; conflicting bodies fail.
  Cancellation is cooperative and terminal only after the worker reports cleanup.
- Mac execution reuses AgentService, including its admission, isolation and model
  checks. Local idempotency keys prevent repeated HTTP delivery from spawning again.
- A disconnect stops accepting work and cancels owned execution; uncertain cleanup
  remains blocked. No exactly-once claim across arbitrary process crashes is made.

## Evidence and promotion

Tests use synthetic jobs and loopback HTTP only, never real Codex or Teams data.
New candidate identity is 1.0.155 on the implementation branch, leaving the frozen
1.0.154 tag/draft/run intact. Strict typecheck, focused tests, Core build/tests,
manifest, server determinism and ZIP read-back are local gates. Exact-SHA remote CI,
provider HTTPS, installation and real Teams web/desktop/iPhone are separate gates.
No merge, push, release publication or server promotion before Astra review.
