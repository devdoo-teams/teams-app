# Project delivery instructions

- Teams 앱 변경 요청은 아래의 필수 릴리스 워크플로우를 따른다. 구현만 끝내거나 로컬 테스트 결과만으로 완료 처리하지 않는다.
- 소스·매니페스트·패키징·런타임 설정 변경은 Git diff를 확인하고 의미 있는 단위로 커밋한다. 완료 보고에는 해당 커밋 SHA를 포함한다.
- 업로드 전에 반드시 앱 패키지 버전, ZIP 내부의 실제 매니페스트, `devicePermissions`, 배포 환경 검증을 확인한다. 인증정보·환경변수·배포 대상이 없으면 추측하지 말고 업로드 단계에서 멈춘 뒤 누락 항목을 명확히 보고한다.
- 인증정보를 임의로 만들거나 추측하지 않으며, 업로드 대상이 불명확하거나 외부 서비스에 대한 추가 권한이 필요한 경우에는 안전한 범위까지만 진행한다.
- 인앱 브라우저 배포 작업은 기존에 로그인된 탭을 우선 재사용한다. Developer Portal, Teams Admin Center 앱 상세, Teams 채팅, 공개 Teams 탭을 매번 새로 열거나 닫지 말고, 현재 탭의 URL과 로그인 상태를 확인한 뒤 같은 탭에서 이어간다.
- 탭을 재사용할 때는 같은 URL을 불필요하게 다시 로드하지 않는다. 로그인·업로드·모바일 검증 중인 사용자 탭을 임의로 닫거나 정리하지 않으며, 일회성 인증 탭도 사용자가 이어서 확인할 수 있으면 유지한다.

## Teams 데스크톱 앱 독립 스크린샷 검증

- 사용자가 모바일 Teams 스크린샷을 제공하는 것을 구현 결과 확인의 선행 조건으로 삼지 않는다. 공개 프로세스와 배포 앱이 준비되면 먼저 Teams 데스크톱 앱에서 오케스트레이터가 직접 UI를 확인한다.
- 데스크톱 검증은 Computer Use skill의 `node_repl` + `@oai/sky`를 사용한다. 우선 앱 식별자 `com.microsoft.teams2`로 `sky.get_app_state`를 호출하고, 실패할 때만 `sky.list_apps`로 확인한 실제 Teams 앱 식별자를 사용한다.
- 각 검증은 `get_app_state`로 접근성 트리를 먼저 읽고, 검증 전·후 스크린샷을 Codex 패널에 표시한다. 클릭·메시지 전송·탭 전환 뒤에는 이전 `element_index`를 재사용하지 않고 최신 상태를 다시 읽는다.
- 최소한 다음을 데스크톱에서 직접 확인한다: 대상 계정과 `업무 허브` 채팅, 실제 Bot 답장, 카드와 top-level 텍스트 중복 여부, `채팅 / 업무 허브 / 정보` 탭 노출, 변경된 탭 UI와 핵심 버튼.
- 데스크톱에서 실제 테스트 메시지를 보내는 경우에는 공개 배포 앱의 기존 테스트 채팅을 사용하고, 명령·작업 ID·답장·카드 내용을 스크린샷과 접근성 트리로 기록한다. API 테스트 하네스만으로 데스크톱 UI 확인을 대체하지 않는다.
- 데스크톱 검증은 모바일 스크린샷이 없어도 수행할 수 있는 독립 게이트다. 다만 iOS 전용 WebView 크기, Teams 모바일 앱 권한, 실제 iPhone GPS 동작은 데스크톱으로 증명할 수 없으므로 `MOBILE_UNVERIFIED`로 별도 표시한다. 이를 모바일 통과로 보고하지 않는다.
- Teams 데스크톱 앱이 로그아웃·잠금·추가 인증 상태이면 로그인·Auth 앱 승인·잠금 해제는 사용자에게 맡기고, 로그인 루프나 새 세션 생성으로 우회하지 않는다. 기존 채팅·앱 창을 임의로 닫지 않는다.

