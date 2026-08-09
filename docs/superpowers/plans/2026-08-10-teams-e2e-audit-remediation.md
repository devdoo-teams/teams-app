# Teams-first 원자적 확장·E2E 검증 계획

> 개정일: 2026-08-10
>
> 이 문서가 이전 remediation 계획을 대체한다. 목표는 CopilotKit, OpenAI API, MCP Apps를 전제로 하지 않고, Teams에서 실제로 사용 가능한 가장 작은 수직 slice를 하나씩 릴리스하는 것이다.

## 1. 결론과 기준선

Microsoft 공식 문서 기준으로 이 프로젝트의 기본 구조는 유효하다.

- Teams 탭은 Teams 호스트 안의 iframe 웹 페이지이며 매니페스트의 `contentUrl`과 TeamsJS `app.initialize()`가 핵심 계약이다.
- Teams SDK는 JavaScript/TypeScript를 지원하고 봇·Adaptive Cards·대화형 작업을 제공한다.
- Microsoft 공식 샘플 저장소에는 Teams SDK·TeamsJS·TypeScript 샘플, personal tab, device permissions, deep link, tab UI template가 있다.
- Adaptive Card의 새 서버 동작은 `Action.Execute`를 우선하고, 실제 Teams 호스트 호환성은 데스크톱·모바일 런타임에서 별도로 확인해야 한다.

따라서 기술 기준선은 다음으로 고정한다.

| 영역 | 기준선 | 첫 릴리스에서 전제하지 않는 것 |
|---|---|---|
| Bot | `@microsoft/teams.apps` + TypeScript + `/api/messages` | CopilotKit agent runtime |
| Tab | React + TeamsJS personal tab + `/tabs/home/` | MCP widget을 기본 화면으로 사용 |
| 응답 | 서버 결정형 명령 + Adaptive Card | OpenAI/모델 API 호출 |
| 실제 작업 | 로그인된 Codex CLI `codex exec` | API key 기반 LLM 작업 |
| 보조 작업기 | 설치·로그인 확인 후에만 GHCP CLI를 선택지로 노출 | GHCP CLI를 추측하거나 자동 설치 |
| 저장 | 로컬 원본 `/Users/doosansmacbookpro/Documents/TeamsApp`의 파일 JSON | iCloud, 원격 저장소, 사본 |
| 외부 서비스 | 위치가 명시적으로 허용된 경우에만 날씨 조회 | 좌표 추측 또는 권한 우회 |
| 외부 플랫폼 | Teams 핵심 기능 수렴 이후 별도 계획 | KakaoTalk·Slack 등의 선행 구현 |

현재 `0a92623`의 health는 `genAI: not-configured`, `responseProviders.openai: false`, `mcpEnabled: false`를 보여주지만 `copilotKit: enabled`도 함께 보여준다. 이 값은 모델 연결이 아니라 라우트 등록 상태이므로 사용자 기능 상태로 사용하면 안 된다. 현재 소스는 React 탭과 Teams SDK 봇을 갖고 있으나 CopilotKit 패널과 MCP/OpenAI 테스트 경로가 여전히 빌드·테스트 계약에 남아 있다. 이것이 첫 구현 slice의 첫 번째 정리 대상이다.

## 2. 비목표와 정리 원칙

- OpenAI API key가 없다는 이유로 Teams 핵심 기능이 빌드·테스트·배포에서 실패하지 않게 한다.
- CopilotKit/MCP는 첫 릴리스의 UI·health·runner·완료 판정에서 제거하거나 `optional / not configured`로만 표시한다. 별도 실험 경로를 남길 수는 있지만 core 경로에 의존시키지 않는다.
- 날씨와 Atlassian 벤치마킹은 Teams 핵심 bot/tab/card/CLI가 실제 배포에서 수렴한 뒤에 진행한다. 외부 API나 외부 플랫폼을 초기 수직 slice에 섞지 않는다.
- 매 단계에 모든 기능을 한꺼번에 넣지 않는다. 기능 하나의 입력 → 실제 서버 처리 → 다른 Teams surface의 결과 → 오류/재시도까지 끝낸 뒤 다음 단계로 간다.
- `npm test`가 optional MCP/OpenAI 테스트를 무조건 포함하면 안 된다. `test:core`와 `test:optional`을 분리하고, core 릴리스 게이트가 API key나 MCP 패키지에 의존하지 않는지 자체 테스트한다.

