# ChatGPT-through-Teams capability matrix

상태: F00 registry. 이 문서는 ChatGPT 앱의 원본 UI/계정 기능을 Teams에서 이미 제공한다는 선언이 아니다.

조사 기준일: 2026-09-06 KST. `SOURCE_TESTED`는 소스·fixture·로컬 테스트 증거만 의미하며 실제 Teams 설치본, 사용자 계정, 모바일 기기, 공개 릴리스의 성공을 의미하지 않는다. `LIVE_UNVERIFIED`와 `MOBILE_UNVERIFIED`는 의도적인 미확인 상태다.

`accountFeatureInventoryComplete`가 `false`인 이유는 현재 사용자의 ChatGPT 앱에 노출된 기능 목록을 이 저장소나 Teams API에서 자동으로 읽어오는 공식 계약이 없기 때문이다. 계정 기능을 추측해 빈 행을 PASS로 만들지 않는다.

## Status vocabulary

- `SOURCE_TESTED`: 현재 저장소의 구현·계약·집중 테스트가 확인됨. 라이브 배포 성공은 아님.
- `IMPLEMENTED_UNVERIFIED`: 구현 경로는 있으나 동일 릴리스의 실제 사용자 표면을 아직 증명하지 못함.
- `OPTIONAL_UNCONFIGURED`: 공식 API/연결은 별도 자격·설정이 필요하고 현재 런타임에서 활성화되지 않음.
- `UNSUPPORTED_BY_CONTRACT`: 현재 확인한 공식 계약으로 ChatGPT 원본 기능의 Teams 내 동일 동작을 주장할 수 없음.
- `MOBILE_UNVERIFIED`: 데스크톱/fixture 결과로 iOS·Android Teams WebView를 대체하지 않음.
- `LIVE_UNVERIFIED`: 코드 또는 로컬 결과는 있으나 공개 런타임·포털·설치본 read-back이 없음.
- `NOT_IMPLEMENTED`: 이 저장소에 수락 가능한 구현이 없음.

## Machine-readable registry

