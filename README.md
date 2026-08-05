# Teams SDK MVP

TypeScript + React + Express + Microsoft Teams SDK 기반의 내부용 Teams 앱 MVP입니다.

## 기능 범위

- Teams 탭으로 제공되는 업무 목록 UI
- `GET /api/health` 상태 확인
- `GET /api/items` 업무 목록 조회
- `GET /api/items` 응답의 전체/진행 중/완료 요약
- `POST /api/items` 업무 추가
- `GET /api/items/:id` 단건 업무 조회
- `PUT /api/items/:id` 업무 제목 수정
- `PATCH /api/items/:id` 업무 완료/재개 전환
- `DELETE /api/items/:id` 업무 삭제
- JSON 파일 기반 업무 영속 저장 및 재시작 복구
- 운영 모드 Entra bearer token 검증 미들웨어
- Teams SDK `/api/messages` 메시지 핸들러 (`help`, `status`, `list` 명령 포함)
- Teams SDK `/api/messages` `status` 명령으로 진행 중 업무 수 확인
- 런타임 상태 패널과 서버 health 확인
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
- Teams 메시지 엔드포인트: http://localhost:3978/api/messages

`TEAMS_SKIP_AUTH=true`는 로컬 개발 전용입니다. 실제 Teams에서는 Entra/Bot 인증 환경변수를 설정하고 이 값을 제거해야 합니다.

## 런타임 검증

기존 `data/items.json`을 건드리지 않고 임시 저장소로 실제 서버 프로세스를 실행하여 API, Bot, 파일 저장, 운영 인증 경계를 검증합니다.

```bash
npm test
```

`npm run test:runtime`만 실행하면 이미 빌드된 서버를 기준으로 런타임 테스트를 반복할 수 있습니다. 테스트는 로컬 인증 우회 흐름과 production bearer token 거부 흐름을 모두 확인합니다.

`npm run check:types`는 별도로 TypeScript 타입 검사를 실행합니다. 실행 환경의 TypeScript CLI가 멈추는 경우에도 `npm run build`는 esbuild 산출물을 만들고 런타임 테스트를 계속할 수 있습니다.

## 인증과 저장소

Teams 탭이 초기화되면 TeamsJS `authentication.getAuthToken()`으로 받은 bearer token을 `/api/items` 요청에 전달합니다. 서버는 운영 모드에서 `CLIENT_ID`, `TENANT_ID`, `APPLICATION_ID_URI`를 기준으로 Microsoft Entra 토큰을 검증합니다. 로컬 개발에서만 `TEAMS_SKIP_AUTH=true`로 이 검증을 우회합니다.

현재 업무 저장소는 `data/items.json`입니다. 이 파일은 로컬 MVP의 재시작 검증을 위해 사용하며 Git에는 포함하지 않습니다. 여러 인스턴스 운영이나 감사 로그가 필요한 단계에서는 SQL/managed database로 교체해야 합니다.

## 앱 패키지 생성

실제 Teams 등록 후 발급받은 값으로 패키지를 생성합니다.

```bash
TEAMS_APP_ID=<teams-app-id> \
BOT_ID=<bot-or-entra-app-id> \
TAB_DOMAIN=<public-https-host> \
CLIENT_ID=<entra-application-client-id> \
APPLICATION_ID_URI=<entra-application-id-uri> \
npm run package:app
```

생성된 `appPackage/build/teams-sdk-mvp.zip`을 Teams Developer Portal 또는 Teams Admin Center에 업로드합니다.

`APPLICATION_ID_URI`는 Microsoft Entra 앱 등록의 `Expose an API`에 표시되는 실제 Application ID URI를 사용해야 합니다. 이 값은 manifest의 `webApplicationInfo.resource`로 들어갑니다.

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
  -e TENANT_ID=... \
  -e APPLICATION_ID_URI=... \
  -e BOT_ID=... \
  -e TEAMS_APP_ID=... \
  -e TAB_DOMAIN=... \
  teams-sdk-mvp
```