## 3. 원자적 구현 순서

각 항목은 독립 커밋과 독립 증거를 갖는다. 이전 항목의 공개 런타임·설치본 증거가 없으면 다음 항목의 Teams 완료를 주장하지 않는다.

### Slice 0A — 결정형 `status` 카드 1개

**범위:** `status` 명령 한 개와 응답 카드 한 개만 변경한다.

- 카드에는 `Teams SDK`, `production/local`, 인증 모드, 저장소, 결정형 모드, Codex CLI capability, GHCP CLI capability만 사실대로 표시한다.
- CopilotKit/OpenAI/MCP 선택 UI와 모델 연결 문구는 이 카드에서 노출하지 않는다.
- 카드와 동일한 top-level 텍스트를 중복 전송하지 않는다.
- 카드의 단일 `업무 허브 탭 열기` 링크가 현재 매니페스트와 동일한 `/tabs/home/` URL을 사용한다.
- 테스트·health·카드 JSON만 정리하고 help/list/CRUD/location/Codex 실행은 건드리지 않는다.

**완료 조건:** API key 없이 core build와 focused test가 종료 코드 0이고, 공개 Teams chat에서 status 카드가 실제 reply로 도착한다. 카드 표시 전·후, 최신 접근성 트리, 실제 runtime 로그, package identity를 한 matrix row에 기록한다.

### Slice 0B — core 의존성·테스트 경계

**범위:** Slice 0A를 막지 않는 범위에서만 빌드·테스트 경계를 정리한다.

- `build:core`는 React/Teams tab, Teams bot, cards, Codex capability만 포함한다.
- MCP widget build와 OpenAI/CopilotKit 테스트는 `build:optional`, `test:optional`로 분리하고 core release gate에서 호출하지 않는다.
- `copilotKit` health 값은 `optional-disabled`, `optional-unconfigured`, `optional-configured`처럼 실제 상태를 구분하거나 core health에서 제외한다.
- `tsx` wrapper가 종료되지 않는 환경에서는 `node --import tsx/esm` 직접 loader를 bounded focused test의 표준 실행으로 삼는다.

**완료 조건:** 빈 API 환경에서 `test:core`, `build:core`, `validate:manifest`, package determinism이 통과하고 optional 경로를 실행하지 않아도 release preflight가 끝난다.

### Slice 1A — `help` 카드

- `help` 명령 하나만 추가한다.
- 카드에는 실제 지원 명령 목록과 탭 링크만 표시한다.
- 기본 버튼은 `상태`와 `업무 허브 탭 열기` 두 개만 제공하고 각각 실제 서버 동작/탭 이동을 검증한다.
- 공식 `Action.Execute` 계약을 우선 사용하고, 실제 호스트에서 필요한 경우에만 `Action.Submit` fallback을 남긴다.

**완료 조건:** 잘못된 입력과 중복 클릭을 포함해 help 카드 한 분기의 데스크톱 before/after screenshot, 접근성 트리, 실제 reply를 확보한다.

### Slice 1B — `list` 읽기 전용

- 파일 JSON 저장소의 실제 업무 목록을 읽는다.
- 빈 목록·정상 목록·저장소 오류·재시도만 구현한다.
- 채팅 카드와 탭이 같은 저장소를 읽는지 확인한다.

**완료 조건:** 로컬 fixture → 공개 runtime → Teams chat 카드 → 탭 목록의 실제 데이터 왕복을 증명한다. 저장된 문자열만 반환하는 가짜 응답은 실패다.

### Slice 2A — React 탭 읽기 전용

- TeamsJS `app.initialize()`와 host context 확인
- 상태 카드, 업무 목록, 로딩/빈 상태/오류/재시도/새로고침
- 모든 표시 업무 항목에 현재 앱의 유효한 deep link
- CopilotKit assistant 패널은 core 기본 화면에 두지 않음

