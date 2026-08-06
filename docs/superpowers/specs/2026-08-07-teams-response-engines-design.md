# Teams 모바일 선택형 응답 엔진 설계

## 목적

Teams 모바일 사용자가 같은 업무 허브 대화 안에서 응답 엔진을 선택할 수 있게 한다.

- `deterministic`: OpenAI API 키 없이 항상 사용할 수 있는 결정형 명령·도구 경로
- `openai`: 서버에 보관된 OpenAI API 자격 증명을 사용하는 자연어 경로
- `local`: Ollama, LM Studio, vLLM 또는 사내 OpenAI-compatible endpoint를 사용하는 선택형 경로

모든 엔진은 동일한 `GenUiEnvelopeV1`을 만들고, 이 결과를 Teams Adaptive Card, Teams 탭의 React GenUI, MCP Apps 위젯에서 각각 렌더링한다. 사용자는 API 키 원문을 Teams 모바일에 입력하지 않는다.

## 현재 상태와 문제 정의

현재 프로젝트는 다음을 이미 갖고 있다.

- TypeScript + React + Express 기반 Teams 앱
- Teams SDK `/api/messages` 메시지 라우팅
- `src/shared/genui.ts`의 공통 GenUI 계약
- `src/server/mcp-genui.ts`의 MCP 도구·`ui://` 리소스·structured content
- `src/client/mcp/McpGenUiWidget.tsx`의 `@modelcontextprotocol/ext-apps` 위젯
- CopilotKit `CopilotChat`, AG-UI 이벤트, 업무·날씨·승인 카드
- 결정형 요청 처리가 현재 `COPILOTKIT_DETERMINISTIC_MODE=true` 경로에 존재
- OpenAI Chat Completions 도구 호출 경로가 `OPENAI_API_KEY` 존재를 요구

현재 결정형 경로는 자동 테스트 용도로만 이름 붙어 있어 운영 모드에서 키가 없으면 GenAI 설정 오류가 발생한다. 또한 Teams Bot, Teams 탭, MCP Apps가 응답 모드를 별도로 알게 되면 사용자 선택과 UI 결과가 쉽게 어긋난다.

## 조사 근거

CopilotKit 공식 Quickstart는 내장 에이전트 실행에 OpenAI API 키 또는 다른 모델 제공자 설정이 필요하다고 설명한다. Copilot Runtime은 서버 측 인증·미들웨어·에이전트 라우팅을 제공하고, Factory Mode로 사용자 정의 AI 백엔드를 연결할 수 있다.

- https://docs.copilotkit.ai/quickstart
- https://docs.copilotkit.ai/a2a/backend/copilot-runtime

MCP Apps 공식 문서는 MCP 도구가 `_meta.ui.resourceUri`로 `ui://` UI 리소스를 참조하고, 호스트가 샌드박스 iframe에 위젯을 렌더링하며, UI를 지원하지 않는 호스트에서는 일반 텍스트·구조화 결과로 동작할 수 있다고 정의한다.

- https://modelcontextprotocol.io/extensions/apps/overview
- https://apps.extensions.modelcontextprotocol.io/api/documents/Overview.html

OpenAI Apps SDK는 MCP 기반으로 앱 로직과 UI를 정의하고 ChatGPT Developer Mode에서 테스트하는 호스트 특화 계층이다. 따라서 앱 서버가 OpenAI API를 직접 호출하지 않는 구성은 가능하지만, 그 UI가 Teams 모바일 Bot 메시지에 직접 렌더링된다고 가정하지 않는다.

- https://help.openai.com/en/articles/12515353-build-with-the-apps-sdk

Ollama 공식 문서는 OpenAI 호환 endpoint를 제공하고, 예제의 API 키 값은 `ollama`처럼 형식만 충족하면 실제 인증에 사용되지 않는다고 설명한다. 이 방식은 OpenAI 키 없는 서버 측 로컬 모델 연결에 사용할 수 있지만 Teams 공개 서버에서 사용자의 Mac `localhost`에 접근할 수는 없다.

