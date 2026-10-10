---
type: "Concept"
sources:
  - resource: "https://git-scm.com/docs/git-push"
    title: "Git push"
    location: "Explicit refspec and fast-forward rules; observed lines 294–314 on 2026-10-10; HTML positions may change"
  - resource: "https://git-scm.com/docs/git-ls-remote"
    title: "Git remote reference read-back"
    location: "--refs and output identity; observed lines 230–231 and 269–275 on 2026-10-10; HTML positions may change"
  - resource: "https://cli.github.com/manual/gh_run_list"
    title: "GitHub CLI run list"
    location: "--commit, --branch, --event and --json; observed lines 547–570 on 2026-10-10; HTML positions may change"
  - resource: "https://docs.github.com/en/rest/actions/workflow-runs"
    title: "GitHub Actions workflow runs"
    location: "List workflow runs: Actions read and head_sha filter; observed lines 88–118 on 2026-10-10; HTML positions may change"
  - resource: "https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows"
    title: "GitHub Actions push event"
    location: "Push tip commit and branch/tag filters; observed lines 858–909 on 2026-10-10; HTML positions may change"
  - resource: "https://docs.copilotkit.ai/reference/components/CopilotChatInput"
    title: "CopilotKit controlled composer and public slots"
    location: "value/onChange/onSubmitMessage and sendButton slot; observed lines 29–65, 113–127, 371–377 on 2026-10-10; HTML positions may change"
generated: { by: "process:codex", at: "2026-10-10T05:56:32Z" }
verified: { by: "process:installed-help-and-synthetic-regressions", at: "2026-10-10T05:56:32Z" }
status: "CANDIDATE_REMOTE_CI_PENDING_LIVE_UNVERIFIED"
stale_after: "2026-10-17T05:56:32Z"
---

# Three-view candidate, independent review and exact-commit CI

## OFFICIAL CONTRACT

Git 2.54.0 (Apple Git-157) installed help supports a fully specified source/destination refspec and `--no-follow-tags`. A normal fast-forward push to the existing main branch does not authorize tags, forced history changes or deployment. `git ls-remote --refs` reads actual remote object identities. GitHub CLI 2.87.2 installed `run list --help` supports `--commit`, `--branch`, `--event`, and selected JSON fields. CI acceptance requires the exact pushed SHA and completed conclusions; a push response alone is insufficient.

CopilotKit 1.66.2 exposes controlled input and public component slots. Its installed composer clears input immediately after invoking submit (`node_modules/@copilotkit/react-core/dist/v2/index.umd.js:918`). The event fixture captures the actual SDK button slot and invokes that handler; SSR/event assertions do not establish browser layout or visual acceptance.

## OBSERVED EVIDENCE

Independent read-only review of base `1c8548b6d6902fd4c5f0b4617dbe01206be5b893` to `4fec77447dab20398f9bc4f047888f4a81f7e91e` found two defects. [MP-380](https://devdoo.atlassian.net/browse/MP-380) preserves confirmed-rejected drafts and displays uncertain submissions read-only without replay (`src/client/copilot-conversation-controller.ts:18`). [MP-381](https://devdoo.atlassian.net/browse/MP-381) renders existing receipt facts once (`src/client/ExecutionPresentationCard.tsx:27`). Correction commit: `f421d93`.

The workflow adds a separate explicitly built SDK verification job (`.github/workflows/core-ci.yml:189`). Main-push CI verifies without publishing; the artifact job still requires manual dispatch. Image publication still requires a tag or manual dispatch. Azure DevOps has `trigger: none` and `pr: none` (`azure-pipelines.yml:1`). No workflow dispatch, catalog upload or public runtime replacement is included in this candidate preparation.

## FIXTURE

`/tmp/teams-three-view-release136-20261010/{composer,receipts,sdk-ci}-RED.log` retain failures. Matching GREEN logs cover actual SDK event handling, owner-history clearing, uncertain delivery, timeout/disposal, one-send guards, receipt uniqueness and SDK CI registration. Earlier 72-case evidence is synthetic React SSR across three modes, mandatory statuses and detail combinations; it contains no screenshots or direct visual review.

## LIVE RESULT

Candidate 1.0.136 package, committed builds, remote SHA and CI read-back are pending. Existing public 1.0.135 remains separate. Only connected ego-browser space 2 is delegated to the user; no independently controlled preview surface is exposed. No claim, takeover, page navigation or capture occurred. Native Computer Use `node_repl`/`@oai/sky` tools are not callable in this executor. Screen comparison, native desktop, mobile and exhaustive live UI acceptance remain unverified; these defects and MP-369 must remain open until same-release live evidence exists.