```json
{
  "schemaVersion": 1,
  "asOf": "2026-09-06",
  "accountFeatureInventoryComplete": false,
  "sources": [
    "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/designing-your-bot",
    "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context",
    "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference",
    "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions",
    "https://help.openai.com/en/articles/11487775-connectors-in-chatgpt",
    "https://developers.openai.com/api/docs/guides/tools",
    "https://developers.openai.com/api/docs/guides/conversation-state"
  ],
  "capabilities": [
    {
      "id": "teams-core-agent",
      "surface": "Teams bot chat and Adaptive Card",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/designing-your-bot",
      "implementationEvidence": "src/server/response-engine-deterministic.ts; src/server/core-orchestration-service.ts; src/server/genui-response.ts",
      "entitlement": "Authenticated Teams bot installation and server Core runtime",
      "negativeState": "Provider unavailable or deterministic Core error card",
      "focusedTest": "scripts/core-orchestration-teams-chat-runtime-test.ts; npm run test:core",
      "status": "SOURCE_TESTED"
    },
    {
      "id": "work-hub-tab",
      "surface": "Teams personal tab / Work Hub",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context",
      "implementationEvidence": "src/client/OrchestrationPanel.tsx; src/server/core-orchestration-route.ts",
      "entitlement": "Installed Teams personal tab with authenticated tab session",
      "negativeState": "Loading, empty, unavailable-provider, and mobile fallback states",
      "focusedTest": "scripts/client-orchestration-panel-test.tsx; scripts/core-orchestration-cross-surface-test.ts",
      "status": "SOURCE_TESTED"
    },
    {
      "id": "adaptive-card-controls",
      "surface": "Chat Adaptive Card actions",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions",
      "implementationEvidence": "src/server/genui-response.ts; Action.Submit and Action.ShowCard subset",
      "entitlement": "Teams client card support for the declared version",
      "negativeState": "Unsupported action is omitted or represented by a tab link",
      "focusedTest": "scripts/core-orchestration-chat-card-test.ts; npm run validate:manifest",
      "status": "SOURCE_TESTED"
    },
    {
      "id": "conversation-new-continue",
      "surface": "Teams chat commands and Work Hub actions",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/designing-your-bot",
      "implementationEvidence": "agent new and agent continue in src/server/response-engine-deterministic.ts and core-orchestration-service.ts",
      "entitlement": "Authenticated Core provider with a durable selected job/thread",
      "negativeState": "Missing or cross-principal thread returns an explicit error",
      "focusedTest": "scripts/core-orchestration-chat-card-test.ts; scripts/core-orchestration-route-test.ts; scripts/core-orchestration-service-test.ts",
      "status": "SOURCE_TESTED"
    },
    {
      "id": "progress-reconnect",
      "surface": "Work Hub list/detail and bot progress cards",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/designing-your-bot",
      "implementationEvidence": "src/server/agent-job-store.ts durable progress, result, error, updatedAt; src/client/OrchestrationPanel.tsx",
      "entitlement": "Durable server store and an authenticated Teams conversation",
      "negativeState": "Reconciliation-required and failed states remain visible; empty result is not completion",
      "focusedTest": "scripts/agent-job-store-hardening-test.ts; npm run test:core",
      "status": "IMPLEMENTED_UNVERIFIED"
    },
    {
      "id": "model-reasoning-token",
      "surface": "Work Hub selectors and job card facts",
      "officialContract": "https://developers.openai.com/api/docs/guides/conversation-state",
      "implementationEvidence": "src/server/codex-model-catalog.ts; src/server/agent-token-usage.ts; src/client/OrchestrationPanel.tsx",
      "entitlement": "Measured Codex catalog and terminal usage observation",
      "negativeState": "Unavailable catalog and account quota are shown as unavailable, not guessed",
      "focusedTest": "scripts/codex-model-catalog-test.ts; scripts/core-orchestration-chat-card-test.ts",
      "status": "SOURCE_TESTED"
    },
    {
      "id": "card-file-upload",
      "surface": "Adaptive Card input",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference",
      "implementationEvidence": "No file-upload action in the declared Teams card subset",
      "entitlement": "Teams tab file picker is a separate surface",
      "negativeState": "Card does not fabricate a file upload control; use the tab when implemented",
      "focusedTest": "scripts/core-orchestration-chat-card-test.ts; N/A for file upload",
      "status": "UNSUPPORTED_BY_CONTRACT"
    },
    {
      "id": "tab-file-bridge",
      "surface": "Work Hub file selection and download",
      "officialContract": "https://help.openai.com/en/articles/11487775-connectors-in-chatgpt",
      "implementationEvidence": "No accepted owner-scoped artifact/file bridge in current Core slice",
      "entitlement": "Explicit storage, type/size, retention, and provider capability configuration",
      "negativeState": "File analysis is not advertised when the provider or bridge is unavailable",
      "focusedTest": "N/A; planned F07 file-* tests",
      "status": "NOT_IMPLEMENTED"
    },
    {
      "id": "web-search-citations",
      "surface": "Bot answer and tab result provenance",
      "officialContract": "https://developers.openai.com/api/docs/guides/tools",
      "implementationEvidence": "No enabled Responses web-search provider in Core runtime",
      "entitlement": "Optional OpenAI API provider, tool configuration, and citation-preserving response path",
      "negativeState": "Provider is unconfigured; deterministic Core does not invent citations",
      "focusedTest": "N/A; planned optional-provider tests",
      "status": "OPTIONAL_UNCONFIGURED"
    },
    {
      "id": "skills-plugins-mcp-provenance",
      "surface": "Job card ShowCard and Work Hub detail",
      "officialContract": "https://help.openai.com/en/articles/11487775-connectors-in-chatgpt",
      "implementationEvidence": "src/server/agent-tool-observation.ts; src/server/genui-response.ts; src/client/OrchestrationPanel.tsx",
      "entitlement": "A provider must emit a safe tool observation; connector installation is separate",
      "negativeState": "Absent observations are displayed as unavailable; raw arguments and secrets are excluded",
      "focusedTest": "scripts/core-orchestration-chat-card-test.ts; scripts/agent-tool-observation-test.ts",
      "status": "SOURCE_TESTED"
    },
    {
      "id": "teams-job-history",
      "surface": "Work Hub job list, detail, resume, retry, archive boundary",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context",
      "implementationEvidence": "src/server/agent-job-store.ts; src/server/core-orchestration-route.ts",
      "entitlement": "Authenticated server-owned Teams tenant/requester scope",
      "negativeState": "Cross-principal records are not returned",
      "focusedTest": "scripts/agent-job-store-hardening-test.ts; scripts/core-orchestration-route-test.ts",
      "status": "SOURCE_TESTED"
    },
    {
      "id": "chatgpt-original-history",
      "surface": "ChatGPT account/project history inside Teams",
      "officialContract": "https://help.openai.com/en/articles/11487775-connectors-in-chatgpt",
      "implementationEvidence": "No official account-history import or ChatGPT UI embedding contract in this repository",
      "entitlement": "A separate official API or product contract would be required",
      "negativeState": "Teams job history is labeled as Teams-owned and is not called ChatGPT history",
      "focusedTest": "N/A; contract boundary assertion in this matrix",
      "status": "UNSUPPORTED_BY_CONTRACT"
    },
    {
      "id": "artifacts-docs-sheets-slides-code",
      "surface": "Work Hub artifact links and downloads",
      "officialContract": "https://developers.openai.com/api/docs/guides/tools",
      "implementationEvidence": "No owner-scoped artifact service with integrity read-back in current Core slice",
      "entitlement": "Artifact storage, MIME/size/expiry policy, and provider output support",
      "negativeState": "A path or text summary is not treated as a generated downloadable artifact",
      "focusedTest": "N/A; planned F11 artifact-* tests",
      "status": "NOT_IMPLEMENTED"
    },
    {
      "id": "memory-instructions",
      "surface": "Persistent user/project instructions",
      "officialContract": "https://help.openai.com/en/articles/11487775-connectors-in-chatgpt",
      "implementationEvidence": "No ChatGPT memory or global-instruction synchronization contract in Core",
      "entitlement": "Explicit scoped storage and an approved source-of-truth contract",
      "negativeState": "No silent copying or claim of ChatGPT memory synchronization",
      "focusedTest": "N/A; planned F12 instruction-* tests",
      "status": "UNSUPPORTED_BY_CONTRACT"
    },
    {
      "id": "image-video-media",
      "surface": "Teams chat/tab media input and output",
      "officialContract": "https://developers.openai.com/api/docs/guides/tools",
      "implementationEvidence": "No accepted image/video generation or media artifact bridge in Core",
      "entitlement": "Provider modality support, file bridge, and Teams surface verification",
      "negativeState": "Unsupported media is not represented as a fabricated text success",
      "focusedTest": "N/A; planned F13 modality tests",
      "status": "NOT_IMPLEMENTED"
    },
    {
      "id": "voice-realtime-screen",
      "surface": "Teams desktop/mobile voice and screen controls",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context",
      "implementationEvidence": "No accepted realtime audio/screen-control adapter in Core",
      "entitlement": "Teams client permissions, provider support, and device-level live evidence",
      "negativeState": "Text chat is not reported as realtime voice or screen control",
      "focusedTest": "N/A; planned F14 device tests",
      "status": "NOT_IMPLEMENTED"
    },
    {
      "id": "schedules-notifications",
      "surface": "Proactive Teams notifications and scheduled agent work",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/designing-your-bot",
      "implementationEvidence": "No accepted durable scheduler with timezone, cancellation, and notification read-back in Core",
      "entitlement": "Tenant notification policy and durable scheduler/queue",
      "negativeState": "A completed synchronous response is not called a scheduled job",
      "focusedTest": "N/A; planned F15 schedule-* tests",
      "status": "NOT_IMPLEMENTED"
    },
    {
      "id": "canvas-computer-control",
      "surface": "Interactive editing and computer-control actions",
      "officialContract": "https://help.openai.com/en/articles/11487775-connectors-in-chatgpt",
      "implementationEvidence": "No accepted canvas or computer-control adapter in Core",
      "entitlement": "Explicit target approval, isolation, and provider contract",
      "negativeState": "A textual agent result is not treated as computer-control execution",
      "focusedTest": "N/A; planned F16 isolation tests",
      "status": "NOT_IMPLEMENTED"
    },
    {
      "id": "azure-worker-live",
      "surface": "Public Azure queue/worker execution",
      "officialContract": "https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices",
      "implementationEvidence": "Azure dispatch code and health/readiness contracts exist, but current live worker identity is not read back",
      "entitlement": "Configured Azure resources, worker identity, and same-release health evidence",
      "negativeState": "Queue unavailability remains fail-closed; local fixture is not live Azure proof",
      "focusedTest": "scripts/azure-core-test-runner-test.mjs; scripts/a2a-execution-readiness-test.ts",
      "status": "LIVE_UNVERIFIED"
    },
    {
      "id": "teams-mobile-ui",
      "surface": "iOS/Android Teams app and WebView",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context",
      "implementationEvidence": "Responsive tab and mobile fallback source exists; current same-release mobile screenshots and AX evidence are absent",
      "entitlement": "Installed same-release Teams app, mobile host, and device permissions where applicable",
      "negativeState": "Mobile result remains MOBILE_UNVERIFIED until actual device evidence is captured",
      "focusedTest": "scripts/client-orchestration-panel-test.tsx; live mobile test required",
      "status": "MOBILE_UNVERIFIED"
    },
    {
      "id": "teams-portal-installed-identity",
      "surface": "Developer Portal/Admin Center and installed Teams app",
      "officialContract": "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/prepare-your-app",
      "implementationEvidence": "Manifest validation and packaging contracts exist; current portal/installed same-release read-back is absent",
      "entitlement": "Tenant app upload policy and exact package identity",
      "negativeState": "No release completion while portal, runtime, ZIP, and installed version are not identical",
      "focusedTest": "scripts/release-gate-test.mjs; scripts/teams-registration-test.mjs",
      "status": "LIVE_UNVERIFIED"
    }
  ]
}
```

## Reading rule

The matrix is an evidence index, not a feature promise. Before a release, update only rows backed by a current exact commit, package identity, public health, portal read-back, and the applicable Teams desktop/mobile evidence. Do not convert `SOURCE_TESTED`, `OPTIONAL_UNCONFIGURED`, `LIVE_UNVERIFIED`, or `MOBILE_UNVERIFIED` into `PASS` by changing prose alone.
