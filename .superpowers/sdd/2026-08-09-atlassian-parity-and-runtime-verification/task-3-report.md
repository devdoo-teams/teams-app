# Task 3 report — Work Hub parity domain

## Status

The Task 3 server-side work-item domain is implemented and locally verified. It is intentionally not wired into `src/server/index.ts`, chat commands, Adaptive Cards, or client UI; those integrations are controller/UI work owned by the later integration tasks.

## API design

### Scope and ownership

Every service call carries a `WorkItemScope`:

```ts
{
  tenantId: string;
  requesterId: string;
  conversationId: string;
}
```

Stored items are owned by the tenant and conversation and record their creator. Reads require the current user to be the creator, assignee, or watcher. Edit, status transition, and assignment require creator or assignee ownership. Comments and follow/unfollow require item visibility, while a user in the same tenant/conversation may follow an otherwise unassigned item. Cross-tenant and cross-conversation IDs resolve as not found.

`requesterId` is used instead of a second user-id vocabulary so the future controller can map directly to the existing scoped AgentJob contract.

### Work-item model

`src/shared/work-item.ts` defines:

- Generic statuses: `backlog`, `todo`, `open`, `in_progress`, `blocked`, `done`, and `cancelled`.
- Priority, title/description, labels, due date, assignee, watcher IDs, comments, timestamps, and immutable item IDs.
- Stable deep-link metadata: `/tabs/home/?workItemId=<id>` with `kind`, `itemId`, `path`, and `href`.
- Optional `codexJobLink` containing only a Codex job ID and relation (`created-from`, `supports`, or `blocked-by`). No AgentJob is embedded or executed by this domain.
- Mutation input/query types and the idempotency-conflict error contract.

### Service operations

`WorkItemService` exposes:

- `create`, `edit`, `transition`, `assign`, `comment`, `watch`, and `unwatch`.
- `get`, `search`, `recent`, `assigned`, and `calendar` queries.
- Search filters for text, status, assignee, watcher, labels, due-date range, and limit.
- Inclusive calendar due-date ranges ordered by due date.
- Required `mutationKey` on every mutation. A key is scoped to tenant, requester, and conversation; a retry with the same normalized operation/payload replays the original result, while a different payload raises `WorkItemIdempotencyConflictError`.

### Persistence

`WorkItemStore` persists versioned JSON containing items and mutation results through the repository’s atomic JSON store. Mutations are serialized in-process, mutation records survive restart, item/deep-link data is validated on load, and failed transactions restore in-memory state.

## Changed files

Only the requested new files were added:

- `src/shared/work-item.ts` — shared types, constants, deep-link builder, and idempotency error.
- `src/server/work-item-store.ts` — scoped persistent store, ownership checks, transaction context, and idempotency records.
- `src/server/work-item-service.ts` — normalized domain API, validation, queries, permissions, and mutations.
- `scripts/work-item-parity-test.ts` — focused executable parity test.
- `.superpowers/sdd/2026-08-09-atlassian-parity-and-runtime-verification/task-3-report.md` — this report.

No package script was added because the focused test runs directly with the existing `tsx` dependency. Existing controller, GenUI, client, manifest, release, and instruction files were not modified by this task.

## Tests and outputs

TDD red phase was observed before implementation:

```text
ERR_MODULE_NOT_FOUND: Cannot find module .../src/server/work-item-service.js
exit_code=1
```

Final focused test:

```text
$ npx tsx scripts/work-item-parity-test.ts
PASS: Work Hub parity domain covers scoped CRUD, transitions, collaboration, queries, deep links, Codex linkage, and persistent idempotency
exit_code=0
```

Final release typecheck:

```text
$ npm run typecheck
> tsc --noEmit -p tsconfig.release.json
exit_code=0
```

The focused test covers create retry/conflict, tenant/conversation isolation, assignment and assigned view, edit, status transition, comments and duplicate-comment retry, watch/unwatch, search/filter, recent view, calendar range, invalid input, stable deep links, Codex linkage metadata, persistence restart, and replay of a persisted create mutation.

## Concerns and follow-up

- Chat command routing, actionable cards, card result handling, and client rendering are intentionally deferred; this task provides the controller-ready service contract only.
- No Teams desktop/mobile, public HTTPS, portal, or external-service verification was performed, per the bounded task scope and the instruction not to use external credentials/UI.
- The store is a local versioned JSON implementation with a single-process mutation queue. A multi-instance deployment should move the same contract to a transactional shared datastore before relying on cross-process idempotency.
- Status values are validated, but no product-specific transition graph is imposed; the later controller/product policy can restrict allowed transitions without changing storage or query contracts.