## 필수 Teams 변경·배포·완료 워크플로우

Teams 앱 변경 요청에는 별도 예외 승인이 없는 한 다음 순서를 반드시 지킨다. 상세 체크리스트와 보고 템플릿은 [`docs/teams-release-workflow.md`](docs/teams-release-workflow.md)에 있다.

1. 요청사항을 구현하고 로컬 테스트 모드에서 `npm test`, 매니페스트 검증, 필요한 런타임 테스트를 실행한다.
2. 앱 버전을 올리고 새 Teams ZIP 패키지를 생성한다. 이전 ZIP을 재사용하지 않으며, ZIP 내부 매니페스트와 SHA-256을 확인한다.
3. Git 변경사항을 검토하고 커밋한다. 커밋되지 않은 구현 상태를 업로드하지 않는다.
4. 새 패키지를 Developer Portal 또는 승인된 배포 대상에 업로드한다. 동일 앱 ID의 업데이트는 Teams Admin Center의 앱 관리 → 사용자 지정 앱 검색 → 기존 앱 상세 → `새 버전`의 `파일 업로드` 경로를 우선 사용한다. 상단 `새 앱 업로드`는 동일 앱 ID를 신규 앱으로 거부할 수 있으므로 업데이트 경로로 사용하지 않는다. 업로드 성공 화면·버전·검증 결과를 직접 확인한다. 업로드가 막히면 완료로 보고하지 않는다.
5. 로컬 테스트 프로세스와 `TEAMS_SKIP_AUTH=true`, `TEAMS_SKIP_OUTBOUND=true`를 종료·제거하고, 실제 자격 증명을 로드한 공개 프로세스로 전환한다. 공개 프로세스는 최소한 `auth=teams-authenticated`, `bot=teams-sdk`, `outbound=teams-sdk`를 `/api/health`에서 보여야 한다.
6. 공개 HTTPS URL과 Teams 호스트에서 새 버전의 UI·핵심 명령·변경 기능을 런타임 검증한다. 먼저 실제 Teams 설치 정보의 버전이 ZIP/manifest 버전과 같은지 확인한다. 설치본이 이전 버전이면 업데이트 전파 또는 제거 후 재설치를 끝내기 전까지 SSO·UI 검증을 통과로 간주하지 않는다. 공개 프로세스가 준비되면 먼저 Teams 데스크톱 앱에서 오케스트레이터가 접근성 트리와 실제 스크린샷으로 독립 검증한다. 사용자가 모바일 스크린샷을 제공하지 않아도 이 데스크톱 게이트는 생략하지 않는다. 그 다음 사용자가 배포된 Teams 앱에서 테스트 메시지를 직접 보내도록 하고, 사용자가 받은 Bot 응답·GenUI/Adaptive Card·필요한 proactive 진행·완료 메시지를 확인한다. 오케스트레이터가 API나 테스트 하네스에서 만든 요청만으로 Teams UI 검증을 대체하지 않는다.
7. 사용자의 배포 앱 메시지 확인까지 끝난 뒤에만 Teams 채팅으로 완료 메시지를 보낸다. 완료 메시지는 사용자 확인의 대체물이 아니며, 버전, 커밋 SHA, 패키지 검증/업로드 증거, 공개 health 결과, 사용자 메시지·답장 증거, 런타임 테스트 결과를 포함한다.

`local-handler`, `local-outbox`, `local-bypass` 상태를 공개 완료 상태로 간주하지 않는다. 공개 health가 위 기준을 충족하지 않거나 Teams 응답이 확인되지 않으면 완료 메시지를 보내지 말고 `BLOCKER`로 보고한다. 순수 읽기 전용 진단으로 앱 산출물을 변경하지 않은 경우에만 패키지 업로드 절차를 생략할 수 있다.

## Teams 원격 Codex 트러블슈팅 지침

