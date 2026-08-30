# External Hosting Deep Revalidation — 2026-08-31

## Scope and evidence boundary

This is a bounded, first-party documentation audit of the hosting candidates
that can plausibly satisfy this repository's current contract:

1. an HTTPS Teams bot/tab origin that runs the existing Express server with
   `npm start`;
2. durable single-process job/event state while the repository still uses
   `file-json-single-process`;
3. outbound HTTPS to Microsoft and model services; and
4. a server-side Codex worker launched as a real Linux child process behind an
   OS-enforced isolation boundary.

It is not a literal inventory of every hosting provider on the Internet. The
claims below are limited to the linked vendor documentation and are not live
account, billing, DNS, image-publish, deployment, or Teams-installation
evidence.

## Decision matrix

| Candidate | First-party fact checked | Current-app fit | Classification |
| --- | --- | --- | --- |
| Cloudflare Workers Free | Free plan has 100,000 requests/day, 10 ms CPU per request, and 128 MB memory. `node:child_process` is listed among non-functional stub modules. | Cannot run the current Node child-process Codex worker or be treated as a drop-in Express host. | `NOT_A_PRIMARY_RUNTIME` |
| Cloudflare Containers | Runs arbitrary container runtimes, but the pricing page marks the Free tier as `N/A`; usage is included with the $5/month Workers Paid plan. Instances sleep and their disk is not a durable application store. | Possible paid canary or a redesigned edge facade, not a free production replacement for current JSON state and worker auth. | `PAID_CANARY_ONLY` |
| Cloudflare Tunnel | `cloudflared` makes outbound-only connections from an origin to Cloudflare. | Connectivity/protection layer for an already-running server; it does not provide compute or replace the local/external origin. | `NOT_A_HOST` |
| Google Cloud Run service | Usage is billed by resource consumption with a monthly free grant; free usage is aggregated by billing account. | Good container host for the Core service after durable storage and billing guardrails are supplied. | `PRIMARY_ALTERNATIVE` |
| Google Cloud Run worker pool | Worker pools are for continuous background work, have no load-balanced endpoint, and do not autoscale. Revisions are immutable and resolve image tags to digests. | Useful for a separately designed worker plane; it does not replace the public Teams service or supply durable state by itself. | `WORKER_CANDIDATE` |
| Azure Container Apps | Consumption plan has monthly free grants, but subscription/resource conditions and overage billing apply. | Best alignment with the Microsoft Teams deployment path; Azure Files plus `maxReplicas=1` can preserve the current single-process JSON contract. | `PRIMARY_CANDIDATE` |
| Oracle Always Free VM | Home-region Always Free compute includes up to 2 OCPUs/12 GB for Ampere A1, subject to capacity and possible idle reclamation. | Technically capable of a Linux container/bwrap or seccomp worker, but TLS, patching, backup, monitoring, and rollback are self-managed. | `TRUE_FREE_CANARY` |
| Firebase App Hosting | Uses Cloud Build, Artifact Registry, Cloud Run, and Cloud CDN; requires the Blaze pay-as-you-go plan. | A managed Cloud Run surface, not an additional free compute tier. It does not solve worker isolation or current file-state semantics. | `CLOUD_RUN_SURFACE` |
| Firebase Hosting | Static hosting can proxy dynamic content through Cloud Run or Functions. | Suitable for static tab assets only; it cannot replace `/api/messages` or a Codex worker. | `STATIC_ONLY` |
| Render Free | Free web services sleep after inactivity and have an ephemeral filesystem; the vendor says not to use Free instances for production. | Fails durable state/availability requirements unless the app is redesigned and the service is no longer Free. | `CANARY_ONLY` |
| Railway Free Trial | Trial is a one-time credit with a limited monthly free credit after the trial; network access can be restricted for unverified accounts. | Not a stable no-cost production contract and not evidence of persistent storage or worker isolation. | `TRIAL_ONLY` |

## Findings that affect the current implementation

### 1. Cloudflare is not a drop-in migration target

The current server imports Node process/filesystem primitives and launches the
Codex CLI. Cloudflare's Workers documentation distinguishes importable
non-functional stubs from working Node APIs and lists `node:child_process` in
that stub section. Workers' `/tmp` filesystem also does not establish a durable
multi-request store. Cloudflare Containers can run a full runtime, but the
current pricing page has no Free container allotment and the instance disk is
not the required durable job store.

