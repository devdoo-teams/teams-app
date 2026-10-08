---
type: "Concept"
sources:
  - resource: "https://www.typescriptlang.org/tsconfig/#include"
    title: "TypeScript TSConfig include reference"
    location: "include anchor, observed HTML lines304–306 on2026-10-08; HTML lines are not stable"
  - resource: "https://www.typescriptlang.org/docs/handbook/2/objects.html#readonlyarray"
    title: "TypeScript Handbook ReadonlyArray"
    location: "The ReadonlyArray Type anchor; observed2026-10-08"
  - resource: "https://github.com/microsoft/teams.ts/blob/515f5c331a19e5cab7ec18e5eac6865c1a1d35fe/packages/api/src/clients/conversation/activity.ts"
    title: "Microsoft Teams SDK2.0.15 conversation activity client"
    location: "Pinned source lines14–21 and66–79; observed2026-10-08"
  - resource: "https://github.com/microsoft/teams.ts/blob/515f5c331a19e5cab7ec18e5eac6865c1a1d35fe/packages/api/src/activities/utils/to-activity-params.ts"
    title: "Microsoft Teams SDK2.0.15 outbound normalization"
    location: "Pinned source lines18–36; observed2026-10-08"
  - resource: "https://github.com/microsoft/teams.ts/blob/515f5c331a19e5cab7ec18e5eac6865c1a1d35fe/packages/api/src/activities/message/message.ts"
    title: "Microsoft Teams SDK2.0.15 outbound message inputs"
    location: "Pinned source lines121–158 and193–231; observed2026-10-08"
generated: { by: "process:codex", at: "2026-10-08T11:34:00Z" }
verified: { by: "process:official-source-clean-baseline-and-fixtures", at: "2026-10-08T11:34:00Z" }
status: "UNVERIFIED"
stale_after: "2026-10-15T11:34:00Z"
---

# Strict source typecheck and preserved user files

## OFFICIAL CONTRACT

TypeScript include globs inspect matching filesystem paths regardless of Git tracking. The unchanged release configuration includes all source TS/TSX with `strict:true` and `noEmit:true`. Installed TypeScript5.9.3 help confirms `--noEmit` and `-p/--project`; Node24.13.1 and Teams API2.0.15 are the observed local tools. No exclusions, declaration stubs, dependency versions or strictness were changed.

The SDK accepts modern outbound message inputs. Readonly caller attachments require a separate mutable array. A typed plain payload retains existing account/conversation extensions and remains attachment-only. Legacy `MessageActivity` normalization would strip these extensions and add empty text, so the repair preserves plain-object transport.

## OBSERVED EVIDENCE

`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.release.json` produced11 diagnostics at clean tracked commit `c853dbc4ec90086cb45b4cd284fd55dda585377a`:8 in preserved untracked `genui-response 2.ts`/`index 2.ts`, and3 in tracked `src/server/index.ts`. An exact clean Git archive with the same compiler/configuration/dependencies independently produced only the3 tracked errors. User copies were neither modified nor excluded. All11 untracked paths and hashes are retained in `/tmp/teams-typecheck-fix-20261008/baseline-source-receipt.json`.

* [MP-352](https://devdoo.atlassian.net/browse/MP-352), key `teams-core:bug:release-typecheck-capability-option`: `src/server/index.ts:1177` checks optional `coreProviderCapabilities` itself before passing it to the verified formatter.
* [MP-353](https://devdoo.atlassian.net/browse/MP-353), key `teams-core:bug:release-typecheck-notification-job-id`: `src/server/index.ts:2608` uses the loaded owner's `job.id`, matching `AgentNotification`'s declared `job`. The old runtime spread could retain `jobId`; the compiler error alone does not prove failed runtime delivery.
* [MP-354](https://devdoo.atlassian.net/browse/MP-354), key `teams-core:bug:release-typecheck-sdk-readonly-attachments`: `src/server/index.ts:4307` types the plain payload as `IMessageActivityInput & Pick<IMessageActivity, 'from' | 'conversation'>`, copies only its array, and calls the same scoped SDK update. Fixing readonly alone exposed an excess-property error; that intermediate failure remains recorded.
* [MP-355](https://devdoo.atlassian.net/browse/MP-355), key `teams-core:improvement:ci-strict-release-typecheck`: `.github/workflows/core-ci.yml:38` registers existing `npm run typecheck` in clean Core CI. `scripts/ci-workflow-contract-test.mjs:29` guards its registration. Jira type is the supported planned Core `Task`; the rejected `Improvement` creation was not considered success.

## FIXTURE / RED AND GREEN

`original-worktree-RED.log` and `clean-baseline-RED.log` preserve the original failures. The baseline archive is immutable. An in-memory overlay of only repaired `index.ts`, compiling all152 clean-baseline root files with unchanged strict settings, has0 diagnostics (`strict-overlay-typed-payload-GREEN.log`). The CI guard failed before registering the command and passed afterward (`semantic-ci-registration-RED.log` / `semantic-ci-registration-GREEN.log`).

`sdk-transport-contract-GREEN.log` executes the actual production payload initializer through the installed SDK update with a synthetic in-memory HTTP transport. It checks the scoped path, account/conversation metadata, carousel layout and attachment contents, no top-level text, a separate attachment array, and unchanged frozen input. Real network/provider requests:0. Six related fixtures passed. Final clean commit-bound Core/default/build/package/full semantic checks remain pending at this source snapshot and require separate receipts before candidate validation.

## INFERENCE / LIVE RESULT

The8 copy diagnostics remain an original-worktree blocker pending user authorization to edit their files. Independent clean release/CI GREEN must not be described as original-worktree semantic GREEN. Public122, the validated123 package/evidence, credentials, executable pin/trust and CLI installation remain outside this repair. [MP-350](https://devdoo.atlassian.net/browse/MP-350) pin mismatch and catalog/provider/desktop/mobile gates remain `UNVERIFIED`. No Jira Done, release loop completion or Teams completion message follows from these fixtures.