- 이 작업은 Teams Bot이 별도 프로세스로 실행하는 Codex CLI 작업이다. 부모 Codex 앱의 인앱 브라우저, Safari, 사용자의 iPhone을 제어할 수 없으므로 `Browser is not available`, `iab unavailable`을 브라우저 재연결 루프로 처리하지 않는다.
- 인증을 반드시 분리한다. `codex login status`는 Codex CLI, `teams status`는 Teams CLI이며 한쪽 결과를 다른 쪽 인증 증거로 사용하지 않는다.
- 업로드 요청 전에는 `codex login status`, 필요한 경우 `teams status`, 패키지 ZIP의 실제 매니페스트 버전·`devicePermissions`, 배포 환경 검증을 각각 확인한다.
- `sideloading not allowed` 또는 `Upload custom apps`는 코드 오류가 아니라 Teams Admin Center 정책이다. Developer Portal 업로드와 CLI sideload를 구분하고 CLI 재시도 루프를 만들지 않는다.
- `APPLICATION_ID_URI`는 추측값으로 덮어쓰지 않는다. 먼저 Teams SDK 봇 Entra 앱의 `Expose an API` 실제 Application ID URI가 `api://botid-<BOT_CLIENT_ID>`인지 확인한다. 관리자 접근이 작업 범위에 있고 SSO 불일치가 실제 런타임에서 재현되면 봇 리소스 URI, `access_as_user` 범위, Teams Web/Desktop 사전 승인, Bot Framework redirect URI, 매니페스트 `webApplicationInfo.resource`, 서버 환경값을 같은 계약으로 맞춘 뒤 버전 증가·새 패키지 생성·재업로드를 수행한다. 관리자 접근이 없으면 추측 변경 없이 BLOCKER로 보고한다.
- Dev Tunnel CLI가 디바이스 코드 흐름에서 보안 기본값으로 거부되면 브라우저 인증(`devtunnel user login --use-browser-auth --entra`)을 시도하고, 비밀번호·Auth 앱 승인·추가 인증은 사용자에게 맡긴다. 로그인 후에는 `devtunnel create`, `devtunnel port create`, `devtunnel host`를 분리 실행한다. `tunnel-id`와 실제 공개 `ports[].portUri` 호스트가 다를 수 있으므로 `devtunnel show <tunnel-id> --json`의 `portUri`를 기준으로 패키지를 만든다.
- 공개 터널 호스트가 바뀌면 `TAB_DOMAIN`을 새 호스트로 바꾸고 버전 증가·매니페스트 검증·새 ZIP 생성·기존 앱 업데이트 업로드를 다시 수행한다. 기존 주소가 응답하지 않는다고 새 주소를 추측하지 말고, `curl`로 `/api/health`를 확인한 실제 `portUri`만 사용한다.
- 매니페스트의 `TAB_DOMAIN`과 Teams 관리 봇의 `messagingEndpoint`는 별도 상태다. 호스트가 바뀌면 현재 `portUri`의 `/api/messages`를 Teams 외부 앱 ID에 `teams app update <external-app-id> --endpoint https://<portUri>/api/messages --json`으로 반영하고, 응답의 `updated.endpoint`·`needsReinstall`를 확인한 뒤 새 ZIP을 다시 생성·업로드한다. 공개 `/api/health`가 살아 있어도 이전 엔드포인트가 남아 있으면 모바일 메시지는 무응답일 수 있다.
- 결과는 반드시 `STATUS / EVIDENCE / COMPLETED / BLOCKER / NEXT ACTION` 형식으로 보고한다. 관찰하지 않은 로그인·브라우저 연결·모바일 GPS·업로드 완료를 주장하지 않는다.
- Adaptive Card 응답은 카드 attachment만 전송한다. 카드와 같은 내용을 top-level `text`에 함께 넣어 Teams 모바일에서 회색 텍스트 버블과 카드가 중복 표시되지 않게 한다. 텍스트는 legacy 모드 또는 카드 전송 실패 시의 명시적 fallback에만 사용한다.

## 명령어 우선 릴리스 게이트와 화면 잠금 대응

