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
- 선택 기능: CopilotKit v2/AG-UI 업무 도우미는 `TEAMS_OPTIONAL_RUNTIME=true`에서만 로드되며 Core 기본 빌드에 포함되지 않음
- 선택 기능: OpenAI-compatible Chat Completions, 로컬/사내 provider, MCP Apps adapter는 별도 설정·검증 없이는 사용하지 않음
- Core UI: Teams Bot Adaptive Card와 React 개인 탭이 공유하는 결정형 `GenUiEnvelopeV1` 계약
- Teams 모바일 HTML5 Geolocation 위치 조회 및 구형 호스트용 TeamsJS 위치 API fallback
- Teams 앱 manifest `devicePermissions: ["geolocation"]` 선언
- 환경 템플릿 기반 Teams manifest
- 환경변수 치환형 Teams 앱 ZIP 패키징

## 실행

```bash
npm install
npm run check
TEAMS_LOCAL_DEV=true TEAMS_SKIP_AUTH=true npm run dev
```

실행 후 다음 주소를 확인합니다.

- 탭: http://localhost:3978/tabs/home
- 상태: http://localhost:3978/api/health
- API: http://localhost:3978/api/items
- 날씨 데모: http://localhost:3978/api/weather?latitude=37.5665&longitude=126.978&mode=demo
- CopilotKit 런타임 정보: http://localhost:3978/api/copilotkit/info
- Teams 메시지 엔드포인트: http://localhost:3978/api/messages

`TEAMS_SKIP_AUTH=true`는 `TEAMS_LOCAL_DEV=true`와 함께 사용하고, `NODE_ENV=production`이 아니며 `PUBLIC_BASE_URL`, `TAB_DOMAIN`, `BOT_DOMAIN`, `DEV_TUNNEL_ID`가 모두 비어 있는 로컬 개발에서만 허용됩니다. 이 안전한 로컬 게이트가 열릴 때만 MCP가 loopback 서버에 연결됩니다. `BOT_CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID`가 있으면 Teams SDK Bot은 계속 실행되어 실제 Teams 메시지 라우팅을 테스트할 수 있습니다. `TEAMS_SKIP_OUTBOUND=true`를 별도로 설정한 경우에만 비동기 진행·완료 메시지를 로컬 outbox에 보관합니다. 운영에서는 `TEAMS_SKIP_AUTH`와 `TEAMS_LOCAL_DEV`를 제거하고 Teams Bot 자격 증명과 Entra SSO를 모두 구성해야 합니다. 예전 `MCP_PUBLIC_ENABLED=true` 설정은 지원하지 않으며 시작 시 거부됩니다.

### 응답 엔진 선택과 모바일 사용 흐름

v1.0.7부터 사용자·테넌트별로 다음 응답 엔진을 선택할 수 있습니다. 새 사용자와 키가 없는 환경의 기본값은 서버 네트워크가 필요 없는 결정형 모드입니다. 세 모드는 모두 같은 `GenUiEnvelopeV1`을 반환하므로 Teams Bot에서는 Adaptive Card, Teams 탭에서는 CopilotKit GenUI, MCP Apps에서는 구조화된 리소스로 같은 업무·날씨·승인 결과를 표현합니다.

| 모드 | 용도 | 필요한 서버 설정 |
| --- | --- | --- |
| 결정형 | 키 없이 안정적인 업무·날씨·Codex 명령 실행 | 없음 |
| OpenAI | OpenAI 또는 호환 Chat Completions 기반 자연어 응답 | `OPENAI_API_KEY` 및 선택적 `OPENAI_MODEL`, `OPENAI_BASE_URL` |
| 로컬/사내 모델 | 사내망 또는 자체 호스팅 OpenAI-compatible endpoint | `LOCAL_MODEL_BASE_URL`, 선택적 `LOCAL_MODEL_NAME`, `LOCAL_MODEL_API_KEY` |

모바일 Teams에서 선택하려면 다음 순서를 따릅니다.

