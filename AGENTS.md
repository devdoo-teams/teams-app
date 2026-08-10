# Project delivery instructions

- Teams 앱 변경 요청은 아래의 필수 릴리스 워크플로우를 따른다. 구현만 끝내거나 로컬 테스트 결과만으로 완료 처리하지 않는다.
- 현재 기술 제약에서는 `Teams Core`가 기준 제품이다. Microsoft Teams SDK + TypeScript/React 개인 탭 + Express/결정형 서버 + Adaptive Cards를 API 키 없이 먼저 구현한다. CopilotKit, OpenAI API, 로컬 모델, MCP는 Core 기능이 안정된 뒤 명시적 feature flag와 별도 검증으로만 추가하며, API 키가 없다는 이유로 Core 기능을 대체 응답·가짜 완료로 처리하지 않는다. 상세 단계는 [`docs/api-free-teams-roadmap.md`](docs/api-free-teams-roadmap.md)를 따른다.
- MCP/MCP Apps는 Teams 모바일 UI 자체로 간주하지 않는다. Teams 탭은 TeamsJS/React WebView, Bot 응답은 Adaptive Cards 1.2 호환 subset을 기준으로 구현하고, MCP는 구체적인 서버 tool 연결이 확인된 뒤 서버 측 adapter로만 검토한다.
- 기본 `npm run build`와 기본 실행은 Core만 대상으로 한다. 선택 provider는 `build:optional`, `build:all`, `TEAMS_OPTIONAL_RUNTIME=true`처럼 명시적으로 요청한 경우에만 로드한다.
- 소스·매니페스트·패키징·런타임 설정 변경은 Git diff를 확인하고 의미 있는 단위로 커밋한다. 완료 보고에는 해당 커밋 SHA를 포함한다.
- 릴리스 루프의 clean 판정은 추적 파일 변경만 차단한다. 시작 시 발견된 미추적 파일은 `untrackedAtStart`로 기록하고 삭제·이동·업로드하지 않는다. 추적 파일 수정은 여전히 커밋 전 진행을 차단한다.
- 업로드 전에 반드시 앱 패키지 버전, ZIP 내부의 실제 매니페스트, `devicePermissions`, 배포 환경 검증을 확인한다. 인증정보·환경변수·배포 대상이 없으면 추측하지 말고 업로드 단계에서 멈춘 뒤 누락 항목을 명확히 보고한다.
- 인증정보를 임의로 만들거나 추측하지 않으며, 업로드 대상이 불명확하거나 외부 서비스에 대한 추가 권한이 필요한 경우에는 안전한 범위까지만 진행한다.
- 인앱 브라우저 배포 작업은 기존에 로그인된 탭을 우선 재사용한다. Developer Portal, Teams Admin Center 앱 상세, Teams 채팅, 공개 Teams 탭을 매번 새로 열거나 닫지 말고, 현재 탭의 URL과 로그인 상태를 확인한 뒤 같은 탭에서 이어간다.
- 탭을 재사용할 때는 같은 URL을 불필요하게 다시 로드하지 않는다. 로그인·업로드·모바일 검증 중인 사용자 탭을 임의로 닫거나 정리하지 않으며, 일회성 인증 탭도 사용자가 이어서 확인할 수 있으면 유지한다.
- 인앱 브라우저의 탭 재사용은 자원 절약 게이트다. 작업 시작 시 ambient UI 상태와 현재 포커스 창에 열린 탭을 먼저 확인하고, 표면별로 기존 탭 하나를 선택해 끝까지 재사용한다. 기본 동작으로 `tabs.new`, 새 브라우저 창, 새 로그인 탭을 호출하지 않는다.
- 브라우저 도구의 `tabs.list()`가 빈 목록을 반환하더라도 ambient UI 상태에 열린 탭이 표시되거나 사용자가 기존 탭을 열어 두었다고 말하면 “탭 없음”으로 판단하지 않는다. 이는 연결/노출 불일치로 분류하고 기존 포커스 탭에 재접속하거나 사용자에게 기존 탭 포커스를 요청한다. 이 경우 새 탭을 만들어 우회하지 않는다.
- 인증·업로드·모바일 검증 중인 탭은 URL을 다시 `goto`하거나 새로고침하지 않는다. 같은 표면의 다른 단계는 현재 탭에서 이동하고, 탭 ID·URL·제목을 단계 시작/종료 시 비교해 동일 세션을 유지한다. 새 탭이 정말 필요하면 먼저 사용자에게 이유와 기존 탭 재사용이 불가능한 근거를 보고하고 명시적 승인을 받는다.

## Teams 데스크톱 앱 독립 스크린샷 검증

