# Teams-first 최소 단위 확장·E2E 검증 계획

> 개정일: 2026-08-10
>
> 목적: CopilotKit, OpenAI API, MCP Apps를 전제하지 않고 Microsoft Teams에서 실제 사용 가능한 가장 작은 기능부터 하나씩 확장한다.

## 1. 재검토 결론

현재 소스는 다음 두 축을 이미 갖고 있다.

- TypeScript/Node 기반 Teams SDK 봇과 `/api/messages` 런타임
- React + TeamsJS 기반 개인 탭과 Adaptive Card 응답

이 조합은 Microsoft 공식 구조와 일치한다. Microsoft 문서는 Teams 탭을 Teams 호스트 안의 iframe 웹 페이지로 설명하고, 매니페스트의 `contentUrl`과 TeamsJS `app.initialize()`를 요구한다. 또한 Teams SDK는 JavaScript/TypeScript를 지원하고, 공식 샘플 저장소에 Teams SDK·TeamsJS·TypeScript 샘플이 제공된다.

반면 현재 1.0.19 소스의 `copilotKit: enabled`는 모델 연결을 의미하지 않고 CopilotKit 라우트가 등록되었다는 뜻이다. 현재 health는 `genAI: not-configured`이며 `OPENAI_API_KEY`가 없다. 따라서 CopilotKit/OpenAI 경로를 실제 기능의 기반으로 계속 확장하는 것은 현재 사용 가능한 인증·자격 조건과 맞지 않는다. MCP Apps 역시 Teams 호스트의 핵심 런타임이 아니므로 첫 릴리스의 필수 경로에서 제외한다.

### 최종 기술 기준선

| 영역 | 첫 릴리스 기준 | 제외 또는 후순위 |
|---|---|---|
| 봇 | `@microsoft/teams.apps` + TypeScript, 실제 Teams `/api/messages` | CopilotKit agent runtime |
| 탭 | React + TeamsJS 개인 탭, `contentUrl`과 `/tabs/home/` 일치 | MCP widget을 기본 화면으로 사용 |
| 응답 | 결정형 명령 라우터와 Adaptive Cards | OpenAI/모델 호출을 기본 동작으로 가정 |
| 실제 에이전트 작업 | 로그인된 Codex CLI `codex exec` | API 키 기반 모델 호출 |
| 보조 실행기 | 설치·로그인된 경우에만 GHCP CLI capability로 선택 가능 | GHCP CLI가 없는데 있는 것처럼 표시 |
| 저장소 | 로컬 원본 `/Users/doosansmacbookpro/Documents/TeamsApp`의 파일 JSON | iCloud, 원격 저장소, 사본 |
| 날씨 | 위치 권한이 실제로 허용된 뒤 공개 날씨 endpoint 사용 | 위치 추측, 권한 없는 좌표 사용 |
| 외부 플랫폼 | Teams 기능 수렴 후 별도 검토 | KakaoTalk 등 선행 구현 |

## 2. 현재 상태와 확인된 결함

- `d0640d3`에서 매니페스트와 봇 카드의 개인 탭 deep link를 `/tabs/home/`로 정렬했다.
- 직접 실행한 `node --import tsx/esm scripts/teams-tab-link-test.ts`는 통과했다.
- `npm run test:teams-tab-link`는 테스트 assertion이 아니라 현재 환경의 `tsx` wrapper가 종료되지 않는 프로세스 문제가 있어 제한 시간 게이트에서 멈췄다. 테스트 명령 자체가 반드시 종료되도록 실행 경로를 정리해야 한다.
- Codex CLI는 `codex login status`에서 ChatGPT 로그인 상태를 확인할 수 있고 실제 `CodexRunner`가 `codex exec`를 실행한다. 다만 시작 전 capability 확인과 자연어 중복 요청 idempotency가 부족하다.
- React 탭에는 실제 업무·위치·응답 모드 UI가 있으나 CopilotKit 패널이 기본 경로로 노출되어 있고, API 미설정 상태와 사용자가 기대하는 실제 작업 실행 상태가 명확히 분리되지 않았다.
- 공식 Teams UI, 포털 업로드, 설치 버전, 데스크톱 전수 스크린샷, 모바일 GPS/WebView는 아직 현재 커밋 기준으로 증명되지 않았다. 과거 채팅 기록이나 예전 모바일 사진은 현재 릴리스 증거로 재사용하지 않는다.