1. Teams Admin Center의 기존 앱 상세에 업로드된 v1.0.15 앱을 Teams 모바일에서 새로 고침하거나 앱을 다시 추가하고 `업무 허브` 개인 탭을 엽니다.
2. 탭의 `응답 엔진` 선택 영역에서 `결정형`, `OpenAI`, `로컬/사내 모델` 중 하나를 누릅니다.
3. 설정되지 않은 provider는 비활성화되어 있으며 모바일 사용자는 키·endpoint URL을 입력하지 않습니다. OpenAI/로컬 항목이 비활성화되어 있으면 `결정형`을 선택하거나 관리자에게 서버 설정을 요청합니다.
4. Bot 대화에서는 `mode` 또는 `응답 모드`를 보내 같은 세 가지 선택 Adaptive Card를 열 수 있습니다. 선택 후 `help`, `list`, `status`, `날씨` 또는 자연어 요청을 보내 응답을 확인합니다.
5. 선택값은 서버가 검증한 Entra 사용자·테넌트 scope에 저장됩니다. 클라이언트가 tenant/requester를 body에 넣어도 무시되며, 업무 ACL·승인 경계는 응답 모드와 독립적으로 유지됩니다.

OpenAI와 로컬 provider의 비밀값은 서버 프로세스 환경변수에만 둡니다. Teams 모바일, 탭의 HTML, `/api/health`, `/api/response-mode`, GenUI 카드, MCP metadata에는 API key, bearer token, provider credential, provider endpoint URL을 넣지 않습니다. `OPENAI_API_KEY`가 없을 때 OpenAI 모드를 선택하면 설정 오류를 반환하고 결정형 성공 응답으로 위장하지 않습니다. `COPILOTKIT_DETERMINISTIC_MODE=true`는 자동 테스트 전용이며 운영 공개 프로세스에는 설정하지 않습니다.

로컬/엔터프라이즈 OpenAI-compatible provider는 서버에서 `LOCAL_MODEL_BASE_URL`(필수), `LOCAL_MODEL_NAME`(기본 `local-model`), `LOCAL_MODEL_API_KEY`(선택)를 읽습니다. Teams 모바일 클라이언트는 이 URL·키를 입력하거나 덮어쓸 수 없으며, local provider가 설정되지 않거나 실패하면 OpenAI나 결정형 응답으로 자동 전환하지 않고 안전한 GenUI 오류를 반환합니다. 주소는 서버 환경변수의 `http://` 또는 `https://` URL만 허용하고 URL 안의 사용자명·비밀번호는 거부합니다. `LOCAL_MODEL_API_KEY`가 없어도 인증 없는 호환 서버를 사용할 수 있습니다.

공개 Teams에서 실행되는 서버는 개발자 노트북의 `localhost`에 접근할 수 없습니다. 노트북에서만 실행하는 모델은 로컬 테스트에만 사용하고, 실제 Teams 모바일 검증에서는 서버 프로세스가 접근할 수 있는 허용된 사설 네트워크 경로 또는 공개 HTTPS 엔드포인트를 `LOCAL_MODEL_BASE_URL`로 지정해야 합니다. 이 provider는 기존 `GenUiEnvelopeV1`, 날씨·업무·승인 도구와 서버 측 ACL/취소 경계를 그대로 사용합니다.

모바일 Teams 탭은 시작할 때 현재 위치 권한을 요청하고, 실패하면 서울 데모로 대체하지 않고 위치 권한 안내만 표시합니다. `내 위치 사용` 버튼으로 다시 요청할 수 있습니다. iPhone/iPad Teams 호스트에서 구형 네이티브 TeamsJS 위치 API가 지원되면 먼저 사용하고, 실패하거나 지원되지 않으면 HTML5 Geolocation을 시도합니다. New Teams·웹에서는 HTML5 위치를 먼저 사용하며, 호스트가 명시적으로 지원할 때만 TeamsJS `geoLocation` Preview API를 보조 경로로 사용합니다. 위치가 거부되면 Teams 탭 메뉴의 `앱 권한`에서 위치를 허용하고, iPhone 설정의 개인정보 보호 및 보안 > 위치 서비스 > Teams도 `앱 사용 중`으로 설정한 뒤 다시 시도해야 합니다. 위치 권한을 새로 선언한 뒤에는 버전이 올라간 Teams 앱 패키지를 다시 업로드해야 합니다. Bot 대화에는 기기 위치가 자동 전달되지 않으므로 `날씨`만 입력해 서울을 추측하지 않으며, Teams 탭에서 위치를 허용하거나 `weather <위도> <경도>`를 입력해야 합니다.

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

