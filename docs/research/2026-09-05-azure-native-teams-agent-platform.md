# Azure-native Teams agent platform proposal

Checked: 2026-09-05

Repository evidence baseline: `47ac4384568c9a5f498e4062ab46a49cfd88a199`

Decision status: research recommendation only; no Azure resource, traffic, secret, package, or runtime was changed

## Executive decision

The smallest sufficient next architecture is an **Azure canary that keeps the current q3 Dev Tunnel/local service intact**, runs Teams Core in one Azure Container App, externalizes authoritative state to Cosmos DB and Storage Queue, stores immutable worker artifacts in Blob Storage/ACR, and executes strict local CLI providers on **one separately hardened Linux VM**. Managed identity, Key Vault, Log Analytics, Application Insights, GitHub OIDC, and an Azure DevOps environment approval complete the minimum control plane.

This is not yet a deployment decision. A current non-mutating ARM what-if reports nine `Unsupported` role assignments. Their principal, scope, role definition, and purpose passed the itemized static contract review in [`2026-09-05-azure-what-if-rbac-review.md`](2026-09-05-azure-what-if-rbac-review.md), but live assignment and authorization remain unverified. The Container App still needs explicit startup/readiness/liveness probes; `minReplicas: 0` must either be accepted as a cold-start/availability trade-off or changed to `1` for the promoted service. The existing q3 service remains the rollback origin until one release identity passes state reconciliation, public runtime, worker, package, Teams desktop, and Teams mobile gates.

A fuller Azure-native resilient target—Service Bus Standard where ordering is required, a replaceable VM Scale Set worker pool, multiple Container App revisions/origins, and Front Door—is intentionally deferred until measured workload or continuity requirements justify its cost and operational surface. AKS and Container Apps Jobs do not satisfy the repository's current strict-worker contract by documentation alone.

## Evidence taxonomy

This document uses four non-overlapping labels:

- **OFFICIAL CONTRACT** — behavior explicitly documented by Microsoft, Azure, or GitHub first-party documentation current on the checked date.
- **OBSERVED REPOSITORY EVIDENCE** — source, tests, manifests, Git history, or a non-mutating receipt observed at the pinned repository baseline. This does not prove Azure or Teams runtime behavior.
- **INFERENCE / RECOMMENDATION** — an architecture conclusion derived from the official contract and repository evidence. It is not a vendor guarantee.
- **LIVE UNVERIFIED** — anything requiring a current cloud resource, deployed revision, live credential, public request, worker execution, portal state, desktop interaction, or mobile interaction that this research did not perform.

No local fixture, Bicep compilation, what-if result, unit test, health contract, or Git commit is promoted to live deployment evidence.

## 1. OFFICIAL CONTRACT

### 1.1 Teams UI and GitHub's Teams cloud-agent integration are separate products

**OFFICIAL CONTRACT.** A Teams tab is a web page declared by the app manifest and hosted inside Teams; the page must initialize the Teams JavaScript client library with `app.initialize()`. It is therefore the TeamsApp UI surface, independent of where this repository's backend runs. [Microsoft: Create a content page](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/create-tab-pages/content-page)