- https://docs.ollama.com/api/openai-compatibility

Microsoft Teams SDK는 메시지 Activity와 설치·업데이트 Activity를 애플리케이션 코드에서 처리한다. 결정형 명령은 모델 호출 없이 이 경로에서 직접 응답할 수 있다.

- https://microsoft.github.io/teams-sdk/typescript/essentials/on-activity/activity-ref/

## 선택한 접근

### 공통 응답 엔진 라우터

Teams Bot, CopilotKit AG-UI 엔드포인트, MCP 도구가 각자 모델 분기를 구현하지 않는다. 하나의 서버 측 라우터가 사용자 선택과 서버 설정을 검증하고 엔진을 선택한다.

```ts
export type ResponseMode = 'deterministic' | 'openai' | 'local';

export type ResponseModeAvailability = {
  mode: ResponseMode;
  label: string;
  configured: boolean;
  requiresServerConfiguration: boolean;
};

export interface ResponseEngine {
  readonly mode: ResponseMode;
  run(input: ResponseEngineInput): Promise<ResponseEngineOutput>;
}

export type ResponseEngineInput = {
  prompt: string;
  conversationId: string;
  requesterId: string;
  tenantId: string;
  context: Record<string, unknown>;
  emit: (event: GenUiEnvelopeV1 | { type: 'text'; text: string }) => void;
  isCancelled: () => boolean;
};

export type ResponseEngineOutput = {
  text: string;
  envelope?: GenUiEnvelopeV1;
  provider: ResponseMode;
};
```

`ResponseEngineOutput`은 자연어 문자열과 선택적 `GenUiEnvelopeV1`을 함께 갖는다. 카드가 필요한 업무·날씨·승인 요청은 항상 공통 envelope를 생성한다. 일반 텍스트만 필요한 응답도 Teams fallback text와 MCP `content`에 동일하게 전달한다.

### 모드별 동작

#### `deterministic`

운영 기본값이다. API 호출 없이 다음 명령을 처리한다.

- `help`, `도움`, `명령`: 사용 가능한 명령과 모드 설명
- `list`, `업무 목록`: 업무 현황 GenUI 카드
- `status`, `진행 상태`: Codex 작업 상태 카드 또는 텍스트
- `weather`, `날씨`: Teams 위치 컨텍스트가 있으면 현재 날씨, 없으면 위치 사용 안내
- `write`, `파일 수정`, `변경`: 승인 대기 GenUI 카드
- 기존 Codex 작업 재개·읽기 전용 요청: 기존 AgentService 경로

지원되지 않는 자연어는 추측하지 않고 사용 가능한 명령과 모드 선택 안내를 반환한다. 결정형 응답을 AI가 생성한 것처럼 표시하지 않는다.

#### `openai`

현재 `TeamsCodexAgent`의 OpenAI 도구 호출 경로를 provider 구현으로 이동한다.

- `OPENAI_API_KEY`는 서버 환경에만 존재한다.
- `OPENAI_MODEL`과 `OPENAI_BASE_URL`을 지원한다.
- 키가 없거나 provider가 실패하면 오류 원인을 안전하게 카드로 표시하고, 사용자 선택을 `deterministic`으로 자동 변경하지 않는다. 다음 요청은 사용자가 다시 선택할 수 있다.
- 모바일 사용자는 API 키를 입력하거나 볼 수 없다.
- 실제 OpenAI E2E는 서버에 키를 구성한 별도 릴리스에서 검증한다.

#### `local`

`LOCAL_MODEL_BASE_URL`과 선택적 `LOCAL_MODEL_API_KEY`를 사용하는 OpenAI-compatible adapter다.

- API 키가 비어 있어도 동작 가능한 endpoint를 지원한다.
- 서버가 endpoint에 접근하지 못하면 모델 응답을 위조하지 않고 provider unavailable 카드로 응답한다.
- `localhost` endpoint는 로컬 개발에서만 검증한다.
- Teams 모바일 공개 검증에는 공개 HTTPS endpoint, 사내 네트워크 경로 또는 서버와 모델이 같은 호스트에 있는 배포가 필요하다.

