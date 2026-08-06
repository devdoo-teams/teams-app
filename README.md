# Teams SDK MVP

TypeScript + React + Express + Microsoft Teams SDK 기반의 내부용 Teams 앱 MVP입니다.

## 기능 범위

- Teams 탭으로 제공되는 업무 목록 UI
- `GET /api/health` 상태 확인
- `GET /api/items` 업무 목록 조회
- `GET /api/items` 응답의 전체/진행 중/완료 요약
- `POST /api/items` 업무 추가
- `GET /api/items/:id` 단건 업무 조회
- `GET /api/weather?latitude=<위도>&longitude=<경도>` 현재 위치 날씨 조회 및 서울 데모 fallback
- `PUT /api/items/:id` 업무 제목 수정
- `PATCH /api/items/:id` 업무 완료/재개 전환
- `DELETE /api/items/:id` 업무 삭제
- JSON 파일 기반 업무 영속 저장 및 재시작 복구
- 운영 모드 Entra bearer token 검증 미들웨어
- Teams SDK `/api/messages` 메시지 핸들러 (`help`, `weather`, `status`, `list` 명령 포함)
- Teams SDK `/api/messages` `status` 명령으로 진행 중 업무 수 확인
- Teams에서 Codex CLI 읽기 전용 작업을 시작하고 작업 ID로 상태 조회
- 같은 Teams 대화의 자연어 후속 답장을 마지막 완료 Codex thread에 자동 연결
- `write` 작업의 승인·취소 흐름과 Codex JSONL 결과 영속 저장
- Codex 완료·실패 결과의 Teams proactive message 전송
- Teams SDK `install.add` 설치 이벤트 welcome message와 명령 안내
- 런타임 상태 패널과 서버 health 확인
- 위치 권한 기반 날씨 위젯과 `날씨`/`weather` Bot 명령
- CopilotKit v2 `CopilotChat` 기반 Teams 탭 업무 도우미
- AG-UI 스트리밍 에이전트와 `useAgentContext` 기반 업무·날씨 컨텍스트 전달
- CopilotKit `useRenderTool` 기반 업무 현황·날씨·workspace-write 승인 카드
- `POST /api/copilotkit/agent/default/run` CopilotKit REST/SSE 런타임
- Teams 모바일 HTML5 Geolocation 위치 조회 및 구형 호스트용 TeamsJS 위치 API fallback
- Teams 앱 manifest `devicePermissions: ["geolocation"]` 선언
- 환경 템플릿 기반 Teams manifest
- 환경변수 치환형 Teams 앱 ZIP 패키징

## 실행

```bash
npm install
npm run check
TEAMS_SKIP_AUTH=true npm run dev
```

실행 후 다음 주소를 확인합니다.

- 탭: http://localhost:3978/tabs/home
- 상태: http://localhost:3978/api/health
- API: http://localhost:3978/api/items
- 날씨 데모: http://localhost:3978/api/weather?latitude=37.5665&longitude=126.978&mode=demo
- CopilotKit 런타임 정보: http://localhost:3978/api/copilotkit/info
- Teams 메시지 엔드포인트: http://localhost:3978/api/messages

`TEAMS_SKIP_AUTH=true`는 로컬 탭 API의 사용자 인증만 우회하는 개발용 설정입니다. `BOT_CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID`가 있으면 Teams SDK Bot은 계속 실행되어 실제 Teams 메시지 outbound를 테스트할 수 있습니다. `TEAMS_SKIP_OUTBOUND=true`를 별도로 설정한 경우에만 비동기 진행·완료 메시지를 로컬 outbox에 보관합니다. 운영에서는 `TEAMS_SKIP_AUTH`를 제거하고 탭 API도 Entra SSO로 보호합니다.