- 반복 가능한 검사는 Computer Use나 화면 잠금 상태에 의존하지 않는다. 구현·타입체크·전체 테스트·배포 환경·ZIP 내부 매니페스트·공개 health·공개 탭 HTTP 응답은 명령어로 먼저 검증한다.
- 릴리스 판정에는 다음 제한시간 게이트를 사용한다. `release:preflight`는 타입체크(60초), 전체 테스트(300초), 배포 환경(30초)을 순서대로 실행하고, `release:package`는 검증된 새 ZIP과 내부 매니페스트·SHA-256을 생성하며, `release:public`은 공개 health와 `/tabs/home`을 확인한다. 전부 실행할 때는 `npm run release:gate`를 사용한다.
- `release:public`은 명시적 `--url` 다음 `TEAMS_PUBLIC_URL`, `PUBLIC_BASE_URL`, `.env.runtime`의 `TAB_DOMAIN`에서 공개 origin을 해석한다. `typecheck`는 런타임 패키지를 바꾸지 않는 release 전용 선언 stub을 사용하고, vendor 선언 그래프 진단은 별도 `typecheck:vendor`로 분리한다.
- 게이트가 명령어 timeout이나 비정상 종료를 만나면 `BLOCKED`로 중단한다. 실패한 하위 프로세스 그룹은 정리하지만, 이미 실행 중인 공개 Teams 서버나 Dev Tunnel은 임의로 종료하지 않는다. 원인을 고친 뒤 같은 게이트를 다시 실행한다.
- timeout 회귀 테스트는 실제 저장소에서 짧은 `preflight`를 강제 종료하지 않는다. 빌드 중간 종료가 `dist/client`를 비울 수 있으므로 `runWithTimeout`과 실패 보고 포맷을 무해한 fixture로 검증한다.
- 클라이언트 빌드는 `dist/client`를 먼저 지우지 않고 형제 임시 디렉터리에서 빌드·후처리한 뒤 성공할 때만 원자적으로 교체한다. 따라서 빌드 실패가 공개 탭을 빈 404 상태로 만들면 안 된다. 현재 CopilotKit v2 대형 번들의 source map 생성은 Node 24 + esbuild API에서 무기한 대기하므로 운영 번들은 source map을 끈다.
- 화면이 잠겨 있으면 명령어 게이트·공개 HTTPS·이미 로그인된 인앱 브라우저 탭 검증은 계속할 수 있다. 로그인·Auth 앱 승인·파일 선택·Teams 데스크톱 스크린샷처럼 네이티브 UI가 필요한 항목만 `DESKTOP_UNVERIFIED` 또는 `BLOCKED`로 분리하고 잠금 해제 우회나 자격 증명 추측을 하지 않는다.
- 명령어 게이트 통과는 포털 업로드·설치 버전·Teams 데스크톱·모바일 사용자 확인을 대신하지 않는다. 최종 완료 상태에는 `PORTAL_UPLOAD_UNVERIFIED`, `INSTALLED_VERSION_UNVERIFIED`, `DESKTOP_UNVERIFIED`, `MOBILE_UNVERIFIED`가 남아 있지 않아야 한다.
- 모든 버그 수정·신규 기능은 `release:loop start → machine → package → public → evidence(portal/installed/desktop/mobile) → complete` 순서로 진행한다. `.release/current.json`의 run identity와 현재 Git commit·앱 버전·ZIP SHA가 일치하지 않으면 다음 단계로 넘어가지 않는다. `installed` 증거에는 Teams 앱 정보 화면의 `installedVersion`을 반드시 기록하고, 게시 카탈로그 버전이나 Bot 왕복만으로 설치본 버전을 추정하지 않는다.
- `release:loop complete`가 `READY`를 반환하기 전에는 Teams 완료 메시지를 보내지 않는다. 이 명령은 실제 UI 증거를 만들지 않으며, 포털 업로드·설치본·데스크톱·모바일을 직접 확인한 뒤 제공된 증거 파일만 검증한다.
