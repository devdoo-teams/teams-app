# Portable runtime composition follow-up

Base: reviewed1.0.162 / 9a329812cd51f67f3de3eb8ace4a8e0d977c80cc.
Authority: user-approved diagnosed HTTP/Mac connection and synthetic tests;
The user waived a further Astra review on2026-10-17T18:30:56Z until requested
again. Verified ordinary push and exact-SHA CI follow the existing approval;
new targets/credentials/cost/security changes remain separately gated.

## Scope and seams
- Reuse durable pull host/router/transport and existing Mac AgentService.
- Explicit opt-in server mode, one private persistent state directory, verified
  tenant/owner/authorized-client binding; no body-supplied worker authority.
- Reuse an existing delegated credential provider; no login/credential issuance,
  inbound Mac endpoint, model policy change or provider resource.
- Fresh worker catalog/readiness is required by existing Core gates. Configuration
  and an old receipt do not constitute executable readiness.
- Test real HTTP/auth, durable host/AgentService and connector lifecycle. Only
  credentials/token validation and native execution/isolation are synthetic.
- Preserve the original worktree,74 user files,19 artifacts and server152.
  Synchronize only verified source under existing ordinary-push/CI approval;
  do not switch the operating process or create a deployment target.

## Tasks
1. RED/GREEN explicit durable configuration and verified worker binding.
2. RED/GREEN host dispatcher/routes and Mac existing service/credential adapter,
   bounded scheduler and catalog observation. Cover auth denial, tenant/session
   isolation, duplicate/lost replies, restart and cancellation cleanup.
3. Wire opt-in index mode, register focused tests, strict checks/Core suite,
   separate local commit/candidate and exact-SHA parent/Astra review packet.

## Rulings
- Original157 tasks are complete; this plan addresses only Astra's composition gap.
- Existing validated JWT tenant/owner/client maps to one logical Mac worker. It
  does not claim physical-device attestation. User body IDs are never authority.
- Read-only fresh jobs, fixed Luna/xhigh, admission/isolation and explicit cleanup
  proof remain authoritative. Persistent JSON requires one writer and a volume;
  shared SQL/provider-volume/live-auth configuration are not claimed.

## Astra163 P2 follow-up
- Preserve the original cached-probe start timestamp; expire admission30seconds after that measurement, and accept recovery only after a new probe.
- Process active heartbeat before diagnostics, proving reported and accepted worst-case timing budgets plus genuine expiry/owned cleanup.
- Run the full local Core and boundary regressions at the fix SHA. No new feature scope, credentials, push or deployment.