- 사용자가 모바일 Teams 스크린샷을 제공하는 것을 구현 결과 확인의 선행 조건으로 삼지 않는다. 공개 프로세스와 배포 앱이 준비되면 먼저 Teams 데스크톱 앱에서 오케스트레이터가 직접 UI를 확인한다.
- 데스크톱 검증은 Computer Use skill의 `node_repl` + `@oai/sky`를 사용한다. 우선 앱 식별자 `com.microsoft.teams2`로 `sky.get_app_state`를 호출하고, 실패할 때만 `sky.list_apps`로 확인한 실제 Teams 앱 식별자를 사용한다.
- 각 검증은 `get_app_state`로 접근성 트리를 먼저 읽고, 검증 전·후 스크린샷을 Codex 패널에 표시한다. 클릭·메시지 전송·탭 전환 뒤에는 이전 `element_index`를 재사용하지 않고 최신 상태를 다시 읽는다.
- 최소한 다음을 데스크톱에서 직접 확인한다: 대상 계정과 `업무 허브` 채팅, 실제 Bot 답장, 카드와 top-level 텍스트 중복 여부, `채팅 / 업무 허브 / 정보` 탭 노출, 변경된 탭 UI와 핵심 버튼.
- 데스크톱에서 실제 테스트 메시지를 보내는 경우에는 공개 배포 앱의 기존 테스트 채팅을 사용하고, 명령·작업 ID·답장·카드 내용을 스크린샷과 접근성 트리로 기록한다. API 테스트 하네스만으로 데스크톱 UI 확인을 대체하지 않는다.
- 데스크톱 검증은 모바일 스크린샷이 없어도 수행할 수 있는 독립 게이트다. 다만 iOS 전용 WebView 크기, Teams 모바일 앱 권한, 실제 iPhone GPS 동작은 데스크톱으로 증명할 수 없으므로 `MOBILE_UNVERIFIED`로 별도 표시한다. 이를 모바일 통과로 보고하지 않는다.
- Teams 데스크톱 앱이 로그아웃·잠금·추가 인증 상태이면 로그인·Auth 앱 승인·잠금 해제는 사용자에게 맡기고, 로그인 루프나 새 세션 생성으로 우회하지 않는다. 기존 채팅·앱 창을 임의로 닫지 않는다.

## 실사용 UI 전수 스크린샷 검증 원칙

- 실제 사용자 실사용 조건을 판정할 때는 구현된 기능을 명령어·API·단위 테스트만으로 통과시키지 않는다. 기능별로 사용자에게 노출되는 모든 화면 위치와 모든 동작 분기를 먼저 목록화하고, 각 항목을 실제 Teams 데스크톱 앱에서 순서대로 실행하며 전·후 스크린샷과 최신 접근성 트리를 남긴다.
- 전수 검증 범위에는 최소한 다음 상태를 포함한다: 초기/로딩/성공/빈 상태/오류/권한 거부/인증 만료/재시도/승인 필요/승인 완료/취소/중복 클릭·재전송/잘못된 입력/경계값/모바일 대체 안내. 해당 기능에 없는 상태는 기능 매트릭스에 `N/A`와 근거를 기록한다.
- 각 화면 위치는 별도 검증 대상으로 취급한다. 예를 들어 채팅의 프롬프트 보기, Adaptive Card의 각 기본 명령 버튼, 탭 링크, 업무 목록 입력·추가·새로고침·필터·상태 변경, 위치 사용 버튼과 권한 거부 안내는 서로 합쳐서 한 번만 확인하지 않는다.
- 실제 버튼은 접근성 트리에서 최신 `element_index`를 확인한 뒤 클릭한다. 클릭·입력·탭 전환·권한 응답마다 다시 `get_app_state`를 호출하고, 이전 인덱스를 재사용하지 않는다. 스크린샷에 버튼·현재 위치·전환 결과·회신이 실제로 보이지 않으면 통과로 기록하지 않는다.
- 각 분기는 “버튼이 보인다”와 “버튼이 실제 서버 동작을 유발하고 올바른 UI 결과를 돌려준다”를 별도 판정한다. 특히 `Action.Execute`/`Action.Submit`, 카드의 탭 링크, 프롬프트 보기, 승인·취소, 위치 권한처럼 호스트별 동작이 다른 기능은 실행 전 카드와 실행 후 회신을 각각 캡처한다.
- Teams WebView에서는 브라우저 `window.confirm`/`window.prompt`에 의존하지 않는다. 삭제·승인·취소처럼 확인이 필요한 동작은 앱 안에 확인/취소 컨트롤을 렌더링하고, 첫 클릭의 확인 상태와 두 번째 클릭의 실제 서버 mutation 결과를 각각 AX·스크린샷으로 검증한다.
- 사용자가 제공한 모바일 스크린샷은 참고 증거이지 오케스트레이터의 데스크톱 전수 검증을 대체하지 않는다. 데스크톱에서 증명할 수 없는 iOS WebView·모바일 권한·GPS·모바일 레이아웃은 별도 `MOBILE_UNVERIFIED` 항목으로 남기고, 사용자에게 넘긴 뒤 실제 모바일 결과 스크린샷을 받아야 통과시킨다.
- 기능 매트릭스에는 `feature`, `surface`, `location`, `branch`, `precondition`, `action`, `expected`, `screenshotBefore`, `screenshotAfter`, `accessibilityEvidence`, `runtimeEvidence`, `result`를 기록한다. 모든 구현 기능과 모든 분기에 `PASS`, `FAIL`, `BLOCKED`, `N/A` 중 하나가 있어야 하며 빈칸·추측·“대표 케이스 통과”는 허용하지 않는다.
- 스크린샷은 현재 실행 중인 공개 배포본과 동일한 앱 버전·커밋·패키지 SHA를 식별할 수 있어야 한다. 이전 버전의 채팅 기록이나 다른 탭의 화면을 현재 릴리스 증거로 재사용하지 않는다. 증거가 오래된 상태인지 새 상태인지 식별할 수 없으면 다시 캡처한다.
- 전수 스크린샷 매트릭스가 완료되지 않은 상태에서는 `DESKTOP_READY` 또는 `MOBILE_READY`로 기록하지 않고, Teams 완료 메시지도 보내지 않는다. 기능이 동작하지 않거나 화면과 서버 결과가 불일치하면 원인과 개선안을 먼저 기록하고 수정 후 해당 분기부터 전수 재검증한다.

