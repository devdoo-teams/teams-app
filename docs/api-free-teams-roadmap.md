# API-free Teams Core 로드맵

## 결정

현재 사용 가능한 인증·실행 경로가 Codex CLI와 GHCP CLI뿐이고 OpenAI API 키가 없으므로, 제품의 기준 경로는 **외부 LLM/API 없이 동작하는 Teams Core**로 고정한다.

- UI: React 개인 탭 + `@microsoft/teams-js`
- 대화: Microsoft Teams SDK + TypeScript
- 메시지 UI: Teams Bot Adaptive Cards와 텍스트 fallback
- 서버: Express + 결정형 업무/상태/날씨/승인 로직
- 작업 실행: 서버가 인증된 Codex CLI를 호출하는 명시적 작업 경계
- 저장소: 현재 단일 프로세스 JSON 저장소. 분산 운영은 별도 단계
- 선택 기능: CopilotKit, OpenAI-compatible provider, 로컬 모델, MCP는 모두 명시적 feature flag 뒤에 둔다

API 키가 필요한 기능을 Core 완료 조건에 포함하지 않는다. 선택 provider가 꺼져 있는 것은 실패가 아니라 `OPTIONAL_PROVIDER_NOT_CONFIGURED` 상태다.

## 공식 호환성 판단

Microsoft 공식 문서 기준으로 개인 탭은 Teams 모바일에서 WebView로 열리는 사용자 지정 화면이고, TeamsJS 초기화·매니페스트의 `staticTabs`·HTTPS `contentUrl`이 기본 계약이다. 모바일에서는 Android/iOS 클라이언트 각각을 테스트해야 한다.

Adaptive Cards는 봇과 탭의 UI를 대체하는 별도 기술이 아니라, 봇 메시지 안에서 버튼·입력·링크를 제공하는 메시지 UI다. Teams 모바일은 Adaptive Cards 1.2까지를 기준으로 삼아야 하므로 Core 카드 JSON은 1.2 호환 subset으로 제한한다. 복잡한 화면은 탭에서 제공하고, 채팅 카드는 짧은 요약과 1차 작업만 제공한다.

MCP는 Teams 모바일 화면 표준이 아니다. Microsoft Teams SDK의 MCP client/server는 서버 측 도구 연결 계층으로 사용할 수 있지만, Teams 모바일에 직접 렌더링되는 UI는 여전히 Teams 탭·봇·Adaptive Cards가 담당한다. 따라서 현재는 MCP Apps 위젯을 Core UI로 이식하지 않고, 나중에 구체적인 MCP 서버와 무키 실행 조건이 확인될 때만 별도 adapter로 추가한다.

## 가장 작은 단위의 구현 순서

### 0. Core 경계 고정

목표: API 키가 없어도 서버와 탭이 시작되고, `/api/health`가 `deterministic=true`, `openai=false`, `mcp=disabled`를 보여준다.

검증:

- `npm run build:core`
- `npm run test:core`
- `npm run release:preflight`
- 공개 `/api/health`와 `/tabs/home/`

### 1. 탭 셸과 상태 읽기

목표: TeamsJS 초기화, 서비스 상태, 인증 상태, 탭 링크가 모바일·데스크톱에서 보인다.

범위: 읽기 전용 상태 카드와 새로고침만 구현한다. 위치·업무 변경·AI를 아직 섞지 않는다.

통과 조건: 초기/로딩/실패/재시도/인증 만료를 전·후 스크린샷과 접근성 트리로 확인한다.

### 2. 업무 한 건 CRUD

목표: 제목 입력 → 추가 → 목록 조회 → 완료/재개 → 삭제를 한 건씩 실제 서버 mutation으로 확인한다.

범위: idempotency key, 소유자 범위, 중복 클릭 잠금, 새로고침·재시작 보존을 포함한다.

통과 조건: 빈 목록, 잘못된 입력, 중복 전송, 성공, 서버 오류, 재시작 후 보존을 각각 확인한다.

### 3. Bot 명령과 Adaptive Card

목표: `help`, `status`, `list`를 Teams SDK Bot으로 처리하고, 카드의 모든 버튼이 동일한 서버 mutation/API로 연결된다.

범위: 카드와 top-level 텍스트 중복을 제거하고, 모든 카드에 업무 허브 탭 링크를 기본 제공한다. 버튼 수는 모바일 가독성을 위해 최소화한다.

통과 조건: 명령 입력 전·후, 카드 버튼 입력 전·후, 잘못된 입력, 권한 거부, 재전송을 Teams 데스크톱과 모바일에서 확인한다.

