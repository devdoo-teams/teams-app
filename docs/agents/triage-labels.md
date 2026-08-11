# Triage Labels

The Matt Pocock engineering skills use five canonical triage roles. This repository keeps the
default label strings.

| Canonical role | Jira label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer evaluation is required |
| `needs-info` | `needs-info` | Waiting for reporter information |
| `ready-for-agent` | `ready-for-agent` | Fully specified and safe for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires a human-owned action or decision |
| `wontfix` | `wontfix` | Intentionally not actioned |

When a skill names a canonical role, use the matching Jira label only after Jira confirms that the
label exists. A missing label is `JIRA_SYNC_UNVERIFIED`, not permission to create it implicitly.