## 필수 Teams 변경·배포·완료 워크플로우

Teams 앱 변경 요청에는 별도 예외 승인이 없는 한 다음 순서를 반드시 지킨다. 상세 체크리스트와 보고 템플릿은 [`docs/teams-release-workflow.md`](docs/teams-release-workflow.md)에 있다.

1. 요청사항을 구현하고 로컬 테스트 모드에서 `npm run test:core`, `npm run build:core`, 매니페스트 검증, 필요한 런타임 테스트를 실행한다. OpenAI/MCP/CopilotKit 선택 경로는 `test:optional`/`build:optional`로 별도 확인하며 core 완료 조건에 섞지 않는다.
2. 앱 버전을 올리고 새 Teams ZIP 패키지를 생성한다. 이전 ZIP을 재사용하지 않으며, ZIP 내부 매니페스트와 SHA-256을 확인한다.
3. Git 변경사항을 검토하고 커밋한다. 커밋되지 않은 구현 상태를 업로드하지 않는다.
4. 새 패키지를 Developer Portal 또는 승인된 배포 대상에 업로드한다. 동일 앱 ID의 업데이트는 Teams Admin Center의 앱 관리 → 사용자 지정 앱 검색 → 기존 앱 상세 → `새 버전`의 `파일 업로드` 경로를 우선 사용한다. 상단 `새 앱 업로드`는 동일 앱 ID를 신규 앱으로 거부할 수 있으므로 업데이트 경로로 사용하지 않는다. 업로드 성공 화면·버전·검증 결과를 직접 확인한다. 업로드가 막히면 완료로 보고하지 않는다.
5. 로컬 테스트 프로세스와 `TEAMS_SKIP_AUTH=true`, `TEAMS_SKIP_OUTBOUND=true`를 종료·제거하고, 실제 자격 증명을 로드한 공개 프로세스로 전환한다. 공개 프로세스는 최소한 `auth=teams-authenticated`, `bot=teams-sdk`, `outbound=teams-sdk`를 `/api/health`에서 보여야 한다.
6. 공개 HTTPS URL과 Teams 호스트에서 새 버전의 UI·핵심 명령·변경 기능을 런타임 검증한다. 먼저 실제 Teams 설치 정보의 버전이 ZIP/manifest 버전과 같은지 확인한다. 설치본이 이전 버전이면 업데이트 전파 또는 제거 후 재설치를 끝내기 전까지 SSO·UI 검증을 통과로 간주하지 않는다. 공개 프로세스가 준비되면 먼저 Teams 데스크톱 앱에서 오케스트레이터가 접근성 트리와 실제 스크린샷으로 독립 검증한다. 사용자가 모바일 스크린샷을 제공하지 않아도 이 데스크톱 게이트는 생략하지 않는다. 그 다음 사용자가 배포된 Teams 앱에서 테스트 메시지를 직접 보내도록 하고, 사용자가 받은 Bot 응답·GenUI/Adaptive Card·필요한 proactive 진행·완료 메시지를 확인한다. 오케스트레이터가 API나 테스트 하네스에서 만든 요청만으로 Teams UI 검증을 대체하지 않는다.
7. 공개 프로세스와 배포 앱의 모든 기능 분기를 `실사용 UI 전수 스크린샷 검증 원칙`에 따라 기능 매트릭스로 실행한다. 각 버튼·링크·탭·입력·권한 흐름은 실행 전과 실행 후 화면을 모두 캡처하고, 동작 결과가 기대와 다르면 해당 분기를 실패로 남긴 뒤 수정·재배포·재검증한다.
8. 사용자의 배포 앱 메시지 확인까지 끝난 뒤에만 Teams 채팅으로 완료 메시지를 보낸다. 완료 메시지는 사용자 확인의 대체물이 아니며, 버전, 커밋 SHA, 패키지 검증/업로드 증거, 공개 health 결과, 사용자 메시지·답장 증거, 런타임 테스트 결과를 포함한다.

