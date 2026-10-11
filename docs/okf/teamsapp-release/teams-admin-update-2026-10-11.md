---
type: "Reference"
title: "Teams Admin Center existing-app update contract"
description: "Current primary-source and local-page evidence for updating the existing custom Teams app package and verifying its identity."
resource: /teams-admin-update-2026-10-11.md
tags: [official-contract, teams, app-update, release]
generated:
  by: "process:teams-admin-update-contract-refresh/1"
  at: "2026-10-11T06:17:51Z"
verified:
  by: "process:teams-release-update/1"
  at: "2026-10-11T06:17:51Z"
status: stable
stale_after: "2026-10-18T06:17:51Z"
sources:
  - id: teams-admin-existing-app-update
    resource: "https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings"
    title: "Manage custom app policies and settings - Microsoft Teams"
    location: "Update a custom app using Teams admin center, lines 78-85; observed 2026-10-11"
  - id: teams-installed-app-update
    resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload"
    title: "Upload your custom app - Teams"
    location: "Update your app and installed-context update flow, lines 100-122; observed 2026-10-11"
  - id: github-actions-events
    resource: "https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax"
    title: "Workflow syntax for GitHub Actions"
    location: "Push trigger examples and workflow_dispatch default-branch requirement, lines 237-250 and 758-762; observed 2026-10-11"
---

# Teams Admin Center existing-app update contract

## OFFICIAL CONTRACT

Microsoft's Teams Admin Center documentation says an existing custom app in the organization catalog is updated by opening that app's details page and selecting **Upload file**. The documented new-app upload route is separate. When a new version is published, policies from the previous version continue to apply. A user may also submit an updated app for admin approval. [Source: Manage custom app policies and settings, sections “Upload a custom app using Teams admin center” and “Update a custom app using Teams admin center,” lines 64-85.](https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings)

Microsoft's Teams client documentation says an installed app update requires user consent in one context and then applies across related contexts where the app is installed. [Source: Upload your custom app, “Update your app,” lines 100-122.](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload)

GitHub Actions documentation supports workflows triggered on `push`; a `workflow_dispatch` run is accepted only when the workflow file exists on the default branch. [Source: Workflow syntax for GitHub Actions, lines 237-250 and 758-762.](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

## OBSERVED EVIDENCE

- The existing signed-in Teams Admin Center details page displayed short name `업무 허브`, publisher `Teams SDK MVP`, and published version `1.0.138`.
- The app details view showed an external App ID matching `appPackage/manifest.json`; the Admin Center page's internal catalog record ID is a different identifier. Verify both fields before upload, and use the existing app's **Upload file** control.
- The source version set was `1.0.143`; refreshed Git refs contained no higher manifest version, no open PR heads, and the latest published GitHub release shown by `gh release list` was `1.0.95`. `1.0.144` passed `release:prepare --dry-run` with the highest observed Git manifest version `1.0.143`.
- Browser evidence was captured from the existing Admin Center app details tab and directly reviewed. The page showed the existing app and its `파일 업로드` update control; this was a read-only observation.

## INFERENCE

The current app detail is the matching catalog entry because its displayed external App ID equals the Teams manifest app ID. The different URL/catalog ID alone does not establish a mismatch.

## RELEASE GATE

The upload is not complete until the existing app's page reports the newly published version. The installed Teams app is not updated merely because the package upload succeeds; read back the installed version and obtain the required user update consent before host-specific UI verification. A successful GitHub action must identify the same commit SHA used by the package and runtime checks.
