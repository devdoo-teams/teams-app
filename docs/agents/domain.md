# Domain Docs

This is a single-context Teams Core repository. Domain documents are consumed lazily and never
replace the release gates in `AGENTS.md`.

## Before exploring

1. Read `AGENTS.md` for mandatory repository and release behavior.
2. Read `CONTEXT.md` when it exists and use its canonical vocabulary.
3. Read applicable ADRs under `docs/adr/` when that directory exists.
4. For Core product boundaries, read `docs/api-free-teams-roadmap.md`.
5. For release, evidence, or Jira work, read `docs/teams-release-workflow.md`,
   `docs/teams-ui-verification-matrix.md`, and `docs/jira-issue-tracking-workflow.md` as applicable.

If `CONTEXT.md` or `docs/adr/` does not exist, proceed silently. Create `CONTEXT.md` only when a
domain term is actually resolved, and create an ADR only for a hard-to-reverse, surprising decision
that resulted from a real trade-off.
## Canonical release vocabulary

- **Teams Core**: the API-free Microsoft Teams SDK, React tab, deterministic server, Bot, and
  Adaptive Card product path required for completion.
- **Release identity**: one source commit, app version, manifest, package SHA-256, public runtime,
  and evidence run that must agree.
- **Evidence gate**: a machine or user-visible observation required before a release state can
  advance.
- **MOBILE_UNVERIFIED**: mobile-only behavior that desktop, HTTP, CLI, or test evidence cannot
  prove.