`local-handler`, `local-outbox`, `local-bypass` 상태를 공개 완료 상태로 간주하지 않는다. 공개 health가 위 기준을 충족하지 않거나 Teams 응답이 확인되지 않으면 완료 메시지를 보내지 말고 `BLOCKER`로 보고한다. 순수 읽기 전용 진단으로 앱 산출물을 변경하지 않은 경우에만 패키지 업로드 절차를 생략할 수 있다.

## 장기 프로세스·하위 에이전트 모니터링 체크포인트

- 30초를 넘길 수 있는 명령·빌드·테스트·브라우저 작업은 무기한 대기로 실행하지 않는다. 호출 시 제한시간을 지정하고, 제한시간의 절반·종료 시점에 진행률과 마지막 로그를 확인한다.
- 공개 서버·Dev Tunnel·업로드 세션·UI 검증을 서로 독립된 작업으로 취급한다. 한 작업이 대기하거나 잠겨도 다른 작업을 중단하지 않고, `ps`/포트/`/api/health`/최근 로그로 각 작업의 생존 여부를 따로 판정한다.
- 하위 에이전트는 작업 ID별로 `pending_init`, `running`, `needs_attention`, `completed`, `errored`, `interrupted`를 기록한다. 에이전트가 필요하지 않은 단계에서는 새 에이전트를 만들지 않으며, 동일한 대기 상태를 반복 보고하지 않는다.
- 하위 에이전트는 즉시 결과가 필요한 경우에만 제한된 대기를 사용하고, 그 외에는 부모 작업이 비중복 측면 작업을 진행한다. 동일 작업에 대한 중복 위임·중복 검증을 금지한다.
- 두 번 연속 진행률·로그·상태 변화가 없으면 해당 작업을 `BLOCKED` 또는 `STALE_PROCESS_SUSPECTED`로 분리하고, 원인·PID·마지막 활동 시각·대체 가능한 다음 작업을 기록한다. 공개 서버나 사용자가 사용 중인 브라우저 세션은 근거 없이 종료하지 않는다.
- 모니터링 결과는 각 단계 보고에 `process`, `pid`, `elapsed`, `lastActivity`, `health`, `nextAction`을 포함한다. 이 기록이 없으면 장기 작업을 완료로 판정하지 않는다.

## Teams Bot Codex 트러블슈팅 지침