### 사용자 선택 UX

응답 모드 선택은 세 표면에서 같은 API와 저장소를 사용한다.

1. Teams 모바일 Bot: `mode` 명령에 대한 Adaptive Card를 보내고, 카드의 `Action.Submit`으로 선택을 받는다.
2. Teams 탭: 상단에 `응답 엔진` 선택 컨트롤을 표시하고 현재 모드·설정 상태·마지막 변경 시각을 표시한다.
3. MCP Apps 위젯: 호스트가 지원하는 경우 앱 내부에 모드 표시를 제공한다. 호스트가 지원하지 않는 경우 MCP 도구의 fallback text를 사용한다.

모드 선택 API는 다음 의미를 갖는다.

```text
GET  /api/response-mode
POST /api/response-mode { "mode": "deterministic" | "openai" | "local" }
```

서버는 Teams SSO identity 또는 Bot activity identity로 `tenantId`, `requesterId`를 확정한 뒤 저장한다. 클라이언트가 보낸 tenant·사용자 ID는 신뢰하지 않는다. 사용자가 선택한 `openai` 또는 `local`이 서버에서 구성되지 않은 경우 현재 선택은 유지하되 다음 응답에서 설정 필요 상태를 보여준다.

모바일 카드에 표시할 상태는 다음처럼 비밀정보를 포함하지 않는다.

- `결정형 · 사용 가능`
- `OpenAI · 서버 설정 필요` 또는 `OpenAI · 사용 가능`
- `로컬/사내 모델 · endpoint 설정 필요` 또는 `로컬/사내 모델 · 사용 가능`

## MCP Apps 및 Teams 렌더링 경계

MCP Apps 위젯은 MCP 호스트가 UI 리소스를 가져와 샌드박스 iframe에 렌더링하는 방식이다. Teams Bot 메시지 자체는 MCP Apps iframe을 렌더링하지 않으므로, 다음 매핑을 유지한다.

| 실행 표면 | 도구 결과 | UI 렌더러 |
|---|---|---|
| Teams 모바일 Bot | `GenUiEnvelopeV1` + fallback text | Teams Adaptive Card |
| Teams 모바일 탭 | `/api/...` + AG-UI/REST | React `GenUiCard` |
| MCP Apps 호스트 | `structuredContent` + `ui://` resource | `McpGenUiWidget` iframe |
| UI 미지원 MCP 호스트 | `content[].text` | 호스트 기본 텍스트 |

모든 표면의 카드 제목, 상태, 업무 수, 날씨, 승인 경계는 같은 envelope를 기준으로 한다. MCP 위젯의 승인·취소 작업은 현재처럼 읽기 전용으로 유지하고, 실제 쓰기 승인은 Teams 탭 또는 Bot 승인 경계에서만 수행한다.

## 보안 및 실패 처리

- 모드 선택은 기능 선택이지 권한 상승 수단이 아니다.
- 업무·Codex 작업·승인·취소는 기존 ACL과 tenant/conversation/requester scope를 그대로 적용한다.
- API 키·provider token·authorization header는 GenUI, Adaptive Card, MCP structured content, 로그에 넣지 않는다.
- `/api/health`에는 provider 이름과 configured 여부만 표시한다.
- 사용자 입력으로 provider URL을 바꾸지 않는다. endpoint는 서버 환경설정으로만 결정한다.
- `deterministic`은 모델 장애 시의 숨은 fallback이 아니라 독립적인 사용자가 선택 가능한 모드다.
- provider timeout, malformed tool call, invalid model output은 안전한 error envelope로 변환한다.
- MCP Apps의 CSP·sandbox·권한 메타데이터는 필요한 최소 범위로 유지한다.

## 검증 계획

### 계약·단위 검증

