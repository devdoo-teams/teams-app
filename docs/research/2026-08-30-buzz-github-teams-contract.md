# Buzz, GitHub Copilot, and Microsoft Teams contract comparison

Checked: 2026-08-30 (Asia/Seoul)

Scope: compare Block's Buzz repository, GitHub's Microsoft Teams Copilot cloud
agent integration, and Microsoft's Teams SDK/docs/samples for the bot, personal
tab, Adaptive Card, app-package update, mobile-permission, and A2A seams. This
note uses first-party sources only. It is a research and source-audit note; it
does not claim a live Teams installation, upload, mobile result, GitHub account
connection, A2A peer, or production round trip.

## Verdict in one paragraph

Buzz is a useful architectural reference for an agent workspace, not a Teams
compatibility contract. Its documented center is a self-hosted Nostr relay:
humans and agents share rooms, events are signed, and agent identity,
membership, and audit history are first-class. GitHub's Teams integration is a
different product contract: Teams conversation context starts an asynchronous
Copilot cloud-agent session, with direct-message actions attributed to the
linked user and shared-context artifacts attributed to the GitHub app. Teams
SDK supplies the transport and host seams, but it does not make a local A2A
implementation interoperable or prove deployment identity. **Inference:** the
candidate should preserve Teams as the user-facing bot/tab/card contract and
borrow Buzz's explicit identity/audit ideas only behind that boundary; it
should not present Buzz's relay protocol or GitHub's cloud-agent behavior as
already implemented.

## Documented contracts

### 1. Buzz: relay-owned workspace and agent identity

Block documents Buzz as a self-hostable workspace where people and agents share
rooms. The relay URL selects the community, and tenant-observable state is
community-local. Messages, reactions, workflow steps, reviews, and git events
are signed events in one log; agents have their own keys, memberships, and
audit trail. The repository describes `buzz-cli` as JSON-in/JSON-out and lists
ACP/MCP agent surfaces, while its status table marks mobile clients as “being
wired up,” not as a completed surface.