- 이 작업은 Teams Bot이 별도 프로세스로 실행하는 Codex CLI 작업이다. 부모 Codex 앱의 인앱 브라우저, Safari, 사용자의 iPhone을 제어할 수 없으므로 `Browser is not available`, `iab unavailable`을 브라우저 재연결 루프로 처리하지 않는다.
- 하위 에이전트가 브라우저를 사용할 수 없다는 이유로 새 인앱 브라우저·새 로그인 세션을 만들지 않는다. 브라우저 제어는 부모 오케스트레이터의 기존 탭 세션에서만 수행하며, 연결이 끊겼으면 기존 탭 재접속 또는 사용자 포커스 요청을 BLOCKER로 분리한다.
- 인증을 반드시 분리한다. `codex login status`는 Codex CLI, `teams status`는 Teams CLI이며 한쪽 결과를 다른 쪽 인증 증거로 사용하지 않는다.
- GitHub Copilot CLI는 공식 `copilot` 실행 파일을 기준으로 한다. `copilot --help`는 실행 파일 존재만 증명하며 로그인·Copilot 라이선스·조직 정책을 증명하지 않는다. health probe에서 `copilot login` 또는 `/login`을 자동 실행하지 말고, 실제 bounded read-only 실행의 결과가 확인되기 전에는 `unknown`/사용 불가로 표시한다. `gh copilot`은 환경에서 명시적으로 지정된 레거시 호환 경로일 때만 사용하며 공식 GHCP 기본값으로 추정하지 않는다.
- Jira Cloud는 Teams Core의 런타임 의존성이 아니라 이슈·릴리스·검증 증거 추적 시스템으로만 사용한다. 실패 테스트·재현된 사용자 버그·실제 릴리스 blocker·검증 가능한 Core slice만 idempotent key로 생성/갱신하며, 진행 메시지와 선택 provider의 `N/A`는 이슈로 남발하지 않는다. 프로젝트 표시명으로 key를 추측하지 않고 기존 Jira/Teams 로그인 탭에서 site·project key·workflow·assignee를 확인한다. Jira에는 비밀번호·API token·device code·bearer token을 기록하지 않는다.
- 현재 Jira 추적 대상은 `https://devdoo.atlassian.net`, 프로젝트 키 `MP`다. 기본 담당자는 Jira에서 현재 로그인한 사용자(`self`)로 해석하며 계정 ID를 추측하거나 저장하지 않는다. 이슈 타입은 재현된 결함/릴리스 blocker=`Bug`, 계획된 Core 단위=`Task`, 비차단 개선=`Improvement`로 선택한다. 허용된 실제 workflow transition은 Jira에서 조회한 값만 사용한다. Jira connector 또는 기존 로그인 탭의 실제 쓰기와 응답을 확인하기 전에는 이슈 생성·동기화를 완료로 보고하지 않고 `JIRA_SYNC_UNVERIFIED`로 분리한다.
- 업로드 요청 전에는 `codex login status`, 필요한 경우 `teams status`, 패키지 ZIP의 실제 매니페스트 버전·`devicePermissions`, 배포 환경 검증을 각각 확인한다.
- `sideloading not allowed` 또는 `Upload custom apps`는 코드 오류가 아니라 Teams Admin Center 정책이다. Developer Portal 업로드와 CLI sideload를 구분하고 CLI 재시도 루프를 만들지 않는다.
- `APPLICATION_ID_URI`는 추측값으로 덮어쓰지 않는다. 먼저 Teams SDK 봇 Entra 앱의 `Expose an API` 실제 Application ID URI가 Microsoft의 결합 봇+탭 계약인 `api://<TAB_DOMAIN>/botid-<BOT_CLIENT_ID>`인지 확인한다. 관리자 접근이 작업 범위에 있고 SSO 불일치가 실제 런타임에서 재현되면 봇 리소스 URI, `access_as_user` 범위, Teams Web/Desktop 사전 승인, Bot Framework redirect URI, 매니페스트 `webApplicationInfo.resource`와 `token.botframework.com` valid domain, 서버 환경값을 같은 계약으로 맞춘 뒤 버전 증가·새 패키지 생성·재업로드를 수행한다. 관리자 접근이 없으면 추측 변경 없이 BLOCKER로 보고한다.
- Dev Tunnel CLI가 디바이스 코드 흐름에서 보안 기본값으로 거부되면 브라우저 인증(`devtunnel user login --use-browser-auth --entra`)을 시도하고, 비밀번호·Auth 앱 승인·추가 인증은 사용자에게 맡긴다. 로그인 후에는 `devtunnel create`, `devtunnel port create`, `devtunnel host`를 분리 실행한다. `tunnel-id`와 실제 공개 `ports[].portUri` 호스트가 다를 수 있으므로 `devtunnel show <tunnel-id> --json`의 `portUri`를 기준으로 패키지를 만든다.
- 공개 터널 호스트가 바뀌면 `TAB_DOMAIN`을 새 호스트로 바꾸고 버전 증가·매니페스트 검증·새 ZIP 생성·기존 앱 업데이트 업로드를 다시 수행한다. 기존 주소가 응답하지 않는다고 새 주소를 추측하지 말고, `curl`로 `/api/health`를 확인한 실제 `portUri`만 사용한다.
- 매니페스트의 `TAB_DOMAIN`과 Teams 관리 봇의 `messagingEndpoint`는 별도 상태다. 호스트가 바뀌면 현재 `portUri`의 `/api/messages`를 Teams 외부 앱 ID에 `teams app update <external-app-id> --endpoint https://<portUri>/api/messages --json`으로 반영하고, 응답의 `updated.endpoint`·`needsReinstall`를 확인한 뒤 새 ZIP을 다시 생성·업로드한다. 공개 `/api/health`가 살아 있어도 이전 엔드포인트가 남아 있으면 모바일 메시지는 무응답일 수 있다.
- 결과는 반드시 `STATUS / EVIDENCE / COMPLETED / BLOCKER / NEXT ACTION` 형식으로 보고한다. 관찰하지 않은 로그인·브라우저 연결·모바일 GPS·업로드 완료를 주장하지 않는다.
- Adaptive Card 응답은 카드 attachment만 전송한다. 카드와 같은 내용을 top-level `text`에 함께 넣어 Teams 모바일에서 회색 텍스트 버블과 카드가 중복 표시되지 않게 한다. 텍스트는 legacy 모드 또는 카드 전송 실패 시의 명시적 fallback에만 사용한다.
- Codex CLI가 exit code 0으로 끝나도 실제 `agent_message` 최종 결과가 없으면 작업을 `completed` 또는 성공 알림으로 기록하지 않는다. 이 경우 `failed`/차단 원인으로 저장하고, 실제 최종 결과·thread ID·이벤트 수가 확인된 뒤에만 완료 카드를 보낸다.
- `completed` 작업은 비어 있지 않은 `result`를 반드시 가져야 한다. `commit` 응답은 `committed=true`와 실제 `commitHash`가 모두 있을 때만 `kind=result/status=complete`로 렌더링하며, 읽기 전용·소유 경로 없음·변경 없음은 오류 카드로 보낸다.
- JSON 저장소 mutation은 메모리 변경과 원자적 파일 저장을 하나의 직렬 경계로 묶고, 저장 실패 시 이전 메모리 스냅샷으로 롤백한다. 저장 실패 후 남은 메모리 값이나 완료 상태를 후속 Teams 응답의 근거로 사용하지 않는다.

