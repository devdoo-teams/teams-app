# MP-117 — Teams Adaptive Card ActionSet compatibility

## Scope

- Replaced only command `Action.Execute` values in `src/server/genui-teams.ts` that were emitted in the card's top-level `actions` collection.
- Left attachment-only message activities, deterministic action payloads, non-command `Action.Submit`, `Action.OpenUrl`, and `Action.ShowCard` paths unchanged.

## Contract basis

Microsoft's [Universal Action Model](https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/universal-action-model) states that `Action.Execute` was introduced in Adaptive Cards 1.4. For older Teams clients it recommends an `Action.Submit` fallback and strongly recommends wrapping `Action.Execute` in an `ActionSet`, because older clients can miss fallback handling when it is not wrapped.

## Implemented shape

- Command Execute actions are collected into one body-level `{ type: "ActionSet", actions: [...] }` element.
- Each Execute action retains its `verb` and exact five-field GenUI payload.
- Each fallback is an official `Action.Submit` action object with the same title and payload as its Execute action.
- Non-Execute actions remain in the card's top-level `actions` collection.

## Verification evidence

- `npm run test:genui-contract` — PASS. The contract asserts the exact ActionSet shape, no top-level Execute actions for command-only cards, fallback title, and fallback payload.
- `npm run test:runtime` — BLOCKED before the MP-117 checks. It exited at `scripts/runtime-test.mjs:975` on the pre-existing natural-language ACK task-id assertion; the MP-117 runtime ActionSet checks start around line 1054. No unrelated runtime change was made.

## Deliberate exclusions

No live Teams validation, deployment, browser automation, release work, frontend work, A2A, Bitbucket, GHCP, Jira, or baseline changes were performed.
