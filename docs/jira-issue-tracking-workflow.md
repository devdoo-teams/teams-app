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