The technically coherent Cloudflare design is therefore a later split:
Workers for a thin HTTPS/facade layer, D1 for a schema-backed job/event store,
R2 for artifacts, and Queues only for bounded handoff. The real Codex process
must remain on a separately managed Linux compute plane. That is a new
distributed-system release, not a hosting-only configuration change.

### 2. Azure is the least disruptive managed target

The existing repository already has an Azure Container Apps workflow contract.
Keeping the Core service on one revision with an Azure Files mount at
`/app/data` and `maxReplicas=1` preserves the current storage invariant while
the public service is moved off the Mac. This still requires an actual Azure
subscription, resource group, registry, Files share, OIDC trust, and public
origin; none are claimed to exist by this note.

### 3. A worker plane is a separate architectural boundary

The current production provider deliberately returns unavailable on non-macOS,
because its native preflight invokes macOS Seatbelt/Codesign behavior. A Linux
external runtime cannot be declared ready merely by setting `AGENT_CODEX_HOME`
and `CODEX_BIN`. It needs a separately verified Linux provider, an explicit
approved sandbox implementation, per-worker private auth homes, executable
integrity checks, process-group cancellation, durable job state, and real
authenticated round-trip evidence.

The external host can therefore be deployed in two stages:

1. Core service canary with the current A2A state explicitly `unavailable`;
2. worker-plane canary only after Linux isolation and live A2A gates pass.

The existing Dev Tunnel and Teams endpoint must remain unchanged until both
stages have the same-release identity evidence.

## Recommended order

1. Keep the public Dev Tunnel and current installed Teams app untouched.
2. Implement and verify the Linux worker isolation contract on a disposable
   Linux target; do not put credentials or `auth.json` in the image, source,
   ZIP, or GitHub artifacts.
3. Use Azure Container Apps + Azure Files as the managed Core canary, with
   Cloud Run as the alternative if a Google billing project is available.
4. Use Oracle Always Free only when zero compute charge is a hard requirement
   and self-managed availability/reclamation risk is accepted.
5. Revisit Cloudflare only as a separate Workers/D1/R2/Queues facade release.

## Official sources

- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Workers pricing: <https://developers.cloudflare.com/workers/platform/pricing/>
- Cloudflare Node.js compatibility and non-functional stubs: <https://developers.cloudflare.com/workers/runtime-apis/nodejs/>
- Cloudflare Containers overview: <https://developers.cloudflare.com/containers/>
- Cloudflare Containers pricing: <https://developers.cloudflare.com/containers/platform/pricing/>
- Cloudflare Tunnel: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>
- Cloud Run pricing: <https://cloud.google.com/run/pricing>
- Cloud Run container contract: <https://docs.cloud.google.com/run/docs/container-contract>
- Cloud Run worker pools: <https://docs.cloud.google.com/run/docs/deploy-worker-pools>
- Azure Container Apps billing: <https://learn.microsoft.com/en-us/azure/container-apps/billing>
- Azure Container Apps Azure Files: <https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts-azure-files>
- Microsoft Teams container deployment: <https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/deploy-teams-app-to-container-service>
- Oracle Always Free resources: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
- Firebase App Hosting: <https://firebase.google.com/docs/app-hosting>
- Firebase App Hosting costs: <https://firebase.google.com/docs/app-hosting/costs>
- Firebase Hosting: <https://firebase.google.com/docs/hosting>
- Render free instances: <https://render.com/docs/free>
- Railway free trial: <https://docs.railway.com/pricing/free-trial>
- OpenAI Codex sandbox safety: <https://openai.com/index/building-codex-windows-sandbox/>
- OpenAI Codex security mitigations: <https://deploymentsafety.openai.com/gpt-5-3-codex/cybersecurity>
- bubblewrap project: <https://github.com/containers/bubblewrap>
- bubblewrap security advisory (patched version requirement): <https://github.com/containers/bubblewrap/security/advisories/GHSA-pxhw-h44j-8pfx>

## Final classification

`RESEARCH_COMPLETE_FOR_NAMED_CANDIDATES` — official documentation was
revalidated for the named candidates above.

`NOT_PROVIDER_EXHAUSTIVE` — this does not claim that every free hosting
service on the Internet was inspected.

`DEPLOYMENT_UNVERIFIED` — no account/resource/billing/OIDC/DNS/image/worker/
Teams UI change was performed by this audit.