### 4. 위치 요청과 날씨

목표: 탭의 `내 위치 사용` 버튼이 Teams 모바일 권한과 HTML5 Geolocation 경로를 사용하고, 위치가 없으면 추측하지 않고 안내한다.

범위: 권한 허용/거부/취소/재시도와 좌표 기반 날씨 조회만 다룬다. Bot의 `weather <위도> <경도>`는 별도 명시 입력 경로로 유지한다.

통과 조건: 실제 iOS Teams에서 위치 허용·거부·재시도와 위젯 갱신을 확인한다. 데스크톱 확인만으로 모바일 GPS 통과를 선언하지 않는다.

### 5. Codex CLI 작업 경계

목표: Teams에서 `run`으로 읽기 전용 Codex CLI 작업을 시작하고, `status`/후속 답장으로 같은 thread를 이어간다.

범위: 읽기 전용 → 승인 필요한 write → approve/cancel → commit 순서로 확장한다. GHCP CLI는 별도 실행 adapter로 추가하되, 둘 중 하나가 없을 때 Core 명령이 가짜 완료를 반환하지 않게 한다.

통과 조건: 실제 CLI 프로세스 PID·로그·작업 상태·중단·재시작 보존을 확인하고, 변경 결과가 없는 경우 “완료”라고 답하지 않는다.

### 6. 협업·알림 기능

목표: 팔로우, 채널 연결, 알림 수준 저장을 독립 기능으로 추가한다.

범위: 외부 Jira/Trello/Atlassian 연동은 아직 넣지 않는다. 먼저 내부 업무 상태와 Teams 대화만 연결한다.

### 7. 선택 provider의 격리된 실험

조건: Core 기능과 모바일 전수 검증이 안정된 뒤에만 시작한다.

- CopilotKit: API 키/런타임이 있는 별도 실험 build에서만 켠다.
- OpenAI-compatible: 서버 환경변수로만 설정하고 모바일에 키·endpoint를 노출하지 않는다.
- MCP: 실제 MCP 서버의 tool schema와 인증·실패·timeout을 확인한 뒤 서버 adapter만 추가한다. MCP Apps UI를 Teams 탭으로 직접 가정하지 않는다.

선택 provider는 Core 릴리스와 별도 버전·feature flag·테스트·증거를 갖는다. 설정되지 않은 provider가 Core UI를 가리거나 기본 빌드를 지연시키지 않아야 한다.

## 릴리스 게이트

각 단계는 다음을 모두 통과해야 다음 단계로 이동한다.

1. 원본 로컬 소스에서 구현·명령어 테스트·API 런타임 검증
2. 새 버전·새 ZIP·manifest·SHA 검증 및 Git 커밋
3. 기존 로그인 인앱 브라우저 탭을 재사용해 기존 앱 업데이트 경로로 업로드
4. local bypass/outbox 종료 후 공개 Teams SDK 프로세스로 전환
5. 공개 health, 탭, Bot 왕복 확인
6. 데스크톱 접근성 트리와 전·후 스크린샷 확인
7. 모바일에서 같은 기능을 직접 확인하고 전·후 스크린샷 확보
8. 그 뒤에만 Teams 완료 메시지 전송

화면 잠금·네이티브 파일 선택·Auth 승인으로 3~8번이 불가능하면 해당 단계는 `BLOCKED`로 남긴다. 이를 추측으로 `PASS` 처리하거나 새 브라우저 탭·iCloud 파일·존재하지 않는 원격 저장소로 우회하지 않는다.

## 참고 레퍼런스

- [Tabs in Microsoft Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs)
- [Design Tabs for Desktop, Web & Mobile](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/design/tabs?tabs=mobile)
- [Get Contextual Information for Tabs](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context)
- [Create and Explore Card Types in Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference)
- [Executing Actions in Adaptive Cards](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/in-depth-guides/adaptive-cards/executing-actions)
- [Microsoft Teams Developer Platform](https://learn.microsoft.com/en-us/microsoftteams/platform/overview)
- [Tools and SDKs to Build Teams App](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/tool-sdk-overview)
- [Teams SDK quickstart](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/get-started/quickstart-register)
- [Microsoft Teams Samples](https://github.com/OfficeDev/Microsoft-Teams-Samples)
- [Microsoft Teams SDK](https://github.com/microsoft/teams-sdk)
- [MCP in Teams SDK](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/in-depth-guides/ai/mcp/overview)
