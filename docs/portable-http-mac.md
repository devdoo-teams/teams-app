---
type: "Implementation contract"
title: "Portable HTTP and existing Mac execution"
sources:
  - resource: "https://nodejs.org/download/release/v24.19.0/docs/api/globals.html#class-abortcontroller"
    title: "Node.js v24.19.0 globals"
    location: "AbortController, AbortSignal.throwIfAborted, fetch; version-pinned documentation"
  - resource: "https://expressjs.com/en/guide/routing/"
    title: "Express 5 routing"
    location: "Routing and middleware callbacks; HTML lines are not a stable contract"
  - resource: "https://learn.microsoft.com/en-us/javascript/api/@azure/identity/azureclicredential?view=azure-node-latest"
    title: "AzureCliCredential JavaScript API"
    location: "Constructor and getToken sections; observed 2026-10-17; installed @azure/identity4.13.2 declarations agree"
  - resource: "https://learn.microsoft.com/en-us/javascript/api/@azure/identity/azureclicredentialoptions?view=azure-node-latest"
    title: "AzureCliCredentialOptions"
    location: "tenantId and processTimeoutInMs sections; HTML lines are not a stable contract"
  - resource: "https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc#the-default-scope"
    title: "Microsoft identity platform scopes and permissions"
    location: "The .default scope; existing consent is required; no permission grant is performed by this implementation"
  - resource: "https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference"
    title: "Access token claims reference"
    location: "tid, oid, scp, azp/appid claims; signature verification remains the existing SDK validator's responsibility"
generated: { by: "process:portable-runtime-composition", at: "2026-10-17T18:01:59Z" }
verified: { by: "process:local-synthetic-contract-tests", at: "2026-10-17T18:01:59Z" }
status: draft
stale_after: "2026-10-24T18:01:59Z"
---

# Portable HTTP / existing Mac execution

Local candidate1.0.163 completes the opt-in composition missing from reviewed
1.0.162/9a329812. On2026-10-17 the user waived another Astra review until
requested again; verified source synchronization and CI use the existing approval. The existing3978 production
server152, main154, remote reviewed162 and their artifacts remain separate.
This document does not claim a cloud deployment, live delegated authorization,
real Codex execution or a Teams web/Mac/iPhone pass.

## Included implementation

The Core build ships `dist/server/portable-worker-runtime.js`. Importing that
entry starts no listener, worker, login, filesystem lease or timer.

| Export | Responsibility |
| --- | --- |
| `createPullWorkerHost` | Single-writer durable task/claim/begin/cancellation/result ledger |
| `createPullWorkerRouter` | Authenticated bounded HTTP operations; no registration or token issuance |
| `createAuthenticatedPullTransport` | Outbound HTTPS, asynchronous existing authorization, one total request deadline, bounded response, no redirects or DevTunnel relay |
| `MacPullWorker` | Serialized polling steps, disconnect/cleanup, explicit reconnect |
| `createAgentServiceMacExecutor` | Existing Mac AgentService and its durable idempotency, model, admission, isolation and explicit cleanup proof |
| `resolvePortableHostConfig`, `createPortableHostRuntime` | Explicit durable root, verified tenant/owner/client binding, fresh worker catalog/readiness and production dispatcher/router composition |
| `resolvePortableMacConfig`, `createExistingDelegatedAuthorization`, `createMacPullRuntime` | Explicit existing credential provider, existing local service, bounded observation/poll scheduler and owned shutdown |

## Server activation and persistent storage

`index.ts` accepts `TEAMS_AGENT_DISPATCH_MODE=pull-worker` only through the explicit
configuration below. Local and Azure queue modes retain their prior defaults.

- `TEAMS_PULL_STATE_DIR`: absolute dedicated persistent directory, one writer.
- `TEAMS_PULL_WORKER_BINDING`: strict JSON containing `workerId`, `tenantId`,
  `requesterId`, `clientId`; tenant/owner/client are explicit UUIDs.
- Existing Teams SDK/Entra validator, matching tenant, accepted API audience and
  existing operator allowlist must already be configured. Skip-auth is refused.
- File storage and Codex are required. Multiple writer declarations are refused.
  All existing store paths and the new handoff ledger resolve beneath this
  root; explicit overrides cannot escape it. Existing atomic store/lease helpers
  reject symlink paths and maintain private0700 directories/0600 files.

The HTTP process instantiates no local CLI runner or native preflight in this
mode. It uses the existing AgentService with the pull dispatcher. Core routes,
Bot/tab authentication, model policy and operator checks remain in force.
Authentication precedes the worker JSON parser. A validated token must match the
configured tenant, owner and authorized client (`azp`/`appid`); user-selected body
or header IDs confer no authority. This maps one logical worker; it is not
physical-device attestation and cannot distinguish machines sharing that identity.