## 3. 단계별 구현 계획

각 단계는 독립된 작은 기능으로 구현하고, 한 단계의 런타임·스크린샷 증거가 확보되기 전에는 다음 기능을 사용자에게 완료로 보고하지 않는다. 구현 하위 에이전트는 단계별로 한 명씩 위임하고, 공통 파일을 동시에 수정하지 않는다.

### Slice 0 — 의존성·능력 명시와 안전한 기준선

**목표:** 모델/API가 없어도 앱이 어떤 기능을 제공하는지 거짓 없이 표시한다.

- 기본 응답 엔진을 `deterministic`으로 명시한다.
- health와 탭 상태에 `Codex CLI: 사용 가능/로그인 필요/실행 파일 없음`, `GHCP CLI: 사용 가능/미설치/로그인 필요`를 분리 표시한다.
- CopilotKit/MCP 라우트는 기본 UI·기능 목록·완료 판정에서 제거하거나 `optional / not configured`로 표시한다.
- `OPENAI_API_KEY`가 없어도 typecheck, build, bot, tab, cards가 통과해야 한다.
- `tsx`가 종료되지 않는 환경에서는 bounded direct loader를 표준 테스트 명령으로 사용하고, 장기 프로세스는 30초·60초 checkpoint로 감시한다.

**완료 조건:** API 키 없이 `npm run typecheck`, 전체 핵심 테스트, client/server build가 종료 코드 0이고 health가 모델 미설정을 실제 사용 가능 기능으로 오인시키지 않는다.

### Slice 1 — Bot 최소 명령 계약

**목표:** 모바일 채팅에서 가장 작은 실제 동작을 안정화한다.

순서대로 `help` → `status` → `list`만 먼저 유지한다.

- `help`: 명령 설명과 탭 열기 링크를 카드로 반환한다.
- `status`: 서비스·인증·저장소·Codex/GHCP capability를 카드로 반환한다.
- `list`: 파일 JSON 저장소의 실제 업무 목록을 읽어 카드로 반환한다.
- 카드 본문과 같은 내용을 top-level text로 중복 전송하지 않는다.
- 기본 버튼은 `도움말`, `상태`, `업무 목록`, `업무 허브 탭 열기`로 제한하고, 각 버튼은 서버의 실제 명령을 유발한다.
- 카드 action은 공식 Teams SDK 문서의 `Action.Execute` 계약을 우선 사용하고, 호스트가 지원하지 않는 경우에만 명시적인 `Action.Submit` fallback을 사용한다.

**완료 조건:** 로컬 handler, 공개 HTTPS bot, 기존 Teams 데스크톱 채팅에서 각 명령의 전·후 스크린샷과 접근성 트리, 실제 reply를 확보한다.

### Slice 2 — React 개인 탭의 업무 최소 CRUD

**목표:** 채팅 카드가 여는 탭에서 실제 데이터가 바뀌도록 한다.

- `app.initialize()`와 host context를 먼저 확인한다.
- 목록 로딩, 빈 상태, 로딩, 오류, 재시도, 새로고침을 구현한다.
- 제목 추가 → 단건 상태 변경 → 상세 편집의 순서로 확장한다.
- 각 mutation은 idempotency key를 사용하고, 실패 시 UI가 성공으로 남지 않게 한다.
- 탭의 모든 카드와 목록 항목에는 유효한 현재 앱 deep link를 제공한다.
- CopilotKit assistant 패널은 이 slice의 기본 경로에 두지 않는다.

**완료 조건:** 새 업무를 추가한 뒤 채팅 `list`와 탭 목록에서 같은 실제 항목이 보이고, 오류·재시도·중복 클릭 분기를 각각 증명한다.

### Slice 3 — Codex CLI 실제 작업