모바일 Teams 탭에서는 `내 위치 사용` 버튼을 눌러 위치를 요청합니다. iPhone/iPad Teams 호스트에서 구형 네이티브 TeamsJS 위치 API가 지원되면 먼저 사용하고, 실패하거나 지원되지 않으면 HTML5 Geolocation을 시도합니다. New Teams·웹에서는 HTML5 위치를 먼저 사용하며, 호스트가 명시적으로 지원할 때만 TeamsJS `geoLocation` Preview API를 보조 경로로 사용합니다. 위치가 거부되면 Teams 탭 메뉴의 `앱 권한`에서 위치를 허용하고, iPhone 설정의 개인정보 보호 및 보안 > 위치 서비스 > Teams도 `앱 사용 중`으로 설정한 뒤 다시 시도해야 합니다. 위치 권한을 새로 선언한 뒤에는 버전이 올라간 Teams 앱 패키지를 다시 업로드해야 합니다. 위치를 얻지 못한 경우 서울 카드는 현재 위치가 아닌 데모 데이터로 명시됩니다.

모바일 구현 참고: [Teams 모바일 탭 설계](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/design/tabs?tabs=mobile), [Teams 모바일 앱 모범 사례](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/teams-mobile-best-practices), [Teams 위치 기능](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/location-capability), [Teams 브라우저 장치 권한](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/browser-device-permissions).

## Teams 원격 Codex 작업

로컬에서 `codex` CLI가 로그인되어 있으면 Teams Bot을 원격 작업 채널로 사용할 수 있습니다. Codex는 기본적으로 현재 저장소를 읽기 전용으로 분석하고, 파일 수정 작업은 명시적 승인 후 `workspace-write`로 실행합니다.

```text
help
날씨
weather 37.5665 126.978
run 저장소의 현재 구현 상태를 분석해줘
status <작업 ID>
continue <작업 ID> <추가 요청>
방금 결과를 더 자세히 설명해줘
write 테스트 보강 계획을 적용해줘
approve <작업 ID>
commit <작업 ID> 변경 내용을 커밋해줘
cancel <작업 ID>
```

관련 환경변수:

- `AGENT_WORKSPACE`: Codex가 작업할 Git 저장소 경로. 기본값은 현재 실행 디렉터리입니다.
- `AGENT_JOB_STORE_PATH`: Teams 작업·Codex thread·결과를 저장할 JSON 경로입니다.
- `CODEX_BIN`: Codex 실행 파일. 기본값은 `codex`입니다.

운영 환경에서는 Codex 실행기를 별도 worker로 분리하고, Teams Bot에는 허용 사용자·승인·작업 상태만 노출하는 구성을 권장합니다. `data/agent-jobs.json`도 로컬 업무 데이터와 동일하게 Git에 포함하지 않습니다.

## 런타임 검증

기존 `data/items.json`을 건드리지 않고 임시 저장소로 실제 서버 프로세스를 실행하여 API, Bot, 파일 저장, 운영 인증 경계를 검증합니다.

```bash
npm test
```

`npm run test:runtime`만 실행하면 이미 빌드된 서버를 기준으로 런타임 테스트를 반복할 수 있습니다. 테스트는 로컬 인증 우회 흐름, 업무 CRUD, Bot 명령, 설치 welcome message, Teams SDK Activity 라우팅, Codex thread 재개·취소·승인·Git commit·outbox 전달과 production bearer token 거부 흐름을 모두 확인합니다.

CopilotKit 런타임 검증은 `/api/copilotkit/info` 검색, 업무 현황·날씨 tool event, Codex 진행 스트림, workspace-write 승인 경계와 승인 카드 취소까지 포함합니다. Teams 탭의 CopilotKit 클라이언트는 REST/SSE 전송을 명시해 `/info`와 `/agent/default/run` 엔드포인트를 사용합니다.

`npm run check:types`는 별도로 TypeScript 타입 검사를 실행합니다. 실행 환경의 TypeScript CLI가 멈추는 경우에도 `npm run build`는 esbuild 산출물을 만들고 런타임 테스트를 계속할 수 있습니다.

## 인증과 저장소

Teams 탭이 초기화되면 TeamsJS `authentication.getAuthToken()`으로 받은 bearer token을 `/api/items` 요청에 전달합니다. 서버는 운영 모드에서 탭/SSO용 `CLIENT_ID`, `TENANT_ID`, `APPLICATION_ID_URI`를 기준으로 Microsoft Entra 토큰을 검증하고, Bot 메시지 발신에는 별도의 `BOT_CLIENT_ID`와 `CLIENT_SECRET`를 사용합니다. 로컬 개발에서만 `TEAMS_SKIP_AUTH=true`로 이 검증을 우회합니다.