**완료 조건:** Teams 데스크톱 탭에서 각 상태를 실제 화면으로 캡처하고, 설치된 앱 버전·패키지 SHA·공개 health와 묶는다.

### Slice 2B — 업무 mutation 하나씩

다음 순서를 지킨다.

1. 업무 추가
2. 단건 상태 변경
3. 제목/설명 편집
4. 댓글·watch·담당자

각 mutation에는 idempotency key, 성공 회신, 서버 오류, 재전송/중복 클릭 방어를 넣는다. 한 mutation의 증거가 완성되기 전에는 다음 mutation을 구현하지 않는다.

### Slice 3A — Codex capability와 read-only 작업

- 요청 전에 `codex login status`와 실행 파일을 검사한다.
- capability가 없으면 실행 버튼을 제공하지 않고 로그인 필요 상태를 반환한다.
- `run`은 read-only 작업만 허용하고 실제 `codex exec`의 thread ID, 진행 이벤트, 최종 결과를 저장한다.
- 결정형 미리보기는 실제 Codex 실행과 명확히 구분한다.
- timeout, SIGTERM/SIGKILL, stdout/stderr 제한, 재시작 복구를 검증한다.

**완료 조건:** fake runner가 아니라 실제 Codex CLI read-only 1건을 원본 작업공간에서 수행하고, Teams reply·job store·process log·Git diff(변경 없음)를 연결한다.

### Slice 3B — 승인형 write·continue/cancel

- `continue <jobId>`, `approve`, `cancel`을 각각 별도 slice row로 관리한다.
- 승인 카드에는 요청자·tenant·conversation scope, 허용 작업공간, 변경 예상 범위를 포함한다.
- 승인 전 파일 변경 0건, 승인 후 diff, 취소 후 잔여 프로세스 0건을 확인한다.
- 동일 요청 재전송은 동일 job으로 수렴하며 중복 Codex 프로세스를 만들지 않는다.

**완료 조건:** 승인 전/후·취소·timeout·재전송을 각각 Teams UI와 로컬 diff로 증명한다.

### Slice 4 — GHCP CLI 선택 실행기

- 실제 설치·로그인·지원 명령을 먼저 capability probe한다.
- 미설치/로그인 필요/실패 상태는 비활성화하고 Codex 성공으로 가장하지 않는다.
- 실제 계약을 확인하기 전에는 fake runner contract test만 둔다.
- 사용 불가하면 이 slice는 `N/A` 사유를 기록하며 Teams core 완료를 막지 않는다.

### Slice 5 — 위치·날씨

Teams core bot/tab/card/CLI slices가 공개 설치본에서 수렴한 뒤에만 시작한다.

- `내 위치 사용` 버튼의 loading/success/permission denied/browser fallback/network error/retry를 분리한다.
- Teams native location → browser geolocation 순서를 명시하고 좌표가 없으면 조회하지 않는다.
- 데스크톱 검증은 `DESKTOP_PASS`일 뿐 iOS WebView/GPS를 증명하지 않는다. 실제 모바일 확인 전에는 `MOBILE_UNVERIFIED`다.

### Slice 6 — 외부 제품 벤치마킹과 확장

Teams 앱의 기능 완성도와 전수 런타임 증거가 수렴한 뒤 별도 승인으로 시작한다. Jira/Trello/Atlassian Home의 UX를 비교할 수는 있지만, 외부 플랫폼 연동 구현이나 MCP Apps 확장은 이 계획의 초기 범위가 아니다.

## 4. 모든 slice의 필수 micro-release loop

각 slice를 다음 루프에 통과시킨다. Slice 0A도 예외가 아니다.

