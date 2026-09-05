# Teams Agent Hub

Microsoft Teams SDK, TypeScript/React 개인 탭, Express, Adaptive Cards로 만든 내부용 에이전트 업무 허브입니다.

## 현재 제품 계약

현재 기준 제품은 **agent-only Teams Core**입니다. 사용자에게 노출되는 Core 표면은 다음 두 곳입니다.

- Teams Bot 채팅: 에이전트 작업 시작, 조회, 승인, 입력, 취소, 재시도와 진행·완료 알림
- `업무 허브` 개인 탭: 서비스 상태, 새 작업 제출, durable 작업 이력, 진행 상황, 작업 상세 조회

일반 업무 CRUD, 날씨, 위치 조회는 현재 제품 범위가 아닙니다. 날씨 API·명령·위젯과 geolocation 요청은 제거됐고, Teams 매니페스트에도 위치 `devicePermissions`를 선언하지 않습니다. 남아 있는 선택 provider나 레거시 내부 모듈은 Core 사용자 기능 또는 릴리스 완료 증거로 간주하지 않습니다.

## Core 기능

- `GET /api/health`로 공개 런타임과 인증·저장소·에이전트 실행 준비 상태 확인
- Teams SDK `/api/messages`에서 `help`와 `agent ...` 명령 처리
- read-only 또는 승인 후 workspace-write 에이전트 작업 실행
- 작업 ID, provider, 상태, 진행 기록, 결과·오류의 durable 저장과 재시작 복구
- 업무허브에서 3초마다 작업 목록을 갱신하는 near-real-time 조회
- 진행 중인 요청이 끝난 뒤 다음 조회를 예약해 중첩 폴링 방지
- 선택한 작업의 원본 프롬프트, 진행 기록, 결과와 provider가 보고한 도구 표시
- Teams 채팅 작업 카드의 `프롬프트·도구` `Action.ShowCard`
- 카드 attachment-only 전송으로 카드와 top-level 텍스트 중복 방지

`near-real-time`은 현재 3초 폴링을 뜻하며 push 또는 streaming UI를 뜻하지 않습니다. 작업 이력은 서버의 durable store가 기준이고, 브라우저 메모리만으로 완료 상태를 만들지 않습니다.

## 프롬프트와 도구 증거 경계

업무허브와 Adaptive Card는 작업에 저장된 원본 프롬프트를 표시합니다. 도구 정보는 실행 provider가 구조화된 이벤트로 명시한 안전한 식별자만 저장·표시합니다.

| 분류 | 표시 조건 |
| --- | --- |
| `skill` | provider가 스킬 분류와 식별자를 명시적으로 보고함 |
| `plugin` | provider가 플러그인 분류와 식별자를 명시적으로 보고함 |
| `mcp` | provider가 MCP server/tool 식별자를 명시적으로 보고함 |
| `cli` | provider 이벤트가 command execution을 보고함. 실행 파일 basename만 표시 |
| `builtin` | provider가 내장 tool 이름을 명시적으로 보고함 |

명령 인수, 원문 shell command, 경로, tool input/output, 토큰과 자격 증명은 도구 이력에 넣지 않습니다. provider가 식별자를 보고하지 않으면 `보고된 도구 없음`으로 표시합니다. 이는 도구를 사용하지 않았다는 뜻이 아니라 **관찰 가능한 provider 증거가 없다는 뜻**입니다. 명령 문자열이나 결과 문장에서 스킬·플러그인 사용을 추론하지 않습니다.

Codex CLI의 공식 `codex exec --json` 계약은 JSONL 실행 이벤트를 제공하지만 스킬·플러그인 provenance를 항상 보장하지 않습니다. GitHub Copilot의 streaming event에서 `toolName`, `mcpServerName`, `mcpToolName`처럼 명시적으로 전달된 이름만 같은 원칙으로 수집합니다.

## 로컬 실행

```bash
npm install
npm run check
TEAMS_LOCAL_DEV=true TEAMS_SKIP_AUTH=true npm run dev
```