## 명령어 우선 릴리스 게이트와 화면 잠금 대응

- 반복 가능한 검사는 Computer Use나 화면 잠금 상태에 의존하지 않는다. 구현·타입체크·전체 테스트·배포 환경·ZIP 내부 매니페스트·공개 health·공개 탭 HTTP 응답은 명령어로 먼저 검증한다.
- `/Users/doosansmacbookpro/Documents/TeamsApp`은 이 프로젝트의 로컬 원본 소스이자 유일한 Git 이력 기준이다. 이를 사본·미러·동기화 대상이라고 추정하거나 다른 경로를 원본으로 취급하지 않는다.
- 이 저장소에는 Git 원격이 구성되어 있지 않다. 원격 저장소·원격 브랜치·clone·pull·push를 전제로 설명하거나 시도하지 않으며, 사용자가 명시적으로 원격을 추가하기 전에는 로컬 커밋만 관리한다.
- 빌드·테스트·소스 수정은 원본 작업공간에서 수행한다. `/tmp`는 일회성 로그, 격리 검증, 새 ZIP 산출물에만 사용할 수 있고 `/tmp`의 Git 이력이나 파일을 원본 상태로 보고하지 않는다. 검증된 최종 변경과 커밋은 반드시 원본 작업공간에 존재해야 한다.
- 파일 업로드는 원본에서 생성해 검증한 최신 ZIP의 명시적 로컬 경로를 브라우저 파일 선택기에 직접 전달한다. Finder, 동기화 상태, 다운로드 대기 또는 별도 소스 복제를 업로드 선행 조건으로 만들지 않는다.
- 릴리스 판정에는 다음 제한시간 게이트를 사용한다. `release:preflight`는 API/MCP 선택 경로와 분리된 core source compile check(60초), `build:core`(300초), `test:core`(300초), 배포 환경(30초)을 순서대로 실행한다. `test:core`에는 API 키 없이 실제 production Teams SDK 번들을 기동하는 `core-runtime-smoke.mjs`가 포함되어 `listen()`, `/api/health`, `/tabs/home/`을 확인한다. 서버 core 번들은 Teams SDK·필수 런타임을 포함하고 CopilotKit/MCP는 선택 청크로 분리한다. `test:optional`/`build:optional`은 별도 실험 경로이며 core 통과를 막지 않는다. `release:package`는 검증된 새 ZIP과 내부 매니페스트·SHA-256을 생성하며, `release:public`은 공개 health와 `/tabs/home/`을 확인한다. 전부 실행할 때는 `npm run release:gate`를 사용한다.
- `release:public`은 명시적 `--url` 다음 `TEAMS_PUBLIC_URL`, `PUBLIC_BASE_URL`, `.env.runtime`의 `TAB_DOMAIN`에서 공개 origin을 해석한다. core 게이트는 `typecheck:core`의 제한된 esbuild source compile check와 `build:core`의 React/Teams SDK/Codex 경로를 사용한다. 전체 `typecheck`는 현재 Node 24/TypeScript 선언 그래프에서 장시간 대기할 수 있으므로 별도 진단으로 실행하며, core source check를 semantic TypeScript 전체 통과로 과장하지 않는다. vendor 선언 그래프 진단은 `typecheck:vendor`로 분리한다.
- 기본 `npm test`/`npm run test:api-free`는 무제한 전체 `typecheck`를 호출하지 않고 bounded `typecheck:core`와 API-free 기능 검증을 실행한다. 전체 `npm run typecheck`는 별도 bounded 진단이며, 정체되면 `TYPECHECK_DIAGNOSTIC_BLOCKED`로 기록하고 Core 릴리스 게이트와 분리한다.
- 공개 서버는 반드시 `npm start`로 실행한다. 이 명령은 존재하는 `.env.runtime`을 자동 로드한다. `node dist/server/index.js`를 직접 실행해 인증 설정을 누락하지 않으며, 재시작 직후 `/api/health`의 `environment=production`, `auth=teams-authenticated`, `userAuth=entra-sso`, `bot=teams-sdk`, `outbound=teams-sdk`를 확인한다.
- Teams 개인 탭 `contentUrl`은 `/tabs/home/`처럼 trailing slash를 포함해야 한다. `/tabs/home`의 301 리디렉션에 의존하면 Teams Web/Desktop iframe이 빈 화면에 머물 수 있으므로 매니페스트 검증에서 이를 차단한다.
- 패키징은 결정적이어야 한다. 같은 커밋·버전·매니페스트·아이콘으로 `release:package`를 반복해도 ZIP SHA-256이 같아야 하며 `test:package-determinism` 실패 시 업로드하지 않는다. 릴리스 루프 package 단계가 기록한 동일 ZIP만 업로드하고, 업로드 뒤 ZIP을 다시 생성해 SHA를 바꾸지 않는다.
- 게이트가 명령어 timeout이나 비정상 종료를 만나면 `BLOCKED`로 중단한다. 실패한 하위 프로세스 그룹은 정리하지만, 이미 실행 중인 공개 Teams 서버나 Dev Tunnel은 임의로 종료하지 않는다. 원인을 고친 뒤 같은 게이트를 다시 실행한다.
- timeout 회귀 테스트는 실제 저장소에서 짧은 `preflight`를 강제 종료하지 않는다. 빌드 중간 종료가 `dist/client`를 비울 수 있으므로 `runWithTimeout`과 실패 보고 포맷을 무해한 fixture로 검증한다.
- 클라이언트 빌드는 `dist/client`를 먼저 지우지 않고 형제 임시 디렉터리에서 빌드·후처리한 뒤 성공할 때만 원자적으로 교체한다. 따라서 빌드 실패가 공개 탭을 빈 404 상태로 만들면 안 된다. 현재 CopilotKit v2 대형 번들의 source map 생성은 Node 24 + esbuild API에서 무기한 대기하므로 운영 번들은 source map을 끈다.
- `health=200`만으로 공개 탭을 정상으로 판정하지 않는다. 공개 프로세스 재기동·빌드 교체 직후 같은 origin에서 `/api/health` 200, `/tabs/home/` 200, HTML의 해시 자산 200을 연속 확인한다. health는 살아 있지만 탭만 404이면 `TAB_RUNTIME_UNAVAILABLE`로 즉시 실패 처리하고 Teams UI 검증·업로드를 진행하지 않는다. Teams SDK 봇이 활성화된 프로덕션 분기에서도 개인 탭 HTTP 라우트는 항상 등록되어야 한다.
- `dist/client`가 사라지거나 `dist/client <n>`처럼 충돌 이름으로 이동된 흔적이 보이면 FileProvider/동시 빌드에 의한 산출물 TOCTOU로 분류한다. 실행 중 공개 서버를 계속 두고, 새 산출물의 `index.html`·해시 자산 존재와 위 3개 HTTP probe를 통과한 뒤에만 프로세스를 교체한다. 한 번의 health probe만 통과한 결과는 런타임 증거로 저장하지 않는다.
- 화면이 잠겨 있으면 명령어 게이트·공개 HTTPS·이미 로그인된 인앱 브라우저 탭 검증은 계속할 수 있다. 로그인·Auth 앱 승인·파일 선택·Teams 데스크톱 스크린샷처럼 네이티브 UI가 필요한 항목만 `DESKTOP_UNVERIFIED` 또는 `BLOCKED`로 분리하고 잠금 해제 우회나 자격 증명 추측을 하지 않는다.
- macOS FileProvider가 파일을 `dataless`로 되돌린 경우에는 코드 결함으로 단정하지 않는다. 빌드 전 `package.json`, `package-lock.json`, `appPackage/manifest.json`, `src/`, `scripts/`, `types/`와 실제 ZIP에 대해 `stat`의 `blocks`·플래그를 확인하고, `blocks=0`인 핵심 입력은 `SOURCE_IO_BLOCKED`로 기록한다. `cp`, Git 객체 읽기, 빌드·서버 시작을 파일별로 무기한 반복하지 말고 PID·경과 시간·마지막 로그를 30초 간격으로 확인한다. 두 번 연속 변화가 없으면 stale로 분리하고 의존성 재구성·이미 로컬인 산출물 검증 같은 독립 작업을 계속한다.
- `dist`가 `blocks=0`인 FileProvider 경로이면 생성된 서버·탭 자산을 동기화 폴더에서 직접 서빙하지 않는다. `build:core`는 안정된 OS 런타임 경로로 산출물을 만들고 `npm start`는 같은 경로의 `scripts/start-server.mjs`를 통해 실행한다. 클라이언트·서버 Git materialize와 그 실행 의존성은 작업공간 안에 만들지 말고 OS 임시 경로에 만들며, esbuild와 런타임에는 `scripts/fileprovider-runtime-deps.mjs`가 준비한 로컬 dependency cache를 `nodePaths`/symlink로 명시한다. 이는 소스 원본을 옮기는 것이 아니며, `/tmp`/캐시 경로의 파일은 재생성 가능한 런타임 산출물일 뿐 Git 원본·업로드 원본으로 취급하지 않는다.
- 테스트가 서버를 기동할 때는 반드시 `resolveRuntimeDistRoot()`가 반환한 검증된 런타임 번들을 사용한다. `dist/server/index.js`를 직접 실행하면 dataless placeholder나 오래된 산출물을 검사하게 되므로 금지한다. 기본 `npm test`에는 CopilotKit Channels shadow 같은 선택 provider 테스트를 포함하지 않으며 선택 경로는 명시적 명령으로 별도 실행한다. `typecheck:core`의 esbuild 서비스 중단은 한 번만 서비스 재시작 후 재시도하고, 두 번 실패하면 즉시 게이트를 실패시킨다.
- 매니페스트의 developer/static-tab website root와 canonical `/tabs/home/`를 모두 공개 HTTP로 확인한다. `/`가 404이면 `TAB_RUNTIME_UNAVAILABLE`로 처리하고 포털·설치본·데스크톱·모바일 검증을 진행하지 않는다.
- `/Users/doosansmacbookpro/Documents/TeamsApp`은 항상 원본이다. `/tmp`, iCloud/동기화 폴더, Git 객체 복구 결과를 사본·원격 저장소·새 원본으로 취급하지 않으며, 복구 과정에서 만든 임시 파일은 원본 worktree 밖의 recoverable 경로로 이동한 뒤 clean worktree를 다시 확인한다.
- FileProvider 다운로드 대기 때문에 Finder·새 브라우저 탭·새 로그인 세션을 만들지 않는다. 업로드는 원본에서 생성·검증한 최신 ZIP의 절대 경로를 직접 선택하는 단계이고, 화면 잠금이면 파일 선택기를 우회하지 않고 `PORTAL_UPLOAD_UNVERIFIED`로 보류한다.
- 명령어 게이트 통과는 포털 업로드·설치 버전·Teams 데스크톱·모바일 사용자 확인을 대신하지 않는다. 최종 완료 상태에는 `PORTAL_UPLOAD_UNVERIFIED`, `INSTALLED_VERSION_UNVERIFIED`, `DESKTOP_UNVERIFIED`, `MOBILE_UNVERIFIED`가 남아 있지 않아야 한다.
- 모든 버그 수정·신규 기능은 `release:loop start → machine → package → public → evidence(portal/installed/desktop/mobile) → complete` 순서로 진행한다. `.release/current.json`의 run identity와 현재 Git commit·앱 버전·ZIP SHA가 일치하지 않으면 다음 단계로 넘어가지 않는다. `installed` 증거에는 Teams 앱 정보 화면의 `installedVersion`을 반드시 기록하고, 게시 카탈로그 버전이나 Bot 왕복만으로 설치본 버전을 추정하지 않는다.
- `release:loop complete`가 `READY`를 반환하기 전에는 Teams 완료 메시지를 보내지 않는다. 이 명령은 실제 UI 증거를 만들지 않으며, 포털 업로드·설치본·데스크톱·모바일을 직접 확인한 뒤 제공된 증거 파일만 검증한다.
- 오래된 커밋을 가리키는 활성 run 때문에 새 릴리스를 시작할 수 없으면 상태 파일을 삭제하거나 `COMPLETE`로 바꾸지 않는다. 원인을 확인한 뒤 `npm run release:loop -- supersede --reason "..."`로 기존 run을 명시적으로 `SUPERSEDED` 처리하고, 같은 상태 경로에서 새 `start`를 실행한다. `SUPERSEDED`는 완료·배포 성공을 의미하지 않는다.
