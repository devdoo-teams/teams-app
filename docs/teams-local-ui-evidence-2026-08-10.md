# Local Teams UI evidence — 2026-08-10

This document records observations from the local runtime and the currently
installed Teams desktop chat. It is deliberately separate from
`docs/teams-ui-verification-matrix.md`: none of this evidence is release,
public, installed-version, or mobile proof.

## Identity and boundary

- Source package/manifest observed: `1.0.30`.
- Git `HEAD` observed during capture: `ac158d2` (`1.0.29` release commit).
- Current ZIP/public process: stale `1.0.29` according to the bounded release audit.
- Local runtime: `http://127.0.0.1:43980`, canonical tab route `308` → `200`.
- Local API calls used the configured local access-token header; no token was
  entered into Teams or inferred from the UI.
- Result vocabulary below is local-only: `LOCAL_RUNTIME_PASS`, `LOCAL_RUNTIME_FAIL`,
  `PUBLIC_UNVERIFIED`, `DESKTOP_UNVERIFIED`, `MOBILE_UNVERIFIED`.

## Local personal-tab captures

Each interaction was preceded and followed by a fresh browser DOM/accessibility
snapshot. The screenshots are temporary artifacts under `/tmp`; they are listed
here so a later release run can either copy them into immutable evidence storage
or recapture them against the exact release identity.

| Surface / branch | Local result | Screenshot artifact |
| --- | --- | --- |
| Activity initial state | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-activity-before.png` |
| Today summary | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-today.png` |
| Weather location request, browser-denied branch | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-weather-after-location.png` |
| Work list populated | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-work-list.png` |
| Work create validation error | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-work-invalid.png` |
| Work create success | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-work-created.png` |
| Work status mutation before/after | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-work-status.png`, `/tmp/teams-local-1.0.30-work-status-after.png` |
| Work detail/edit | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-work-detail-before.png`, `/tmp/teams-local-1.0.30-work-edit-after.png` |
| Work comment | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-work-comment-after.png` |
| Work watch/unwatch | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-work-watch-after.png` |
| Work assignment persistence (old button text) | LOCAL_RUNTIME_FAIL | `/tmp/teams-local-1.0.30-work-assignment-refresh.png` |
| Assigned/recent/calendar filters | LOCAL_RUNTIME_PASS / FAIL | `/tmp/teams-local-1.0.30-filter-assigned.png`, `/tmp/teams-local-1.0.30-filter-recent.png`, `/tmp/teams-local-1.0.30-filter-calendar.png` |
| Due-date input and calendar result | LOCAL_RUNTIME_FAIL / BLOCKED | `/tmp/teams-local-1.0.30-work-due-date.png`, `/tmp/teams-local-1.0.30-calendar-created.png` |
| Settings response-mode branches | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-settings-before.png` |
| Activity controls and collaboration follow/unfollow/save | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-activity-controls.png`, `/tmp/teams-local-1.0.30-collaboration-follow.png`, `/tmp/teams-local-1.0.30-collaboration-unfollow.png`, `/tmp/teams-local-1.0.30-collaboration-save.png` |
| Collaboration deep-link target context | LOCAL_RUNTIME_PASS | `/tmp/teams-local-1.0.30-deep-link-after.png` |

### Confirmed local defects

1. After assignment persisted in the API, the old UI still rendered
   `나에게 할당`. A server-derived `assignedToRequester` field and
   `나에게 할당됨` disabled state were implemented by the delegated fix. The
   server bundle and the browser UI must be rebuilt and recaptured before this
   becomes a release result.
2. Filling the native date input through the browser automation surface showed
   a date, but the submitted API value remained `dueDate: null` and the calendar
   view stayed empty. This branch is not treated as working until a real user
   input path or a focused regression proves it.
3. Browser location permission denial is rendered explicitly. Native Teams host
   location permission and iPhone GPS remain `MOBILE_UNVERIFIED`.

## Teams desktop captures

The desktop app was inspected with `com.microsoft.teams2` using a fresh full AX
tree and screenshots. The chat was the existing `업무 허브` chat; no new chat or
browser tab was created.

| Check | Result | Evidence |
| --- | --- | --- |
| Existing `업무 허브` chat, Jira/Trello/Atlassian Home entries, cards, prompt buttons, and tab names visible in AX | DESKTOP_UNVERIFIED | `/tmp/teams-desktop-ax-full-current.txt`, `/tmp/teams-desktop-current.png` |
| Click `업무 허브` tab with AX index | DESKTOP_UNVERIFIED | `/tmp/teams-desktop-ax-tab-current.txt`, `/tmp/teams-desktop-tab-current.jpeg` |
| Click `업무 허브` tab by screen coordinate; selected state changed | LOCAL_RUNTIME_PASS (host control only) | `/tmp/teams-desktop-ax-tab-coordinate.txt`, `/tmp/teams-desktop-tab-coordinate.jpeg` |
| Settled tab content | DESKTOP_UNVERIFIED | `/tmp/teams-desktop-ax-tab-settled.txt`, `/tmp/teams-desktop-tab-settled.jpeg`; AX reported `retracted_sideloaded_or_custombot` |
| Click visible `프롬프트 보기` by AX and screen coordinate | LOCAL_RUNTIME_FAIL / DESKTOP_UNVERIFIED | `/tmp/teams-desktop-ax-prompt-current.txt`, `/tmp/teams-desktop-prompt-current.jpeg`, `/tmp/teams-desktop-ax-prompt-coordinate.txt`, `/tmp/teams-desktop-prompt-coordinate.jpeg` |

The desktop chat is visibly an older/stale deployment (`1.0.29` content) and
therefore cannot be used as proof of the current source package. The prompt
button was visible but neither AX activation nor coordinate activation produced
a visible ShowCard state. The personal tab selected state changed, but its
content was retracted rather than rendered. These are blockers for the same-
release desktop gate, not evidence that the current source implementation is
correct or incorrect in a fresh package.

## Release decision

The official matrix remains blocked until a committed, freshly packaged,
publicly restarted, installed, desktop-verified, and user-mobile-confirmed
release has matching version, commit, and ZIP SHA-256. This local evidence must
not be copied into a `PASS` row without that identity binding.

