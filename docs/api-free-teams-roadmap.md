# API-free agent-only Teams Core 로드맵

## 결정

현재 기준 제품은 **agent-only Teams Core**다. API 키 없이도 Microsoft Teams 안에서 에이전트 작업을 시작하고, durable 이력과 진행 상황을 조회하며, 승인·입력·취소·재시도를 수행할 수 있어야 한다.

- UI: React 개인 탭 + `@microsoft/teams-js`
- 대화: Microsoft Teams SDK Bot
- 메시지 UI: canonical Microsoft Teams 문서의 모바일 공식 범위인 Adaptive Cards 1.6의 제한된 subset
- 서버: Express + 결정형 에이전트 작업 lifecycle
- 실행: 인증된 Codex CLI 또는 명시적으로 구성된 provider runner
- 상태: durable AgentJobStore와 선택적 durable queue/worker
- 선택 기능: CopilotKit, OpenAI-compatible provider, 로컬 모델, MCP, 외부 SaaS adapter는 feature flag와 별도 증거 뒤에 둔다

날씨, 위치 조회, 일반 업무 CRUD, 협업 피드는 현재 Core 제품 범위가 아니다. 날씨 API·명령·위젯과 geolocation 권한 요청은 제거 상태를 유지하고, 매니페스트에는 사용하지 않는 `devicePermissions`를 선언하지 않는다.

## 사용자 표면

### 2026-10-07 적용 순서와 검증 경계

사용자 제공 Library 보고서 `libfile_7cfcb5c652c88191be09e432c6b3c2c4`의 v0 파일을 실제 로컬로 materialize하고 읽었다. 30개 후보의 고정 소스·라이선스 근거는 기술 비교 자료이며, upstream 또는 우리 앱의 실행 통과 증거가 아니다. 기존 durable job·승인·owner 격리·provider 선택·실행 영수증을 다시 구현하지 않는다.

작은 단위의 순서는 대화 상세 → 개인 채팅 알림 → 진행 카드/outbox → 승인함 → 이어가기/취소 → provider/실행 영수증 → Windows 및 receiver/worker 분리 → 파일/PR → 일정 workflow → RAG/MCP/기억 → child jobs/사용자 인계/명시적 공유 → 컴퓨터 작업이다. 새 외부 연결·권한·비용·대상이 필요한 단계는 현재 승인 범위에서 설계와 합성 시험까지 진행한다.

개인 승인함은 기존 owner-scoped 작업 응답의 `pendingOperation`을 읽는다. `awaiting_approval`인 `workspace-write` 작업만 표시하며, 상세·대화 이력·작업/확인 카드가 동일 작업 ID와 서버 계산 revision을 표시한다. revision은 순서가 고정된 schema1 배열 `[schema, jobId, prompt, mode, provider|null, executionEnvironment|null, model|null, reasoningEffort|null, catalogRevision|null, parentJobId|null, threadId|null]`의 JSON UTF-8 SHA-256이다. 진행 로그·전송 상태·시간은 포함하지 않는다. 이는 읽기 전용 비교 식별자이며 실행 권한이나 인자 결합 승인 토큰이 아니다. 기존 확인 grant는 action/job/correlation/tenant/requester/conversation을 결합하며 별도 인자 revision을 결합하지 않는다. 기존 grant 만료·소비·권한 검사는 그대로 유지한다. grant 만료는 durable 작업 만료를 뜻하지 않고, 다른 표면이 승인/취소하면 최신 작업 응답에서 pending 항목이 사라진다. 새 승인 경로나 자동 실행을 추가하지 않는다. 이 slice의 로컬 합성 결과는 보존된109 릴리스 검증과 분리하며 공개104/설치본/카탈로그 및 실제 Teams UI는 변경·검증하지 않는다.

승인함은 최근 일반 작업 20개에서 필터링하지 않고 owner 범위의 전체 저장 작업에서 승인 대기 상태를 먼저 필터링한다. 응답은 최대100개이며 더 있으면 생략 안내를 표시한다. 기존 응답에 승인함 조회가 없으면 전체 빈 상태로 주장하지 않고 최근 작업 기준임을 표시한다. 선택 상세는 기존 owner-scoped get API로 polling마다 갱신해 다른 표면에서 처리된 상태를 반영한다.