`npm test`는 `npm run test:api-free`의 별칭이며 OpenAI API, 로컬 모델 endpoint, MCP host, CopilotKit 초기화를 요구하지 않습니다. 이 기본 명령이 Teams Core의 소스·패키지·서버 경계를 검증합니다.

`npm run test:optional`은 명시적으로 선택한 OpenAI/local/MCP provider 계약만 검사하고, `npm run test:optional:runtime`과 `npm run test:optional:copilotkit`은 별도 실험 경로입니다. 이 선택 경로의 실패·지연·미설정은 Core 릴리스 실패로 전파하지 않습니다.

`npm run test:optional:runtime`만 실행하면 이미 빌드된 서버를 기준으로 이전 optional 통합 런타임을 반복할 수 있습니다. 이 테스트는 CopilotKit·MCP 경로까지 포함하므로 API-free Teams Core의 통과 증거로 사용하지 않습니다.

`npm run test:core`에는 API 키·MCP·CopilotKit 없이 결정형 Teams Core, 저장소 hardening, Teams 탭/카드 계약, Codex 경계를 검증합니다. OpenAI/local/MCP/CopilotKit 검증은 명시적 optional 명령으로 분리되어 있으며 Core 릴리스의 통과 조건이 아닙니다.

선택 CopilotKit 런타임을 별도로 켠 경우에만 `/api/copilotkit/info`와 REST/SSE 경로를 검증합니다. API key, 모델 endpoint, 또는 실제 provider가 없으면 이 경로를 구현·배포 완료로 보고하지 않습니다.

배포 런타임 검증은 사용자가 모바일 스크린샷을 제공해야만 시작하는 방식이 아닙니다. 공개 프로세스가 준비되면 Computer Use의 `node_repl` + `@oai/sky`로 로그인된 Teams 데스크톱 앱을 직접 확인하고, 접근성 트리와 전·후 스크린샷으로 `업무 허브` 채팅·Bot 카드·개인 탭·변경 UI를 검증합니다. 상세 절차는 [`docs/teams-desktop-runtime-verification.md`](docs/teams-desktop-runtime-verification.md)에 있습니다. 데스크톱 검증은 일반 Teams 동작의 독립 증거이며, iOS 전용 WebView·모바일 앱 권한·iPhone GPS는 별도로 `MOBILE_UNVERIFIED`로 보고합니다.

`npm run check:types`는 별도로 TypeScript 타입 검사를 실행합니다. 실행 환경의 TypeScript CLI가 멈추는 경우에도 `npm run build`는 esbuild 산출물을 만들고 런타임 테스트를 계속할 수 있습니다.

## 인증과 저장소

Teams 탭이 초기화되면 TeamsJS `authentication.getAuthToken()`으로 받은 bearer token을 `/api/items` 요청에 전달합니다. 서버는 운영 모드에서 탭/SSO용 `CLIENT_ID`, `TENANT_ID`, `APPLICATION_ID_URI`를 기준으로 Microsoft Entra 토큰을 검증하고, Bot 메시지 발신에는 별도의 `BOT_CLIENT_ID`와 `CLIENT_SECRET`를 사용합니다. 로컬 개발에서만 `TEAMS_LOCAL_DEV=true TEAMS_SKIP_AUTH=true`로 이 검증을 우회합니다.

현재 업무·작업·GenUI grant 저장소는 private atomic JSON 파일입니다. 각 파일은 동일 디렉터리 임시 파일에 `fsync`한 뒤 원자적으로 교체되며, 디렉터리/파일 권한은 각각 `0700`/`0600`으로 유지됩니다. 이 `file-json-single-process` 저장소는 단일 프로세스 전용이며 `WEB_CONCURRENCY>1` 또는 `NODE_APP_INSTANCE>0` 설정으로 시작하지 않습니다. 여러 worker/replica 운영이나 감사 로그가 필요한 단계에서는 SQL/managed database로 교체해야 하며, atomic rename만으로 분산 동시성 문제를 해결한다고 간주하지 않습니다.

