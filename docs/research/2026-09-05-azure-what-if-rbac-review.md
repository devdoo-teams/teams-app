# Azure canary what-if RBAC review

Checked: 2026-09-05

Source: `47ac4384568c9a5f498e4062ab46a49cfd88a199` (clean, app version `1.0.100`)

Target: subscription `0e58c3cb-474d-4e70-978a-4939c586f867`, resource group `rg-teamsapp-canary`, region `koreacentral`

Receipt: `/private/tmp/teamsapp-azure-canary-preflight-47ac438-20260905T0120KST.json`

Receipt SHA-256: `3a5285742401e1020b14255534b0dd20e2566e47eb792eba68462245bfb0e898`

## Verdict

`STATIC_CONTRACT_PASS / LIVE_RBAC_UNVERIFIED`

The non-mutating preflight returned `REVIEW_REQUIRED`: `23 Create`, `9 Unsupported`, and `0` destructive changes. All nine unsupported results retained a non-empty ARM `unsupportedReason`. Every row is a role assignment whose resource identifier depends on a new managed identity's runtime `principalId`; ARM reports that the resource ID or API version cannot be calculated until deployment. Static inspection ties each expression to the exact target resource, expected managed identity, deterministic role definition, and narrow assignment scope.

This review resolves the source-level meaning of the nine rows. It does not prove role creation, propagation, token acquisition, or successful data-plane authorization. The exact Azure target was empty when `az resource list` was read, so those checks remain live deployment gates.

## Official contracts used

- ARM what-if can return `Unsupported` when resource IDs or expressions cannot be evaluated before deployment; unsupported is not itself a safe or destructive verdict: [ARM deployment what-if](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if).
- A role assignment binds a principal, role definition, and scope; Bicep can scope the extension resource to a symbolic resource: [role assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments) and [Bicep roleAssignments reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.authorization/roleassignments).
- Resource-group `AssignableScopes` permits a custom role to be assigned at a narrower resource scope: [role definitions](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-definitions).
- Queue metadata, send, receive/delete, peek, and update operations have distinct Entra permissions: [authorize Azure Storage operations](https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-azure-active-directory). JavaScript `QueueClient.getProperties()` reads the specified queue's metadata and properties: [Queue client for JavaScript](https://learn.microsoft.com/en-us/azure/storage/queues/storage-nodejs-how-to-use-queues).
- Built-in role identifiers and permissions are defined by Azure: [Storage roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage), [Container roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/containers), and [Key Vault RBAC](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide).
- Cosmos DB built-in data contributor ID `00000000-0000-0000-0000-000000000002` and relative container scope `/dbs/<db>/colls/<container>` are documented data-plane contracts: [Cosmos data-plane security](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/reference-data-plane-security) and [Cosmos RBAC connection guide](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-connect-role-based-access-control).

## Itemized review

| # | Principal | Exact assignment scope | Role and required operation | Source | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | Core app managed identity | ACR registry `teamsappgoictvxm` | Built-in `AcrPull` `7f951dda-4ed3-4680-a7ca-43fe172d538d`; pull the digest-pinned Core image | `infra/azure/modules/acr.bicep:5,25-32` | PASS — correct built-in ID and registry scope; live pull unverified |
| 2 | Core app managed identity | Queue `agent-dispatch` | Built-in Storage Queue Data Message Sender `c6a89b2d-59bc-44d0-9896-0f6e12d7b80a`; `messages/add/action` only | `infra/azure/modules/storage.bicep:6,118-126` | PASS — enqueue is distinct from receive/read; live send unverified |
| 3 | Core app managed identity | Queue `agent-dispatch` | Custom metadata reader `387d80c8-3e3e-5c7c-86ec-d959ac45d20e`; `queues/read` only for non-mutating `QueueClient.getProperties()` readiness | `infra/azure/modules/storage.bicep:9-29,128-136` | PASS — RG-assignable custom role, queue-scoped assignment, no message DataAction; live metadata read unverified |
| 4 | Worker managed identity | Queue `agent-dispatch` | Custom worker lease role `d02d8815-dbbe-5546-86c9-f68d5486d24f`; message read, process/delete, and write/update visibility | `infra/azure/modules/storage.bicep:31-53,138-146` | PASS — permissions match receive/peek/delete/lease-renew behavior and exclude send; live lease cycle unverified |
| 5 | Worker managed identity | Blob container `worker-artifacts` | Built-in Storage Blob Data Reader `2a2b9908-6ea1-4ae2-8e65-a410df84e7d1`; read verified immutable worker archive | `infra/azure/modules/storage.bicep:94-102,148-156` | PASS — container-scoped read; live archive fetch unverified |
| 6 | Worker managed identity | Queue `agent-dispatch-poison` | Built-in Storage Queue Data Message Sender `c6a89b2d-59bc-44d0-9896-0f6e12d7b80a`; add poison record | `infra/azure/modules/storage.bicep:83-88,158-166` | PASS — poison send is isolated from dispatch receive rights; live poison path unverified |
| 7 | Core app managed identity | Cosmos container `/dbs/teamsapp/colls/runtime-records` | Cosmos DB Built-in Data Contributor `00000000-0000-0000-0000-000000000002`; runtime CRUD/CAS data plane | `infra/azure/modules/cosmos.bicep:13,71-78` | PASS — documented role and most-granular relative container scope; live SDK authorization unverified |
| 8 | Worker managed identity | Cosmos container `/dbs/teamsapp/colls/runtime-records` | Same Cosmos data contributor role; worker dispatch/checkpoint/receipt CRUD/CAS | `infra/azure/modules/cosmos.bicep:13,80-87` | PASS — separate principal at the same container scope; live worker authorization unverified |
| 9 | Core app managed identity | Key Vault `teamsapp-goictvxm` | Built-in Key Vault Secrets User `4633458b-17de-408a-b874-0445c86b69e6`; read secret contents without managing them | `infra/azure/modules/key-vault.bicep:8,50-58` | PASS — documented role and vault scope; live secret reference unverified |

## Boundaries and follow-up

- The app and worker identities are separate in every assignment; no row grants the worker ACR pull, Key Vault secret read, Queue send to the dispatch queue, or Azure Files access.
- No row grants the Core app queue receive/delete rights or worker archive write rights.
- The custom role definitions are deterministic and resource-group assignable; their assignments are narrowed to one queue.
- The current template still creates an unused Azure Files share and stores a non-secret Files endpoint in Key Vault. That is a separate minimal-architecture improvement tracked as `MP-282`; it does not invalidate the nine role bindings reviewed here.
- Any change to a principal, role permission, assignment scope, generated name, Bicep API version, or target requires a fresh what-if and a fresh itemized review. Deployment must stop if a new unsupported row cannot be mapped exactly.
- Before promotion, live evidence must cover role creation/propagation and the actual ACR pull, Queue metadata/send/lease/poison operations, Blob archive read, Cosmos CRUD/ETag conflict, and Key Vault reference from the same release identity.