실행 영수증의 첫 표시 slice는 기존 Codex 작업의 선택 model/effort, worker 관측 model/effort와 출처·시각, 검증된 terminal usage·출처를 공통 읽기 전용 projection으로 탭 상세·작업 카드·대화 각 turn에 표시한다. 별도 수집하지 않는 전송 model/effort와 responseId는 `수집되지 않음`으로 표시하며 선택값·threadId·jobId를 대신 채우지 않는다. 없는 usage는 실제 0과 구분하고 reasoning token 수로 실제 effort를 추정하지 않는다. 원본 job 저장 계약과 owner-scoped API는 유지한다. 이는 직접 provider 응답 증거, 새 provider 연결, 비용 집계나 공개 배포 검증이 아니다. 보존된110 기준과 별도의 소스 변경·로컬 합성 검증으로 추적한다.

첫 대화 상세는 기존 owner-scoped API의 선택 작업과 최대 20개 부모 작업에 저장된 요청·최종 응답·진행·안전한 도구 이름을 보여준다. 내부 reasoning, raw CLI 세션, 저장되지 않은 도구 결과를 복원한 것처럼 표시하지 않는다. 이전 작업이 없거나 체인이 불일치하면 불완전 상태를 표시한다. 이후 저장·cursor·전체 세션은 별도 수락 조건으로 확장한다. [OpenClaw 고정 소스](https://github.com/openclaw/openclaw/tree/2e59936b6747f10c44edb76decd662c2d27305be), [LibreChat 고정 소스](https://github.com/LibreChat-AI/LibreChat/tree/e1dfc10449ff713faffacd60273fddcfe2c0a698)는 비교 근거이며 코드 복사나 실행 검증을 뜻하지 않는다.

사용자의 `업무허브탭의 devtunnel 은 시간제한을 두지마` 요청에 따라 기존 승인된 서버·터널의 로컬 자동 종료 시간은 제거한다. `scripts/local_hub_lifetime.py`의 `None` 정책은 자동 종료 기한이 없으며, 명시적 정지 또는 서버 종료는 여전히 종료 조건이다. 이 정책 자체는 실행 권한을 부여하지 않는다. tunnel 서비스 만료·인증·접근 범위와 OS 설정은 변경하지 않으며, 현재 프로세스 생존은 24/7 가용성 보장이 아니다.

### Teams Bot 채팅

- `help`와 `agent ...` namespace만 기본 명령으로 노출한다.
- 에이전트 작업 시작, 상태·목록 조회, 승인, 추가 입력, 취소, 재시도를 처리한다.
- 작업 카드는 상태와 최소 action만 보여주고, `프롬프트·도구` `Action.ShowCard`에서 원본 프롬프트와 관찰된 도구를 펼쳐 본다.
- 카드 응답은 attachment-only다. 카드와 같은 문장을 top-level `text`에 중복 전송하지 않는다.

### 업무허브 개인 탭

- 서비스·인증·저장소·실행 준비 상태를 간단히 표시한다.
- 새 작업 입력과 provider/mode 선택, durable 작업 목록, 선택한 작업 상세만 제공한다.
- 작업 목록은 3초마다 갱신한다. 앞선 요청이 끝난 뒤 다음 요청을 예약해 중첩 폴링을 만들지 않는다.
- 상세에는 상태, 작업 ID, 원본 프롬프트, 진행 기록, 결과·오류, provider가 보고한 도구를 표시한다.

여기서 `near-real-time`은 3초 polling contract다. push, WebSocket 또는 streaming UI가 구현됐다는 뜻이 아니다. 서버의 durable record가 기준이며 탭의 일시적인 메모리 상태를 완료 증거로 사용하지 않는다.

## 도구 provenance의 truth boundary

도구 이력은 provider가 구조화된 실행 이벤트에 명시한 제한된 식별자만 기록한다.

- `skill`: provider가 skill 분류와 이름을 명시한 경우
- `plugin`: provider가 plugin 분류와 이름을 명시한 경우
- `mcp`: provider가 MCP server/tool 이름을 명시한 경우
- `cli`: command execution 이벤트가 있을 때 실행 파일 basename만
- `builtin`: provider가 내장 tool 이름을 명시한 경우

원문 command, 인수, 파일 경로, tool input/output, 환경변수, 토큰과 자격 증명은 저장·표시하지 않는다. provider가 이름을 보고하지 않은 경우 UI는 `보고된 도구 없음`으로 표시한다. 이는 실제 도구 미사용의 증거가 아니다. 프롬프트, command 문자열 또는 최종 응답을 분석해 스킬·플러그인 사용을 추론하지 않는다.

Codex CLI 공식 계약에서 `codex exec --json`은 JSONL 실행 이벤트를 제공하지만 skill/plugin provenance를 항상 구분해 주는 계약은 아니다. GitHub Copilot streaming event의 `toolName`, `mcpServerName`, `mcpToolName`처럼 provider가 명시한 식별자만 수집한다. 새 provider도 같은 fail-closed projection을 통과해야 한다.

## 공식 Teams 호환성 기준

- 개인 탭은 TeamsJS가 초기화되는 HTTPS `contentUrl`을 사용하고 `/tabs/home/` trailing slash를 유지한다.
- Core 오케스트레이션 Bot 카드는 canonical Microsoft Teams `en-us` 문서의 모바일 공식 지원 범위인 Adaptive Cards 1.6으로 선언하고, 실제 요소도 검증된 제한적 subset만 사용한다. Teams가 지원하지 않는 `positive`/`destructive` action style은 사용하지 않는다. 지역화 문서가 canonical 문서와 다르면 실제 Teams 데스크톱·모바일 검증 전까지 계약 차이를 명시한다.
- 프롬프트·도구 상세는 Teams가 지원하는 `Action.ShowCard`로 제공한다.
- 현재 제품이 네이티브 장치 기능을 사용하지 않으므로 Teams 매니페스트에 장치 권한을 선언하지 않는다. 향후 권한이 필요한 기능은 별도 수락·구현·검증·버전으로 추가한다.
- MCP는 서버 측 optional tool adapter이며 Teams 탭이나 모바일 UI를 대체하지 않는다.

## 단계별 수직 slice

각 단계는 source test, clean build, package identity, 공개 runtime, Teams 데스크톱과 모바일 증거를 같은 릴리스로 묶은 뒤에만 완료한다.

### 0. Agent-only Core 경계

목표:

- 서버와 탭이 API 키 없이 시작한다.
- 활성 UI, Bot command list, 매니페스트에 weather/geolocation이 없다.
- optional provider가 없어도 Core 상태·작업 lifecycle이 동작한다.

최소 게이트:

```bash
npm run test:agent-only-hub-contract
npm run test:manifest
npm run typecheck
```

### 1. Durable 작업 lifecycle

목표:

- submit, list, get, approve, input, cancel, retry가 사용자 범위와 idempotency 계약을 지킨다.
- queued, running, awaiting approval, input required, completed, failed, cancelled 상태가 durable store에 남는다.
- 저장 실패 시 메모리 상태를 롤백하고 재시작 뒤에도 저장된 상태를 복구한다.
- 프로세스 exit code 0만으로 완료 처리하지 않고 비어 있지 않은 최종 result를 요구한다.

### 2. 최소 업무허브

목표:

- 초기, 로딩, 빈 목록, 성공, 오류, 재시도 상태를 작은 화면에서도 읽을 수 있다.
- 3초 non-overlapping polling으로 durable 이력과 진행을 갱신한다.
- 선택한 작업에서 원본 프롬프트와 provider-reported tools를 조회한다.
- approval/cancel처럼 확인이 필요한 mutation은 `window.confirm`이 아니라 탭 내부 확인 UI를 사용한다.

### 3. Teams 채팅 카드

목표:

- `help`, `agent run|write|status|list|approve|input|cancel|retry`의 실제 서버 왕복을 확인한다.
- 작업 카드의 `프롬프트·도구` ShowCard가 원본 프롬프트와 같은 durable tool observations를 표시한다.
- 상태별 action과 업무허브 링크만 제공하고 카드·text 중복을 만들지 않는다.
- 잘못된 ID, 중복 요청, 권한 거부, provider unavailable을 성공 카드로 포장하지 않는다.

### 4. 도구 관찰과 보안

목표:

- Codex JSONL 및 지원 provider lifecycle event에서 허용된 category/name만 투영한다.
- 도구 목록은 중복 제거, 개수·길이 제한, 허용 문자 검증을 거친다.
- raw command, arguments, output, path, secret이 API·탭·카드·로그 증거에 노출되지 않는다.
- skill/plugin 명시 이벤트가 없는 실행은 `unreported`로 남고 다른 텍스트에서 추정하지 않는다.

### 5. Worker와 A2A 확장

조건: 단일 agent lifecycle과 same-release Teams UI가 안정된 뒤 진행한다.

- indexed Codex worker는 서로 다른 owner-only `AGENT_CODEX_HOME_<ordinal>`을 사용한다.
- provider, 실행 identity, 취소, 재시작 복구를 durable task에 고정한다.
- fixture와 localhost 통과를 live authenticated A2A 증거로 승격하지 않는다.
- 실제 Agent Card, send/get/list/cancel, 병렬 child, restart recovery, telemetry를 별도 검증한다.

### 6. 선택 provider

조건: agent-only Core 릴리스 게이트가 모두 통과한 뒤 진행한다.

- CopilotKit, OpenAI-compatible, 로컬 모델, MCP, Jira/Confluence/Bitbucket adapter는 optional build와 feature flag로만 활성화한다.
- 서버 자격 증명은 클라이언트에 노출하지 않고 principal·scope·timeout·redaction 경계를 검증한다.
- 설정되지 않은 provider는 `OPTIONAL_PROVIDER_NOT_CONFIGURED`로 남기며 Core를 가리거나 가짜 fallback 성공을 반환하지 않는다.
- contract/fixture 테스트는 실제 connector 인증, 외부 service write, Teams UI 왕복의 증거가 아니다.

## 릴리스 게이트

기능 추가 또는 재현된 버그 수정이 수락된 경우에만 버전을 한 번 올린다. 문서·감사·증거 갱신이나 실패한 재시도만으로 버전 또는 ZIP을 만들지 않는다.

1. 현재 source와 focused regression 검사
2. clean `build:core`, `test:core`, 매니페스트 검증
3. source commit, manifest version, ZIP SHA-256 결합
4. 기존 로그인 인앱 브라우저 탭에서 기존 앱의 새 버전 업로드
5. 공개 health, `/tabs/home/`, 해시 자산, Bot endpoint 확인
6. Teams 데스크톱에서 Bot·ShowCard·업무허브 전 분기 스크린샷과 접근성 증거
7. 모바일에서 같은 설치 버전의 레이아웃·카드 action·탭 동작 확인
8. 모든 발견 항목의 Jira 매핑 후에만 Teams 완료 메시지

weather/geolocation은 이번 제품에서 `N/A`가 아니라 **제거 계약**이다. 릴리스 gate는 해당 API·명령·UI·매니페스트 권한이 다시 나타나면 실패해야 한다.

## 공식 레퍼런스

- [Teams 플랫폼 개요](https://learn.microsoft.com/en-us/microsoftteams/platform/overview)
- [Teams 탭](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs)
- [데스크톱·웹·모바일 탭 디자인](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/design/tabs?tabs=mobile)
- [Teams Adaptive Cards 참고](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference)
- [Teams 카드 동작](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions)
- [Teams 네이티브 장치 권한](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/native-device-permissions)
- [OpenAI Codex CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [GitHub Copilot streaming events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)
- [MCP in Teams SDK](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/in-depth-guides/ai/mcp/overview)