실행 후 다음 주소를 확인합니다.

- 업무허브 탭: http://localhost:3978/tabs/home/
- 상태: http://localhost:3978/api/health
- Teams 메시지 엔드포인트: http://localhost:3978/api/messages

`TEAMS_SKIP_AUTH=true`는 `TEAMS_LOCAL_DEV=true`와 함께 사용하고, 운영 공개 origin이 없는 안전한 로컬 개발에서만 허용됩니다. 운영에서는 local bypass/outbox 설정을 제거하고 Teams Bot 자격 증명과 Entra SSO를 구성해야 합니다.

## Teams 에이전트 명령

매니페스트가 노출하는 Core 명령 namespace는 다음과 같습니다.

```text
help
agent run <요청>
agent write <요청>
agent status <작업 ID>
agent list
agent cancel <작업 ID>
agent approve <작업 ID>
agent retry <작업 ID>
agent input <작업 ID> <추가 입력>
```

정상 종료 코드만으로 작업을 완료 처리하지 않습니다. 실제 최종 agent result가 없거나 durable 저장에 실패하면 `completed`가 아니라 실패 또는 차단 상태로 남깁니다.

관련 환경변수:

- `AGENT_WORKSPACE`: 에이전트가 작업할 Git 저장소의 절대 경로
- `AGENT_JOB_STORE_PATH`: 작업·thread·진행·결과·안전한 도구 식별자를 저장할 durable JSON 경로
- `CODEX_BIN`: 승인된 Codex CLI 실행 파일의 명시적 절대 경로

운영에서는 에이전트 실행기를 별도 worker로 분리하고, Teams 서버에는 사용자 범위·승인·작업 상태만 노출합니다. 현재 파일 JSON backend는 단일 프로세스 전용입니다. 여러 replica는 transactional shared store와 durable queue/outbox가 검증된 뒤에만 사용합니다.

## 선택 provider 경계

CopilotKit, OpenAI-compatible provider, 로컬 모델, MCP, Jira/Confluence/Bitbucket adapter는 명시적인 optional build·설정·테스트 대상입니다. 설정되지 않은 선택 provider는 `OPTIONAL_PROVIDER_NOT_CONFIGURED`이며 agent-only Core 실패가 아닙니다. optional provider의 fixture 통과를 실제 connector 인증이나 Teams 사용자 왕복 성공으로 보고하지 않습니다.

## 검증

```bash
npm run typecheck
npm run test:agent-only-hub-contract
npm run test:agent-tool-observation
npm run test:client-orchestration-panel
npm run test:core
npm run build:core
```

Core 검증은 날씨·geolocation이 활성 제품 표면과 매니페스트에 다시 들어오지 않는지, 업무허브 이력·진행·프롬프트·도구 경계가 유지되는지를 포함해야 합니다. optional 경로는 별도 명령으로 검사하며 Core 통과 조건에 섞지 않습니다.

## 앱 패키지와 릴리스

기능 변경을 수락하고 Core 게이트가 통과한 뒤에만 버전을 한 번 올리고 새 ZIP을 만듭니다. 생성된 ZIP에서 다음을 확인합니다.

- source package와 ZIP 내부 `manifest.json` 버전 일치
- 현재 앱 ID, bot ID, HTTPS 탭/메시지 endpoint
- `contentUrl`의 `/tabs/home/` trailing slash
- `devicePermissions`가 없음
- ZIP SHA-256과 source commit의 동일 release identity

문서 변경, 감사, 실패한 배포 재시도만으로 버전이나 ZIP을 만들지 않습니다. 자세한 절차는 [Teams 릴리스 워크플로우](docs/teams-release-workflow.md)를 따릅니다.

## 공식 계약 참고

- [Microsoft Teams 탭](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs)
- [Teams Adaptive Cards 참고](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference)
- [Teams 카드 동작](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions)
- [Teams 네이티브 장치 권한](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/native-device-permissions)
- [OpenAI Codex CLI reference](https://developers.openai.com/codex/cli/reference/)
- [GitHub Copilot streaming events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)
