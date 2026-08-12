# Issue Tracker

This repository tracks actionable Teams Core work in Jira Cloud. Read
[`docs/jira-issue-tracking-workflow.md`](../jira-issue-tracking-workflow.md) before creating,
updating, linking, or transitioning an issue.

## Target

- Site: `https://devdoo.atlassian.net`
- Project: `MP`
- Default assignee: the currently signed-in Jira user (`self`)
- Issue types: reproducible defect or release blocker=`Bug`; planned Core slice=`Task`;
  non-blocking optimization=`Improvement`
- Git hosting source of truth: `origin=https://github.com/devdoo-teams/teams-app.git`. Treat
  Bitbucket as an optional additional remote only after an authenticated Bitbucket view confirms
  the workspace, repository slug, visibility, and clone URL. If a pull request is requested, use
  the configured GitHub `origin` workflow unless the repository configuration is explicitly
  changed. Do not infer or add Bitbucket before that confirmation.

## Live writes

Use an existing authenticated Jira connector or browser session. Before each write, resolve the
signed-in account, available issue types, labels, link types, and workflow transitions from Jira.
Never store or request passwords, API tokens, device codes, bearer tokens, or account IDs.

Search for the idempotency key before creating an issue:

```text
teams-core:<issue-kind>:<stable-test-or-row-id>:<source-commit>
```

If Jira cannot confirm a write, preserve the payload in the local evidence ledger and report
`JIRA_SYNC_UNVERIFIED`. A local payload or browser form is not a Jira issue.

## Triage operations

Use the canonical-to-tracker mapping in [`docs/agents/triage-labels.md`](triage-labels.md). Each
issue carries one triage state label. Apply only labels that Jira confirms exist; do not create or
rename project labels implicitly.

## Wayfinding operations

- Create the map as a Jira `Task` labelled `wayfinder:map`.
- Create each decision ticket before wiring relationships. Use `wayfinder:research`,
  `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` for its type.
- Use Jira's native parent/child and `blocks` links when the current project exposes them. If a
  relationship is unavailable, place named issue links in `Parent` and `Blocked by` sections.
- Claim a frontier ticket by assigning it to the signed-in user before work starts.
- Resolve one non-research ticket per session. Post the resolution as a comment, use an allowed
  Jira transition to close it, then append only a linked one-line gist to the map.
- Query the frontier as open, unclaimed child tickets whose blocking issues are closed. Never
  infer frontier state from a local plan when Jira is reachable.
