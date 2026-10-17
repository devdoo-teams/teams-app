# Portable runtime composition follow-up

Base: reviewed1.0.162 / 9a329812cd51f67f3de3eb8ace4a8e0d977c80cc.
Authority: user-approved diagnosed HTTP/Mac connection and synthetic tests;
Astra review precedes push/deployment.

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
- Preserve main,74 user files,19 artifacts and server152. No push/deploy/full CI.

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