- 모드 enum, availability payload, 저장·조회 ACL
- tenant 간 사용자 모드 격리
- 알 수 없는 모드·길이 초과 값 거부
- 결정형 명령별 envelope와 fallback text 동등성
- OpenAI adapter가 키 없이 네트워크 호출하지 않는지 검증
- 로컬 adapter가 API 키 없이 fake OpenAI-compatible server와 통신하는지 검증
- provider 오류·timeout·잘못된 tool call의 안전한 error envelope

### 통합 검증

- `/api/response-mode` GET/POST와 CopilotKit 실행 경로의 모드 반영
- Teams SDK Activity에서 `mode`와 Adaptive Card submit 처리
- MCP `tools/list`의 `_meta.ui.resourceUri`, UI resource MIME type, structured content 검증
- MCP Apps basic host에서 업무·날씨 envelope 렌더링
- UI 미지원 MCP 클라이언트에서 fallback text 확인

### 실제 런타임 검증

1. 로컬 deterministic: 키 없이 탭·Bot·MCP 도구 확인
2. 공개 deterministic: `auth=teams-authenticated`, `bot=teams-sdk`, `outbound=teams-sdk` health 확인
3. Teams 모바일: 응답 모드 카드 선택 → `list`·`status`·`weather` → GenUI 응답 확인
4. OpenAI 서버 설정 후: 모바일에서 OpenAI 선택 → 자연어 도구 호출 → GenUI 응답 확인
5. local endpoint 설정 후: 모바일에서 로컬/사내 모델 선택 → 자연어 도구 호출 → GenUI 응답 확인
6. 각 변경마다 새 Teams ZIP을 만들고 Developer Portal에 업로드한 뒤, 공개 프로세스로 전환하고 모바일 증거를 확보한다.

## 릴리스 및 Git 규칙

이 설계는 기존 Teams 릴리스 워크플로우를 변경하지 않는다.

- 설계 문서와 구현을 의미 있는 단위로 커밋한다.
- 이전 하위 에이전트의 저장소 보강 변경은 먼저 독립 리뷰·테스트·커밋한다.
- 응답 모드 contract, deterministic engine, provider adapters, Teams UX, MCP Apps, 테스트를 각각 검토 가능한 커밋 단위로 만든다.
- 버전을 올리고 ZIP 내부 manifest, `devicePermissions`, SHA-256을 확인한다.
- Developer Portal 업로드 성공과 버전을 직접 확인한다.
- 로컬 bypass를 종료한 뒤 공개 Teams SDK 프로세스로 전환한다.
- 공개 health와 실제 Teams 모바일 메시지 왕복을 확인하기 전에는 완료 메시지를 보내지 않는다.

## 범위 밖

- Teams 모바일 앱에 사용자가 OpenAI API 키 원문을 입력하는 기능
- Teams Bot 메시지 안에서 MCP Apps iframe을 직접 렌더링하는 기능
- 공개 서버에서 사용자의 개인 Mac `localhost` 모델에 직접 접근하는 기능
- OpenAI 키가 없는 상태에서 자연어 추론이 가능한 것처럼 응답을 위조하는 기능

## 완료 기준

다음 조건을 모두 만족해야 이 기능을 완료로 본다.

- Teams 모바일 사용자가 세 응답 모드를 선택할 수 있다.
- 키가 없어도 deterministic 모드의 업무·날씨·상태·승인 흐름이 동작한다.
- OpenAI 모드는 서버 설정이 있을 때만 자연어 경로를 사용한다.
- local 모드는 서버가 실제 endpoint에 연결될 때만 사용 가능 상태로 표시한다.
- Teams, CopilotKit 탭, MCP Apps 호스트가 동일한 GenUI envelope 의미를 표시한다.
- 모드 선택과 업무 권한이 tenant/requester 범위로 격리된다.
- 새 패키지 업로드, 공개 health, Teams 모바일 왕복 증거가 Git 커밋과 함께 남는다.