## 앱 패키지 생성

실제 Teams 등록 후 발급받은 값으로 패키지를 생성합니다.

이 릴리스 후보의 소스 package와 Teams manifest 버전은 `1.0.25`으로 고정되어 있으며 `npm run validate:manifest`가 두 값을 함께 검사합니다. 실제 배포 환경값이 없는 상태에서는 패키지를 업로드하거나 placeholder를 운영 자격 증명으로 간주하지 않습니다.

운영 패키지를 만들기 전에 배포 환경 사전검사를 실행합니다. 이 검사는 검증용 placeholder, 로컬 호스트, 잘못된 GUID를 차단합니다. `BOT_ID`는 메시징용 Teams/Bot 등록 ID이며, 봇과 탭을 함께 사용하는 Teams SDK 앱에서는 `APPLICATION_ID_URI`가 Microsoft의 결합 봇+탭 계약인 `api://<TAB_DOMAIN>/botid-<BOT_CLIENT_ID>`여야 합니다. `webApplicationInfo.id`는 별도 인증 앱일 수 있지만 resource URI 계약은 관찰된 봇 리소스와 일치해야 합니다.

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

ZIP을 새로 만든 뒤에는 내부 `manifest.json`의 버전 `1.0.25`, `devicePermissions: ["geolocation"]`, 탭 호스트와 `token.botframework.com`을 포함한 valid domain, 해석된 ID/URI를 확인하고 SHA-256을 기록합니다. 이전 ZIP을 재사용하지 않습니다.

`APPLICATION_ID_URI`는 Microsoft Entra 앱 등록의 `Expose an API`에 표시되는 실제 Application ID URI를 사용해야 합니다. 이 값은 manifest의 `webApplicationInfo.resource`로 들어갑니다.

Teams SDK에서 봇과 탭을 함께 사용하는 SSO는 봇 Entra 앱의 관찰된 Application ID URI·`access_as_user` 범위·Teams Web/Desktop 사전 승인·Bot Framework redirect URI를 사용합니다. 따라서 `APPLICATION_ID_URI`와 manifest의 `webApplicationInfo.resource`는 결합 계약인 `api://<TAB_DOMAIN>/botid-<BOT_CLIENT_ID>`와 같아야 하고, `webApplicationInfo.id`는 실제 토큰을 발급하는 인증 앱 ID와 일치해야 합니다. manifest `validDomains`에는 탭 호스트와 `token.botframework.com`을 함께 넣습니다. SSO 오류가 나면 Bot Entra 앱 설정과 Teams 앱 매니페스트를 함께 확인한 뒤 버전 증가·새 ZIP 생성·재업로드를 수행합니다.

## Teams에서 실행

실제 Teams sideload에는 public HTTPS 터널과 Teams 앱 등록이 필요합니다.

Teams 앱 변경 요청은 구현·로컬 검증 후 새 버전의 패키지를 생성하고 실제 업로드해야 합니다. 업로드가 끝나면 로컬 테스트 프로세스를 종료하고 `TEAMS_SKIP_AUTH`·`TEAMS_SKIP_OUTBOUND`가 없는 공개 Teams SDK 프로세스로 전환한 뒤, 공개 `/api/health`와 실제 Teams 메시지 왕복을 확인하고서야 Teams 완료 메시지를 보냅니다. 이 순서는 저장소 전역 지침인 [`AGENTS.md`](AGENTS.md)와 [Teams 릴리스 워크플로우](docs/teams-release-workflow.md)에 고정되어 있습니다.

필수 릴리스 순서는 `새 ZIP 생성·검사 → Developer Portal 업로드 확인 → local bypass/outbox 프로세스 종료 → 실제 자격 증명의 공개 Teams SDK 프로세스 시작 → 공개 HTTPS health에서 auth=teams-authenticated, userAuth=entra-sso, bot=teams-sdk, outbound=teams-sdk 확인 → 공개 탭과 실제 Teams 모바일 메시지 왕복 확인 → 그 뒤에만 완료 메시지 전송`입니다. 공개 health 또는 모바일 왕복을 관찰하지 못하면 완료로 보고하지 않고 BLOCKER로 남깁니다.

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