**목표:** 자연어를 저장된 답변으로 흉내 내지 않고 실제 Codex 작업으로 연결한다.

- 요청 수신 전에 `codex login status`와 실행 파일 capability를 검사한다.
- `run <작업>`은 기본 read-only로 시작하고, 실행 ID·진행 이벤트·최종 결과를 저장한다.
- `continue <작업 ID>`는 기존 Codex thread를 재개한다.
- write 작업은 승인 카드 전에는 파일을 수정하지 않는다.
- `approve`, `cancel`, timeout, 재시작 복구, 중복 요청을 별도 상태로 처리한다.
- 결정형 응답은 “결정형 미리보기”로만 라벨링하며 Codex가 실제 실행되지 않았으면 완료라고 말하지 않는다.
- 프로세스는 timeout, SIGTERM/SIGKILL, stdout/stderr 제한을 유지하고 job store는 tenant·사용자·conversation scope를 유지한다.

**완료 조건:** 테스트용 로컬 원본에서 실제 `codex exec` read-only 1건, 승인 전 write 차단 1건, 승인 후 변경 1건, 취소 1건을 각각 실행하고 Git diff/로그/Teams reply를 연결한다.

### Slice 4 — GHCP CLI 선택 실행기

**목표:** 사용 가능한 경우에만 두 번째 CLI를 선택할 수 있게 한다.

- `gh copilot`의 설치·로그인·명령 capability를 시작 시 검사한다.
- 미설치·로그인 필요·지원하지 않는 명령이면 UI에서 비활성화하고 Codex 경로를 자동으로 가장하지 않는다.
- 실제 GHCP CLI 계약을 확인하기 전에는 실행기 코드를 만들지 않고 fake runner 계약 테스트만 만든다.
- API key, GitHub token, 조직 권한을 코드나 환경에 추측해서 쓰지 않는다.

**완료 조건:** 실제 설치/로그인 상태와 fake runner의 성공·실패·timeout을 분리 기록한다. 사용 불가하면 이 slice는 `N/A`로 남기고 Codex 기능의 완료를 막지 않는다.

### Slice 5 — Teams 탭 위치·날씨

**목표:** 위치를 추측하지 않고 Teams 호스트에서 사용자가 권한을 허용한 경우에만 날씨를 제공한다.

- 탭에 `내 위치 사용` 버튼, 로딩, 성공, 권한 거부, 브라우저 fallback, 네트워크 오류, 재시도를 분리한다.
- TeamsJS/native location → browser geolocation 순서를 명시하고 좌표가 없으면 날씨 조회를 하지 않는다.
- 응답 카드에는 위치 출처, 좌표, 관측 시각, 데이터 출처를 표시한다.
- 모바일 WebView와 iOS 권한은 데스크톱 통과로 대체하지 않고 별도 사용자 확인으로 남긴다.

**완료 조건:** 데스크톱에서 권한 허용/거부/재시도를 캡처하고, 실제 모바일 Teams에서 사용자가 `내 위치 사용`을 누른 결과를 받아야 모바일 PASS로 올린다.

### Slice 6 — Atlassian 수준의 Teams 내부 확장

**목표:** Jira/Trello/Atlassian Home을 Teams 안에서 벤치마킹하되 외부 플랫폼을 추가하지 않는다.

- 검색, 최근, 내 할당, 상태 필터, 마감일, 담당자, watch, 댓글, 상세 deep link를 탭 안에서 하나씩 추가한다.
- 각 기능은 별도 API/저장 변경과 카드·탭 양쪽의 실제 결과를 연결한다.
- 기능 수보다 “입력 → 실제 저장 → 다른 surface에서 재조회” 왕복을 우선한다.
- CopilotKit/MCP 기반 자동화는 이 slice의 전제에서 제외한다.

### Slice 7 — 릴리스·전수 런타임 검증

모든 slice에 공통으로 다음 순서를 강제한다.