현재 업무 저장소는 `data/items.json`입니다. 이 파일은 로컬 MVP의 재시작 검증을 위해 사용하며 Git에는 포함하지 않습니다. 여러 인스턴스 운영이나 감사 로그가 필요한 단계에서는 SQL/managed database로 교체해야 합니다.

## 앱 패키지 생성

실제 Teams 등록 후 발급받은 값으로 패키지를 생성합니다.

운영 패키지를 만들기 전에 배포 환경 사전검사를 실행합니다. 이 검사는 검증용 placeholder, 로컬 호스트, 잘못된 GUID를 차단합니다. `BOT_ID`는 메시징용 Teams/Bot 등록 ID이고 `CLIENT_ID`는 탭/SSO용 Microsoft Entra 앱 등록 ID이므로 서로 다를 수 있습니다.

```bash
npm run check:deployment
```

```bash
TEAMS_APP_ID=<teams-app-id> \
BOT_ID=<teams-bot-registration-id> \
TAB_DOMAIN=<public-https-host> \
CLIENT_ID=<entra-application-client-id> \
BOT_CLIENT_ID=<azure-bot-application-client-id> \
TENANT_ID=<entra-tenant-id> \
APPLICATION_ID_URI=<entra-application-id-uri> \
npm run package:app
```

생성된 `appPackage/build/teams-sdk-mvp.zip`을 Teams Developer Portal 또는 Teams Admin Center에 업로드합니다.

`APPLICATION_ID_URI`는 Microsoft Entra 앱 등록의 `Expose an API`에 표시되는 실제 Application ID URI를 사용해야 합니다. 이 값은 manifest의 `webApplicationInfo.resource`로 들어갑니다.

Teams 탭 SSO에서는 `TAB_DOMAIN`이 Microsoft Entra 테넌트에서 검증된 공개 HTTPS 도메인이어야 하며, `APPLICATION_ID_URI`는 반드시 `api://<TAB_DOMAIN>/<CLIENT_ID>`와 같아야 합니다. Dev Tunnel의 임시 호스트가 테넌트 검증 도메인이 아니면 Teams 화면은 열리지만 SSO 토큰 발급은 시작되지 않습니다. 이 경우에는 로컬 개발용 `TEAMS_SKIP_AUTH=true`로 기능을 확인하고, 운영 전환 시 검증된 도메인으로 패키지를 다시 생성합니다.

## Teams에서 실행

실제 Teams sideload에는 public HTTPS 터널과 Teams 앱 등록이 필요합니다.

```bash
npm install -g @microsoft/teams.cli
teams login
teams status
teams app create --name teams-sdk-mvp --endpoint https://<tunnel-host>/api/messages --env .env
```

이후 Entra 앱 등록, Bot 자격 증명, public HTTPS endpoint를 준비하고 `appPackage/manifest.json`의 환경 변수를 채워 앱 패키지를 생성해 Teams에 업로드합니다. 실제 테넌트에서의 sideload와 SSO consent는 Microsoft 365 관리자 권한 및 사용자 계정이 필요합니다.

## 컨테이너 실행

공개 HTTPS 환경에 배포할 때 사용할 수 있는 Dockerfile도 포함되어 있습니다. 플랫폼에서 다음 환경변수를 주입하고 `TEAMS_SKIP_AUTH`는 설정하지 않습니다.

```bash
docker build -t teams-sdk-mvp .
docker run --rm -p 3978:3978 \
  -e CLIENT_ID=... \
  -e BOT_CLIENT_ID=... \
  -e CLIENT_SECRET=... \
  -e TENANT_ID=... \
  -e APPLICATION_ID_URI=... \
  -e BOT_ID=... \
  -e TEAMS_APP_ID=... \
  -e TAB_DOMAIN=... \
  teams-sdk-mvp
```