**OFFICIAL CONTRACT.** GitHub's `@GitHub` Microsoft Teams integration is a separate GitHub app/cloud-agent workflow. GitHub documents it as public preview, requiring a paid Copilot plan, operating asynchronously in a GitHub-hosted cloud environment, and having different identity behavior for direct and shared channels. It is not documentation for embedding GitHub Copilot as this application's A2A worker. [GitHub: Integrate Copilot coding agent with Microsoft Teams](https://docs.github.com/en/copilot/how-tos/copilot-integrations/integrate-cloud-agent-with-teams) [GitHub changelog: Shared agentic work in Teams](https://github.blog/changelog/2026-08-21-shared-agentic-work-with-github-copilot-in-microsoft-teams/)

**INFERENCE / RECOMMENDATION.** Keep the existing TeamsJS personal tab and Teams bot/Adaptive Card contract as the product UI. Treat GitHub's `@GitHub` app as an optional, out-of-band collaboration surface. Do not count a GitHub Teams response as a backend A2A execution by Codex, Hermes, Buzz, Grok, or another registered provider.

### 1.2 Dev Tunnel is a development bridge, not a production availability contract

**OFFICIAL CONTRACT.** Microsoft describes Dev Tunnels as a preview service for securely sharing local web services and explicitly says the service has no SLA and is not recommended for production workloads. [Microsoft: Dev Tunnels overview](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/overview)

**INFERENCE / RECOMMENDATION.** The restored q3 tunnel is valuable as the continuity origin during migration, but it cannot be the durable production target. Its current usefulness does not remove the need for a same-release Azure canary and rollback gates.

### 1.3 Azure Container Apps revisions, traffic, probes, and replicas

**OFFICIAL CONTRACT.** Container Apps supports single and multiple revision modes. In multiple revision mode, active revisions can receive weighted traffic and labels can provide stable revision-specific URLs; this enables canary and blue-green patterns. In single revision mode, traffic remains on the old revision until the new revision is ready. [Azure: Revisions in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions)

**OFFICIAL CONTRACT.** Container Apps supports startup, readiness, and liveness probes. Readiness determines whether a replica can receive traffic, liveness can restart an unhealthy container, and startup probes delay the other probes while an application starts. Azure recommends defining appropriate probes, and multiple-revision traffic should move only after readiness succeeds. [Azure: Health probes in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/health-probes)

**OFFICIAL CONTRACT.** Minimum and maximum replicas are configured per revision. A minimum of zero permits scale-to-zero where supported; a nonzero minimum keeps prewarmed replicas and incurs active/idle resource consumption according to the plan's billing rules. [Azure: Set scaling rules in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) [Azure: Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing)

**OFFICIAL CONTRACT.** The Consumption plan can scale to zero and includes monthly grants described by Azure, while Dedicated workload profiles provide dedicated capacity. These documents describe platform allocation and billing; they do **not** establish customer-controlled guest-OS isolation, an owner-only persistent CLI authentication home, or host hardening equivalent to a dedicated VM. [Azure: Container Apps plans](https://learn.microsoft.com/en-us/azure/container-apps/plans) [Azure: Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing)

**INFERENCE / RECOMMENDATION.** Use multiple revision mode and explicit revision labels for the canary, but start with one authoritative Core replica until all mutable stores are proven external. Add startup, readiness, and liveness probes before promotion. Use `minReplicas: 1` for a promoted Core service that must avoid intentional scale-to-zero; retain `0` only for an explicitly accepted development/cost canary where cold start is acceptable.

### 1.4 Cosmos DB consistency, ETags, and transaction boundaries

**OFFICIAL CONTRACT.** Every Cosmos DB item has an `_etag` that changes when the item changes. Optimistic concurrency uses `If-Match`; a stale value fails with HTTP 412. Server-side transactions are scoped to a single logical partition. [Azure: Transactions and optimistic concurrency control](https://learn.microsoft.com/en-us/azure/cosmos-db/database-transactions-optimistic-concurrency)

**OFFICIAL CONTRACT.** A Cosmos DB transactional batch is atomic only for operations sharing one logical partition key. The documented limits include at most 100 operations, a 2 MB request payload, and a five-second execution time. [Azure: Transactional batch operations](https://learn.microsoft.com/en-us/azure/cosmos-db/transactional-batch) [Azure: Cosmos DB service quotas](https://learn.microsoft.com/en-us/azure/cosmos-db/concepts-limits)

**OFFICIAL CONTRACT.** Cosmos DB free tier is opt-in at account creation, limited to one free-tier account per Azure subscription, and currently discounts the first 1,000 RU/s and 25 GB for an eligible account. The documentation does not prove that the target subscription is eligible or that no existing account has consumed the entitlement. [Azure: Cosmos DB free tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier)

**INFERENCE / RECOMMENDATION.** Store each durable task aggregate, ownership fence, idempotency key, and terminal receipt under a partition strategy that permits the required atomic updates. Use ETag compare-and-swap for state transitions and rollback fencing. Do not describe cross-partition migration, queue delivery, or provider execution as exactly once.

### 1.5 Storage Queue versus Service Bus

**OFFICIAL CONTRACT.** Azure Storage Queue and Service Bus Queue both support durable asynchronous messaging and at-least-once delivery patterns. Storage Queue is simpler and highly scalable but does not provide built-in ordering or atomic multi-message operations. Service Bus adds broker features such as sessions, transactions, dead-lettering, and duplicate detection. [Azure: Storage queues and Service Bus queues compared](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-azure-and-service-bus-queues-compared-contrasted)

**OFFICIAL CONTRACT.** Service Bus sessions can provide ordered, exclusive handling for messages with the same `SessionId`; sessions are available in Standard and Premium tiers, not Basic. Duplicate detection uses an application-controlled `MessageId` within a configured time window and is also limited to Standard and Premium. [Azure: Service Bus message sessions](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-sessions) [Azure: Duplicate detection](https://learn.microsoft.com/en-us/azure/service-bus-messaging/duplicate-detection)

**OFFICIAL CONTRACT.** With PeekLock, a Service Bus message can be redelivered when a lock is lost or processing fails. Azure therefore still recommends idempotent processing; duplicate detection does not turn end-to-end execution into exactly once. [Azure: Message loss and duplicate delivery](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-message-loss-and-duplicates)

**INFERENCE / RECOMMENDATION.** Preserve Storage Queue for the bounded canary because the repository already implements leases, visibility renewal, durable receipts, poison handling, and idempotency around it. Move to Service Bus Standard only if an accepted requirement needs per-task FIFO sessions, broker transactions, richer dead-letter workflows, or duplicate detection. Retain Cosmos-backed idempotency even after that migration.

### 1.6 Blob Storage versus Azure Files

**OFFICIAL CONTRACT.** Blob Storage is Azure's object store for unstructured data and distributed access. Azure Files provides managed SMB or NFS file shares and is aimed at shared file-system and lift-and-shift scenarios. Storage Queue is the asynchronous message component of the storage account. [Azure: Introduction to Azure Storage](https://learn.microsoft.com/en-us/azure/storage/common/storage-introduction)

**INFERENCE / RECOMMENDATION.** Use a private Blob container for immutable worker archives, migration manifests, and other content-addressed artifacts. Do not provision or expose Azure Files merely as a future placeholder: the current runtime neither mounts the share nor grants the worker Files data-plane access. Add Files only when a reviewed workload genuinely requires shared POSIX/SMB semantics and has an explicit mount, identity, backup, and concurrency contract.

### 1.7 ACR and immutable images

**OFFICIAL CONTRACT.** ACR Basic, Standard, and Premium have the same registry API but different included storage, throughput, and features. Premium adds capabilities such as geo-replication and private link; Basic is intended for lower-volume scenarios. [Azure: Container Registry service tiers](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-skus)

**OFFICIAL CONTRACT.** ACR reliability depends on the selected region/tier and architecture; zone redundancy and geo-replication require supported configurations rather than occurring automatically. [Azure: Reliability in Azure Container Registry](https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry)

**INFERENCE / RECOMMENDATION.** ACR Basic is sufficient for a single-region canary if every deployment is pinned by image digest and retention is managed deliberately. Upgrade only for measured throughput, private network, zone, or geo-replication requirements. Azure's ACR pricing page describes paid service tiers and does not establish a free registry entitlement for this account. [Azure: Container Registry pricing](https://azure.microsoft.com/en-us/pricing/details/container-registry/)

### 1.8 Managed identity, Key Vault, and least privilege

**OFFICIAL CONTRACT.** A Container App can use a system-assigned or user-assigned managed identity to access Entra-protected Azure resources without application-managed credentials. [Azure: Managed identities in Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity)

**OFFICIAL CONTRACT.** Container Apps can reference Key Vault secrets using managed identity. A reference to the latest secret version can be refreshed by the platform, while a version-pinned reference remains immutable until configuration changes. [Azure: Manage secrets in Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)

**OFFICIAL CONTRACT.** Microsoft recommends Azure RBAC for Key Vault data-plane authorization and recommends assigning roles at the vault scope for most application scenarios rather than creating a vault per secret. [Azure: Key Vault RBAC guide](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)

**INFERENCE / RECOMMENDATION.** Use separate managed identities for Core and workers, narrow data-plane roles, and version-pinned Key Vault references for release-critical secrets. Put only secrets in Key Vault; ordinary endpoints and resource names belong in validated configuration. CLI user authentication material remains out of band and must not enter Bicep, Key Vault deployment outputs, images, archives, or logs.

### 1.9 Monitor, Application Insights, and Log Analytics

**OFFICIAL CONTRACT.** Container Apps can send console and system logs to a Log Analytics workspace, and those logs can be queried with Azure Monitor. [Azure: Monitor logs in Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/log-monitoring)

**OFFICIAL CONTRACT.** Container Apps' managed OpenTelemetry agent can route telemetry to supported backends, but applications must still emit supported OpenTelemetry signals and configure destinations. The current managed-agent documentation lists Application Insights support for logs and traces, not metrics. [Azure: OpenTelemetry agents in Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/opentelemetry-agents)

**OFFICIAL CONTRACT.** Azure Monitor Application Insights supports OpenTelemetry instrumentation for Node.js applications. Enabling a workspace resource alone does not instrument this server or prove that spans, metrics, task IDs, and provider receipts are correlated. [Azure: Enable Azure Monitor OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable)

**INFERENCE / RECOMMENDATION.** Send platform/container logs to Log Analytics and instrument Core and worker processes with OpenTelemetry using stable task, tenant-safe correlation, release, revision, provider, queue receipt, and terminal-result attributes. Add alerts for unhealthy revisions, queue age/poison growth, missing terminal receipts, worker heartbeat, Cosmos throttling/conflicts, and rollback fences. Azure Monitor pricing includes ingestion and retention dimensions; no source reviewed here proves a free entitlement or zero-cost retention for the target account. [Azure: Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/)

### 1.10 Strict worker isolation: dedicated Linux VM, VMSS, AKS, and Container Apps Jobs

**OFFICIAL CONTRACT.** Azure Virtual Machines give the customer a guest operating system to configure and manage. This is the Azure option among those evaluated here that directly exposes the OS controls needed by the repository's owner-only homes, service manager, process tree controls, executable pinning, and hardening contract. [Azure: Virtual Machines overview](https://learn.microsoft.com/en-us/azure/virtual-machines/overview)

**OFFICIAL CONTRACT.** VM Scale Sets manage a group of load-balanced virtual machines, support autoscaling and availability-zone/fault-domain placement, and can maintain a consistent instance configuration. Automatic instance repair can restart, reimage, or replace unhealthy instances based on an application health signal. [Azure: VM Scale Sets overview](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/overview) [Azure: Automatic instance repairs](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/virtual-machine-scale-sets-automatic-instance-repairs)

**OFFICIAL CONTRACT.** Container Apps Jobs are finite executions that run to completion, either manually, on a schedule, or from events. The documentation describes job lifecycle and scaling; it does **not** prove customer guest-OS control, a persistent owner-only authentication home, or VM-level isolation for mutually untrusted CLI workers. [Azure: Jobs in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/jobs)

**OFFICIAL CONTRACT.** AKS worker nodes are virtual machines, but pods normally share node resources and the host kernel. Microsoft's security guidance warns that Kubernetes is not a safe hostile multitenant boundary by default and points to stronger isolation mechanisms; some pod-sandboxing/confidential-container options are limited or preview features. [Azure: Security concepts in AKS](https://learn.microsoft.com/en-us/azure/aks/concepts-security) [Azure: Core AKS concepts](https://learn.microsoft.com/en-us/azure/aks/core-aks-concepts)

**INFERENCE / RECOMMENDATION.** Keep strict Codex/Hermes/Buzz CLI execution on one hardened Linux VM for the canary. The cited Container Apps and Container Apps Jobs documentation does not prove VM-level isolation. AKS adds a cluster control plane and does not make a normal pod a hostile-code boundary. Move to VMSS only after worker bootstrap, authentication enrollment, state, archive verification, draining, and replacement are automated and proven; then isolate trust domains by instance or pool rather than co-locating untrusted identities.

### 1.11 Front Door is useful only when there is a meaningful origin topology

**OFFICIAL CONTRACT.** Azure Front Door probes origins and uses origin health to route traffic, but when an origin group contains only one enabled origin, Front Door continues routing traffic to it even if probes report it unhealthy. [Azure: Front Door health probes](https://learn.microsoft.com/en-us/azure/frontdoor/health-probes)

**OFFICIAL CONTRACT.** Microsoft recommends multiple origins and appropriate probe/load-balancing configuration for availability. Front Door can also provide global routing and WAF capabilities, but those features add a separate edge control plane. [Azure: Front Door best practices](https://learn.microsoft.com/en-us/azure/frontdoor/best-practices)

**INFERENCE / RECOMMENDATION.** Do not add Front Door to a one-origin canary. Container Apps ingress plus a validated custom domain is the smaller boundary. Add Front Door only with at least two independently healthy origins, a multi-region/failover requirement, or an approved WAF/global-edge requirement. Front Door pricing includes base, request, and data-transfer dimensions; the official pricing page does not prove a free entitlement. [Azure: Front Door pricing](https://azure.microsoft.com/en-us/pricing/details/frontdoor/)

### 1.12 GitHub supply chain and Azure DevOps promotion

**OFFICIAL CONTRACT.** GitHub Actions can authenticate to Azure through OpenID Connect so a workflow does not store a long-lived Azure credential; the Entra federated credential and workflow permissions/conditions still must be configured and constrained. [GitHub: Configure OIDC in Azure](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure)

**OFFICIAL CONTRACT.** GitHub artifact attestations provide signed provenance that can be generated and verified for build artifacts. GitHub documents plan/visibility availability limits; an attestation is useful only when the consumer verifies the expected repository, workflow, commit, and artifact digest. [GitHub: Use artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)

**OFFICIAL CONTRACT.** Azure DevOps approvals and checks are controlled by resource owners and are not defined by a pipeline YAML file. Environments and service connections can be protected by approvals, branch controls, and other checks before a stage runs. [Azure DevOps: Approvals and checks](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops) [Azure DevOps: Environments](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/environments?view=azure-devops)

**OFFICIAL CONTRACT.** Microsoft recommends workload identity federation for Azure Resource Manager service connections instead of client secrets. Current documentation also describes issuer migration and retirement timelines that must be checked against the actual organization before rollout. [Azure DevOps: Connect to Azure with an ARM service connection](https://learn.microsoft.com/en-us/azure/devops/pipelines/library/connect-to-azure?view=azure-devops)

**INFERENCE / RECOMMENDATION.** GitHub owns source, tests, immutable artifacts, image/ZIP digests, and attestation. Azure DevOps consumes only a verified receipt and owns environment approval, exact-target what-if review, deployment, traffic promotion, and rollback. Use OIDC/workload identity federation at both boundaries; do not store Azure client secrets in either platform.

### 1.13 ARM what-if and cost/free-tier caveats

**OFFICIAL CONTRACT.** ARM what-if predicts changes without applying them, but it can report `Unsupported` when it cannot fully evaluate expressions such as `reference()`. An `Unsupported` result is not proof that a change is safe or destructive; it requires human review against the exact target. [Azure: ARM deployment what-if](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if)

**OFFICIAL CONTRACT.** Azure advertises a mixture of limited-time new-customer services and always-free monthly quantities. Eligibility, quotas, regions, related resources, overage, and offer type vary; the public page does not prove what this subscription can consume without charge. [Azure: Free services](https://azure.microsoft.com/en-us/pricing/free-services) [Azure: Account purchase options](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account)

**INFERENCE / RECOMMENDATION.** Treat “free-first” as a cost optimization objective, not a release gate or entitlement claim. Before deployment, calculate the exact region/SKU bill, confirm the subscription's active offer and free-tier eligibility in Azure, set budgets/alerts, and obtain approval for nonzero spend. `minReplicas: 1`, a continuously running VM, ACR, Log Analytics ingestion, Key Vault operations, storage, egress, Service Bus Standard, and Front Door may incur charges.

## 2. OBSERVED REPOSITORY EVIDENCE

Everything in this section was observed from the pinned baseline or supplied non-mutating handoff evidence. It is not live Azure/Teams proof.

### 2.1 Release and Teams contract

**OBSERVED REPOSITORY EVIDENCE.** `package.json` and `appPackage/manifest.json` both identify app version `1.0.100`. The manifest retains the personal tab at `/tabs/home/`, bot scopes `personal`, `team`, and `groupChat`, and `devicePermissions: ["geolocation"]`. No version file was changed by this research.

**OBSERVED REPOSITORY EVIDENCE.** The repository's release contracts require the Teams Core UI, bot, durable runtime, package, installed desktop app, and mobile evidence to share one version/commit/package/runtime identity. They also prohibit treating optional providers or fixture tests as live. Relevant contracts are `AGENTS.md`, `docs/teams-release-workflow.md`, and `docs/superpowers/plans/2026-09-03-azure-teamsapp-platform.md`.

### 2.2 Current Azure template shape

**OBSERVED REPOSITORY EVIDENCE.** `infra/azure/main.bicep` and its modules describe Container Apps, ACR, Cosmos DB, Storage Queue and poison queue, a private Blob artifact container, an Azure Files share, Key Vault, Log Analytics/Application Insights, managed identities, and one Linux VM. The Container App uses multiple revision mode and immutable release-identity environment values, but the current module sets `minReplicas: 0`, `maxReplicas: 1`, routes 100% to `latestRevision`, and defines no explicit startup/readiness/liveness probes.

**OBSERVED REPOSITORY EVIDENCE.** The Cosmos template selects session consistency, `/partitionKey`, one non-zone-redundant region, autoscale maximum 1,000 RU/s, disabled local/key authentication, and a requested free-tier account. This is configuration intent, not proof of eligibility or provisioned behavior.

**OBSERVED REPOSITORY EVIDENCE.** The storage template disables shared-key authorization, creates dispatch and poison Storage queues plus a private worker-artifacts Blob container, and grants narrow queue/blob roles. It also creates an Azure Files share and records a Files endpoint, while the runtime contract test expressly verifies that the worker identity does not receive Azure Files contributor access. No repository runtime path reviewed here mounts or uses that share.

**OBSERVED REPOSITORY EVIDENCE.** The worker VM template uses a managed identity, no application-managed storage credential, a private staged archive, SHA-256 verification before archive parsing/execution, an owner-only environment file, and a service unit. This is static implementation evidence only.

### 2.3 Integrated fixes and current handoff state

**OBSERVED REPOSITORY EVIDENCE.** Baseline history contains `af297e5` (`fix(azure): verify worker archive before execution (MP-279)`), `41abd7a` (`fix(azure): fence state rollback ownership (MP-278)`), `6914563` (`fix(azure): retain what-if unsupported reasons (MP-281)`), `7e8efd2` (`fix(azure): separate submit readiness from worker liveness (MP-277)`), and `f98b09e` (`test(core): await durable outbound receipt (MP-179)`). The clean-head Core source check, Azure Core 18/18, full Core test, and Core build passed at `f98b09e`. These are integrated repository results, not deployed Azure or live Teams proof.

**OBSERVED LIVE EVIDENCE.** On 2026-09-05, the existing q3 origin returned `/api/health` HTTP 200 for version `1.0.100`, source commit `fbddeaa299d88d2e80ce75b9ca39bfcefa6bc515`, production Teams authentication/bot/outbound, and `/tabs/home/` HTTP 200. `devtunnel show` reported one host connection. This proves point-in-time service continuity only; it does not prove Azure, provider execution, uptime, or a current Teams UI round trip.

**OBSERVED LIVE EVIDENCE.** An explicit read-only `az resource list` against subscription `0e58c3cb-474d-4e70-978a-4939c586f867` and resource group `rg-teamsapp-canary` returned `[]` on 2026-09-05. This proves the target was empty at that observation time; it is not a future deployment guarantee.

**OBSERVED LIVE EVIDENCE.** The non-mutating preflight receipt `/private/tmp/teamsapp-azure-canary-preflight-47ac438-20260905T0120KST.json` (SHA-256 `3a5285742401e1020b14255534b0dd20e2566e47eb792eba68462245bfb0e898`, mode `0600`) binds clean source `47ac4384568c9a5f498e4062ab46a49cfd88a199`, version `1.0.100`, the exact target, registered providers, and Azure Core PASS. ARM what-if returned `23 Create`, `9 Unsupported`, `0` destructive changes, with all nine `unsupportedReason` values retained. The unsupported rows are dynamic role assignments whose IDs depend on managed-identity principal IDs available only during deployment. Their static contracts passed itemized review, while live creation and authorization remain unverified.

### 2.4 Release and pipeline controls already present

**OBSERVED REPOSITORY EVIDENCE.** `azure-pipelines.yml` separates foundation deployment, digest import, Container App deployment, revision verification, approval evidence, traffic promotion, and rollback. `infra/azure/README.md` requires an externally configured Azure DevOps Approval check and immutable GitHub receipt. YAML presence does not prove the environment, check, service connection, OIDC trust, permissions, or run exists.

**OBSERVED REPOSITORY EVIDENCE.** The migration scripts export/hash state, default import to dry-run, create a pre-import snapshot, reconcile stable IDs/counts/content, and use ownership/ETag fences for rollback. The runtime still must prove that every authoritative mutable store has moved before multiple Core replicas are safe.

## 3. Bounded option comparison

The ratings below are **INFERENCE / RECOMMENDATION** based on Sections 1 and 2, not live benchmarks.

| Dimension | Option A — current Dev Tunnel/local | Option B — Azure canary + Storage Queue + one hardened Linux VM | Option C — fuller resilient Azure target |
| --- | --- | --- | --- |
| Purpose | Preserve current behavior and provide rollback continuity | Smallest sufficient Azure production candidate | Multi-origin and replaceable-worker resilience after demand is proven |
| Teams Core | Local Express/React behind q3 Dev Tunnel | One ACA Core replica/revision, explicit probes, `minReplicas: 1` for promotion | Multiple healthy replicas/revisions and potentially multiple regional origins |
| Durable state | Existing local/file compatibility stores | Cosmos DB ETags/partitioned transactions; Storage Queue lease/receipt lifecycle | Cosmos topology sized to measured partition/RU needs; Service Bus Standard only for sessions/transactions/dedup requirements |
| Worker boundary | Local Mac process boundary; FileProvider and host continuity risks remain | One hardened Linux VM with managed identity, owner-only homes, pinned/verified archive, system service | VMSS pools partitioned by trust/provider, health-based repair, automated enrollment/drain/replace |
| Artifacts | Local build outputs | ACR Basic image by digest; private Blob worker/migration artifacts | ACR Standard/Premium only when throughput, private link, zone, or geo requirements justify it |
| Secrets/identity | Local environment/session | Separate managed identities, narrow RBAC, Key Vault references; CLI auth out of band | Same model, stronger network/private endpoint posture where justified |
| Observability | Local logs and public health | Log Analytics + workspace Application Insights + explicit OTel instrumentation/alerts | Cross-region dashboards, SLOs, richer alert routing and retention after cost approval |
| Traffic/rollback | Teams points at q3 | ACA labeled canary; q3 remains untouched until all gates pass | Weighted ACA/Front Door traffic across at least two independently healthy origins |
| Isolation statement | No Azure isolation claim | VM guest-OS controls are available; live hardening remains unverified | VMSS retains VM boundary; AKS/ACA Jobs remain unsuitable for the current strict contract without a new approved isolation design |
| Cost posture | Lowest Azure spend, highest host/preview risk | Smallest paid footprint that meets the current contract | Highest cost and operational complexity |
| Recommendation | Keep only as continuity origin during migration | **Recommended next state** | Defer until explicit scale, RTO/RPO, WAF, or regional requirements are accepted |

### Option A — retain current local/Dev Tunnel

**INFERENCE / RECOMMENDATION.** Keep this option running during Phases 0–4 because it is the only known continuity path. Do not invest in it as the production target: Microsoft gives Dev Tunnels no production SLA, and the local process, workstation availability, mutable local stores, and prior FileProvider behavior remain coupled failure domains.

### Option B — bounded Azure canary

**INFERENCE / RECOMMENDATION.** This option matches the repository's existing contracts and minimizes migration risk. It deliberately preserves Storage Queue and one VM instead of replacing every component at once. Before promotion:

1. Add explicit startup, readiness, and liveness probes against bounded endpoints that verify process/bootstrap readiness without exposing secrets.
2. Set the promoted Core revision to `minReplicas: 1`; keep `maxReplicas: 1` until all authoritative state and coordination are external and horizontally safe.
3. Route traffic to an explicitly verified revision/label rather than blindly trusting `latestRevision`.
4. Preserve the itemized review of all nine what-if `Unsupported` role assignments and re-run it after any identity, role, scope, or template change.
5. Remove or defer the unused Azure Files share/endpoint unless a reviewed runtime consumer is introduced.
6. Preserve Storage Queue and Cosmos-backed idempotency; prove lease heartbeat, duplicate delivery, poison handling, cancellation, restart recovery, and nonempty terminal receipt live.
7. Preserve the q3 service and local state export until Azure reconciliation and same-release Teams verification finish.

### Option C — fuller resilient target

**INFERENCE / RECOMMENDATION.** Adopt individual parts only after a recorded requirement and load/failure evidence:

- use Service Bus Standard sessions when per-aggregate FIFO/exclusive processing is required;
- use Service Bus transactions or duplicate detection only when their documented broker behavior solves an accepted requirement, while retaining application idempotency;
- use VMSS after worker images, authentication enrollment, archive retrieval, draining, heartbeat, and replacement are deterministic;
- use additional ACA replicas only after no authoritative process-local mutation remains;
- add a second region/origin plus Front Door when an RTO/RPO, global latency, or WAF requirement exists;
- upgrade ACR and monitoring retention only against measured throughput, resilience, and compliance needs.

AKS is excluded from this target unless a future design specifically requires Kubernetes and separately proves a hardened workload-isolation model. Container Apps Jobs may be useful for stateless finite batch tasks, but not as a documented replacement for the current persistent strict CLI worker.

## 4. Recommended smallest-sufficient architecture

The following is an **INFERENCE / RECOMMENDATION** and has not been deployed:

```text
Teams chat + personal tab
          |
          v
Azure Container Apps ingress
  Teams Core, one promoted replica
  explicit startup/readiness/liveness probes
          |
          +---- Cosmos DB
          |     scoped durable tasks, ownership fences,
          |     idempotency, checkpoints, terminal receipts
          |
          +---- Storage Queue + poison queue
          |     at-least-once dispatch, lease, heartbeat
          |
          +---- private Blob container
          |     immutable worker and migration artifacts
          |
          +---- HTTPS provider adapters
          |     only explicitly configured remote providers
          |
          v
one hardened Linux VM
  managed identity + narrow RBAC
  verified worker archive
  owner-only provider authentication homes
  Codex/Hermes/Buzz CLI processes only when explicitly configured

Cross-cutting:
  ACR digest-pinned Core image
  Key Vault secret references
  Log Analytics + Application Insights/OpenTelemetry
  GitHub OIDC build/attestation -> Azure DevOps WIF approval/promotion

Continuity origin until acceptance:
  current local server + q3 Dev Tunnel
```

### Component decisions

| Concern | Minimum decision | Deferred decision trigger |
| --- | --- | --- |
| Core compute | ACA multiple-revision mode, one authoritative replica, explicit probes, promoted minimum one | Add replicas only after shared-state completeness and concurrency tests |
| State | Cosmos DB with deliberate partition keys, ETags, idempotency, immutable terminal evidence | Add region/zone strategy after accepted RPO/RTO and data-residency review |
| Dispatch | Existing Storage Queue + poison queue | Service Bus Standard when FIFO sessions, transactions, or broker duplicate window is required |
| Worker | One hardened Linux VM | VMSS after deterministic bootstrap, auth enrollment, drain, replacement, and at least two-worker live proof |
| Artifact storage | Blob for immutable archives; ACR Basic for digest-pinned image | ACR Standard/Premium for measured throughput/private link/geo requirements |
| Shared filesystem | None | Azure Files only for a concrete shared-filesystem consumer |
| Secrets | Managed identities + RBAC + version-pinned Key Vault references | Private endpoints/network hardening after connectivity design and cost approval |
| Telemetry | Log Analytics, workspace App Insights, explicit Node/worker OTel instrumentation and alerts | Longer retention/export/SIEM after volume and compliance review |
| Edge | ACA ingress/custom domain | Front Door only for multiple origins, WAF, or global-routing requirement |
| Delivery | GitHub OIDC, digest + attestation; Azure DevOps WIF environment approval | No alternate deployment authority without a policy change |

## 5. Phased migration

Every phase below is an **INFERENCE / RECOMMENDATION**. A phase may advance only with a durable receipt and evidence from the same source/release identity.

### Phase 0 — freeze identity and preserve service

- Pin baseline and record version `1.0.100`, commit, source/client/server digests, current Teams ZIP digest, and current public runtime identity.
- Keep the local server and q3 Dev Tunnel running; do not change Teams endpoints or package registration.
- Confirm tracked source is clean and locally materialized before any build, avoiding FileProvider fallback ambiguity.
- Re-read the exact Azure tenant, subscription, resource group, region, and existing-resource inventory without inspecting secret values.

### Phase 1 — make the foundation reviewable, still without deployment

- Re-run official Bicep build and exact-target ARM what-if from a clean, pinned commit.
- Reconcile each of the nine current `Unsupported` role assignments with the itemized review; any unexplained resource or scope fails closed.
- Add/prove explicit ACA startup, readiness, and liveness probe definitions.
- Decide and approve the canary/promoted replica policy: `0` may be used only for an accepted cold-start canary; promotion requires `1` under the current availability objective.
- Remove/defer Azure Files if it remains unused.
- Confirm GitHub OIDC/attestation availability and Azure DevOps WIF environment/check configuration by read-back, not YAML inference.
- Produce an itemized estimate and budget alerts; do not assume free entitlement.

### Phase 2 — provision an isolated Azure canary

- Provision only the reviewed resource group and deterministic resource IDs after explicit environment approval.
- Build once in GitHub; verify provenance and exact digests before ACR import.
- Deploy Core to a labeled ACA canary revision by immutable image digest with no Teams traffic change.
- Bootstrap the VM from the private Blob archive only after digest/archive checks; keep authentication material out of artifacts and logs.
- Verify managed-identity/RBAC access and deny unneeded data-plane access.

### Phase 3 — migrate and reconcile state without cutover

- Export the local authoritative ledger to an immutable count/ID/schema/hash manifest.
- Run import dry-run, preserve a pre-import Azure snapshot, then apply only with an explicit fence owner.
- Reconcile counts, stable IDs, tenant ownership, content hashes, idempotency records, checkpoints, and terminal receipts.
- Exercise MP-278 ownership fencing and safe rollback behavior against controlled data. A stale owner or post-import mutation must not be deleted by rollback.

### Phase 4 — prove runtime and worker behavior

- Verify ACA revision readiness, public health, static tab assets, release identity, and telemetry from the same revision.
- Run one authenticated, bounded worker task per enabled provider and capture submission, accepted receipt, heartbeat/checkpoint, nonempty terminal result or explicit error, cancellation, duplicate delivery, and restart recovery.
- Verify MP-279's archive rejection/success paths on the deployed worker without exposing the archive or authentication contents.
- Keep unavailable providers unavailable; do not advertise fixture-only capability.

### Phase 5 — canary and Teams promotion

- Exercise the ACA label URL first; if weighted traffic is used, start with a bounded non-Teams canary and a predeclared rollback threshold.
- Only after state/runtime gates pass, update the existing Teams app through its approved new-version path using the exact same release identity.
- Verify registered/downloaded ZIP, installed version, desktop UI matrix, real bot response, personal tab, and mobile-specific behavior. Desktop evidence does not substitute for iPhone GPS/WebView evidence.
- Change the Teams messaging/tab endpoint only at this stage. Keep q3 available until post-promotion soak and rollback criteria pass.
- Send a Teams completion report only after all required same-release gates pass.

### Phase 6 — resilience expansion, only when triggered

- Move workers to VMSS after deterministic enrollment/replacement is proven.
- Add Core replicas after shared-state completeness is proven under concurrency.
- Move selected queues to Service Bus Standard only for accepted broker-feature requirements.
- Add a second healthy regional origin and Front Door for accepted failover/WAF/global-routing objectives.
- Revisit Cosmos regions, ACR tier, private networking, backup, telemetry retention, and cost against measured production data.

## 6. Rollback and continuity gates

These gates are **INFERENCE / RECOMMENDATION** grounded in the repository release contract and official platform boundaries.

### 6.1 Immutable release identity gate

The following must match before any traffic or Teams endpoint change:

- Git commit and clean source receipt;
- application/manifest version;
- GitHub artifact attestation subject and artifact digest;
- ACR image digest;
- client bundle and server bundle digests;
- Teams ZIP SHA-256 and ZIP-internal manifest;
- ACA revision name/configuration and public runtime identity;
- registered and installed Teams version.

Any mismatch is a rollback/promotion blocker, not a reason to generate another version. Infrastructure-only or research-only changes do not qualify for a Teams version bump.

### 6.2 Runtime promotion gate

- Startup, readiness, and liveness probes pass for the exact revision.
- Public health and tab/assets return from that revision without a local bypass.
- No authoritative mutable store remains process-local before `maxReplicas > 1`.
- Queue age, poison rate, Cosmos throttling/conflicts, worker heartbeat, and missing receipt alerts are active.
- Each enabled provider has one current live round trip; unavailable providers fail closed.

### 6.3 State continuity gate

- Export and pre-import snapshot digests are immutable and retained.
- Import dry-run/apply/reconcile identify the same data set.
- ETag/ownership fencing prevents a rollback from deleting another importer's or post-cutover writes.
- A rollback is record-aware, not a blind account/container replacement. Cross-partition atomicity is not claimed.
- Storage Queue redelivery is expected; durable idempotency and nonempty terminal receipts decide completion.

### 6.4 Traffic rollback gate

- Retain the prior verified ACA revision and its release receipt.
- Shift ACA traffic back to that revision when health, error, latency, queue, or worker thresholds are breached.
- Do not rely on Front Door health with one origin as failover.
- If Azure state has accepted post-cutover writes, restore traffic without blindly restoring old data; use ownership fences, reconciliation, and a forward fix.
- Keep q3 as an explicitly monitored emergency continuity origin until the Azure soak gate closes. Do not stop it merely because provisioning succeeded.

### 6.5 Teams rollback gate

- Retain the prior Teams package and registration evidence.
- A package rollback must be paired with a compatible runtime/revision and state schema; version, package, and runtime cannot be rolled back independently and still be called same-release.
- Revalidate desktop and mobile after any endpoint/package rollback. Previous screenshots are not current evidence.

## 7. Cost and free-tier position

**OFFICIAL CONTRACT.** Azure publishes free monthly quantities and new-account offers, but eligibility and included services depend on the subscription offer, region, resource type, and whether a one-per-subscription entitlement is already used. Cosmos DB free tier is a creation-time, one-account-per-subscription option. The reviewed official pages do not prove this target's entitlement. [Azure: Free services](https://azure.microsoft.com/en-us/pricing/free-services) [Azure: Cosmos DB free tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier)

**LIVE UNVERIFIED.** No pricing calculator estimate, subscription offer read-back, quota check, budget, existing free-tier occupancy check, or billing forecast was performed here.

**INFERENCE / RECOMMENDATION.** The canary should be “free-first” but not “free-assumed.” The continuously running Linux VM and promoted `minReplicas: 1` are deliberate availability costs. ACR, Storage, Key Vault operations, Cosmos overages, Log Analytics ingestion/retention, network egress, public IP/networking, Service Bus Standard, and Front Door can add charges. Provision only after an itemized region-specific estimate and budget alert are approved. The official ACR, Service Bus, Monitor, and Front Door pricing pages describe chargeable meters and do not promise a free entitlement for this account. [Azure: ACR pricing](https://azure.microsoft.com/en-us/pricing/details/container-registry/) [Azure: Service Bus pricing](https://azure.microsoft.com/en-us/pricing/details/service-bus/) [Azure: Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/) [Azure: Front Door pricing](https://azure.microsoft.com/en-us/pricing/details/frontdoor/)

## 8. Exact non-goals

The proposal intentionally does **not**:

- provision, deploy, delete, modify, or inspect an Azure resource;
- read secret values, authentication files, API tokens, connection strings, or MFA/device codes;
- change Teams registration, tenant policy, endpoint, traffic, package, manifest version, or runtime code;
- claim that q3, Azure, a worker, Cosmos, Queue, Key Vault, telemetry, OIDC, an approval, or any provider is live because code/configuration exists;
- replace the TeamsJS tab or Teams bot/Adaptive Card UI with GitHub's `@GitHub` Teams app;
- classify GitHub's Teams cloud agent, Buzz relay/ACP, Hermes A2A, Grok/xAI, and Codex CLI as the same transport or identity;
- promise exactly-once execution, cross-partition Cosmos transactions, zero downtime, free Azure service, VM-level isolation from Container Apps/Jobs, or hostile-tenant isolation from ordinary AKS pods;
- add Front Door to a single origin, Service Bus without a broker-feature requirement, Azure Files without a file-system consumer, AKS without a Kubernetes requirement, or VMSS before workers are replaceable;
- store provider user credentials in an image, archive, Bicep parameter, Key Vault deployment output, pipeline artifact, log, state migration bundle, or Teams package;
- close MP-278 or MP-279 based on repository integration alone;
- bump app `1.0.100` for this research document.

## 9. LIVE UNVERIFIED register

The following remain explicitly **LIVE UNVERIFIED** after this research:

1. q3 bot round trip, Teams UI behavior, and sustained uptime beyond the point-in-time health/tab observation.
2. Azure target inventory after the point-in-time empty-resource observation.
3. Live creation, propagation, and authorization behavior for all nine statically reviewed ARM what-if `Unsupported` role assignments.
4. Azure subscription offer, free-tier eligibility, quotas, region availability, price estimate, and budget alerts.
5. GitHub OIDC federated trust, artifact-attestation plan availability, generated attestation, and consumer verification.
6. Azure DevOps WIF service connection, numeric environment ID, resource-owner approval check, explicit approvers, and pipeline permission read-back.
7. ACR import/pull by digest, Container App revision creation, explicit probes, replica behavior, traffic labels/weights, and rollback.
8. Cosmos partition design under production data, ETag conflicts, transactional limits, RU consumption, backup/restore, and migration reconciliation.
9. Storage Queue lease/heartbeat/redelivery/poison behavior and any Service Bus requirement.
10. VM network isolation, OS hardening, archive verification in situ, owner-only auth homes, managed identity, service lifecycle, cancellation, restart recovery, and replacement.
11. Codex, Hermes, Buzz, Grok, GitHub, or any other provider's authenticated live execution and nonempty terminal receipt.
12. Log Analytics ingestion, Application Insights/OpenTelemetry correlation, dashboards, alerts, retention, and cost.
13. Teams Developer Portal/Admin Center package upload, registered/downloaded ZIP identity, installed desktop version, desktop UI matrix, bot response, tab UI, and mobile GPS/WebView behavior.
14. MP-278 state rollback ownership fencing and MP-279 worker archive verification in a deployed Azure environment.

## Final recommendation

**INFERENCE / RECOMMENDATION.** Approve Option B only as a gated canary design. Preserve the current local/q3 service; retain and refresh the nine-row RBAC review; add probes; choose the nonzero promoted replica floor; remove unused Files; verify supply-chain identities and approval controls; then provision without changing Teams traffic. Promote only after state, worker, runtime, package, desktop, and mobile evidence are bound to one release identity. Defer Service Bus, VMSS, Front Door, multi-region Cosmos, premium ACR, and AKS until an accepted requirement proves the smaller design insufficient.

That sequence uses Azure where it directly closes a current failure boundary while avoiding an unverified “use every Azure service” architecture that would increase cost and rollback complexity without improving the present acceptance evidence.