1. 로컬 원본에서 구현·typecheck·핵심 테스트·빌드
2. 버전 증가, 새 ZIP 생성, 내부 manifest·`devicePermissions`·SHA 확인
3. Git diff 검토 후 커밋
4. 기존 Developer Portal/Admin Center 탭에서 동일 앱의 `새 버전 → 파일 업로드`로 업데이트
5. `npm start` 공개 프로세스로 전환하고 `/api/health`에서 `production`, `teams-authenticated`, `teams-sdk` 확인
6. 공개 URL과 Teams 설치본의 버전·커밋·package SHA identity 확인
7. 기존 Teams 데스크톱 앱의 접근성 트리와 전·후 스크린샷으로 채팅·탭·카드·모든 버튼/링크/입력 분기를 검증
8. 사용자가 모바일 Teams에서 같은 배포본을 확인하고 GPS/WebView/권한 결과를 회신
9. 모든 matrix row가 `PASS`, `FAIL`, `BLOCKED`, `N/A` 중 하나일 때만 완료 메시지 전송

포털·설치본·데스크톱·모바일 증거가 없으면 각각 `PORTAL_UPLOAD_UNVERIFIED`, `INSTALLED_VERSION_UNVERIFIED`, `DESKTOP_UNVERIFIED`, `MOBILE_UNVERIFIED`로 보고한다.

## 4. 하위 에이전트 위임과 통합 규칙

현재처럼 독립 감사는 병렬로 수행하되, 코드 수정은 파일 충돌을 피하기 위해 다음 순서로 한 작업자씩 실행한다.

1. **Core runner agent:** Slice 0·3의 capability, Codex 상태, idempotency, runner 테스트
2. **Teams card agent:** Slice 1의 카드 계약, action routing, 중복 텍스트 제거, tab deep link
3. **React tab agent:** Slice 2·5의 탭 UI와 상태 분기
4. **Release evidence agent:** Slice 7의 evidence schema, version/package identity, 종료 가능한 test command
5. 오케스트레이터가 각 작업을 fresh build·전수 테스트·Git diff·전용 review로 검수한 뒤 다음 작업을 시작

하위 에이전트가 “브라우저 사용 불가”라고 보고해도 새 브라우저·새 로그인 세션을 만들지 않는다. 기존 탭 재접속 또는 사용자 잠금 해제/인증을 별도 blocker로 기록한다.

## 5. 공격적 러버덕 기준

- `help/status/list`가 저장된 문구만 반환하고 실제 상태·파일·작업과 연결되지 않으면 실패다.
- health가 `CopilotKit enabled`만 보여주면서 모델 미설정을 숨기면 실패다.
- 버튼이 보이지만 서버 action이 없거나 카드 회신이 오지 않으면 실패다.
- 탭 화면에 데이터가 보이지만 채팅과 같은 저장소를 읽지 않으면 실패다.
- Codex CLI가 실행되지 않았는데 “분석 시작/완료”라고 말하면 실패다.
- 모바일에서 위치 버튼이 보이지 않거나 권한 거부가 무한 로딩이면 실패다.
- 로컬 테스트만 통과하고 공개 Teams 설치본을 확인하지 않으면 배포 완료가 아니다.
- 이전 버전 스크린샷, 예전 채팅, 포털 게시 버전으로 현재 설치본을 추정하면 실패다.

## 6. 공식 참조 기준

- Microsoft Teams 개발 플랫폼 개요: Teams SDK, bots, tabs, message extensions의 역할을 기준으로 삼는다.
- 개인 탭 생성 문서와 Tabs 문서: React/TeamsJS 웹 탭, `app.initialize()`, manifest `contentUrl`, 모바일 WebView 검증을 기준으로 삼는다.
- Teams 공식 샘플 저장소: TypeScript/JavaScript Teams SDK·TeamsJS와 personal tab, device permissions, deep link, tab UI template를 우선 벤치마킹한다.
- Teams SDK Adaptive Cards action 문서: `Action.Execute`와 라우팅 키를 우선 사용하고, 호스트 호환성은 실제 Teams 데스크톱·모바일에서 검증한다.

외부 플랫폼 또는 MCP Apps는 위 Teams 기준선이 전수 검증되고 사용자가 별도로 확장 승인을 한 뒤에만 조사한다.
