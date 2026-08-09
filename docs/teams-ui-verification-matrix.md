# Teams UI verification matrix

This document is the authoritative machine-readable matrix for Task 5. Each row is an independent verification unit for one Teams surface, location, and branch. The current command-gated run leaves external UI evidence blocked until same-release portal, installed, desktop, and mobile screenshots are captured; the validator still requires every evidence slot and every status reason so no branch can be silently treated as passing.

A control being visible is never the action result. Reviewers must capture fresh AX and screenshot proof for visibleControl, then separately capture the Teams/server/runtime proof required by serverAction and result. For PASS or FAIL, replace the blocked evidence objects with same-run artifacts that identify the exact app version, source commit, package SHA-256, and installed version.

<!-- TEAMS_UI_MATRIX_JSON_START -->
```json
{
  "schemaVersion": 1,
  "matrixId": "teams-work-hub-task-5-ui-verification",
  "task": "Task 5 — Mobile-first GenUI and verification matrix",
  "generatedOn": "2026-08-10",
  "releaseIdentity": {
    "appVersion": "1.0.26",
    "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
    "packageSha256": "f5655b15aa85669de4ce9bc3b806d2a2d480947b60b1f4dfd7d3a82cd213d078",
    "installedVersion": null,
    "environment": "public-command-only-ui-unverified",
    "publicOrigin": "https://dxshc7dx-3978.jpe1.devtunnels.ms"
  },
  "evidencePolicy": {
    "freshDefinition": "A PASS or FAIL row requires before/after screenshots, AX evidence, and runtime evidence captured in the same verification run.",
    "identityDefinition": "Every captured artifact must identify appVersion, sourceCommit, packageSha256, and installedVersion when known; artifacts from another version are invalid.",
    "blockedDefinition": "BLOCKED is valid only when every evidence slot exists with state=not-captured, null path/timestamp, and an explicit reason.",
    "notApplicableDefinition": "N/A is valid only with a scoped reason and state=not-applicable evidence; it must not hide an implemented branch.",
    "proofBoundary": "visibleControl proves only that a control/state rendered; serverAction/resultProof proves the backend/runtime result separately.",
    "mobileBoundary": "Desktop evidence cannot prove iOS WebView size, Teams mobile permissions, or GPS; those remain separate mobile rows."
  },
  "coverage": {
    "requiredKeys": [
      "chat.commands.help",
      "chat.commands.mode",
      "chat.commands.weather.no-coordinate",
      "chat.commands.weather.valid-coordinate",
      "chat.commands.weather.invalid-coordinate",
      "chat.commands.weather.server-error",
      "chat.commands.status.summary",
      "chat.commands.status.job",
      "chat.commands.status.scope-missing",
      "chat.commands.list.populated",
      "chat.commands.list.empty",
      "chat.commands.run.read-only",
      "chat.commands.run.invalid-prompt",
      "chat.commands.write.approval",
      "chat.commands.approve.success",
      "chat.commands.approve.conflict",
      "chat.commands.approve.forbidden",
      "chat.commands.continue.retry",
      "chat.commands.continue.missing",
      "chat.commands.continue.invalid-prompt",
      "chat.commands.commit.success",
      "chat.commands.commit.pending",
      "chat.commands.commit.missing",
      "chat.commands.cancel.success",
      "chat.commands.cancel.conflict",
      "chat.commands.cancel.missing",
      "chat.commands.natural-language.success",
      "chat.commands.natural-language.invalid",
      "chat.commands.empty",
      "chat.scopes.personal",
      "chat.scopes.group",
      "chat.scopes.channel",
      "chat.card.no-top-level-duplicate",
      "chat.card.prompt-view",
      "chat.card.tab-link",
      "chat.card.command.help",
      "chat.card.command.weather",
      "chat.card.command.status",
      "chat.card.command.list",
      "chat.card.approval.approve",
      "chat.card.approval.cancel",
      "chat.card.action.expired",
      "chat.card.action.consumed",
      "chat.card.action.mismatch",
      "chat.card.retry-action.not-rendered",
      "chat.card.response-mode.deterministic",
      "chat.card.response-mode.openai",
      "chat.card.response-mode.local",
      "chat.card.response-mode.unconfigured",
      "chat.install",
      "chat.progress.loading",
      "chat.card.state.loading",
      "chat.card.state.ready",
      "chat.card.state.empty",
      "chat.card.state.error",
      "chat.card.state.approval",
      "chat.card.state.complete",
      "chat.card.section.text",
      "chat.card.section.facts",
      "chat.card.section.stats",
      "chat.card.section.weather",
      "chat.card.section.list",
      "chat.card.section.progress",
      "chat.card.section.status",
      "chat.auth.expired",
      "chat.auth.retry",
      "personal.home.hero",
      "personal.home.runtime-panel",
      "personal.home.response-mode",
      "personal.home.weather",
      "personal.home.items",
      "personal.home.copilot",
      "personal.home.footer",
      "personal.loading.initial",
      "personal.loading.response-mode",
      "personal.loading.weather",
      "personal.loading.items",
      "personal.error.runtime",
      "personal.error.response-mode",
      "personal.error.weather",
      "personal.error.items",
      "personal.retry.runtime",
      "personal.retry.weather",
      "personal.retry.items",
      "personal.empty.weather",
      "personal.empty.items",
      "personal.auth.expired",
      "personal.auth.retry",
      "personal.response-mode.ready",
      "personal.response-mode.saving",
      "personal.response-mode.unconfigured",
      "personal.weather.permission.allow.browser",
      "personal.weather.permission.allow.teams-native",
      "personal.weather.permission.deny.browser",
      "personal.weather.permission.deny.teams-native",
      "personal.weather.provider.demo",
      "personal.weather.server-error",
      "personal.filter.all",
      "personal.filter.open",
      "personal.filter.done",
      "personal.crud.create.success",
      "personal.crud.create.invalid",
      "personal.crud.create.server-error",
      "personal.crud.read.populated",
      "personal.crud.read.empty",
      "personal.crud.read.server-error",
      "personal.crud.update.open",
      "personal.crud.update.save",
      "personal.crud.update.invalid",
      "personal.crud.update.cancel",
      "personal.crud.update.server-error",
      "personal.crud.delete.confirm",
      "personal.crud.delete.cancel",
      "personal.crud.delete.success",
      "personal.crud.delete.server-error",
      "personal.crud.status.open-to-done",
      "personal.crud.status.done-to-open",
      "personal.crud.status.server-error",
      "personal.copilot.lazy-loading",
      "personal.copilot.ready",
      "personal.copilot.prompt-menu",
      "personal.copilot.weather-tool",
      "personal.copilot.task-tool",
      "personal.copilot.approval-visible",
      "personal.copilot.approve.success",
      "personal.copilot.cancel.success",
      "personal.copilot.approval.conflict",
      "personal.copilot.approval.missing-context",
      "personal.copilot.approval.auth-expired",
      "personal.copilot.runtime-error.retry",
      "personal.copilot.runtime-error.reload",
      "personal.copilot.ai-feedback.positive",
      "personal.copilot.ai-feedback.negative",
      "personal.mobile.narrow-home",
      "personal.mobile.narrow-card",
      "codex.approval.allow",
      "codex.approval.cancel",
      "codex.approval.conflict",
      "codex.cancel.success",
      "codex.retry.continue",
      "codex.progress",
      "codex.complete",
      "codex.failed",
      "codex.blocked",
      "codex.auth-expired",
      "deep-link.static-tab",
      "deep-link.open-tab-action",
      "deep-link.response-mode-card",
      "deep-link.trailing-slash"
    ],
    "count": 149,
    "resultStatuses": [
      "PASS",
      "FAIL",
      "BLOCKED",
      "N/A"
    ]
  },
  "rows": [
    {
      "id": "teams-ui-chat-commands-help",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Help",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Help.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Help, then capture the after state.",
        "input": "Chat Commands Help",
        "operation": "Exercise chat.commands.help and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Help",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Help before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Help.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Help control or state is only the trigger for chat.commands.help.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.help",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.help result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Help control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Help branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.help.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Help."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.help and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.help."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.help"
      ]
    },
    {
      "id": "teams-ui-chat-commands-mode",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Mode",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Mode.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Mode, then capture the after state.",
        "input": "Chat Commands Mode",
        "operation": "Exercise chat.commands.mode and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Mode",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Mode before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Mode.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Mode control or state is only the trigger for chat.commands.mode.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.mode",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.mode result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Mode control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Mode branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.mode.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Mode."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.mode and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.mode."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.mode"
      ]
    },
    {
      "id": "teams-ui-chat-commands-weather-no-coordinate",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Weather No Coordinate",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Weather No Coordinate.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Weather No Coordinate, then capture the after state.",
        "input": "Chat Commands Weather No Coordinate",
        "operation": "Exercise chat.commands.weather.no-coordinate and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Weather No Coordinate",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Weather No Coordinate before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Weather No Coordinate.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Weather No Coordinate control or state is only the trigger for chat.commands.weather.no-coordinate.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.weather.no-coordinate",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.weather.no-coordinate result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Weather No Coordinate control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Weather No Coordinate branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.weather.no-coordinate.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Weather No Coordinate."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.weather.no-coordinate and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.weather.no-coordinate."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.weather.no-coordinate"
      ]
    },
    {
      "id": "teams-ui-chat-commands-weather-valid-coordinate",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Weather Valid Coordinate",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Weather Valid Coordinate.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Weather Valid Coordinate, then capture the after state.",
        "input": "Chat Commands Weather Valid Coordinate",
        "operation": "Exercise chat.commands.weather.valid-coordinate and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Weather Valid Coordinate",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Weather Valid Coordinate before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Weather Valid Coordinate.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Weather Valid Coordinate control or state is only the trigger for chat.commands.weather.valid-coordinate.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.weather.valid-coordinate",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.weather.valid-coordinate result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Weather Valid Coordinate control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Weather Valid Coordinate branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.weather.valid-coordinate.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Weather Valid Coordinate."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.weather.valid-coordinate and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.weather.valid-coordinate."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.weather.valid-coordinate"
      ]
    },
    {
      "id": "teams-ui-chat-commands-weather-invalid-coordinate",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Weather Invalid Coordinate",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Weather Invalid Coordinate.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Weather Invalid Coordinate, then capture the after state.",
        "input": "Chat Commands Weather Invalid Coordinate",
        "operation": "Exercise chat.commands.weather.invalid-coordinate and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Weather Invalid Coordinate",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Weather Invalid Coordinate before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Weather Invalid Coordinate.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Weather Invalid Coordinate control or state is only the trigger for chat.commands.weather.invalid-coordinate.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.weather.invalid-coordinate",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.weather.invalid-coordinate result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Weather Invalid Coordinate control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Weather Invalid Coordinate branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.weather.invalid-coordinate.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Weather Invalid Coordinate."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.weather.invalid-coordinate and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.weather.invalid-coordinate."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.weather.invalid-coordinate"
      ]
    },
    {
      "id": "teams-ui-chat-commands-weather-server-error",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Weather Server Error",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Weather Server Error.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Weather Server Error, then capture the after state.",
        "input": "Chat Commands Weather Server Error",
        "operation": "Exercise chat.commands.weather.server-error and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Commands Weather Server Error",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Commands Weather Server Error before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Weather Server Error.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Weather Server Error control or state is only the trigger for chat.commands.weather.server-error.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.weather.server-error",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.weather.server-error result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Weather Server Error control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Weather Server Error branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.weather.server-error.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Commands Weather Server Error."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.weather.server-error and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.weather.server-error."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.weather.server-error"
      ]
    },
    {
      "id": "teams-ui-chat-commands-status-summary",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Status Summary",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Status Summary.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Status Summary, then capture the after state.",
        "input": "Chat Commands Status Summary",
        "operation": "Exercise chat.commands.status.summary and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Status Summary",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Status Summary before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Status Summary.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Status Summary control or state is only the trigger for chat.commands.status.summary.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.status.summary",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.status.summary result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Status Summary control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Status Summary branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.status.summary.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Status Summary."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.status.summary and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.status.summary."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.status.summary"
      ]
    },
    {
      "id": "teams-ui-chat-commands-status-job",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Status Job",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Status Job.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Status Job, then capture the after state.",
        "input": "Chat Commands Status Job",
        "operation": "Exercise chat.commands.status.job and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Status Job",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Status Job before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Status Job.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Status Job control or state is only the trigger for chat.commands.status.job.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.status.job",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.status.job result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Status Job control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Status Job branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.status.job.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Status Job."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.status.job and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.status.job."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.status.job"
      ]
    },
    {
      "id": "teams-ui-chat-commands-status-scope-missing",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Status Scope Missing",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Status Scope Missing.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Status Scope Missing, then capture the after state.",
        "input": "Chat Commands Status Scope Missing",
        "operation": "Exercise chat.commands.status.scope-missing and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Status Scope Missing",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Status Scope Missing before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Status Scope Missing.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Status Scope Missing control or state is only the trigger for chat.commands.status.scope-missing.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.status.scope-missing",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.status.scope-missing result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Status Scope Missing control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Status Scope Missing branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.status.scope-missing.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Status Scope Missing."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.status.scope-missing and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.status.scope-missing."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.status.scope-missing"
      ]
    },
    {
      "id": "teams-ui-chat-commands-list-populated",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands List Populated",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands List Populated.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands List Populated, then capture the after state.",
        "input": "Chat Commands List Populated",
        "operation": "Exercise chat.commands.list.populated and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands List Populated",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands List Populated before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands List Populated.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands List Populated control or state is only the trigger for chat.commands.list.populated.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.list.populated",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.list.populated result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands List Populated control or state is visible and its precondition is readable.",
        "after": "The Chat Commands List Populated branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.list.populated.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands List Populated."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.list.populated and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.list.populated."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.list.populated"
      ]
    },
    {
      "id": "teams-ui-chat-commands-list-empty",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands List Empty",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands List Empty.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands List Empty, then capture the after state.",
        "input": "Chat Commands List Empty",
        "operation": "Exercise chat.commands.list.empty and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Commands List Empty",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Commands List Empty before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands List Empty.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands List Empty control or state is only the trigger for chat.commands.list.empty.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.list.empty",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.list.empty result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands List Empty control or state is visible and its precondition is readable.",
        "after": "The Chat Commands List Empty branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.list.empty.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Commands List Empty."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.list.empty and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.list.empty."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.list.empty"
      ]
    },
    {
      "id": "teams-ui-chat-commands-run-read-only",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Run Read Only",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Run Read Only.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Run Read Only, then capture the after state.",
        "input": "Chat Commands Run Read Only",
        "operation": "Exercise chat.commands.run.read-only and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Run Read Only",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Run Read Only before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Run Read Only.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Run Read Only control or state is only the trigger for chat.commands.run.read-only.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.run.read-only",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.run.read-only result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Run Read Only control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Run Read Only branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.run.read-only.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Run Read Only."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.run.read-only and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.run.read-only."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.run.read-only"
      ]
    },
    {
      "id": "teams-ui-chat-commands-run-invalid-prompt",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Run Invalid Prompt",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Run Invalid Prompt.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Run Invalid Prompt, then capture the after state.",
        "input": "Chat Commands Run Invalid Prompt",
        "operation": "Exercise chat.commands.run.invalid-prompt and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Run Invalid Prompt",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Run Invalid Prompt before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Run Invalid Prompt.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Run Invalid Prompt control or state is only the trigger for chat.commands.run.invalid-prompt.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.run.invalid-prompt",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.run.invalid-prompt result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Run Invalid Prompt control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Run Invalid Prompt branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.run.invalid-prompt.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Run Invalid Prompt."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.run.invalid-prompt and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.run.invalid-prompt."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.run.invalid-prompt"
      ]
    },
    {
      "id": "teams-ui-chat-commands-write-approval",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Write Approval",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Write Approval.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Write Approval, then capture the after state.",
        "input": "Chat Commands Write Approval",
        "operation": "Exercise chat.commands.write.approval and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Write Approval",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Write Approval before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Write Approval.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Write Approval control or state is only the trigger for chat.commands.write.approval.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.write.approval",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.write.approval result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Write Approval control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Write Approval branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.write.approval.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Write Approval."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.write.approval and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.write.approval."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.write.approval"
      ]
    },
    {
      "id": "teams-ui-chat-commands-approve-success",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Approve Success",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Approve Success.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Approve Success, then capture the after state.",
        "input": "Chat Commands Approve Success",
        "operation": "Exercise chat.commands.approve.success and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Approve Success",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Approve Success before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Approve Success.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Approve Success control or state is only the trigger for chat.commands.approve.success.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.approve.success",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.approve.success result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Approve Success control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Approve Success branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.approve.success.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Approve Success."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.approve.success and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.approve.success."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.approve.success"
      ]
    },
    {
      "id": "teams-ui-chat-commands-approve-conflict",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Approve Conflict",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Approve Conflict.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Approve Conflict, then capture the after state.",
        "input": "Chat Commands Approve Conflict",
        "operation": "Exercise chat.commands.approve.conflict and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Approve Conflict",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Approve Conflict before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Approve Conflict.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Approve Conflict control or state is only the trigger for chat.commands.approve.conflict.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.approve.conflict",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.approve.conflict result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Approve Conflict control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Approve Conflict branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.approve.conflict.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Approve Conflict."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.approve.conflict and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.approve.conflict."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.approve.conflict"
      ]
    },
    {
      "id": "teams-ui-chat-commands-approve-forbidden",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Approve Forbidden",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Approve Forbidden.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Approve Forbidden, then capture the after state.",
        "input": "Chat Commands Approve Forbidden",
        "operation": "Exercise chat.commands.approve.forbidden and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Approve Forbidden",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Approve Forbidden before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Approve Forbidden.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Approve Forbidden control or state is only the trigger for chat.commands.approve.forbidden.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.approve.forbidden",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.approve.forbidden result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Approve Forbidden control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Approve Forbidden branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.approve.forbidden.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Approve Forbidden."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.approve.forbidden and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.approve.forbidden."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.approve.forbidden"
      ]
    },
    {
      "id": "teams-ui-chat-commands-continue-retry",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Continue Retry",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Continue Retry.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Continue Retry, then capture the after state.",
        "input": "Chat Commands Continue Retry",
        "operation": "Exercise chat.commands.continue.retry and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Continue Retry",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Continue Retry before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Continue Retry.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Continue Retry control or state is only the trigger for chat.commands.continue.retry.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.continue.retry",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.continue.retry result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Continue Retry control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Continue Retry branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.continue.retry.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Continue Retry."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.continue.retry and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.continue.retry."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.continue.retry"
      ]
    },
    {
      "id": "teams-ui-chat-commands-continue-missing",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Continue Missing",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Continue Missing.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Continue Missing, then capture the after state.",
        "input": "Chat Commands Continue Missing",
        "operation": "Exercise chat.commands.continue.missing and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Continue Missing",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Continue Missing before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Continue Missing.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Continue Missing control or state is only the trigger for chat.commands.continue.missing.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.continue.missing",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.continue.missing result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Continue Missing control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Continue Missing branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.continue.missing.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Continue Missing."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.continue.missing and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.continue.missing."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.continue.missing"
      ]
    },
    {
      "id": "teams-ui-chat-commands-continue-invalid-prompt",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Continue Invalid Prompt",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Continue Invalid Prompt.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Continue Invalid Prompt, then capture the after state.",
        "input": "Chat Commands Continue Invalid Prompt",
        "operation": "Exercise chat.commands.continue.invalid-prompt and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Continue Invalid Prompt",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Continue Invalid Prompt before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Continue Invalid Prompt.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Continue Invalid Prompt control or state is only the trigger for chat.commands.continue.invalid-prompt.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.continue.invalid-prompt",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.continue.invalid-prompt result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Continue Invalid Prompt control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Continue Invalid Prompt branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.continue.invalid-prompt.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Continue Invalid Prompt."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.continue.invalid-prompt and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.continue.invalid-prompt."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.continue.invalid-prompt"
      ]
    },
    {
      "id": "teams-ui-chat-commands-commit-success",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Commit Success",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Commit Success.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Commit Success, then capture the after state.",
        "input": "Chat Commands Commit Success",
        "operation": "Exercise chat.commands.commit.success and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Commit Success",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Commit Success before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Commit Success.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Commit Success control or state is only the trigger for chat.commands.commit.success.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.commit.success",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.commit.success result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Commit Success control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Commit Success branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.commit.success.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Commit Success."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.commit.success and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.commit.success."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.commit.success"
      ]
    },
    {
      "id": "teams-ui-chat-commands-commit-pending",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Commit Pending",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Commit Pending.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Commit Pending, then capture the after state.",
        "input": "Chat Commands Commit Pending",
        "operation": "Exercise chat.commands.commit.pending and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Commit Pending",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Commit Pending before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Commit Pending.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Commit Pending control or state is only the trigger for chat.commands.commit.pending.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.commit.pending",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.commit.pending result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Commit Pending control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Commit Pending branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.commit.pending.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Commit Pending."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.commit.pending and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.commit.pending."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.commit.pending"
      ]
    },
    {
      "id": "teams-ui-chat-commands-commit-missing",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Commit Missing",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Commit Missing.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Commit Missing, then capture the after state.",
        "input": "Chat Commands Commit Missing",
        "operation": "Exercise chat.commands.commit.missing and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Commit Missing",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Commit Missing before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Commit Missing.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Commit Missing control or state is only the trigger for chat.commands.commit.missing.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.commit.missing",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.commit.missing result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Commit Missing control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Commit Missing branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.commit.missing.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Commit Missing."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.commit.missing and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.commit.missing."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.commit.missing"
      ]
    },
    {
      "id": "teams-ui-chat-commands-cancel-success",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Cancel Success",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Cancel Success.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Cancel Success, then capture the after state.",
        "input": "Chat Commands Cancel Success",
        "operation": "Exercise chat.commands.cancel.success and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Cancel Success",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Cancel Success before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Cancel Success.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Cancel Success control or state is only the trigger for chat.commands.cancel.success.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.cancel.success",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.cancel.success result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Cancel Success control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Cancel Success branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.cancel.success.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Cancel Success."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.cancel.success and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.cancel.success."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.cancel.success"
      ]
    },
    {
      "id": "teams-ui-chat-commands-cancel-conflict",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Cancel Conflict",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Cancel Conflict.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Cancel Conflict, then capture the after state.",
        "input": "Chat Commands Cancel Conflict",
        "operation": "Exercise chat.commands.cancel.conflict and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Cancel Conflict",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Cancel Conflict before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Cancel Conflict.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Cancel Conflict control or state is only the trigger for chat.commands.cancel.conflict.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.cancel.conflict",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.cancel.conflict result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Cancel Conflict control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Cancel Conflict branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.cancel.conflict.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Cancel Conflict."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.cancel.conflict and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.cancel.conflict."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.cancel.conflict"
      ]
    },
    {
      "id": "teams-ui-chat-commands-cancel-missing",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Cancel Missing",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Cancel Missing.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Cancel Missing, then capture the after state.",
        "input": "Chat Commands Cancel Missing",
        "operation": "Exercise chat.commands.cancel.missing and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Cancel Missing",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Cancel Missing before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Cancel Missing.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Cancel Missing control or state is only the trigger for chat.commands.cancel.missing.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.cancel.missing",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.cancel.missing result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Cancel Missing control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Cancel Missing branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.cancel.missing.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Cancel Missing."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.cancel.missing and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.cancel.missing."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.cancel.missing"
      ]
    },
    {
      "id": "teams-ui-chat-commands-natural-language-success",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Natural Language Success",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Natural Language Success.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Natural Language Success, then capture the after state.",
        "input": "Chat Commands Natural Language Success",
        "operation": "Exercise chat.commands.natural-language.success and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Natural Language Success",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Natural Language Success before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Natural Language Success.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Natural Language Success control or state is only the trigger for chat.commands.natural-language.success.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.natural-language.success",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.natural-language.success result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Natural Language Success control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Natural Language Success branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.natural-language.success.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Natural Language Success."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.natural-language.success and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.natural-language.success."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.natural-language.success"
      ]
    },
    {
      "id": "teams-ui-chat-commands-natural-language-invalid",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Natural Language Invalid",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Natural Language Invalid.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Natural Language Invalid, then capture the after state.",
        "input": "Chat Commands Natural Language Invalid",
        "operation": "Exercise chat.commands.natural-language.invalid and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "textbox",
        "label": "Chat Commands Natural Language Invalid",
        "presenceAssertion": "Fresh AX evidence must show the expected textbox or rendered state for Chat Commands Natural Language Invalid before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Natural Language Invalid.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Natural Language Invalid control or state is only the trigger for chat.commands.natural-language.invalid.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.natural-language.invalid",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.natural-language.invalid result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Natural Language Invalid control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Natural Language Invalid branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.natural-language.invalid.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Commands Natural Language Invalid."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.natural-language.invalid and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.natural-language.invalid."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.natural-language.invalid"
      ]
    },
    {
      "id": "teams-ui-chat-commands-empty",
      "feature": "chat command",
      "surface": "teams-chat",
      "location": "Teams chat composer and Bot reply",
      "branch": "Chat Commands Empty",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Commands Empty.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Commands Empty, then capture the after state.",
        "input": "Chat Commands Empty",
        "operation": "Exercise chat.commands.empty and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Commands Empty",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Commands Empty before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Commands Empty.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Commands Empty control or state is only the trigger for chat.commands.empty.",
        "handler": "src/server/index.ts#handleMessage",
        "request": "Teams message activity text for chat.commands.empty",
        "resultProof": "Record the actual server/runtime response and prove the chat.commands.empty result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Commands Empty control or state is visible and its precondition is readable.",
        "after": "The Chat Commands Empty branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.commands.empty.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Commands Empty."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.commands.empty and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.commands.empty."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.commands.empty"
      ]
    },
    {
      "id": "teams-ui-chat-scopes-personal",
      "feature": "Bot conversation scope",
      "surface": "teams-chat",
      "location": "personal chat with 업무 허브",
      "branch": "Chat Scopes Personal",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Scopes Personal.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Scopes Personal, then capture the after state.",
        "input": "Chat Scopes Personal",
        "operation": "Exercise chat.scopes.personal and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Scopes Personal",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Scopes Personal before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Scopes Personal.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Scopes Personal control or state is only the trigger for chat.scopes.personal.",
        "handler": "src/server/teams-tab-link.ts#buildTeamsPersonalTabDeepLink and appPackage/manifest.json",
        "request": "Runtime transition for chat.scopes.personal",
        "resultProof": "Record the actual server/runtime response and prove the chat.scopes.personal result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Scopes Personal control or state is visible and its precondition is readable.",
        "after": "The Chat Scopes Personal branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.scopes.personal.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Scopes Personal."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.scopes.personal and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.scopes.personal."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.scopes.personal"
      ]
    },
    {
      "id": "teams-ui-chat-scopes-group",
      "feature": "Bot conversation scope",
      "surface": "teams-chat",
      "location": "group chat with 업무 허브",
      "branch": "Chat Scopes Group",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Scopes Group.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Scopes Group, then capture the after state.",
        "input": "Chat Scopes Group",
        "operation": "Exercise chat.scopes.group and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Scopes Group",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Scopes Group before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Scopes Group.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Scopes Group control or state is only the trigger for chat.scopes.group.",
        "handler": "src/server/teams-tab-link.ts#buildTeamsPersonalTabDeepLink and appPackage/manifest.json",
        "request": "Runtime transition for chat.scopes.group",
        "resultProof": "Record the actual server/runtime response and prove the chat.scopes.group result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Scopes Group control or state is visible and its precondition is readable.",
        "after": "The Chat Scopes Group branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.scopes.group.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Scopes Group."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.scopes.group and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.scopes.group."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.scopes.group"
      ]
    },
    {
      "id": "teams-ui-chat-scopes-channel",
      "feature": "Bot conversation scope",
      "surface": "teams-chat",
      "location": "team/channel conversation with 업무 허브",
      "branch": "Chat Scopes Channel",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Scopes Channel.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Scopes Channel, then capture the after state.",
        "input": "Chat Scopes Channel",
        "operation": "Exercise chat.scopes.channel and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Scopes Channel",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Scopes Channel before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Scopes Channel.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Scopes Channel control or state is only the trigger for chat.scopes.channel.",
        "handler": "src/server/teams-tab-link.ts#buildTeamsPersonalTabDeepLink and appPackage/manifest.json",
        "request": "Runtime transition for chat.scopes.channel",
        "resultProof": "Record the actual server/runtime response and prove the chat.scopes.channel result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Scopes Channel control or state is visible and its precondition is readable.",
        "after": "The Chat Scopes Channel branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.scopes.channel.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Scopes Channel."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.scopes.channel and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.scopes.channel."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.scopes.channel"
      ]
    },
    {
      "id": "teams-ui-chat-card-no-top-level-duplicate",
      "feature": "Adaptive Card delivery",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card No Top Level Duplicate",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card No Top Level Duplicate.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card No Top Level Duplicate, then capture the after state.",
        "input": "Chat Card No Top Level Duplicate",
        "operation": "Exercise chat.card.no-top-level-duplicate and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Card No Top Level Duplicate",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Card No Top Level Duplicate before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card No Top Level Duplicate.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card No Top Level Duplicate control or state is only the trigger for chat.card.no-top-level-duplicate.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.no-top-level-duplicate",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.no-top-level-duplicate result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card No Top Level Duplicate control or state is visible and its precondition is readable.",
        "after": "The Chat Card No Top Level Duplicate branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.no-top-level-duplicate.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Card No Top Level Duplicate."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.no-top-level-duplicate and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.no-top-level-duplicate."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.no-top-level-duplicate"
      ]
    },
    {
      "id": "teams-ui-chat-card-prompt-view",
      "feature": "Adaptive Card prompt menu",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Prompt View",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Prompt View.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Prompt View, then capture the after state.",
        "input": "Chat Card Prompt View",
        "operation": "Exercise chat.card.prompt-view and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "프롬프트 보기",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 프롬프트 보기 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 프롬프트 보기.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Prompt View control or state is only the trigger for chat.card.prompt-view.",
        "handler": "src/server/genui-teams.ts#renderPromptViewAction",
        "request": "Adaptive Card action payload for chat.card.prompt-view",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.prompt-view result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Prompt View control or state is visible and its precondition is readable.",
        "after": "The Chat Card Prompt View branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.prompt-view.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Card Prompt View."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.prompt-view and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.prompt-view."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.prompt-view"
      ]
    },
    {
      "id": "teams-ui-chat-card-tab-link",
      "feature": "Adaptive Card deep link",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Tab Link",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Tab Link.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Tab Link, then capture the after state.",
        "input": "Chat Card Tab Link",
        "operation": "Exercise chat.card.tab-link and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "업무 허브 탭 열기",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 업무 허브 탭 열기 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 업무 허브 탭 열기.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Tab Link control or state is only the trigger for chat.card.tab-link.",
        "handler": "src/server/genui-teams.ts#renderAction",
        "request": "Adaptive Card action payload for chat.card.tab-link",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.tab-link result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Tab Link control or state is visible and its precondition is readable.",
        "after": "The Chat Card Tab Link branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.tab-link.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Card Tab Link."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.tab-link and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.tab-link."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.tab-link"
      ]
    },
    {
      "id": "teams-ui-chat-card-command-help",
      "feature": "Adaptive Card quick command",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Command Help",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Command Help.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Command Help, then capture the after state.",
        "input": "Chat Card Command Help",
        "operation": "Exercise chat.card.command.help and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "도움말",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 도움말 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 도움말.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Command Help control or state is only the trigger for chat.card.command.help.",
        "handler": "src/server/index.ts#resolveGenUiAction",
        "request": "Adaptive Card action payload for chat.card.command.help",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.command.help result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Command Help control or state is visible and its precondition is readable.",
        "after": "The Chat Card Command Help branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.command.help.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Card Command Help."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.command.help and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.command.help."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.command.help"
      ]
    },
    {
      "id": "teams-ui-chat-card-command-weather",
      "feature": "Adaptive Card quick command",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Command Weather",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Command Weather.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Command Weather, then capture the after state.",
        "input": "Chat Card Command Weather",
        "operation": "Exercise chat.card.command.weather and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "날씨",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 날씨 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 날씨.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Command Weather control or state is only the trigger for chat.card.command.weather.",
        "handler": "src/server/index.ts#resolveGenUiAction",
        "request": "Adaptive Card action payload for chat.card.command.weather",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.command.weather result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Command Weather control or state is visible and its precondition is readable.",
        "after": "The Chat Card Command Weather branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.command.weather.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Card Command Weather."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.command.weather and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.command.weather."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.command.weather"
      ]
    },
    {
      "id": "teams-ui-chat-card-command-status",
      "feature": "Adaptive Card quick command",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Command Status",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Command Status.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Command Status, then capture the after state.",
        "input": "Chat Card Command Status",
        "operation": "Exercise chat.card.command.status and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "상태",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 상태 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 상태.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Command Status control or state is only the trigger for chat.card.command.status.",
        "handler": "src/server/index.ts#resolveGenUiAction",
        "request": "Adaptive Card action payload for chat.card.command.status",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.command.status result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Command Status control or state is visible and its precondition is readable.",
        "after": "The Chat Card Command Status branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.command.status.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Card Command Status."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.command.status and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.command.status."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.command.status"
      ]
    },
    {
      "id": "teams-ui-chat-card-command-list",
      "feature": "Adaptive Card quick command",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Command List",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Command List.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Command List, then capture the after state.",
        "input": "Chat Card Command List",
        "operation": "Exercise chat.card.command.list and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "업무 목록",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 업무 목록 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 업무 목록.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Command List control or state is only the trigger for chat.card.command.list.",
        "handler": "src/server/index.ts#resolveGenUiAction",
        "request": "Adaptive Card action payload for chat.card.command.list",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.command.list result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Command List control or state is visible and its precondition is readable.",
        "after": "The Chat Card Command List branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.command.list.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible textbox or state for Chat Card Command List."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.command.list and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.command.list."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.command.list"
      ]
    },
    {
      "id": "teams-ui-chat-card-approval-approve",
      "feature": "Adaptive Card approval",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Approval Approve",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Approval Approve.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Approval Approve, then capture the after state.",
        "input": "Chat Card Approval Approve",
        "operation": "Exercise chat.card.approval.approve and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "승인",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 승인 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 승인.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Approval Approve control or state is only the trigger for chat.card.approval.approve.",
        "handler": "src/server/index.ts#resolveGenUiAction",
        "request": "Adaptive Card action payload for chat.card.approval.approve",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.approval.approve result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Approval Approve control or state is visible and its precondition is readable.",
        "after": "The Chat Card Approval Approve branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.approval.approve.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Card Approval Approve."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.approval.approve and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.approval.approve."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.approval.approve"
      ]
    },
    {
      "id": "teams-ui-chat-card-approval-cancel",
      "feature": "Adaptive Card approval",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Approval Cancel",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Approval Cancel.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Approval Cancel, then capture the after state.",
        "input": "Chat Card Approval Cancel",
        "operation": "Exercise chat.card.approval.cancel and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "취소",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 취소 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 취소.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Approval Cancel control or state is only the trigger for chat.card.approval.cancel.",
        "handler": "src/server/index.ts#resolveGenUiAction",
        "request": "Adaptive Card action payload for chat.card.approval.cancel",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.approval.cancel result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Approval Cancel control or state is visible and its precondition is readable.",
        "after": "The Chat Card Approval Cancel branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.approval.cancel.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Card Approval Cancel."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.approval.cancel and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.approval.cancel."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.approval.cancel"
      ]
    },
    {
      "id": "teams-ui-chat-card-action-expired",
      "feature": "Adaptive Card action rejection",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Action Expired",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Action Expired.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Action Expired, then capture the after state.",
        "input": "Chat Card Action Expired",
        "operation": "Exercise chat.card.action.expired and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Card Action Expired",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Card Action Expired before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Action Expired.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Action Expired control or state is only the trigger for chat.card.action.expired.",
        "handler": "src/server/index.ts#resolveGenUiAction",
        "request": "Adaptive Card action payload for chat.card.action.expired",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.action.expired result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Action Expired control or state is visible and its precondition is readable.",
        "after": "The Chat Card Action Expired branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.action.expired.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Card Action Expired."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.action.expired and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.action.expired."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.action.expired"
      ]
    },
    {
      "id": "teams-ui-chat-card-action-consumed",
      "feature": "Adaptive Card action rejection",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Action Consumed",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Action Consumed.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Action Consumed, then capture the after state.",
        "input": "Chat Card Action Consumed",
        "operation": "Exercise chat.card.action.consumed and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Card Action Consumed",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Card Action Consumed before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Action Consumed.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Action Consumed control or state is only the trigger for chat.card.action.consumed.",
        "handler": "src/server/index.ts#resolveGenUiAction",
        "request": "Adaptive Card action payload for chat.card.action.consumed",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.action.consumed result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Action Consumed control or state is visible and its precondition is readable.",
        "after": "The Chat Card Action Consumed branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.action.consumed.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Card Action Consumed."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.action.consumed and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.action.consumed."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.action.consumed"
      ]
    },
    {
      "id": "teams-ui-chat-card-action-mismatch",
      "feature": "Adaptive Card action rejection",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Action Mismatch",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Action Mismatch.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Action Mismatch, then capture the after state.",
        "input": "Chat Card Action Mismatch",
        "operation": "Exercise chat.card.action.mismatch and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Card Action Mismatch",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Card Action Mismatch before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Action Mismatch.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Action Mismatch control or state is only the trigger for chat.card.action.mismatch.",
        "handler": "src/server/index.ts#resolveGenUiAction",
        "request": "Adaptive Card action payload for chat.card.action.mismatch",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.action.mismatch result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Action Mismatch control or state is visible and its precondition is readable.",
        "after": "The Chat Card Action Mismatch branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.action.mismatch.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Card Action Mismatch."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.action.mismatch and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.action.mismatch."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.action.mismatch"
      ]
    },
    {
      "id": "teams-ui-chat-card-retry-action-not-rendered",
      "feature": "Codex retry affordance",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Retry Action Not Rendered",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Retry Action Not Rendered.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Retry Action Not Rendered, then capture the after state.",
        "input": "Chat Card Retry Action Not Rendered",
        "operation": "Exercise chat.card.retry-action.not-rendered and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Card Retry Action Not Rendered",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Card Retry Action Not Rendered before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Retry Action Not Rendered.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Retry Action Not Rendered control or state is only the trigger for chat.card.retry-action.not-rendered.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.retry-action.not-rendered",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.retry-action.not-rendered result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Retry Action Not Rendered control or state is visible and its precondition is readable.",
        "after": "The Chat Card Retry Action Not Rendered branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.retry-action.not-rendered.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-applicable",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "N/A: the current card renderer does not emit a retry button; the supported retry surface is the continue command. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-applicable",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "N/A: the current card renderer does not emit a retry button; the supported retry surface is the continue command. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-applicable",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "N/A: the current card renderer does not emit a retry button; the supported retry surface is the continue command. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Card Retry Action Not Rendered."
        ]
      },
      "runtimeEvidence": {
        "state": "not-applicable",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "N/A: the current card renderer does not emit a retry button; the supported retry surface is the continue command. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.retry-action.not-rendered and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.retry-action.not-rendered."
        ]
      },
      "result": {
        "status": "N/A",
        "reason": "N/A: the current card renderer does not emit a retry button; the supported retry surface is the continue command.",
        "visibleControl": "NOT_APPLICABLE",
        "serverAction": "NOT_APPLICABLE",
        "nextAction": "Retain the continue-command row as the retry proof."
      },
      "coverage": [
        "chat.card.retry-action.not-rendered"
      ]
    },
    {
      "id": "teams-ui-chat-card-response-mode-deterministic",
      "feature": "response-mode Adaptive Card",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Response Mode Deterministic",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Response Mode Deterministic.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Response Mode Deterministic, then capture the after state.",
        "input": "Chat Card Response Mode Deterministic",
        "operation": "Exercise chat.card.response-mode.deterministic and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "결정형",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 결정형 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 결정형.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Response Mode Deterministic control or state is only the trigger for chat.card.response-mode.deterministic.",
        "handler": "src/server/index.ts#handleResponseModeSubmit",
        "request": "Adaptive Card action payload for chat.card.response-mode.deterministic",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.response-mode.deterministic result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Response Mode Deterministic control or state is visible and its precondition is readable.",
        "after": "The Chat Card Response Mode Deterministic branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.response-mode.deterministic.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Chat Card Response Mode Deterministic."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.response-mode.deterministic and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.response-mode.deterministic."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.response-mode.deterministic"
      ]
    },
    {
      "id": "teams-ui-chat-card-response-mode-openai",
      "feature": "response-mode Adaptive Card",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Response Mode Openai",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Response Mode Openai.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Response Mode Openai, then capture the after state.",
        "input": "Chat Card Response Mode Openai",
        "operation": "Exercise chat.card.response-mode.openai and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "OpenAI",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for OpenAI before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for OpenAI.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Response Mode Openai control or state is only the trigger for chat.card.response-mode.openai.",
        "handler": "src/server/index.ts#handleResponseModeSubmit",
        "request": "Adaptive Card action payload for chat.card.response-mode.openai",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.response-mode.openai result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Response Mode Openai control or state is visible and its precondition is readable.",
        "after": "The Chat Card Response Mode Openai branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.response-mode.openai.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Chat Card Response Mode Openai."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.response-mode.openai and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.response-mode.openai."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.response-mode.openai"
      ]
    },
    {
      "id": "teams-ui-chat-card-response-mode-local",
      "feature": "response-mode Adaptive Card",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Response Mode Local",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Response Mode Local.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Response Mode Local, then capture the after state.",
        "input": "Chat Card Response Mode Local",
        "operation": "Exercise chat.card.response-mode.local and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "로컬/사내 모델",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 로컬/사내 모델 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 로컬/사내 모델.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Response Mode Local control or state is only the trigger for chat.card.response-mode.local.",
        "handler": "src/server/index.ts#handleResponseModeSubmit",
        "request": "Adaptive Card action payload for chat.card.response-mode.local",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.response-mode.local result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Response Mode Local control or state is visible and its precondition is readable.",
        "after": "The Chat Card Response Mode Local branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.response-mode.local.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Chat Card Response Mode Local."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.response-mode.local and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.response-mode.local."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.response-mode.local"
      ]
    },
    {
      "id": "teams-ui-chat-card-response-mode-unconfigured",
      "feature": "response-mode Adaptive Card",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Response Mode Unconfigured",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Response Mode Unconfigured.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Response Mode Unconfigured, then capture the after state.",
        "input": "Chat Card Response Mode Unconfigured",
        "operation": "Exercise chat.card.response-mode.unconfigured and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "서버 설정 필요",
        "presenceAssertion": "Fresh AX evidence must show the disabled or explanatory state for 서버 설정 필요 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the setup guidance for 서버 설정 필요.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Response Mode Unconfigured control or state is only the trigger for chat.card.response-mode.unconfigured.",
        "handler": "src/server/index.ts#handleResponseModeSubmit",
        "request": "Adaptive Card action payload for chat.card.response-mode.unconfigured",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.response-mode.unconfigured result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Response Mode Unconfigured control or state is visible and its precondition is readable.",
        "after": "The Chat Card Response Mode Unconfigured branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.response-mode.unconfigured.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Chat Card Response Mode Unconfigured."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.response-mode.unconfigured and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.response-mode.unconfigured."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.response-mode.unconfigured"
      ]
    },
    {
      "id": "teams-ui-chat-install",
      "feature": "Bot install response",
      "surface": "teams-chat",
      "location": "Bot install/activity reply",
      "branch": "Chat Install",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Install.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Install, then capture the after state.",
        "input": "Chat Install",
        "operation": "Exercise chat.install and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Install",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Install before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Install.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Install control or state is only the trigger for chat.install.",
        "handler": "src/server/index.ts#handleInstall",
        "request": "Runtime transition for chat.install",
        "resultProof": "Record the actual server/runtime response and prove the chat.install result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Install control or state is visible and its precondition is readable.",
        "after": "The Chat Install branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.install.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Install."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.install and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.install."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.install"
      ]
    },
    {
      "id": "teams-ui-chat-progress-loading",
      "feature": "Codex progress notification",
      "surface": "teams-chat",
      "location": "proactive Bot progress reply",
      "branch": "Chat Progress Loading",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Progress Loading.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Progress Loading, then capture the after state.",
        "input": "Chat Progress Loading",
        "operation": "Exercise chat.progress.loading and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Progress Loading",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Progress Loading before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Progress Loading.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Progress Loading control or state is only the trigger for chat.progress.loading.",
        "handler": "src/server/agent-service.ts#notifyConversation",
        "request": "Runtime transition for chat.progress.loading",
        "resultProof": "Record the actual server/runtime response and prove the chat.progress.loading result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Progress Loading control or state is visible and its precondition is readable.",
        "after": "The Chat Progress Loading branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.progress.loading.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Progress Loading."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.progress.loading and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.progress.loading."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.progress.loading"
      ]
    },
    {
      "id": "teams-ui-chat-card-state-loading",
      "feature": "Adaptive Card state",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card State Loading",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card State Loading.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card State Loading, then capture the after state.",
        "input": "Chat Card State Loading",
        "operation": "Exercise chat.card.state.loading and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card State Loading",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card State Loading before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card State Loading.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card State Loading control or state is only the trigger for chat.card.state.loading.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.state.loading",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.state.loading result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card State Loading control or state is visible and its precondition is readable.",
        "after": "The Chat Card State Loading branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.state.loading.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card State Loading."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.state.loading and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.state.loading."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.state.loading"
      ]
    },
    {
      "id": "teams-ui-chat-card-state-ready",
      "feature": "Adaptive Card state",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card State Ready",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card State Ready.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card State Ready, then capture the after state.",
        "input": "Chat Card State Ready",
        "operation": "Exercise chat.card.state.ready and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card State Ready",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card State Ready before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card State Ready.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card State Ready control or state is only the trigger for chat.card.state.ready.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.state.ready",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.state.ready result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card State Ready control or state is visible and its precondition is readable.",
        "after": "The Chat Card State Ready branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.state.ready.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card State Ready."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.state.ready and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.state.ready."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.state.ready"
      ]
    },
    {
      "id": "teams-ui-chat-card-state-empty",
      "feature": "Adaptive Card state",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card State Empty",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card State Empty.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card State Empty, then capture the after state.",
        "input": "Chat Card State Empty",
        "operation": "Exercise chat.card.state.empty and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card State Empty",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card State Empty before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card State Empty.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card State Empty control or state is only the trigger for chat.card.state.empty.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.state.empty",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.state.empty result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card State Empty control or state is visible and its precondition is readable.",
        "after": "The Chat Card State Empty branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.state.empty.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card State Empty."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.state.empty and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.state.empty."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.state.empty"
      ]
    },
    {
      "id": "teams-ui-chat-card-state-error",
      "feature": "Adaptive Card state",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card State Error",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card State Error.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card State Error, then capture the after state.",
        "input": "Chat Card State Error",
        "operation": "Exercise chat.card.state.error and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card State Error",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card State Error before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card State Error.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card State Error control or state is only the trigger for chat.card.state.error.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.state.error",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.state.error result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card State Error control or state is visible and its precondition is readable.",
        "after": "The Chat Card State Error branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.state.error.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card State Error."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.state.error and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.state.error."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.state.error"
      ]
    },
    {
      "id": "teams-ui-chat-card-state-approval",
      "feature": "Adaptive Card state",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card State Approval",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card State Approval.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card State Approval, then capture the after state.",
        "input": "Chat Card State Approval",
        "operation": "Exercise chat.card.state.approval and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card State Approval",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card State Approval before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card State Approval.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card State Approval control or state is only the trigger for chat.card.state.approval.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.state.approval",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.state.approval result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card State Approval control or state is visible and its precondition is readable.",
        "after": "The Chat Card State Approval branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.state.approval.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card State Approval."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.state.approval and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.state.approval."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.state.approval"
      ]
    },
    {
      "id": "teams-ui-chat-card-state-complete",
      "feature": "Adaptive Card state",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card State Complete",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card State Complete.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card State Complete, then capture the after state.",
        "input": "Chat Card State Complete",
        "operation": "Exercise chat.card.state.complete and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card State Complete",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card State Complete before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card State Complete.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card State Complete control or state is only the trigger for chat.card.state.complete.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.state.complete",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.state.complete result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card State Complete control or state is visible and its precondition is readable.",
        "after": "The Chat Card State Complete branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.state.complete.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card State Complete."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.state.complete and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.state.complete."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.state.complete"
      ]
    },
    {
      "id": "teams-ui-chat-card-section-text",
      "feature": "Adaptive Card section renderer",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Section Text",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Section Text.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Section Text, then capture the after state.",
        "input": "Chat Card Section Text",
        "operation": "Exercise chat.card.section.text and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card Section Text",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card Section Text before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Section Text.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Section Text control or state is only the trigger for chat.card.section.text.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.section.text",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.section.text result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Section Text control or state is visible and its precondition is readable.",
        "after": "The Chat Card Section Text branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.section.text.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card Section Text."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.section.text and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.section.text."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.section.text"
      ]
    },
    {
      "id": "teams-ui-chat-card-section-facts",
      "feature": "Adaptive Card section renderer",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Section Facts",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Section Facts.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Section Facts, then capture the after state.",
        "input": "Chat Card Section Facts",
        "operation": "Exercise chat.card.section.facts and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card Section Facts",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card Section Facts before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Section Facts.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Section Facts control or state is only the trigger for chat.card.section.facts.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.section.facts",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.section.facts result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Section Facts control or state is visible and its precondition is readable.",
        "after": "The Chat Card Section Facts branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.section.facts.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card Section Facts."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.section.facts and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.section.facts."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.section.facts"
      ]
    },
    {
      "id": "teams-ui-chat-card-section-stats",
      "feature": "Adaptive Card section renderer",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Section Stats",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Section Stats.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Section Stats, then capture the after state.",
        "input": "Chat Card Section Stats",
        "operation": "Exercise chat.card.section.stats and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card Section Stats",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card Section Stats before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Section Stats.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Section Stats control or state is only the trigger for chat.card.section.stats.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.section.stats",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.section.stats result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Section Stats control or state is visible and its precondition is readable.",
        "after": "The Chat Card Section Stats branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.section.stats.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card Section Stats."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.section.stats and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.section.stats."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.section.stats"
      ]
    },
    {
      "id": "teams-ui-chat-card-section-weather",
      "feature": "Adaptive Card section renderer",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Section Weather",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Section Weather.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Section Weather, then capture the after state.",
        "input": "Chat Card Section Weather",
        "operation": "Exercise chat.card.section.weather and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card Section Weather",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card Section Weather before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Section Weather.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Section Weather control or state is only the trigger for chat.card.section.weather.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.section.weather",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.section.weather result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Section Weather control or state is visible and its precondition is readable.",
        "after": "The Chat Card Section Weather branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.section.weather.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card Section Weather."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.section.weather and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.section.weather."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.section.weather"
      ]
    },
    {
      "id": "teams-ui-chat-card-section-list",
      "feature": "Adaptive Card section renderer",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Section List",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Section List.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Section List, then capture the after state.",
        "input": "Chat Card Section List",
        "operation": "Exercise chat.card.section.list and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card Section List",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card Section List before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Section List.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Section List control or state is only the trigger for chat.card.section.list.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.section.list",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.section.list result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Section List control or state is visible and its precondition is readable.",
        "after": "The Chat Card Section List branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.section.list.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card Section List."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.section.list and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.section.list."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.section.list"
      ]
    },
    {
      "id": "teams-ui-chat-card-section-progress",
      "feature": "Adaptive Card section renderer",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Section Progress",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Section Progress.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Section Progress, then capture the after state.",
        "input": "Chat Card Section Progress",
        "operation": "Exercise chat.card.section.progress and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card Section Progress",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card Section Progress before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Section Progress.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Section Progress control or state is only the trigger for chat.card.section.progress.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.section.progress",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.section.progress result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Section Progress control or state is visible and its precondition is readable.",
        "after": "The Chat Card Section Progress branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.section.progress.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card Section Progress."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.section.progress and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.section.progress."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.section.progress"
      ]
    },
    {
      "id": "teams-ui-chat-card-section-status",
      "feature": "Adaptive Card section renderer",
      "surface": "teams-chat",
      "location": "Adaptive Card in the 업무 허브 chat",
      "branch": "Chat Card Section Status",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Card Section Status.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Card Section Status, then capture the after state.",
        "input": "Chat Card Section Status",
        "operation": "Exercise chat.card.section.status and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Chat Card Section Status",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Chat Card Section Status before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Card Section Status.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Chat Card Section Status control or state is only the trigger for chat.card.section.status.",
        "handler": "src/server/genui-teams.ts#renderGenUiCardFromEnvelope",
        "request": "Adaptive Card action payload for chat.card.section.status",
        "resultProof": "Record the actual server/runtime response and prove the chat.card.section.status result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Card Section Status control or state is visible and its precondition is readable.",
        "after": "The Chat Card Section Status branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.card.section.status.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Chat Card Section Status."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.card.section.status and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.card.section.status."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.card.section.status"
      ]
    },
    {
      "id": "teams-ui-chat-auth-expired",
      "feature": "chat authentication",
      "surface": "teams-chat",
      "location": "chat message and Bot reply",
      "branch": "Chat Auth Expired",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Auth Expired.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Auth Expired, then capture the after state.",
        "input": "Chat Auth Expired",
        "operation": "Exercise chat.auth.expired and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Auth Expired",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Auth Expired before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Auth Expired.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Auth Expired control or state is only the trigger for chat.auth.expired.",
        "handler": "src/server/user-auth.ts#createUserAuthMiddleware",
        "request": "Runtime transition for chat.auth.expired",
        "resultProof": "Record the actual server/runtime response and prove the chat.auth.expired result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Auth Expired control or state is visible and its precondition is readable.",
        "after": "The Chat Auth Expired branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.auth.expired.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Auth Expired."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.auth.expired and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.auth.expired."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.auth.expired"
      ]
    },
    {
      "id": "teams-ui-chat-auth-retry",
      "feature": "chat authentication",
      "surface": "teams-chat",
      "location": "chat message and Bot reply",
      "branch": "Chat Auth Retry",
      "precondition": "Use the current teams-chat build and establish the branch precondition for Chat Auth Retry.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Chat Auth Retry, then capture the after state.",
        "input": "Chat Auth Retry",
        "operation": "Exercise chat.auth.retry and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Chat Auth Retry",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Chat Auth Retry before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Chat Auth Retry.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Chat Auth Retry control or state is only the trigger for chat.auth.retry.",
        "handler": "src/server/user-auth.ts#createUserAuthMiddleware",
        "request": "Runtime transition for chat.auth.retry",
        "resultProof": "Record the actual server/runtime response and prove the chat.auth.retry result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Chat Auth Retry control or state is visible and its precondition is readable.",
        "after": "The Chat Auth Retry branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for chat.auth.retry.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Chat Auth Retry."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for chat.auth.retry and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for chat.auth.retry."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "chat.auth.retry"
      ]
    },
    {
      "id": "teams-ui-personal-home-hero",
      "feature": "personal tab section",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Home Hero",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Home Hero.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Home Hero, then capture the after state.",
        "input": "Personal Home Hero",
        "operation": "Exercise personal.home.hero and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Home Hero",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Home Hero before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Home Hero.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Home Hero control or state is only the trigger for personal.home.hero.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.home.hero",
        "resultProof": "Record the actual server/runtime response and prove the personal.home.hero result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Home Hero control or state is visible and its precondition is readable.",
        "after": "The Personal Home Hero branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.home.hero.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Home Hero."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.home.hero and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.home.hero."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.home.hero"
      ]
    },
    {
      "id": "teams-ui-personal-home-runtime-panel",
      "feature": "personal tab section",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Home Runtime Panel",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Home Runtime Panel.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Home Runtime Panel, then capture the after state.",
        "input": "Personal Home Runtime Panel",
        "operation": "Exercise personal.home.runtime-panel and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Home Runtime Panel",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Home Runtime Panel before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Home Runtime Panel.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Home Runtime Panel control or state is only the trigger for personal.home.runtime-panel.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.home.runtime-panel",
        "resultProof": "Record the actual server/runtime response and prove the personal.home.runtime-panel result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Home Runtime Panel control or state is visible and its precondition is readable.",
        "after": "The Personal Home Runtime Panel branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.home.runtime-panel.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Home Runtime Panel."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.home.runtime-panel and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.home.runtime-panel."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.home.runtime-panel"
      ]
    },
    {
      "id": "teams-ui-personal-home-response-mode",
      "feature": "personal tab section",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Home Response Mode",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Home Response Mode.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Home Response Mode, then capture the after state.",
        "input": "Personal Home Response Mode",
        "operation": "Exercise personal.home.response-mode and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Home Response Mode",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Home Response Mode before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Home Response Mode.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Home Response Mode control or state is only the trigger for personal.home.response-mode.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.home.response-mode",
        "resultProof": "Record the actual server/runtime response and prove the personal.home.response-mode result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Home Response Mode control or state is visible and its precondition is readable.",
        "after": "The Personal Home Response Mode branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.home.response-mode.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Home Response Mode."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.home.response-mode and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.home.response-mode."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.home.response-mode"
      ]
    },
    {
      "id": "teams-ui-personal-home-weather",
      "feature": "personal tab section",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Home Weather",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Home Weather.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Home Weather, then capture the after state.",
        "input": "Personal Home Weather",
        "operation": "Exercise personal.home.weather and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Home Weather",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Home Weather before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Home Weather.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Home Weather control or state is only the trigger for personal.home.weather.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.home.weather",
        "resultProof": "Record the actual server/runtime response and prove the personal.home.weather result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Home Weather control or state is visible and its precondition is readable.",
        "after": "The Personal Home Weather branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.home.weather.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Home Weather."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.home.weather and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.home.weather."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.home.weather"
      ]
    },
    {
      "id": "teams-ui-personal-home-items",
      "feature": "personal tab section",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Home Items",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Home Items.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Home Items, then capture the after state.",
        "input": "Personal Home Items",
        "operation": "Exercise personal.home.items and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Home Items",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Home Items before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Home Items.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Home Items control or state is only the trigger for personal.home.items.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.home.items",
        "resultProof": "Record the actual server/runtime response and prove the personal.home.items result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Home Items control or state is visible and its precondition is readable.",
        "after": "The Personal Home Items branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.home.items.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Home Items."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.home.items and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.home.items."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.home.items"
      ]
    },
    {
      "id": "teams-ui-personal-home-copilot",
      "feature": "personal tab section",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Home Copilot",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Home Copilot.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Home Copilot, then capture the after state.",
        "input": "Personal Home Copilot",
        "operation": "Exercise personal.home.copilot and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Home Copilot",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Home Copilot before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Home Copilot.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Home Copilot control or state is only the trigger for personal.home.copilot.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.home.copilot",
        "resultProof": "Record the actual server/runtime response and prove the personal.home.copilot result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Home Copilot control or state is visible and its precondition is readable.",
        "after": "The Personal Home Copilot branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.home.copilot.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Home Copilot."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.home.copilot and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.home.copilot."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.home.copilot"
      ]
    },
    {
      "id": "teams-ui-personal-home-footer",
      "feature": "personal tab section",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Home Footer",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Home Footer.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Home Footer, then capture the after state.",
        "input": "Personal Home Footer",
        "operation": "Exercise personal.home.footer and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Home Footer",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Home Footer before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Home Footer.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Home Footer control or state is only the trigger for personal.home.footer.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.home.footer",
        "resultProof": "Record the actual server/runtime response and prove the personal.home.footer result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Home Footer control or state is visible and its precondition is readable.",
        "after": "The Personal Home Footer branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.home.footer.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Home Footer."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.home.footer and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.home.footer."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.home.footer"
      ]
    },
    {
      "id": "teams-ui-personal-loading-initial",
      "feature": "personal tab loading state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Loading Initial",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Loading Initial.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Loading Initial, then capture the after state.",
        "input": "Personal Loading Initial",
        "operation": "Exercise personal.loading.initial and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Loading Initial",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Loading Initial before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Loading Initial.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Loading Initial control or state is only the trigger for personal.loading.initial.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.loading.initial",
        "resultProof": "Record the actual server/runtime response and prove the personal.loading.initial result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Loading Initial control or state is visible and its precondition is readable.",
        "after": "The Personal Loading Initial branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.loading.initial.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Loading Initial."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.loading.initial and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.loading.initial."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.loading.initial"
      ]
    },
    {
      "id": "teams-ui-personal-loading-response-mode",
      "feature": "personal tab loading state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Loading Response Mode",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Loading Response Mode.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Loading Response Mode, then capture the after state.",
        "input": "Personal Loading Response Mode",
        "operation": "Exercise personal.loading.response-mode and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Loading Response Mode",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Loading Response Mode before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Loading Response Mode.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Loading Response Mode control or state is only the trigger for personal.loading.response-mode.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.loading.response-mode",
        "resultProof": "Record the actual server/runtime response and prove the personal.loading.response-mode result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Loading Response Mode control or state is visible and its precondition is readable.",
        "after": "The Personal Loading Response Mode branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.loading.response-mode.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Loading Response Mode."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.loading.response-mode and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.loading.response-mode."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.loading.response-mode"
      ]
    },
    {
      "id": "teams-ui-personal-loading-weather",
      "feature": "personal tab loading state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Loading Weather",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Loading Weather.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Loading Weather, then capture the after state.",
        "input": "Personal Loading Weather",
        "operation": "Exercise personal.loading.weather and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Loading Weather",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Loading Weather before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Loading Weather.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Loading Weather control or state is only the trigger for personal.loading.weather.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.loading.weather",
        "resultProof": "Record the actual server/runtime response and prove the personal.loading.weather result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Loading Weather control or state is visible and its precondition is readable.",
        "after": "The Personal Loading Weather branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.loading.weather.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Loading Weather."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.loading.weather and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.loading.weather."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.loading.weather"
      ]
    },
    {
      "id": "teams-ui-personal-loading-items",
      "feature": "personal tab loading state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Loading Items",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Loading Items.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Loading Items, then capture the after state.",
        "input": "Personal Loading Items",
        "operation": "Exercise personal.loading.items and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Loading Items",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Loading Items before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Loading Items.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Loading Items control or state is only the trigger for personal.loading.items.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.loading.items",
        "resultProof": "Record the actual server/runtime response and prove the personal.loading.items result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Loading Items control or state is visible and its precondition is readable.",
        "after": "The Personal Loading Items branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.loading.items.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Loading Items."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.loading.items and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.loading.items."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.loading.items"
      ]
    },
    {
      "id": "teams-ui-personal-error-runtime",
      "feature": "personal tab error state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Error Runtime",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Error Runtime.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Error Runtime, then capture the after state.",
        "input": "Personal Error Runtime",
        "operation": "Exercise personal.error.runtime and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Error Runtime",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Error Runtime before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Error Runtime.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Error Runtime control or state is only the trigger for personal.error.runtime.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.error.runtime",
        "resultProof": "Record the actual server/runtime response and prove the personal.error.runtime result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Error Runtime control or state is visible and its precondition is readable.",
        "after": "The Personal Error Runtime branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.error.runtime.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Error Runtime."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.error.runtime and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.error.runtime."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.error.runtime"
      ]
    },
    {
      "id": "teams-ui-personal-error-response-mode",
      "feature": "personal tab error state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Error Response Mode",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Error Response Mode.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Error Response Mode, then capture the after state.",
        "input": "Personal Error Response Mode",
        "operation": "Exercise personal.error.response-mode and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Error Response Mode",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Error Response Mode before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Error Response Mode.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Error Response Mode control or state is only the trigger for personal.error.response-mode.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.error.response-mode",
        "resultProof": "Record the actual server/runtime response and prove the personal.error.response-mode result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Error Response Mode control or state is visible and its precondition is readable.",
        "after": "The Personal Error Response Mode branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.error.response-mode.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Error Response Mode."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.error.response-mode and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.error.response-mode."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.error.response-mode"
      ]
    },
    {
      "id": "teams-ui-personal-error-weather",
      "feature": "personal tab error state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Error Weather",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Error Weather.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Error Weather, then capture the after state.",
        "input": "Personal Error Weather",
        "operation": "Exercise personal.error.weather and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Error Weather",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Error Weather before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Error Weather.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Error Weather control or state is only the trigger for personal.error.weather.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.error.weather",
        "resultProof": "Record the actual server/runtime response and prove the personal.error.weather result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Error Weather control or state is visible and its precondition is readable.",
        "after": "The Personal Error Weather branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.error.weather.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Error Weather."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.error.weather and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.error.weather."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.error.weather"
      ]
    },
    {
      "id": "teams-ui-personal-error-items",
      "feature": "personal tab error state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Error Items",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Error Items.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Error Items, then capture the after state.",
        "input": "Personal Error Items",
        "operation": "Exercise personal.error.items and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Error Items",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Error Items before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Error Items.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Error Items control or state is only the trigger for personal.error.items.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.error.items",
        "resultProof": "Record the actual server/runtime response and prove the personal.error.items result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Error Items control or state is visible and its precondition is readable.",
        "after": "The Personal Error Items branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.error.items.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Error Items."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.error.items and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.error.items."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.error.items"
      ]
    },
    {
      "id": "teams-ui-personal-retry-runtime",
      "feature": "personal tab retry",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Retry Runtime",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Retry Runtime.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Retry Runtime, then capture the after state.",
        "input": "Personal Retry Runtime",
        "operation": "Exercise personal.retry.runtime and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Retry Runtime",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Retry Runtime before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Retry Runtime.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Retry Runtime control or state is only the trigger for personal.retry.runtime.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.retry.runtime",
        "resultProof": "Record the actual server/runtime response and prove the personal.retry.runtime result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Retry Runtime control or state is visible and its precondition is readable.",
        "after": "The Personal Retry Runtime branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.retry.runtime.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Retry Runtime."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.retry.runtime and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.retry.runtime."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.retry.runtime"
      ]
    },
    {
      "id": "teams-ui-personal-retry-weather",
      "feature": "personal tab retry",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Retry Weather",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Retry Weather.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Retry Weather, then capture the after state.",
        "input": "Personal Retry Weather",
        "operation": "Exercise personal.retry.weather and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Retry Weather",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Retry Weather before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Retry Weather.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Retry Weather control or state is only the trigger for personal.retry.weather.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.retry.weather",
        "resultProof": "Record the actual server/runtime response and prove the personal.retry.weather result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Retry Weather control or state is visible and its precondition is readable.",
        "after": "The Personal Retry Weather branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.retry.weather.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Retry Weather."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.retry.weather and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.retry.weather."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.retry.weather"
      ]
    },
    {
      "id": "teams-ui-personal-retry-items",
      "feature": "personal tab retry",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Retry Items",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Retry Items.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Retry Items, then capture the after state.",
        "input": "Personal Retry Items",
        "operation": "Exercise personal.retry.items and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Retry Items",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Retry Items before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Retry Items.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Retry Items control or state is only the trigger for personal.retry.items.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.retry.items",
        "resultProof": "Record the actual server/runtime response and prove the personal.retry.items result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Retry Items control or state is visible and its precondition is readable.",
        "after": "The Personal Retry Items branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.retry.items.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Retry Items."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.retry.items and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.retry.items."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.retry.items"
      ]
    },
    {
      "id": "teams-ui-personal-empty-weather",
      "feature": "personal tab empty state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Empty Weather",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Empty Weather.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Empty Weather, then capture the after state.",
        "input": "Personal Empty Weather",
        "operation": "Exercise personal.empty.weather and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Empty Weather",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Empty Weather before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Empty Weather.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Empty Weather control or state is only the trigger for personal.empty.weather.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.empty.weather",
        "resultProof": "Record the actual server/runtime response and prove the personal.empty.weather result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Empty Weather control or state is visible and its precondition is readable.",
        "after": "The Personal Empty Weather branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.empty.weather.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Empty Weather."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.empty.weather and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.empty.weather."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.empty.weather"
      ]
    },
    {
      "id": "teams-ui-personal-empty-items",
      "feature": "personal tab empty state",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Empty Items",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Empty Items.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Empty Items, then capture the after state.",
        "input": "Personal Empty Items",
        "operation": "Exercise personal.empty.items and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Empty Items",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Empty Items before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Empty Items.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Empty Items control or state is only the trigger for personal.empty.items.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.empty.items",
        "resultProof": "Record the actual server/runtime response and prove the personal.empty.items result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Empty Items control or state is visible and its precondition is readable.",
        "after": "The Personal Empty Items branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.empty.items.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Empty Items."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.empty.items and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.empty.items."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.empty.items"
      ]
    },
    {
      "id": "teams-ui-personal-auth-expired",
      "feature": "personal tab authentication",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Auth Expired",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Auth Expired.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Auth Expired, then capture the after state.",
        "input": "Personal Auth Expired",
        "operation": "Exercise personal.auth.expired and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Auth Expired",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Auth Expired before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Auth Expired.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Auth Expired control or state is only the trigger for personal.auth.expired.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.auth.expired",
        "resultProof": "Record the actual server/runtime response and prove the personal.auth.expired result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Auth Expired control or state is visible and its precondition is readable.",
        "after": "The Personal Auth Expired branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.auth.expired.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Auth Expired."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.auth.expired and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.auth.expired."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.auth.expired"
      ]
    },
    {
      "id": "teams-ui-personal-auth-retry",
      "feature": "personal tab authentication",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Auth Retry",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Auth Retry.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Auth Retry, then capture the after state.",
        "input": "Personal Auth Retry",
        "operation": "Exercise personal.auth.retry and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Auth Retry",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Auth Retry before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Auth Retry.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Auth Retry control or state is only the trigger for personal.auth.retry.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.auth.retry",
        "resultProof": "Record the actual server/runtime response and prove the personal.auth.retry result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Auth Retry control or state is visible and its precondition is readable.",
        "after": "The Personal Auth Retry branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.auth.retry.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Auth Retry."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.auth.retry and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.auth.retry."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.auth.retry"
      ]
    },
    {
      "id": "teams-ui-personal-response-mode-ready",
      "feature": "personal response mode",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Response Mode Ready",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Response Mode Ready.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Response Mode Ready, then capture the after state.",
        "input": "Personal Response Mode Ready",
        "operation": "Exercise personal.response-mode.ready and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "radio",
        "label": "Personal Response Mode Ready",
        "presenceAssertion": "Fresh AX evidence must show the expected radio or rendered state for Personal Response Mode Ready before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Response Mode Ready.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Response Mode Ready control or state is only the trigger for personal.response-mode.ready.",
        "handler": "src/client/ResponseModeSelector.tsx#useResponseMode and /api/response-mode",
        "request": "GET/POST /api/response-mode for personal.response-mode.ready",
        "resultProof": "Record the actual server/runtime response and prove the personal.response-mode.ready result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Response Mode Ready control or state is visible and its precondition is readable.",
        "after": "The Personal Response Mode Ready branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.response-mode.ready.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Personal Response Mode Ready."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.response-mode.ready and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.response-mode.ready."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.response-mode.ready"
      ]
    },
    {
      "id": "teams-ui-personal-response-mode-saving",
      "feature": "personal response mode",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Response Mode Saving",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Response Mode Saving.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Response Mode Saving, then capture the after state.",
        "input": "Personal Response Mode Saving",
        "operation": "Exercise personal.response-mode.saving and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "radio",
        "label": "Personal Response Mode Saving",
        "presenceAssertion": "Fresh AX evidence must show the expected radio or rendered state for Personal Response Mode Saving before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Response Mode Saving.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Response Mode Saving control or state is only the trigger for personal.response-mode.saving.",
        "handler": "src/client/ResponseModeSelector.tsx#useResponseMode and /api/response-mode",
        "request": "GET/POST /api/response-mode for personal.response-mode.saving",
        "resultProof": "Record the actual server/runtime response and prove the personal.response-mode.saving result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Response Mode Saving control or state is visible and its precondition is readable.",
        "after": "The Personal Response Mode Saving branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.response-mode.saving.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Personal Response Mode Saving."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.response-mode.saving and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.response-mode.saving."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.response-mode.saving"
      ]
    },
    {
      "id": "teams-ui-personal-response-mode-unconfigured",
      "feature": "personal response mode",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Response Mode Unconfigured",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Response Mode Unconfigured.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Response Mode Unconfigured, then capture the after state.",
        "input": "Personal Response Mode Unconfigured",
        "operation": "Exercise personal.response-mode.unconfigured and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "radio",
        "label": "Personal Response Mode Unconfigured",
        "presenceAssertion": "Fresh AX evidence must show the expected radio or rendered state for Personal Response Mode Unconfigured before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Response Mode Unconfigured.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Response Mode Unconfigured control or state is only the trigger for personal.response-mode.unconfigured.",
        "handler": "src/client/ResponseModeSelector.tsx#useResponseMode and /api/response-mode",
        "request": "GET/POST /api/response-mode for personal.response-mode.unconfigured",
        "resultProof": "Record the actual server/runtime response and prove the personal.response-mode.unconfigured result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Response Mode Unconfigured control or state is visible and its precondition is readable.",
        "after": "The Personal Response Mode Unconfigured branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.response-mode.unconfigured.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Personal Response Mode Unconfigured."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.response-mode.unconfigured and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.response-mode.unconfigured."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.response-mode.unconfigured"
      ]
    },
    {
      "id": "teams-ui-personal-weather-permission-allow-browser",
      "feature": "personal weather",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Weather Permission Allow Browser",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Weather Permission Allow Browser.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Weather Permission Allow Browser, then capture the after state.",
        "input": "Personal Weather Permission Allow Browser",
        "operation": "Exercise personal.weather.permission.allow.browser and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Weather Permission Allow Browser",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Weather Permission Allow Browser before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Weather Permission Allow Browser.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Weather Permission Allow Browser control or state is only the trigger for personal.weather.permission.allow.browser.",
        "handler": "src/client/App.tsx#loadWeather and GET /api/weather",
        "request": "GET /api/weather with location/permission branch for personal.weather.permission.allow.browser",
        "resultProof": "Record the actual server/runtime response and prove the personal.weather.permission.allow.browser result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Weather Permission Allow Browser control or state is visible and its precondition is readable.",
        "after": "The Personal Weather Permission Allow Browser branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.weather.permission.allow.browser.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Weather Permission Allow Browser."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.weather.permission.allow.browser and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.weather.permission.allow.browser."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.weather.permission.allow.browser"
      ]
    },
    {
      "id": "teams-ui-personal-weather-permission-allow-teams-native",
      "feature": "personal weather",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Weather Permission Allow Teams Native",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Weather Permission Allow Teams Native.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Weather Permission Allow Teams Native, then capture the after state.",
        "input": "Personal Weather Permission Allow Teams Native",
        "operation": "Exercise personal.weather.permission.allow.teams-native and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Weather Permission Allow Teams Native",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Weather Permission Allow Teams Native before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Weather Permission Allow Teams Native.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Weather Permission Allow Teams Native control or state is only the trigger for personal.weather.permission.allow.teams-native.",
        "handler": "src/client/App.tsx#loadWeather and GET /api/weather",
        "request": "GET /api/weather with location/permission branch for personal.weather.permission.allow.teams-native",
        "resultProof": "Record the actual server/runtime response and prove the personal.weather.permission.allow.teams-native result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Weather Permission Allow Teams Native control or state is visible and its precondition is readable.",
        "after": "The Personal Weather Permission Allow Teams Native branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.weather.permission.allow.teams-native.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Weather Permission Allow Teams Native."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.weather.permission.allow.teams-native and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.weather.permission.allow.teams-native."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.weather.permission.allow.teams-native"
      ]
    },
    {
      "id": "teams-ui-personal-weather-permission-deny-browser",
      "feature": "personal weather",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Weather Permission Deny Browser",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Weather Permission Deny Browser.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Weather Permission Deny Browser, then capture the after state.",
        "input": "Personal Weather Permission Deny Browser",
        "operation": "Exercise personal.weather.permission.deny.browser and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Weather Permission Deny Browser",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Weather Permission Deny Browser before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Weather Permission Deny Browser.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Weather Permission Deny Browser control or state is only the trigger for personal.weather.permission.deny.browser.",
        "handler": "src/client/App.tsx#loadWeather and GET /api/weather",
        "request": "GET /api/weather with location/permission branch for personal.weather.permission.deny.browser",
        "resultProof": "Record the actual server/runtime response and prove the personal.weather.permission.deny.browser result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Weather Permission Deny Browser control or state is visible and its precondition is readable.",
        "after": "The Personal Weather Permission Deny Browser branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.weather.permission.deny.browser.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Weather Permission Deny Browser."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.weather.permission.deny.browser and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.weather.permission.deny.browser."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.weather.permission.deny.browser"
      ]
    },
    {
      "id": "teams-ui-personal-weather-permission-deny-teams-native",
      "feature": "personal weather",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Weather Permission Deny Teams Native",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Weather Permission Deny Teams Native.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Weather Permission Deny Teams Native, then capture the after state.",
        "input": "Personal Weather Permission Deny Teams Native",
        "operation": "Exercise personal.weather.permission.deny.teams-native and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Weather Permission Deny Teams Native",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Weather Permission Deny Teams Native before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Weather Permission Deny Teams Native.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Weather Permission Deny Teams Native control or state is only the trigger for personal.weather.permission.deny.teams-native.",
        "handler": "src/client/App.tsx#loadWeather and GET /api/weather",
        "request": "GET /api/weather with location/permission branch for personal.weather.permission.deny.teams-native",
        "resultProof": "Record the actual server/runtime response and prove the personal.weather.permission.deny.teams-native result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Weather Permission Deny Teams Native control or state is visible and its precondition is readable.",
        "after": "The Personal Weather Permission Deny Teams Native branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.weather.permission.deny.teams-native.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Weather Permission Deny Teams Native."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.weather.permission.deny.teams-native and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.weather.permission.deny.teams-native."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.weather.permission.deny.teams-native"
      ]
    },
    {
      "id": "teams-ui-personal-weather-provider-demo",
      "feature": "personal weather",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Weather Provider Demo",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Weather Provider Demo.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Weather Provider Demo, then capture the after state.",
        "input": "Personal Weather Provider Demo",
        "operation": "Exercise personal.weather.provider.demo and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Weather Provider Demo",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Weather Provider Demo before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Weather Provider Demo.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Weather Provider Demo control or state is only the trigger for personal.weather.provider.demo.",
        "handler": "src/client/App.tsx#loadWeather and GET /api/weather",
        "request": "GET /api/weather with location/permission branch for personal.weather.provider.demo",
        "resultProof": "Record the actual server/runtime response and prove the personal.weather.provider.demo result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Weather Provider Demo control or state is visible and its precondition is readable.",
        "after": "The Personal Weather Provider Demo branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.weather.provider.demo.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Weather Provider Demo."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.weather.provider.demo and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.weather.provider.demo."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.weather.provider.demo"
      ]
    },
    {
      "id": "teams-ui-personal-weather-server-error",
      "feature": "personal weather",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Weather Server Error",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Weather Server Error.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Weather Server Error, then capture the after state.",
        "input": "Personal Weather Server Error",
        "operation": "Exercise personal.weather.server-error and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Weather Server Error",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Weather Server Error before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Weather Server Error.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Weather Server Error control or state is only the trigger for personal.weather.server-error.",
        "handler": "src/client/App.tsx#loadWeather and GET /api/weather",
        "request": "GET /api/weather with location/permission branch for personal.weather.server-error",
        "resultProof": "Record the actual server/runtime response and prove the personal.weather.server-error result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Weather Server Error control or state is visible and its precondition is readable.",
        "after": "The Personal Weather Server Error branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.weather.server-error.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Weather Server Error."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.weather.server-error and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.weather.server-error."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.weather.server-error"
      ]
    },
    {
      "id": "teams-ui-personal-filter-all",
      "feature": "personal filter",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Filter All",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Filter All.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Filter All, then capture the after state.",
        "input": "Personal Filter All",
        "operation": "Exercise personal.filter.all and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "전체",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 전체 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 전체.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Filter All control or state is only the trigger for personal.filter.all.",
        "handler": "src/client/App.tsx#visibleItems",
        "request": "Runtime transition for personal.filter.all",
        "resultProof": "Record the actual server/runtime response and prove the personal.filter.all result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Filter All control or state is visible and its precondition is readable.",
        "after": "The Personal Filter All branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.filter.all.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Personal Filter All."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.filter.all and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.filter.all."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.filter.all"
      ]
    },
    {
      "id": "teams-ui-personal-filter-open",
      "feature": "personal filter",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Filter Open",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Filter Open.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Filter Open, then capture the after state.",
        "input": "Personal Filter Open",
        "operation": "Exercise personal.filter.open and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "진행 중",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 진행 중 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 진행 중.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Filter Open control or state is only the trigger for personal.filter.open.",
        "handler": "src/client/App.tsx#visibleItems",
        "request": "Runtime transition for personal.filter.open",
        "resultProof": "Record the actual server/runtime response and prove the personal.filter.open result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Filter Open control or state is visible and its precondition is readable.",
        "after": "The Personal Filter Open branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.filter.open.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Personal Filter Open."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.filter.open and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.filter.open."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.filter.open"
      ]
    },
    {
      "id": "teams-ui-personal-filter-done",
      "feature": "personal filter",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Filter Done",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Filter Done.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Filter Done, then capture the after state.",
        "input": "Personal Filter Done",
        "operation": "Exercise personal.filter.done and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "완료",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for 완료 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 완료.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Filter Done control or state is only the trigger for personal.filter.done.",
        "handler": "src/client/App.tsx#visibleItems",
        "request": "Runtime transition for personal.filter.done",
        "resultProof": "Record the actual server/runtime response and prove the personal.filter.done result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Filter Done control or state is visible and its precondition is readable.",
        "after": "The Personal Filter Done branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.filter.done.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Personal Filter Done."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.filter.done and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.filter.done."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.filter.done"
      ]
    },
    {
      "id": "teams-ui-personal-crud-create-success",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Create Success",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Create Success.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Create Success, then capture the after state.",
        "input": "Personal Crud Create Success",
        "operation": "Exercise personal.crud.create.success and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Create Success",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Create Success before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Create Success.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Create Success control or state is only the trigger for personal.crud.create.success.",
        "handler": "src/client/App.tsx#addItem and POST /api/items",
        "request": "HTTP item request/response for personal.crud.create.success",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.create.success result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Create Success control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Create Success branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.create.success.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Create Success."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.create.success and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.create.success."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.create.success"
      ]
    },
    {
      "id": "teams-ui-personal-crud-create-invalid",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Create Invalid",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Create Invalid.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Create Invalid, then capture the after state.",
        "input": "Personal Crud Create Invalid",
        "operation": "Exercise personal.crud.create.invalid and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Create Invalid",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Create Invalid before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Create Invalid.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Create Invalid control or state is only the trigger for personal.crud.create.invalid.",
        "handler": "src/client/App.tsx#addItem and POST /api/items",
        "request": "HTTP item request/response for personal.crud.create.invalid",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.create.invalid result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Create Invalid control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Create Invalid branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.create.invalid.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Create Invalid."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.create.invalid and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.create.invalid."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.create.invalid"
      ]
    },
    {
      "id": "teams-ui-personal-crud-create-server-error",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Create Server Error",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Create Server Error.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Create Server Error, then capture the after state.",
        "input": "Personal Crud Create Server Error",
        "operation": "Exercise personal.crud.create.server-error and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Crud Create Server Error",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Crud Create Server Error before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Create Server Error.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Create Server Error control or state is only the trigger for personal.crud.create.server-error.",
        "handler": "src/client/App.tsx#addItem and POST /api/items",
        "request": "HTTP item request/response for personal.crud.create.server-error",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.create.server-error result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Create Server Error control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Create Server Error branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.create.server-error.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Crud Create Server Error."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.create.server-error and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.create.server-error."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.create.server-error"
      ]
    },
    {
      "id": "teams-ui-personal-crud-read-populated",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Read Populated",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Read Populated.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Read Populated, then capture the after state.",
        "input": "Personal Crud Read Populated",
        "operation": "Exercise personal.crud.read.populated and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Read Populated",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Read Populated before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Read Populated.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Read Populated control or state is only the trigger for personal.crud.read.populated.",
        "handler": "src/client/App.tsx#loadItems and GET /api/items",
        "request": "HTTP item request/response for personal.crud.read.populated",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.read.populated result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Read Populated control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Read Populated branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.read.populated.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Read Populated."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.read.populated and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.read.populated."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.read.populated"
      ]
    },
    {
      "id": "teams-ui-personal-crud-read-empty",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Read Empty",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Read Empty.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Read Empty, then capture the after state.",
        "input": "Personal Crud Read Empty",
        "operation": "Exercise personal.crud.read.empty and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Crud Read Empty",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Crud Read Empty before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Read Empty.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Read Empty control or state is only the trigger for personal.crud.read.empty.",
        "handler": "src/client/App.tsx#loadItems and GET /api/items",
        "request": "HTTP item request/response for personal.crud.read.empty",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.read.empty result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Read Empty control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Read Empty branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.read.empty.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Crud Read Empty."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.read.empty and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.read.empty."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.read.empty"
      ]
    },
    {
      "id": "teams-ui-personal-crud-read-server-error",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Read Server Error",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Read Server Error.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Read Server Error, then capture the after state.",
        "input": "Personal Crud Read Server Error",
        "operation": "Exercise personal.crud.read.server-error and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Crud Read Server Error",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Crud Read Server Error before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Read Server Error.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Read Server Error control or state is only the trigger for personal.crud.read.server-error.",
        "handler": "src/client/App.tsx#loadItems and GET /api/items",
        "request": "HTTP item request/response for personal.crud.read.server-error",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.read.server-error result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Read Server Error control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Read Server Error branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.read.server-error.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Crud Read Server Error."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.read.server-error and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.read.server-error."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.read.server-error"
      ]
    },
    {
      "id": "teams-ui-personal-crud-update-open",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Update Open",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Update Open.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Update Open, then capture the after state.",
        "input": "Personal Crud Update Open",
        "operation": "Exercise personal.crud.update.open and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Update Open",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Update Open before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Update Open.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Update Open control or state is only the trigger for personal.crud.update.open.",
        "handler": "src/client/App.tsx#startEditing/saveEdit and PUT /api/items/:id",
        "request": "HTTP item request/response for personal.crud.update.open",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.update.open result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Update Open control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Update Open branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.update.open.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Update Open."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.update.open and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.update.open."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.update.open"
      ]
    },
    {
      "id": "teams-ui-personal-crud-update-save",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Update Save",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Update Save.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Update Save, then capture the after state.",
        "input": "Personal Crud Update Save",
        "operation": "Exercise personal.crud.update.save and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Update Save",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Update Save before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Update Save.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Update Save control or state is only the trigger for personal.crud.update.save.",
        "handler": "src/client/App.tsx#startEditing/saveEdit and PUT /api/items/:id",
        "request": "HTTP item request/response for personal.crud.update.save",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.update.save result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Update Save control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Update Save branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.update.save.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Update Save."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.update.save and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.update.save."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.update.save"
      ]
    },
    {
      "id": "teams-ui-personal-crud-update-invalid",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Update Invalid",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Update Invalid.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Update Invalid, then capture the after state.",
        "input": "Personal Crud Update Invalid",
        "operation": "Exercise personal.crud.update.invalid and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Update Invalid",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Update Invalid before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Update Invalid.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Update Invalid control or state is only the trigger for personal.crud.update.invalid.",
        "handler": "src/client/App.tsx#startEditing/saveEdit and PUT /api/items/:id",
        "request": "HTTP item request/response for personal.crud.update.invalid",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.update.invalid result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Update Invalid control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Update Invalid branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.update.invalid.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Update Invalid."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.update.invalid and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.update.invalid."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.update.invalid"
      ]
    },
    {
      "id": "teams-ui-personal-crud-update-cancel",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Update Cancel",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Update Cancel.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Update Cancel, then capture the after state.",
        "input": "Personal Crud Update Cancel",
        "operation": "Exercise personal.crud.update.cancel and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Update Cancel",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Update Cancel before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Update Cancel.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Update Cancel control or state is only the trigger for personal.crud.update.cancel.",
        "handler": "src/client/App.tsx#startEditing/saveEdit and PUT /api/items/:id",
        "request": "HTTP item request/response for personal.crud.update.cancel",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.update.cancel result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Update Cancel control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Update Cancel branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.update.cancel.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Update Cancel."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.update.cancel and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.update.cancel."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.update.cancel"
      ]
    },
    {
      "id": "teams-ui-personal-crud-update-server-error",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Update Server Error",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Update Server Error.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Update Server Error, then capture the after state.",
        "input": "Personal Crud Update Server Error",
        "operation": "Exercise personal.crud.update.server-error and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Crud Update Server Error",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Crud Update Server Error before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Update Server Error.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Update Server Error control or state is only the trigger for personal.crud.update.server-error.",
        "handler": "src/client/App.tsx#startEditing/saveEdit and PUT /api/items/:id",
        "request": "HTTP item request/response for personal.crud.update.server-error",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.update.server-error result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Update Server Error control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Update Server Error branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.update.server-error.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Crud Update Server Error."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.update.server-error and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.update.server-error."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.update.server-error"
      ]
    },
    {
      "id": "teams-ui-personal-crud-delete-confirm",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Delete Confirm",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Delete Confirm.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Delete Confirm, then capture the after state.",
        "input": "Personal Crud Delete Confirm",
        "operation": "Exercise personal.crud.delete.confirm and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Delete Confirm",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Delete Confirm before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Delete Confirm.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Delete Confirm control or state is only the trigger for personal.crud.delete.confirm.",
        "handler": "src/client/App.tsx#removeItem and DELETE /api/items/:id",
        "request": "HTTP item request/response for personal.crud.delete.confirm",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.delete.confirm result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Delete Confirm control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Delete Confirm branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.delete.confirm.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Delete Confirm."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.delete.confirm and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.delete.confirm."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.delete.confirm"
      ]
    },
    {
      "id": "teams-ui-personal-crud-delete-cancel",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Delete Cancel",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Delete Cancel.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Delete Cancel, then capture the after state.",
        "input": "Personal Crud Delete Cancel",
        "operation": "Exercise personal.crud.delete.cancel and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Delete Cancel",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Delete Cancel before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Delete Cancel.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Delete Cancel control or state is only the trigger for personal.crud.delete.cancel.",
        "handler": "src/client/App.tsx#removeItem and DELETE /api/items/:id",
        "request": "HTTP item request/response for personal.crud.delete.cancel",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.delete.cancel result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Delete Cancel control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Delete Cancel branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.delete.cancel.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Delete Cancel."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.delete.cancel and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.delete.cancel."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.delete.cancel"
      ]
    },
    {
      "id": "teams-ui-personal-crud-delete-success",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Delete Success",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Delete Success.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Delete Success, then capture the after state.",
        "input": "Personal Crud Delete Success",
        "operation": "Exercise personal.crud.delete.success and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Delete Success",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Delete Success before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Delete Success.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Delete Success control or state is only the trigger for personal.crud.delete.success.",
        "handler": "src/client/App.tsx#removeItem and DELETE /api/items/:id",
        "request": "HTTP item request/response for personal.crud.delete.success",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.delete.success result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Delete Success control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Delete Success branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.delete.success.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Delete Success."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.delete.success and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.delete.success."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.delete.success"
      ]
    },
    {
      "id": "teams-ui-personal-crud-delete-server-error",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Delete Server Error",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Delete Server Error.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Delete Server Error, then capture the after state.",
        "input": "Personal Crud Delete Server Error",
        "operation": "Exercise personal.crud.delete.server-error and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Crud Delete Server Error",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Crud Delete Server Error before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Delete Server Error.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Delete Server Error control or state is only the trigger for personal.crud.delete.server-error.",
        "handler": "src/client/App.tsx#removeItem and DELETE /api/items/:id",
        "request": "HTTP item request/response for personal.crud.delete.server-error",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.delete.server-error result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Delete Server Error control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Delete Server Error branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.delete.server-error.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Crud Delete Server Error."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.delete.server-error and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.delete.server-error."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.delete.server-error"
      ]
    },
    {
      "id": "teams-ui-personal-crud-status-open-to-done",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Status Open To Done",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Status Open To Done.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Status Open To Done, then capture the after state.",
        "input": "Personal Crud Status Open To Done",
        "operation": "Exercise personal.crud.status.open-to-done and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Status Open To Done",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Status Open To Done before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Status Open To Done.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Status Open To Done control or state is only the trigger for personal.crud.status.open-to-done.",
        "handler": "src/client/App.tsx#toggleItem and PATCH /api/items/:id",
        "request": "HTTP item request/response for personal.crud.status.open-to-done",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.status.open-to-done result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Status Open To Done control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Status Open To Done branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.status.open-to-done.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Status Open To Done."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.status.open-to-done and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.status.open-to-done."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.status.open-to-done"
      ]
    },
    {
      "id": "teams-ui-personal-crud-status-done-to-open",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Status Done To Open",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Status Done To Open.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Status Done To Open, then capture the after state.",
        "input": "Personal Crud Status Done To Open",
        "operation": "Exercise personal.crud.status.done-to-open and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Crud Status Done To Open",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Crud Status Done To Open before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Status Done To Open.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Status Done To Open control or state is only the trigger for personal.crud.status.done-to-open.",
        "handler": "src/client/App.tsx#toggleItem and PATCH /api/items/:id",
        "request": "HTTP item request/response for personal.crud.status.done-to-open",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.status.done-to-open result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Status Done To Open control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Status Done To Open branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.status.done-to-open.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Crud Status Done To Open."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.status.done-to-open and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.status.done-to-open."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.status.done-to-open"
      ]
    },
    {
      "id": "teams-ui-personal-crud-status-server-error",
      "feature": "personal item CRUD",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Crud Status Server Error",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Crud Status Server Error.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Crud Status Server Error, then capture the after state.",
        "input": "Personal Crud Status Server Error",
        "operation": "Exercise personal.crud.status.server-error and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Crud Status Server Error",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Crud Status Server Error before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Crud Status Server Error.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Crud Status Server Error control or state is only the trigger for personal.crud.status.server-error.",
        "handler": "src/client/App.tsx#toggleItem and PATCH /api/items/:id",
        "request": "HTTP item request/response for personal.crud.status.server-error",
        "resultProof": "Record the actual server/runtime response and prove the personal.crud.status.server-error result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Crud Status Server Error control or state is visible and its precondition is readable.",
        "after": "The Personal Crud Status Server Error branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.crud.status.server-error.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Crud Status Server Error."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.crud.status.server-error and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.crud.status.server-error."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.crud.status.server-error"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-lazy-loading",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Lazy Loading",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Lazy Loading.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Lazy Loading, then capture the after state.",
        "input": "Personal Copilot Lazy Loading",
        "operation": "Exercise personal.copilot.lazy-loading and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Copilot Lazy Loading",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Copilot Lazy Loading before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Lazy Loading.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Lazy Loading control or state is only the trigger for personal.copilot.lazy-loading.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.lazy-loading",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.lazy-loading result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Lazy Loading control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Lazy Loading branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.lazy-loading.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Copilot Lazy Loading."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.lazy-loading and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.lazy-loading."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.lazy-loading"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-ready",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Ready",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Ready.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Ready, then capture the after state.",
        "input": "Personal Copilot Ready",
        "operation": "Exercise personal.copilot.ready and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Ready",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Ready before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Ready.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Ready control or state is only the trigger for personal.copilot.ready.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.ready",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.ready result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Ready control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Ready branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.ready.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Ready."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.ready and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.ready."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.ready"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-prompt-menu",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Prompt Menu",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Prompt Menu.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Prompt Menu, then capture the after state.",
        "input": "Personal Copilot Prompt Menu",
        "operation": "Exercise personal.copilot.prompt-menu and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Prompt Menu",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Prompt Menu before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Prompt Menu.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Prompt Menu control or state is only the trigger for personal.copilot.prompt-menu.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.prompt-menu",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.prompt-menu result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Prompt Menu control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Prompt Menu branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.prompt-menu.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Prompt Menu."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.prompt-menu and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.prompt-menu."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.prompt-menu"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-weather-tool",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Weather Tool",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Weather Tool.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Weather Tool, then capture the after state.",
        "input": "Personal Copilot Weather Tool",
        "operation": "Exercise personal.copilot.weather-tool and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Weather Tool",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Weather Tool before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Weather Tool.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Copilot Weather Tool control or state is only the trigger for personal.copilot.weather-tool.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.weather-tool",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.weather-tool result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Weather Tool control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Weather Tool branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.weather-tool.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Weather Tool."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.weather-tool and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.weather-tool."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.weather-tool"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-task-tool",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Task Tool",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Task Tool.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Task Tool, then capture the after state.",
        "input": "Personal Copilot Task Tool",
        "operation": "Exercise personal.copilot.task-tool and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Task Tool",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Task Tool before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Task Tool.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Task Tool control or state is only the trigger for personal.copilot.task-tool.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.task-tool",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.task-tool result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Task Tool control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Task Tool branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.task-tool.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Task Tool."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.task-tool and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.task-tool."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.task-tool"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-approval-visible",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Approval Visible",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Approval Visible.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Approval Visible, then capture the after state.",
        "input": "Personal Copilot Approval Visible",
        "operation": "Exercise personal.copilot.approval-visible and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Approval Visible",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Approval Visible before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Approval Visible.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Approval Visible control or state is only the trigger for personal.copilot.approval-visible.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.approval-visible",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.approval-visible result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Approval Visible control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Approval Visible branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.approval-visible.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Approval Visible."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.approval-visible and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.approval-visible."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.approval-visible"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-approve-success",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Approve Success",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Approve Success.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Approve Success, then capture the after state.",
        "input": "Personal Copilot Approve Success",
        "operation": "Exercise personal.copilot.approve.success and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Approve Success",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Approve Success before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Approve Success.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Approve Success control or state is only the trigger for personal.copilot.approve.success.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.approve.success",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.approve.success result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Approve Success control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Approve Success branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.approve.success.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Approve Success."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.approve.success and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.approve.success."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.approve.success"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-cancel-success",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Cancel Success",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Cancel Success.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Cancel Success, then capture the after state.",
        "input": "Personal Copilot Cancel Success",
        "operation": "Exercise personal.copilot.cancel.success and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Cancel Success",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Cancel Success before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Cancel Success.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Cancel Success control or state is only the trigger for personal.copilot.cancel.success.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.cancel.success",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.cancel.success result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Cancel Success control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Cancel Success branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.cancel.success.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Cancel Success."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.cancel.success and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.cancel.success."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.cancel.success"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-approval-conflict",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Approval Conflict",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Approval Conflict.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Approval Conflict, then capture the after state.",
        "input": "Personal Copilot Approval Conflict",
        "operation": "Exercise personal.copilot.approval.conflict and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Approval Conflict",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Approval Conflict before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Approval Conflict.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Approval Conflict control or state is only the trigger for personal.copilot.approval.conflict.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.approval.conflict",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.approval.conflict result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Approval Conflict control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Approval Conflict branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.approval.conflict.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Approval Conflict."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.approval.conflict and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.approval.conflict."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.approval.conflict"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-approval-missing-context",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Approval Missing Context",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Approval Missing Context.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Approval Missing Context, then capture the after state.",
        "input": "Personal Copilot Approval Missing Context",
        "operation": "Exercise personal.copilot.approval.missing-context and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Approval Missing Context",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Approval Missing Context before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Approval Missing Context.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Approval Missing Context control or state is only the trigger for personal.copilot.approval.missing-context.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.approval.missing-context",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.approval.missing-context result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Approval Missing Context control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Approval Missing Context branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.approval.missing-context.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Approval Missing Context."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.approval.missing-context and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.approval.missing-context."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.approval.missing-context"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-approval-auth-expired",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Approval Auth Expired",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Approval Auth Expired.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Approval Auth Expired, then capture the after state.",
        "input": "Personal Copilot Approval Auth Expired",
        "operation": "Exercise personal.copilot.approval.auth-expired and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Approval Auth Expired",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Approval Auth Expired before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Approval Auth Expired.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "http",
        "trigger": "The visible Personal Copilot Approval Auth Expired control or state is only the trigger for personal.copilot.approval.auth-expired.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.approval.auth-expired",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.approval.auth-expired result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Approval Auth Expired control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Approval Auth Expired branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.approval.auth-expired.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Approval Auth Expired."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.approval.auth-expired and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.approval.auth-expired."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.approval.auth-expired"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-runtime-error-retry",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Runtime Error Retry",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Runtime Error Retry.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Runtime Error Retry, then capture the after state.",
        "input": "Personal Copilot Runtime Error Retry",
        "operation": "Exercise personal.copilot.runtime-error.retry and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Copilot Runtime Error Retry",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Copilot Runtime Error Retry before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Runtime Error Retry.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Runtime Error Retry control or state is only the trigger for personal.copilot.runtime-error.retry.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.runtime-error.retry",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.runtime-error.retry result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Runtime Error Retry control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Runtime Error Retry branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.runtime-error.retry.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Copilot Runtime Error Retry."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.runtime-error.retry and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.runtime-error.retry."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.runtime-error.retry"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-runtime-error-reload",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Runtime Error Reload",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Runtime Error Reload.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Runtime Error Reload, then capture the after state.",
        "input": "Personal Copilot Runtime Error Reload",
        "operation": "Exercise personal.copilot.runtime-error.reload and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Personal Copilot Runtime Error Reload",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Personal Copilot Runtime Error Reload before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Runtime Error Reload.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Runtime Error Reload control or state is only the trigger for personal.copilot.runtime-error.reload.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.runtime-error.reload",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.runtime-error.reload result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Runtime Error Reload control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Runtime Error Reload branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.runtime-error.reload.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Personal Copilot Runtime Error Reload."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.runtime-error.reload and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.runtime-error.reload."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.runtime-error.reload"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-ai-feedback-positive",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Ai Feedback Positive",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Ai Feedback Positive.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Ai Feedback Positive, then capture the after state.",
        "input": "Personal Copilot Ai Feedback Positive",
        "operation": "Exercise personal.copilot.ai-feedback.positive and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Ai Feedback Positive",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Ai Feedback Positive before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Ai Feedback Positive.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Ai Feedback Positive control or state is only the trigger for personal.copilot.ai-feedback.positive.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.ai-feedback.positive",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.ai-feedback.positive result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Ai Feedback Positive control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Ai Feedback Positive branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.ai-feedback.positive.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Ai Feedback Positive."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.ai-feedback.positive and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.ai-feedback.positive."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.ai-feedback.positive"
      ]
    },
    {
      "id": "teams-ui-personal-copilot-ai-feedback-negative",
      "feature": "personal CopilotKit surface",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Copilot Ai Feedback Negative",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Copilot Ai Feedback Negative.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Copilot Ai Feedback Negative, then capture the after state.",
        "input": "Personal Copilot Ai Feedback Negative",
        "operation": "Exercise personal.copilot.ai-feedback.negative and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Copilot Ai Feedback Negative",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Copilot Ai Feedback Negative before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Copilot Ai Feedback Negative.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "copilotkit",
        "trigger": "The visible Personal Copilot Ai Feedback Negative control or state is only the trigger for personal.copilot.ai-feedback.negative.",
        "handler": "src/client/CopilotWorkspaceAssistant.tsx#CopilotWorkspaceAssistant",
        "request": "CopilotKit render/action request for personal.copilot.ai-feedback.negative",
        "resultProof": "Record the actual server/runtime response and prove the personal.copilot.ai-feedback.negative result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Copilot Ai Feedback Negative control or state is visible and its precondition is readable.",
        "after": "The Personal Copilot Ai Feedback Negative branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.copilot.ai-feedback.negative.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Copilot Ai Feedback Negative."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.copilot.ai-feedback.negative and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.copilot.ai-feedback.negative."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.copilot.ai-feedback.negative"
      ]
    },
    {
      "id": "teams-ui-personal-mobile-narrow-home",
      "feature": "narrow Teams mobile webview",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Mobile Narrow Home",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Mobile Narrow Home.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Mobile Narrow Home, then capture the after state.",
        "input": "Personal Mobile Narrow Home",
        "operation": "Exercise personal.mobile.narrow-home and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Mobile Narrow Home",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Mobile Narrow Home before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Mobile Narrow Home.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Mobile Narrow Home control or state is only the trigger for personal.mobile.narrow-home.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.mobile.narrow-home",
        "resultProof": "Record the actual server/runtime response and prove the personal.mobile.narrow-home result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Mobile Narrow Home control or state is visible and its precondition is readable.",
        "after": "The Personal Mobile Narrow Home branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.mobile.narrow-home.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Mobile Narrow Home."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.mobile.narrow-home and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.mobile.narrow-home."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.mobile.narrow-home"
      ]
    },
    {
      "id": "teams-ui-personal-mobile-narrow-card",
      "feature": "narrow Teams mobile webview",
      "surface": "teams-personal-tab",
      "location": "/tabs/home/ personal tab",
      "branch": "Personal Mobile Narrow Card",
      "precondition": "Use the current teams-personal-tab build and establish the branch precondition for Personal Mobile Narrow Card.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Personal Mobile Narrow Card, then capture the after state.",
        "input": "Personal Mobile Narrow Card",
        "operation": "Exercise personal.mobile.narrow-card and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Personal Mobile Narrow Card",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Personal Mobile Narrow Card before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Personal Mobile Narrow Card.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "client-state",
        "trigger": "The visible Personal Mobile Narrow Card control or state is only the trigger for personal.mobile.narrow-card.",
        "handler": "src/client/App.tsx#App",
        "request": "Runtime transition for personal.mobile.narrow-card",
        "resultProof": "Record the actual server/runtime response and prove the personal.mobile.narrow-card result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Personal Mobile Narrow Card control or state is visible and its precondition is readable.",
        "after": "The Personal Mobile Narrow Card branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for personal.mobile.narrow-card.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Personal Mobile Narrow Card."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for personal.mobile.narrow-card and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for personal.mobile.narrow-card."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "personal.mobile.narrow-card"
      ]
    },
    {
      "id": "teams-ui-codex-approval-allow",
      "feature": "Codex approval",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Approval Allow",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Approval Allow.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Approval Allow, then capture the after state.",
        "input": "Codex Approval Allow",
        "operation": "Exercise codex.approval.allow and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Codex Approval Allow",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Codex Approval Allow before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Approval Allow.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Approval Allow control or state is only the trigger for codex.approval.allow.",
        "handler": "src/server/agent-service.ts#approve and POST /api/agent-jobs/:id/approve",
        "request": "Agent job activity or /api/agent-jobs request for codex.approval.allow",
        "resultProof": "Record the actual server/runtime response and prove the codex.approval.allow result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Approval Allow control or state is visible and its precondition is readable.",
        "after": "The Codex Approval Allow branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.approval.allow.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Codex Approval Allow."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.approval.allow and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.approval.allow."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.approval.allow"
      ]
    },
    {
      "id": "teams-ui-codex-approval-cancel",
      "feature": "Codex approval",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Approval Cancel",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Approval Cancel.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Approval Cancel, then capture the after state.",
        "input": "Codex Approval Cancel",
        "operation": "Exercise codex.approval.cancel and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Codex Approval Cancel",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Codex Approval Cancel before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Approval Cancel.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Approval Cancel control or state is only the trigger for codex.approval.cancel.",
        "handler": "src/server/agent-service.ts#approve and POST /api/agent-jobs/:id/approve",
        "request": "Agent job activity or /api/agent-jobs request for codex.approval.cancel",
        "resultProof": "Record the actual server/runtime response and prove the codex.approval.cancel result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Approval Cancel control or state is visible and its precondition is readable.",
        "after": "The Codex Approval Cancel branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.approval.cancel.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Codex Approval Cancel."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.approval.cancel and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.approval.cancel."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.approval.cancel"
      ]
    },
    {
      "id": "teams-ui-codex-approval-conflict",
      "feature": "Codex approval",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Approval Conflict",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Approval Conflict.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Approval Conflict, then capture the after state.",
        "input": "Codex Approval Conflict",
        "operation": "Exercise codex.approval.conflict and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Codex Approval Conflict",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Codex Approval Conflict before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Approval Conflict.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Approval Conflict control or state is only the trigger for codex.approval.conflict.",
        "handler": "src/server/agent-service.ts#approve and POST /api/agent-jobs/:id/approve",
        "request": "Agent job activity or /api/agent-jobs request for codex.approval.conflict",
        "resultProof": "Record the actual server/runtime response and prove the codex.approval.conflict result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Approval Conflict control or state is visible and its precondition is readable.",
        "after": "The Codex Approval Conflict branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.approval.conflict.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Codex Approval Conflict."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.approval.conflict and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.approval.conflict."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.approval.conflict"
      ]
    },
    {
      "id": "teams-ui-codex-cancel-success",
      "feature": "Codex cancellation",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Cancel Success",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Cancel Success.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Cancel Success, then capture the after state.",
        "input": "Codex Cancel Success",
        "operation": "Exercise codex.cancel.success and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Codex Cancel Success",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Codex Cancel Success before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Cancel Success.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Cancel Success control or state is only the trigger for codex.cancel.success.",
        "handler": "src/server/agent-service.ts#cancelStrict and POST /api/agent-jobs/:id/cancel",
        "request": "Agent job activity or /api/agent-jobs request for codex.cancel.success",
        "resultProof": "Record the actual server/runtime response and prove the codex.cancel.success result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Cancel Success control or state is visible and its precondition is readable.",
        "after": "The Codex Cancel Success branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.cancel.success.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Codex Cancel Success."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.cancel.success and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.cancel.success."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.cancel.success"
      ]
    },
    {
      "id": "teams-ui-codex-retry-continue",
      "feature": "Codex retry",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Retry Continue",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Retry Continue.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Retry Continue, then capture the after state.",
        "input": "Codex Retry Continue",
        "operation": "Exercise codex.retry.continue and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Codex Retry Continue",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Codex Retry Continue before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Retry Continue.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Retry Continue control or state is only the trigger for codex.retry.continue.",
        "handler": "src/server/index.ts#handleMessage continue command",
        "request": "Agent job activity or /api/agent-jobs request for codex.retry.continue",
        "resultProof": "Record the actual server/runtime response and prove the codex.retry.continue result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Retry Continue control or state is visible and its precondition is readable.",
        "after": "The Codex Retry Continue branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.retry.continue.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Codex Retry Continue."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.retry.continue and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.retry.continue."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.retry.continue"
      ]
    },
    {
      "id": "teams-ui-codex-progress",
      "feature": "Codex progress",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Progress",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Progress.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Progress, then capture the after state.",
        "input": "Codex Progress",
        "operation": "Exercise codex.progress and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Codex Progress",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Codex Progress before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Progress.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Progress control or state is only the trigger for codex.progress.",
        "handler": "src/server/agent-service.ts#execute",
        "request": "Agent job activity or /api/agent-jobs request for codex.progress",
        "resultProof": "Record the actual server/runtime response and prove the codex.progress result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Progress control or state is visible and its precondition is readable.",
        "after": "The Codex Progress branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.progress.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Codex Progress."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.progress and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.progress."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.progress"
      ]
    },
    {
      "id": "teams-ui-codex-complete",
      "feature": "Codex completion",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Complete",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Complete.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Complete, then capture the after state.",
        "input": "Codex Complete",
        "operation": "Exercise codex.complete and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Codex Complete",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Codex Complete before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Complete.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Complete control or state is only the trigger for codex.complete.",
        "handler": "src/server/agent-service.ts#execute",
        "request": "Agent job activity or /api/agent-jobs request for codex.complete",
        "resultProof": "Record the actual server/runtime response and prove the codex.complete result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Complete control or state is visible and its precondition is readable.",
        "after": "The Codex Complete branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.complete.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Codex Complete."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.complete and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.complete."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.complete"
      ]
    },
    {
      "id": "teams-ui-codex-failed",
      "feature": "Codex failure",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Failed",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Failed.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Failed, then capture the after state.",
        "input": "Codex Failed",
        "operation": "Exercise codex.failed and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Codex Failed",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Codex Failed before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Failed.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Failed control or state is only the trigger for codex.failed.",
        "handler": "src/server/agent-service.ts#execute",
        "request": "Agent job activity or /api/agent-jobs request for codex.failed",
        "resultProof": "Record the actual server/runtime response and prove the codex.failed result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Failed control or state is visible and its precondition is readable.",
        "after": "The Codex Failed branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.failed.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Codex Failed."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.failed and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.failed."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.failed"
      ]
    },
    {
      "id": "teams-ui-codex-blocked",
      "feature": "Codex blocked state",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Blocked",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Blocked.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Blocked, then capture the after state.",
        "input": "Codex Blocked",
        "operation": "Exercise codex.blocked and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "section",
        "label": "Codex Blocked",
        "presenceAssertion": "Fresh AX evidence must show the expected section or rendered state for Codex Blocked before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Blocked.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Blocked control or state is only the trigger for codex.blocked.",
        "handler": "src/server/agent-service.ts#execute",
        "request": "Agent job activity or /api/agent-jobs request for codex.blocked",
        "resultProof": "Record the actual server/runtime response and prove the codex.blocked result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Blocked control or state is visible and its precondition is readable.",
        "after": "The Codex Blocked branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.blocked.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible section or state for Codex Blocked."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.blocked and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.blocked."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.blocked"
      ]
    },
    {
      "id": "teams-ui-codex-auth-expired",
      "feature": "Codex authentication",
      "surface": "codex-job-surface",
      "location": "Codex job card and status reply",
      "branch": "Codex Auth Expired",
      "precondition": "Use the current codex-job-surface build and establish the branch precondition for Codex Auth Expired.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Codex Auth Expired, then capture the after state.",
        "input": "Codex Auth Expired",
        "operation": "Exercise codex.auth-expired and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Codex Auth Expired",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Codex Auth Expired before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Codex Auth Expired.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-bot",
        "trigger": "The visible Codex Auth Expired control or state is only the trigger for codex.auth-expired.",
        "handler": "src/server/agent-service.ts#execute",
        "request": "Agent job activity or /api/agent-jobs request for codex.auth-expired",
        "resultProof": "Record the actual server/runtime response and prove the codex.auth-expired result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Codex Auth Expired control or state is visible and its precondition is readable.",
        "after": "The Codex Auth Expired branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for codex.auth-expired.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Codex Auth Expired."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for codex.auth-expired and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for codex.auth-expired."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "codex.auth-expired"
      ]
    },
    {
      "id": "teams-ui-deep-link-static-tab",
      "feature": "Teams tab deep link",
      "surface": "teams-deep-link",
      "location": "Teams deep link target or link action",
      "branch": "Deep Link Static Tab",
      "precondition": "Use the current teams-deep-link build and establish the branch precondition for Deep Link Static Tab.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Deep Link Static Tab, then capture the after state.",
        "input": "Deep Link Static Tab",
        "operation": "Exercise deep-link.static-tab and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Deep Link Static Tab",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Deep Link Static Tab before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Deep Link Static Tab.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Deep Link Static Tab control or state is only the trigger for deep-link.static-tab.",
        "handler": "src/server/teams-tab-link.ts#buildTeamsPersonalTabDeepLink and appPackage/manifest.json",
        "request": "Teams link navigation request for deep-link.static-tab",
        "resultProof": "Record the actual server/runtime response and prove the deep-link.static-tab result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Deep Link Static Tab control or state is visible and its precondition is readable.",
        "after": "The Deep Link Static Tab branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for deep-link.static-tab.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Deep Link Static Tab."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for deep-link.static-tab and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for deep-link.static-tab."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "deep-link.static-tab"
      ]
    },
    {
      "id": "teams-ui-deep-link-open-tab-action",
      "feature": "Teams tab deep link",
      "surface": "teams-deep-link",
      "location": "Teams deep link target or link action",
      "branch": "Deep Link Open Tab Action",
      "precondition": "Use the current teams-deep-link build and establish the branch precondition for Deep Link Open Tab Action.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Deep Link Open Tab Action, then capture the after state.",
        "input": "Deep Link Open Tab Action",
        "operation": "Exercise deep-link.open-tab-action and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Deep Link Open Tab Action",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Deep Link Open Tab Action before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Deep Link Open Tab Action.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Deep Link Open Tab Action control or state is only the trigger for deep-link.open-tab-action.",
        "handler": "src/server/genui-teams.ts#renderAction",
        "request": "Teams link navigation request for deep-link.open-tab-action",
        "resultProof": "Record the actual server/runtime response and prove the deep-link.open-tab-action result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Deep Link Open Tab Action control or state is visible and its precondition is readable.",
        "after": "The Deep Link Open Tab Action branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for deep-link.open-tab-action.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Deep Link Open Tab Action."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for deep-link.open-tab-action and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for deep-link.open-tab-action."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "deep-link.open-tab-action"
      ]
    },
    {
      "id": "teams-ui-deep-link-response-mode-card",
      "feature": "Teams tab deep link",
      "surface": "teams-deep-link",
      "location": "Teams deep link target or link action",
      "branch": "Deep Link Response Mode Card",
      "precondition": "Use the current teams-deep-link build and establish the branch precondition for Deep Link Response Mode Card.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Deep Link Response Mode Card, then capture the after state.",
        "input": "Deep Link Response Mode Card",
        "operation": "Exercise deep-link.response-mode-card and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "link",
        "label": "응답 모드 카드의 업무 허브 탭 열기",
        "presenceAssertion": "Fresh AX evidence must show the expected link or rendered state for 응답 모드 카드의 업무 허브 탭 열기 before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for 응답 모드 카드의 업무 허브 탭 열기.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Deep Link Response Mode Card control or state is only the trigger for deep-link.response-mode-card.",
        "handler": "src/server/genui-teams.ts#renderAction",
        "request": "Teams link navigation request for deep-link.response-mode-card",
        "resultProof": "Record the actual server/runtime response and prove the deep-link.response-mode-card result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Deep Link Response Mode Card control or state is visible and its precondition is readable.",
        "after": "The Deep Link Response Mode Card branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for deep-link.response-mode-card.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible radio or state for Deep Link Response Mode Card."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for deep-link.response-mode-card and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for deep-link.response-mode-card."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "deep-link.response-mode-card"
      ]
    },
    {
      "id": "teams-ui-deep-link-trailing-slash",
      "feature": "Teams tab deep link",
      "surface": "teams-deep-link",
      "location": "Teams deep link target or link action",
      "branch": "Deep Link Trailing Slash",
      "precondition": "Use the current teams-deep-link build and establish the branch precondition for Deep Link Trailing Slash.",
      "action": {
        "userGesture": "Capture the before state, execute or inspect Deep Link Trailing Slash, then capture the after state.",
        "input": "Deep Link Trailing Slash",
        "operation": "Exercise deep-link.trailing-slash and do not infer server success from control visibility."
      },
      "visibleControl": {
        "role": "button",
        "label": "Deep Link Trailing Slash",
        "presenceAssertion": "Fresh AX evidence must show the expected button or rendered state for Deep Link Trailing Slash before the action.",
        "freshAxAssertion": "After the action, fresh AX evidence must show the visible result for Deep Link Trailing Slash.",
        "separateFromServerResult": true
      },
      "serverAction": {
        "transport": "teams-action",
        "trigger": "The visible Deep Link Trailing Slash control or state is only the trigger for deep-link.trailing-slash.",
        "handler": "src/server/teams-tab-link.ts#buildTeamsPersonalTabDeepLink and appPackage/manifest.json",
        "request": "Teams link navigation request for deep-link.trailing-slash",
        "resultProof": "Record the actual server/runtime response and prove the deep-link.trailing-slash result independently of the visible control.",
        "notVisibleOnly": true
      },
      "expected": {
        "before": "The Deep Link Trailing Slash control or state is visible and its precondition is readable.",
        "after": "The Deep Link Trailing Slash branch renders the expected success, empty, loading, error, approval, or navigation result.",
        "server": "The mapped handler records the expected request and response for deep-link.trailing-slash.",
        "failure": "If the branch fails, the UI shows actionable recovery without claiming an unobserved server result."
      },
      "screenshotBefore": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotBefore."
      },
      "screenshotAfter": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: screenshotAfter."
      },
      "accessibilityEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: accessibilityEvidence.",
        "assertions": [
          "AX tree must contain the visible button or state for Deep Link Trailing Slash."
        ]
      },
      "runtimeEvidence": {
        "state": "not-captured",
        "fresh": false,
        "path": null,
        "capturedAt": null,
        "source": "not-captured",
        "releaseIdentity": {
          "appVersion": "1.0.26",
          "sourceCommit": "e4e1265e539968bccb7121545928de0492e0f42f",
          "packageSha256": null,
          "installedVersion": null,
          "environment": "source-only-unverified",
          "publicOrigin": null
        },
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status. Evidence slot: runtimeEvidence.",
        "command": "Run the branch-specific Teams/runtime check for deep-link.trailing-slash and record the response.",
        "assertions": [
          "Runtime evidence must prove the handler/result for deep-link.trailing-slash."
        ]
      },
      "result": {
        "status": "BLOCKED",
        "reason": "BLOCKED: command gates are current, but same-release Teams UI evidence is not yet captured; capture a fresh approved portal, installed, desktop, or mobile session before changing the row status.",
        "visibleControl": "NOT_PROVEN",
        "serverAction": "NOT_PROVEN",
        "nextAction": "Capture fresh before/after screenshots, AX, and runtime evidence, then update this row."
      },
      "coverage": [
        "deep-link.trailing-slash"
      ]
    }
  ]
}
```

<!-- TEAMS_UI_MATRIX_JSON_END -->