1. 원본 소스에서 구현, `test:core`, typecheck, manifest/build 검증
2. 버전 증가, 새 ZIP 생성, ZIP 내부 manifest·`devicePermissions`·SHA-256 확인
3. Git diff 검토와 의미 있는 커밋
4. 기존 Developer Portal/Admin Center 탭의 동일 앱 상세에서 `새 버전 → 파일 업로드`
5. 공개 프로세스로 전환, `/api/health`의 production·Teams auth·Teams SDK 확인
6. 공개 URL 응답과 Teams 설치 정보의 app version/package identity 확인
7. 기존 Teams 데스크톱 앱에서 접근성 트리를 먼저 읽고, 모든 동작의 before/after screenshot을 캡처
8. 사용자가 배포된 모바일 Teams에서 같은 기능을 확인하고 모바일 전용 결과를 회신
9. matrix row가 모두 `PASS`, `FAIL`, `BLOCKED`, `N/A` 중 하나이고 증거 필드가 채워졌을 때만 `release:loop complete`

각 slice의 증거 row에는 다음을 반드시 저장한다.

`feature`, `surface`, `location`, `branch`, `precondition`, `action`, `expected`, `screenshotBefore`, `screenshotAfter`, `accessibilityEvidence`, `runtimeEvidence`, `commit`, `appVersion`, `packageSha256`, `result`.

포털 업로드·설치 버전·데스크톱·모바일 증거가 없으면 각각 `PORTAL_UPLOAD_UNVERIFIED`, `INSTALLED_VERSION_UNVERIFIED`, `DESKTOP_UNVERIFIED`, `MOBILE_UNVERIFIED`로 남긴다. 과거 채팅이나 이전 버전 모바일 사진은 현재 버전 증거로 재사용하지 않는다.

## 5. 하위 에이전트 위임 순서

코드 수정은 공통 파일 충돌을 피하기 위해 한 구현 에이전트씩 통합한다. 감사·리뷰는 독립적으로 병렬 수행할 수 있다.

1. **Core boundary agent:** Slice 0A/0B의 health, core scripts, optional 경계, Codex/GHCP capability contract
2. **Card contract agent:** Slice 1A/1B의 단일 명령, `Action.Execute`/fallback, 중복 텍스트, deep link
3. **React tab agent:** Slice 2A/2B의 상태 분기와 한 mutation씩
4. **Codex runner agent:** Slice 3A/3B의 capability, idempotency, 승인 경계
5. **Evidence/release agent:** slice별 evidence schema, package identity, 종료 가능한 test/release loop
6. 오케스트레이터가 각 커밋에 대해 diff, focused test, core build, 공식 계약, runtime evidence를 검수한 뒤 다음 에이전트를 시작

하위 에이전트가 브라우저 사용 불가를 보고해도 새 브라우저·새 로그인 세션을 만들지 않는다. 기존 탭 재접속 또는 잠금/추가 인증을 별도 blocker로 기록한다.

## 6. 공격적 러버덕 판정

- `status/help/list`가 저장된 텍스트만 반환하고 실제 health·파일·job과 연결되지 않으면 FAIL
- `copilotKit: enabled`가 모델 미설정을 숨기거나 core health에 모델 사용 가능처럼 표시되면 FAIL
- 버튼이 보이지만 서버 action·reply·탭 이동이 없으면 FAIL
- 채팅과 탭이 같은 저장소를 읽지 않으면 FAIL
- Codex가 실행되지 않았는데 분석 시작/완료라고 말하면 FAIL
- 승인 전 파일 변경, 취소 후 잔여 프로세스, 중복 job이 있으면 FAIL
- 모바일에서 위치 버튼이 없거나 권한 거부가 무한 로딩이면 FAIL
- 로컬 테스트만 통과하고 공개 설치본을 보지 않았으면 배포 완료가 아님

## 7. 공식 참조

- [Teams 개발 플랫폼 개요](https://learn.microsoft.com/en-us/microsoftteams/platform/overview)
- [개인 탭 만들기](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/create-personal-tab)
- [Teams 탭 구조와 모바일 요구사항](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs)
- [Teams SDK agent quickstart](https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/quickstart-create-agent-teams-sdk)
- [Adaptive Card actions with Teams SDK](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/in-depth-guides/adaptive-cards/executing-actions)
- [OfficeDev Microsoft Teams Samples](https://github.com/OfficeDev/Microsoft-Teams-Samples)

이 공식 기준선이 실제 Teams 데스크톱·모바일에서 전수 검증된 뒤에만 외부 플랫폼 또는 MCP Apps 확장을 별도 계획으로 만든다.