Sources: [Buzz README](https://github.com/block/buzz), [Buzz architecture](https://github.com/block/buzz/blob/main/ARCHITECTURE.md), [Buzz agent vision](https://github.com/block/buzz/blob/main/VISION_AGENT.md), and [Buzz remote-agent vision](https://github.com/block/buzz/blob/main/VISION_REMOTE_AGENTS.md).

The architecture document makes the relay the single source of truth and
specifies Nostr NIP-01 on the wire. Its event pipeline authenticates the
connection, verifies the signature, checks membership, persists idempotently,
fans out, and triggers audit/workflow work. That is a strong provenance model,
but it is not the Microsoft Teams Activity, app-manifest, or TeamsJS contract.

### 2. GitHub Copilot in Teams: shared conversation to cloud sandbox

GitHub documents the Teams integration as a public-preview feature available on
paid Copilot plans. A user installs the GitHub app, connects a GitHub account,
and mentions `@GitHub` in a chat, channel, or thread. In a public channel a
default repository may be configured; a direct message does not use a default
repository. The conversation can initiate investigation, planning, code
changes, issues, and pull requests.

The documented security and attribution split is material:

- A direct-message session can act using the linked GitHub personal account's
  permissions.
- A shared-context session creates artifacts under the GitHub app identity.
- Only participants with repository write access can trigger changes, although
  other conversation participants can contribute context.
- The entire thread is used as decision context and is stored in generated
  artifacts; a direct message is the documented way to limit context.
- Work continues asynchronously in a secure cloud sandbox, and the result is
  posted when ready.

Sources: [GitHub integration documentation](https://docs.github.com/en/copilot/how-tos/copilot-integrations/integrate-cloud-agent-with-teams) and [GitHub's August 21, 2026 changelog](https://github.blog/changelog/2026-08-21-shared-agentic-work-with-github-copilot-in-microsoft-teams/).

**Inference:** a Teams app that wants comparable behavior needs explicit
conversation-to-task correlation, context-bound authorization, asynchronous
progress/result delivery, artifact provenance, and a clear user/app identity
split. A local CLI readiness check or a configured provider name is not
equivalent to these product behaviors.

### 3. Microsoft Teams SDK and platform surfaces

Microsoft's current TypeScript Teams SDK repository identifies the core server
and client packages (`@microsoft/teams.apps`, `@microsoft/teams.api`,
`@microsoft/teams.botbuilder`, `@microsoft/teams.cards`, and
`@microsoft/teams.client`) and lists `examples/botbuilder`,
`examples/tab`, and `examples/a2a`. It also says the former
`@microsoft/teams.a2a` package is deprecated in favor of `@a2a-js/sdk`
directly. The repository warns that its example apps change often and are
visual/test samples in the monorepo, not standalone stability guarantees.

Sources: [Microsoft Teams SDK TypeScript repository](https://github.com/microsoft/teams.ts) and [Teams SDK A2A example directory](https://github.com/microsoft/teams.ts/tree/main/examples/a2a).

The SDK's bot guide describes a bot as a web application receiving HTTP POSTs
from Teams, with a bot registration and a public HTTPS endpoint. The official
sample uses `/api/messages` as the Teams traffic endpoint. This is transport
plumbing and handler composition; the app still owns its authorization,
durability, provider, and release identity.

Source: [Teams SDK bot application guide](https://github.com/microsoft/teams-sdk/blob/main/plugins/teams-sdk/skills/teams-dev/references/guide-create-bot-app.md).

Relevant Microsoft sample repositories are [Teams SDK botbuilder](https://github.com/microsoft/teams.ts/tree/main/examples/botbuilder), [Teams SDK tab](https://github.com/microsoft/teams.ts/tree/main/examples/tab), [Teams Adaptive Card Samples](https://github.com/OfficeDev/Microsoft-Teams-Adaptive-Card-Samples), and [TeamsJS tab device permissions](https://github.com/OfficeDev/Microsoft-Teams-Samples/tree/main/samples/TeamsJS/tab-device-permissions/nodejs). The latter explicitly covers geolocation and media permissions in desktop and mobile views. These are implementation references, not evidence that this candidate or any external app is running.

## Concern-by-concern comparison

| Concern | Documented Teams contract | Candidate source evidence | Interpretation |
| --- | --- | --- | --- |
| Bot ingress | Teams bot traffic is delivered to the app's public HTTPS bot endpoint; SDK examples use `POST /api/messages`. | `src/server/index.ts:3774-3805` contains the local fallback route; the Teams SDK path is registered separately when configured. | Source shape exists. This does not prove a reachable public endpoint, valid bot credentials, or a Teams reply. |
| Personal tab | Tabs are client-aware webpages in an iframe. A personal static tab uses manifest `staticTabs`, an HTTPS `contentUrl`, and TeamsJS `app.initialize()`. Microsoft requires testing Android and iOS clients separately. | `appPackage/manifest.json:26-33` declares the personal `home` tab and `/tabs/home/`; `src/client/main.tsx:372-388` initializes the Teams host. | The candidate follows the host seam. It remains a web tab, not a Buzz relay client or an Adaptive Card tab. |
| Adaptive Cards | Teams bot cards are attachments; Teams documents Adaptive Card actions such as `Action.OpenUrl` and `Action.Execute`, with action data returned to the app. | `src/server/index.ts:67-72,1173-1250,3430` renders card activities and card fallbacks. | Card payload compatibility must be checked by host/version and button behavior; source construction is not UI proof. |
| App package and update | The package contains the manifest and icons; app logic/data remain hosted elsewhere. A new custom-app upload can update the available version, but consent and propagation vary by personal, tab, and bot contexts. Changing `botId` creates a new bot instance and leaves prior history with the old bot. | `appPackage/manifest.json:1-59` binds app version, URLs, bot scopes, domains, permissions, and SSO fields. | Package version, actual ZIP contents, registration, installed version, and public runtime must be one release identity. A source manifest alone proves none of those external states. |
| Mobile permissions | Teams documents `devicePermissions` in the manifest and TeamsJS capability APIs. For location, `geolocation` is declared; permission prompts occur when the relevant API starts; unsupported, denied, invalid, and user-aborted cases must be handled. Browser permissions differ from Teams permissions. | `appPackage/manifest.json:54-55` declares `geolocation`; `src/client/location.ts:273-389` handles initialization, support detection, permission-denied mapping, and bounded operation timeout. | This is a good source-level branch boundary. Actual iOS/Android permission prompts, GPS, and WebView layout remain unverified. |
| A2A discovery and execution | The official SDK A2A example uses `@a2a-js/sdk`, two separately registered bots, `POST /a2a`, and `GET /.well-known/agent-card.json`; it explicitly notes same-tenant and peer-install assumptions and says its sample `/a2a` has no authentication. | `src/server/a2a-production-runtime.ts:952-971` mounts agent-card and A2A paths; `src/server/a2a-jsonrpc-route.ts:108-174` builds a bounded Agent Card/router. | An A2A route and Agent Card are interoperability prerequisites, not live interoperability proof. Authenticated remote round trip, distinct identities, peer readiness, task completion, cancellation, restart recovery, and Teams UI evidence are separate gates. |

Platform sources for this table: [tabs overview](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs), [tab content pages](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/create-tab-pages/content-page), [bot design](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/design/bots), [Adaptive Card actions](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions), [app package](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package), [Teams app update experience](https://learn.microsoft.com/en-us/microsoftteams/apps-update-experience), [device capabilities](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/device-capabilities-overview), and [location capability](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/location-capability).

## A2A/agent interoperability boundary

The Microsoft sample is especially useful because it demonstrates the required
cross-surface handoff but also states its limits. Alice and Bob have separate
bot registrations; a handoff carries user/tenant/service-url context in an A2A
data part; the receiving bot creates a 1:1 conversation and sends a proactive
greeting. The sample caveats include same-tenant operation, receiving-bot
installation, and no authentication on the sample A2A endpoint.

Sources: [A2A sample README](https://github.com/microsoft/teams.ts/blob/main/examples/a2a/README.md), [A2A sample executor](https://github.com/microsoft/teams.ts/blob/main/examples/a2a/src/a2a-server.ts), and [A2A protocol specification](https://a2a-protocol.org/v0.2.6/specification/).

**Inference:** for this candidate, “A2A-ready” must mean more than a route
returning JSON. At minimum, the evidence should bind the Agent Card URL and
protocol version to a deployed identity, authenticate the remote call, show a
completed remote result, prove independent agent/provider identities and
scopes, and reconcile cancellation/restart state. The Teams desktop and mobile
surfaces then need their own evidence; A2A protocol evidence cannot substitute
for a Teams UI result.

## Read-only candidate audit

The inspected worktree was `/private/tmp/teams-runtime-deps-fix-20260829` at
`0121d67ce6c1925a4372b888f33aebc47d991aa0`. The only intended change from this
note is this Markdown file. The worktree already contained an untracked
`.runtime-check/` directory; it was left untouched and is not part of this
commit.

Observed source facts:

- `package.json` includes `@microsoft/teams.apps` and `@microsoft/teams-js`.
- The manifest keeps the app's personal tab, bot scopes, public-domain
  placeholders, `token.botframework.com`, `geolocation`, and SSO fields in one
  package contract.
- The client contains explicit Teams host initialization and location
  capability/error handling.
- The server has a Teams message path, card rendering/fallback code, and
  production A2A discovery/router mounts.

These observations are not a release or interoperability result. No credentials
were read or created, no server or external system was changed, no package was
uploaded, and no live Teams, GitHub, mobile, or remote A2A interaction was
performed for this note.

## Sources

All sources below are first-party repository, documentation, specification, or
product-publisher pages consulted for this note:

1. <https://github.com/block/buzz>
2. <https://github.com/block/buzz/blob/main/ARCHITECTURE.md>
3. <https://github.com/block/buzz/blob/main/VISION_AGENT.md>
4. <https://github.com/block/buzz/blob/main/VISION_REMOTE_AGENTS.md>
5. <https://github.blog/changelog/2026-08-21-shared-agentic-work-with-github-copilot-in-microsoft-teams/>
6. <https://docs.github.com/en/copilot/how-tos/copilot-integrations/integrate-cloud-agent-with-teams>
7. <https://github.com/microsoft/teams.ts>
8. <https://github.com/microsoft/teams.ts/tree/main/examples/a2a>
9. <https://github.com/microsoft/teams.ts/tree/main/examples/botbuilder>
10. <https://github.com/microsoft/teams.ts/tree/main/examples/tab>
11. <https://github.com/OfficeDev/Microsoft-Teams-Adaptive-Card-Samples>
12. <https://github.com/OfficeDev/Microsoft-Teams-Samples/tree/main/samples/TeamsJS/tab-device-permissions/nodejs>
13. <https://github.com/microsoft/teams.ts/blob/main/examples/a2a/README.md>
14. <https://github.com/microsoft/teams.ts/blob/main/examples/a2a/src/a2a-server.ts>
15. <https://github.com/microsoft/teams-sdk/blob/main/plugins/teams-sdk/skills/teams-dev/references/guide-create-bot-app.md>
16. <https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs>
17. <https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/create-tab-pages/content-page>
18. <https://learn.microsoft.com/en-us/microsoftteams/platform/bots/design/bots>
19. <https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions>
20. <https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package>
21. <https://learn.microsoft.com/en-us/microsoftteams/apps-update-experience>
22. <https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/device-capabilities-overview>
23. <https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/location-capability>
24. <https://a2a-protocol.org/v0.2.6/specification/>