A private directory on a local test host proves only that host's persistence.
An actual provider volume, single-instance configuration, backups and operational
restart/rollback must still be read back before any deployment. Shared SQL,
horizontal scaling and automatic ledger migration are outside this slice.

## Existing Mac connection

Mac startup is separately opt-in with `TEAMS_PULL_MAC_ENABLED=true`,
`TEAMS_PULL_CREDENTIAL_PROVIDER=azure-cli`, `TEAMS_PULL_SERVER_ORIGIN`,
`TEAMS_PULL_RESOURCE_URI` and the same worker binding. The HTTPS origin must be
plain and match the explicit `api://HOST/botid-APPID` resource. DevTunnel relay,
credential chains, cloud/worker role overlap and a Copilot override are refused.

Only the already signed-in Azure CLI identity is consulted, through installed
`AzureCliCredential({ tenantId, processTimeoutInMs:3000 })`. The adapter requests
exactly `RESOURCE/.default` into memory, verifies a nonexpired receipt and never
logs or persists it. It cannot run login, create an account/credential/permission
or change Entra consent. Whether that existing client has the delegated
`access_as_user` grant and expected `azp` remains a separate live gate. A normal
Teams tab client's token is not automatically a worker credential.

Production activation additionally requires Darwin, the existing operator and
the existing verified native read-only preflight. The connector receives the
same local AgentService; it creates no second executor, service home, auth copy
or inbound Mac port. Existing Luna/xhigh selection, admission and per-job
isolation/cleanup remain authoritative. Unsupported writes and continuations
are refused before admission or durable creation. Existing operator authority
is retained for strict cancellation.

## Observations and lifecycle

1. An authenticated worker reports its exact source SHA, canonical observed model
   catalog and existing runtime readiness dimensions. Catalog revision and fixed
   model selection are revalidated; configuration alone is never available.
2. Core admission requires a fresh available observation. The30-second receipt
   budget also checks the original probe-start timestamp. The existing15-second
   capability cache retains that timestamp on every report; reading its cached
   result cannot renew the original30-second lifetime. Server restart begins unknown;
   stored jobs or an old ready receipt cannot restore readiness.
3. Existing cloud AgentService submits an owner's fresh read-only Codex job.
   Durable claim and begin precede local execution. A local stable owner/job key
   and immutable request hash identify one request, including concurrent replay.
4. Default scheduler polls every1second. Requests include credential acquisition
   in a3-second total deadline; local observation has a5-second bound and its POST
   has the same request bound. Active work renews/finishes before observation.
   With the accepted maxima, begin reply5s + start15s + poll3s + next heartbeat5s
   is28s. A steady cycle includes prior heartbeat reply5s + local observation5s +
   observation POST5s + poll3s + next heartbeat5s, at most23s. Both retain margin
   within the30-second lease. Cycles do not overlap; an actual longer pause/expiry
   still blocks, cancels only owned work and requires verified cleanup.
5. Heartbeats carry cancellation. Finish is durable and replayable after a lost
   reply. Strict cancellation waits for owned process, projection, isolation and
   admission cleanup. A terminal status or a delivered signal is insufficient.
6. Authentication/transport loss blocks new claims and stops only owned work.
   Reconnection is explicit after verified cleanup. Closing the connector never
   closes the shared AgentService or unrelated server/jobs.

An unstarted expired claim may be reissued. A started expired job is quarantined
and blocks new work; no automatic reassignment or arbitrary exactly-once claim
is made. Process-local cleanup proof is not reconstructed from terminal records
following a Mac restart. An uncertain late start, failed cleanup or ambiguous
cancel/result race remains blocked for operator reconciliation. Missing fresh
readiness blocks new admission but does not block reading/cancelling/replaying
an existing durable result.

## Verification and release boundaries

Focused tests exercise actual loopback HTTP, production delegated middleware,
both real AgentServices, durable replay/restart, lost finish acknowledgement,
tenant/owner/client/session/lease denial, concurrent duplicate requests,
cancellation cleanup, auth disconnect, explicit reconnect and scheduler/close.
Only token validation/credentials and native runner/isolation are synthetic.
The actual bundled `index.ts` test additionally verifies SDK startup, auth before
body parsing, zero local CLI use, private state and bounded shutdown/restart.
These tests are registered in the existing Core runner.

Exact-commit local source/strict/Core/build/package receipts belong to the new
candidate only when generated after its commit. Prior remote8/8 CI at9a329812
is solely evidence for reviewed162. New remote CI, push, release/tag, cloud
volume/HTTPS/worker authorization, Bot/SSO round-trip, installation and all Teams
host screenshots remain separate deployment gates. The review waiver does not
change the approval boundary for a new target, credential, cost or security setting.
