# Jira issue tracking workflow for Teams Core

## Scope

Jira Cloud is the project-tracking system for this repository. It is not a runtime dependency of the Teams app and it does not change the rule that Teams Core must work with the deterministic engine and the available Codex CLI path.

The configured Jira target is `https://devdoo.atlassian.net`, project key `MP` (`My Project`), with the default assignee set to the currently signed-in user. The signed-in Jira/Teams account remains the source of truth for the assignee account ID; the repository never guesses or stores that ID.

## What becomes a Jira issue

Create or update one Jira issue for each distinct, actionable item:

- a reproducible failing test or runtime check;
- a release blocker such as stale package identity, upload failure, authentication mismatch, or missing same-release evidence;
- a user-visible defect confirmed in Teams desktop or mobile;
- a planned Core slice that has a clear acceptance test.

Do not create issues for every progress message, every retry, or an optional provider that is intentionally `N/A`.

Recommended labels:

- `teams-core`
- `api-free`
- `runtime-verification`
- `release`
- `desktop`, `mobile`, or `portal`
- `codex-cli` or `ghcp-cli`

Optional CopilotKit/OpenAI/MCP work uses separate labels and never blocks a Teams Core issue.

## Required Jira issue fields

Every created issue must contain:

1. concise symptom and expected behavior;
2. reproduction command or exact Teams action;
3. observed result and classification (`BUG`, `BLOCKED`, `N/A`, or `PASS`);
4. repository path and current Git commit;
5. app/package version and ZIP SHA when a release is involved;
6. evidence IDs, tab/window identity, and screenshot/accessibility/runtime evidence state;
7. owner, next action, and a specific acceptance condition.

Never put passwords, access tokens, device codes, API keys, or raw bearer tokens in Jira. Screenshots must be sanitized and must not be treated as proof unless their release identity matches the current package.

## Status mapping

| Local state | Jira state | Rule |
| --- | --- | --- |
| planned | To Do | acceptance test is defined |
| running | In Progress | a bounded process or implementation is active |
| blocked | Blocked or In Progress + blocker label | reason and owner are explicit |
| fixed, not runtime-proven | In Progress | code evidence alone cannot close it |
| runtime-proven | Done | source, package, public runtime, and required UI evidence agree |
| optional and unavailable | Won't Do / N/A convention | never counted as a Core failure |

## Idempotent update key

The automation key is:

```text
teams-core:<issue-kind>:<stable-test-or-row-id>:<source-commit>
```

Store it in a Jira label or a dedicated issue property if the project permits it. Before creating an issue, search for the same key. On a match, add a short comment or update the existing issue instead of creating a duplicate.

## Workflow checkpoints

At the end of each smallest vertical slice:

1. run the focused source and runtime tests;
2. create/update the matching Jira issue with the actual result;
3. commit the source and test changes;
4. update the Jira issue with the commit hash;
5. only after package/public/desktop/mobile evidence passes, transition the issue to Done;
6. send the Teams completion message with the Jira issue link.

If a process exceeds its bounded checkpoint, record the last observed state and create/update a blocker issue. Do not leave a generic “checking repository” message running without a next action.

## Verified Jira target

The user supplied the following values in the existing signed-in Jira Cloud/Teams session:

- Jira site URL: `https://devdoo.atlassian.net`;
- project key: `MP`;
- default assignee: the current signed-in user (`self`), resolved by Jira at creation time;
- issue type policy: `Bug` for reproducible defects/blockers, `Task` for planned Core slices, and `Improvement` for non-blocking optimization work;
- workflow transition names: discover from the existing project workflow at issue-creation/update time; never invent transition names;
- grouping: independent issues by default, with parent/Epic links only when the user explicitly asks for them.

Authentication must remain in the existing Jira/Teams UI. Do not request or store a password, API token, or device code in chat or Git. Live issue creation still requires a Jira connector or an already authenticated browser action; repository configuration alone must not claim that a Jira issue was created.

For every future live write, first resolve the current signed-in user's Jira account ID and the allowed issue type/status transitions from Jira, then use the idempotency key described above. If the Jira surface cannot be reached, record the issue payload in the local evidence ledger and report `JIRA_SYNC_UNVERIFIED` rather than retrying blindly.

## Current release evidence snapshot

The current Core release is `1.0.25` at Git commit `a58fd21`. The locally generated package was verified with SHA-256 `23b7a1c19f96dccc4a1526cf32be59b43ffde406b49b44bee335041d1bdb7274`. The same app ID was updated through the authenticated Teams Developer CLI and then read back as portal version `1.0.25`; the downloaded portal manifest contains `geolocation`, the current public tab URL, and `token.botframework.com`. The public runtime also reports `version=1.0.25`, `environment=production`, `auth=teams-authenticated`, `bot=teams-sdk`, and `outbound=teams-sdk`.

The remaining release item is a real installed-client/UI evidence blocker, not a source or public-runtime failure:

- idempotency key: `teams-core:release-blocker:installed-ui-evidence:a58fd21`;
- issue type: `Bug` (only when the live Jira write is available);
- default assignee: current Jira user (`self`);
- local state: `BLOCKED` until installed version, desktop screenshots/accessibility evidence, and mobile user confirmation are captured for this exact release;
- next action: reuse the existing Teams desktop/mobile app surfaces, refresh/reopen the existing app installation if needed, and capture the version plus each required UI branch. Do not close the issue from CLI, portal, or HTTP evidence alone.

The Teams CLI diagnostic currently reports one SSO “fail” and three warnings. They are recorded as a diagnostic discrepancy pending runtime reproduction, not silently “fixed”: [Microsoft’s Teams SSO guidance](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/bot-sso-manifest) documents `api://<fully-qualified-domain>/botid-<bot-client-id>` for a bot+tab app and the exact `https://token.botframework.com` valid domain. Therefore the CLI’s expectation of a host-less `api://botid-...` resource or `*.botframework.com` wildcard is not sufficient evidence to change the manifest. If a real SSO failure is observed in Teams, open a separate `Bug` with the exact client, token, and manifest evidence (without secrets).

## Current local Jira payload ledger

The prepared payloads are stored in [`docs/jira-pending-issues.json`](./jira-pending-issues.json). They are not Jira issue keys: no live create/update is claimed until an authenticated Jira connector or an already-open Jira tab returns a successful response. The ledger intentionally contains no password, token, device code, or bearer token.
