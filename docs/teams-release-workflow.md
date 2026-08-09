# Teams 앱 필수 릴리스 워크플로우

이 문서는 Teams 앱 변경 요청의 종료 조건을 정의한다. 로컬 화면이 열리고 `npm test`가 통과한 것만으로는 완료가 아니다.

## 현시점 구현 기준: Teams Core 우선

현재 MVP의 필수 경로는 Microsoft Teams SDK + TypeScript/React 개인 탭 + Express/결정형 서버 + Adaptive Cards 동작이다. CopilotKit, OpenAI API, MCP, 로컬 모델은 선택 provider로 격리하며 API 키나 추가 모델 인증이 없다는 이유로 Teams Core 기능을 만들거나 검증하지 못했다고 보고하지 않는다. MCP/MCP Apps는 Teams 모바일 UI의 대체재가 아니며, 구체적인 MCP 서버가 확인된 뒤 서버 adapter로만 검토한다. 단계별 범위는 [`docs/api-free-teams-roadmap.md`](api-free-teams-roadmap.md)에 고정한다.

1. Teams Core에서 사용자 화면·서버 동작·오류/재시도·권한 대체 경로를 최소 기능으로 구현한다.
2. 명령어·카드·탭 링크·API·런타임을 테스트하고, 실제 Teams 화면에서 해당 단위의 전·후 상태를 확인한다.
3. 새 버전·새 ZIP·커밋·공개 전환·기존 탭 재사용·전수 UI 증거를 완료한다.
4. Core가 안정된 뒤에만 선택 provider를 별도 기능 플래그와 별도 릴리스로 추가한다.

따라서 선택 provider가 설정되지 않은 상태는 Core의 실패가 아니라 `OPTIONAL_PROVIDER_NOT_CONFIGURED`로 분리한다. Core 응답이 저장된 값을 단순히 되돌리는지 여부는 실제 작업 mutation, 상태 변화, 오류, 재시작 보존을 통해 검증한다.

## 인앱 브라우저 세션과 업로드 대상 보존 원칙

배포 작업은 Codex 인앱 브라우저에 이미 열려 있는 로그인 세션과 탭을 기반으로 이어간다.

- 시작할 때 기존 탭 목록에서 Developer Portal, Teams Admin Center 앱 상세, Teams 채팅, 공개 Teams 탭을 URL과 제목으로 확인하고, 일치하는 탭을 재사용한다.
- 같은 페이지를 다시 `goto`하거나 새 로그인 탭을 반복 생성하지 않는다. 사용자 로그인·Auth 앱 승인·모바일 검증 중인 탭을 닫지 않는다.
- 탭 예산은 표면별 최대 1개다. 기본적으로 `tabs.new`, 새 브라우저 창, 새 인증 탭을 호출하지 않으며, 이미 열려 있는 탭을 선택·재접속해 사용한다. 현재 화면에 4개 탭처럼 열린 상태가 보이면 그 탭들을 작업 대상의 기준으로 삼는다.
- `tabs.list()`가 `[]`를 반환해도 ambient UI 상태나 사용자의 설명에 기존 탭이 있으면 탭이 없는 것으로 간주하지 않는다. 도구 세션이 기존 창에 붙지 못한 상태로 기록하고, 현재 포커스 탭 재접속·URL/제목 확인을 먼저 시도한다. 재접속할 수 없으면 사용자에게 기존 탭을 포커스해 달라고 요청하고, 새 탭을 만들어 우회하지 않는다.
- 같은 URL에 이미 있는 탭은 다시 탐색하거나 새로고침하지 않는다. 인증·업로드·모바일 검증 중인 URL을 떠나지 않으며, 사용자가 이어서 확인해야 하는 탭은 닫거나 정리하지 않는다.
- Teams Admin Center의 앱 상세 페이지에서 `게시된 버전`과 `새 버전 → 파일 업로드`를 직접 확인한다. `동작 → 새 앱 업로드`는 동일 앱 ID를 신규 앱으로 처리하므로 기존 앱 업데이트에 사용하지 않는다.
- Developer Portal의 `앱 가져오기`는 앱 목록/검증 흐름으로 동작할 수 있고 동일 앱 ID 업데이트가 멈추거나 거부될 수 있다. 기존 앱 업데이트는 Teams Admin Center의 기존 앱 상세 경로를 우선한다.
- 파일 선택기가 운영체제 창으로 전환되어 브라우저 자동화에서 보이지 않으면 Mac 잠금 해제만 사용자에게 요청한다. 패키지나 앱 ID를 바꾸어 우회하지 않는다.
- 브라우저 작업이 끝나도 사용자에게 필요한 로그인·관리자·Teams 모바일 탭은 유지한다. 탭 정리는 중복·오류 탭에 한정하고, 사용자가 이어서 확인할 탭은 handoff 상태로 남긴다.

이 규칙은 매번 새 창을 만들어 로그인 상태를 잃거나, 신규 앱 업로드 경로에서 동일 앱 ID 오류를 반복하는 문제를 방지한다.

### 브라우저 세션 재사용 체크포인트

각 UI 단계는 다음 정보를 기록하고 단계 전후에 동일한 세션인지 확인한다.

1. 시작: 현재 탭 ID, URL, 제목, 로그인/인증 흐름 여부를 읽는다.
2. 실행: 기존 탭에서만 클릭·입력·업로드·검증을 수행한다. 작업 전후에 최신 DOM/접근성 상태를 다시 읽는다.
3. 종료: 같은 탭 ID와 로그인 세션이 유지되는지 확인한다. 탭 수가 증가하면 원인을 조사하고, 사용자 승인 없이 추가 탭을 남기지 않는다.
4. 연결 실패: 새 탭 생성 대신 기존 탭 재접속을 시도하고, 실패하면 `BROWSER_SESSION_UNAVAILABLE`로 보고한다.

### 장기 작업과 하위 에이전트 진행 모니터링

장기 대기 작업이 전체 릴리스를 붙잡지 않도록 프로세스·에이전트·UI 세션을 분리해 관찰한다.

- 30초 초과 가능 작업은 실행 제한시간을 지정하고, 제한시간 절반과 종료 시점에 최근 로그·PID·경과 시간·상태를 확인한다. 무제한 `wait`나 무제한 브라우저 대기를 사용하지 않는다.
- 공개 서버·Dev Tunnel·테스트 게이트·관리자 업로드·Teams UI 검증을 각각 독립 상태로 기록한다. 한 단계가 `BLOCKED`여도 명령어 게이트, 공개 health, 기존 탭 DOM 확인 등 비중복 작업은 계속한다.
- 하위 에이전트는 작업 ID별 상태를 `pending_init`/`running`/`needs_attention`/`completed`/`errored`/`interrupted`로 확인한다. 즉시 결과가 필요한 경우를 제외하고 반복 폴링하지 않으며, 진행률이 없는 동일 상태는 다시 보고하지 않는다.
- 두 번 연속 상태·로그 변화가 없으면 `STALE_PROCESS_SUSPECTED`로 분리 보고한다. PID, 부모 PID, 경과 시간, CPU/메모리, 마지막 로그, 대체 경로를 남기고, 공개 서버·Dev Tunnel·사용자 브라우저를 임의 종료하지 않는다.
- 각 단계 보고에 다음 모니터링 표를 남긴다.

  | process/agent | id 또는 PID | elapsed | last activity | health/status | next action |
  | --- | --- | --- | --- | --- | --- |

- 이 표의 상태가 확인되지 않은 장기 작업을 완료로 간주하지 않는다. UI 잠금·인증·네이티브 파일 선택은 별도 `BLOCKED`로 분리해 다른 단계의 진행률을 가리지 않는다.

## 순서

### 0. 명령어 우선 기계 게이트

화면 잠금·Computer Use·인앱 브라우저의 가용 여부와 무관하게 반복 검사를 먼저 실행한다.

```bash
npm run release:preflight   # core source-check 60s, core build 300s, core test 300s, deployment 30s
npm run release:package     # 새 ZIP, 내부 manifest, SHA-256
npm run release:public      # 공개 /api/health와 /tabs/home/
# 또는 위 세 단계를 순서대로 한 번에 실행
npm run release:gate
```

게이트는 하위 명령어의 출력·종료 코드·제한시간을 기록한다. timeout 또는 비정상 종료는 `BLOCKED`로 보고하고, 프로세스 그룹만 정리한다. 공개 서버·Dev Tunnel·기존 로그인 탭은 이 과정에서 종료하지 않는다. `release:public`이 HTTP 200을 확인하기 전에는 Teams UI 검증이나 완료 메시지로 넘어가지 않는다.

`release:public`은 `--url`을 우선 사용하고, 없으면 `TEAMS_PUBLIC_URL`, `PUBLIC_BASE_URL`, `.env.runtime`의 `TAB_DOMAIN` 순서로 현재 공개 origin을 해석한다. 별도 URL을 매번 복사해 넣지 않아도 되지만, 실제 `portUri`가 바뀌면 `.env.runtime`을 먼저 갱신하고 패키지·업로드 절차를 다시 시작한다. 운영 `typecheck`는 `tsconfig.release.json`의 작은 vendor type stub으로 선언 그래프 폭주를 차단하며, 실제 패키지 선언을 별도로 진단할 때만 `npm run typecheck:vendor`를 사용한다.

클라이언트는 `dist/client`를 선삭제하지 않고 임시 디렉터리에서 성공적으로 만든 뒤 교체한다. CopilotKit v2 대형 번들에서 현재 Node 24 + esbuild API의 source map 생성이 무기한 대기하는 회귀가 있으므로 운영 빌드 source map은 끈다. 이 문제를 다시 만나도 제한시간 게이트가 공개 산출물을 비우지 않은 채 중단되어야 한다.
`/api/health`가 200이어도 탭이 정상이라는 뜻은 아니다. 공개 프로세스 교체 직후에는 반드시 같은 origin에서 `/api/health` 200 → `/tabs/home/` 200 → HTML에 선언된 해시 자산 200을 연속 확인한다. health만 살아 있고 탭이 404이면 `TAB_RUNTIME_UNAVAILABLE`로 실패 처리하고, 이전 공개 프로세스를 유지한 채 산출물 경로·FileProvider 상태를 조사한다. Teams SDK 봇 분기에서도 개인 탭 HTTP 라우트가 항상 등록되어야 한다. `dist/client`가 `dist/client <n>`처럼 충돌 이름으로 바뀌었거나 원래 경로가 사라진 경우에는 빌드 성공으로 간주하지 않고, 새 `index.html`과 해시 자산을 확인한 뒤 3단계 HTTP probe를 재실행한다.

Core 서버 번들은 Teams SDK·Express 등 필수 런타임을 포함하고 CopilotKit/MCP는 선택 청크로 분리한다. 기본 `npm run build`는 `build:core`만 실행하고, 선택 provider는 `npm run build:all` 또는 명시적 optional 명령에서만 만든다. `npm run test:core`는 `scripts/core-runtime-smoke.mjs`로 API 키 없이 production Teams SDK 프로세스를 실제 기동해 `listen()`, `/api/health`, `/tabs/home/`을 확인한다. 이 스모크가 통과하지 않은 상태에서 기존 공개 서버나 포털 업로드를 최신 버전으로 교체하지 않는다.

### 로컬 원본 소스 기준

- `/Users/doosansmacbookpro/Documents/TeamsApp`이 로컬 원본 소스이며 유일한 Git 이력 기준이다. 다른 폴더나 임시 경로를 원본·원격·복구 기준으로 추정하지 않는다.
- 현재 Git 원격은 구성되어 있지 않다. 원격 저장소, clone, pull, push를 전제로 한 절차를 수행하거나 진행 보고에 포함하지 않는다.
- 구현·빌드·테스트·버전 증가·커밋은 원본 작업공간에서 수행한다. `/tmp`는 일회성 로그·격리 검증·업로드용 ZIP 산출물에만 사용하고, 원본 상태와 커밋의 증거는 원본 작업공간에서 다시 확인한다.
- Teams 업로드는 원본에서 생성하고 SHA-256 및 ZIP 내부 매니페스트를 검증한 최신 ZIP의 절대 로컬 경로를 브라우저 파일 선택기에 직접 전달한다. Finder 다운로드나 동기화 대기를 선행 조건으로 만들지 않는다.

기계 게이트가 통과해도 다음 UI 게이트는 별도다.

| 상태 | 의미 |
| --- | --- |
| `COMMAND_ONLY` | 소스·패키지·공개 HTTP까지만 확인됨 |
| `PORTAL_UPLOAD_UNVERIFIED` | 새 ZIP 업로드/게시 버전을 아직 화면에서 확인하지 못함 |
| `INSTALLED_VERSION_UNVERIFIED` | 실제 Teams 설치본이 ZIP 버전인지 확인하지 못함 |
| `DESKTOP_UNVERIFIED` | Teams 데스크톱 접근성 트리·스크린샷·왕복을 확인하지 못함 |
| `MOBILE_UNVERIFIED` | iOS WebView·위치 권한·모바일 왕복을 확인하지 못함 |

화면이 잠겨 있으면 `COMMAND_ONLY` 단계는 진행하고, 네이티브 UI 단계만 해당 상태로 보류한다. 잠금 해제·비밀번호·Auth 앱 승인·파일 선택을 자동화하거나 우회하지 않는다.

#### FileProvider/dataless 파일과 장시간 대기

macOS FileProvider가 원본 작업공간의 파일을 placeholder 상태로 만들면 코드 오류가 아니라 로컬 바이트 접근 문제일 수 있다. 빌드 전 `package.json`, `package-lock.json`, `appPackage/manifest.json`, `src/`, `scripts/`, `types/`와 실제 ZIP의 `stat` `blocks`·플래그를 확인한다. 파일 크기는 존재하지만 `blocks=0`이고 dataless/FileProvider 플래그가 있으면 `SOURCE_IO_BLOCKED`로 기록한다.

이 상태에서 `cp`, Git 객체 읽기, 빌드, 서버 시작을 파일별로 무기한 반복하지 않는다. 각 PID·경과 시간·마지막 로그를 30초 간격으로 확인하고, 두 번 연속 변화가 없으면 stale 작업으로 분리한다. 의존성 캐시 재구성·이미 로컬인 산출물 검증·공개 health 확인 같은 독립 명령어 검증은 계속할 수 있지만, `/Users/doosansmacbookpro/Documents/TeamsApp` 외의 `/tmp`·iCloud·동기화 경로·Git 객체 복구 결과를 원본으로 취급하지 않는다. 복구 임시 파일은 worktree 밖의 recoverable 경로로 이동하고 clean worktree를 다시 확인한다.
`dist` 자체가 `blocks=0`인 경우에는 `build:core`가 OS 안정 런타임 경로를 선택하고, `npm start`가 `scripts/start-server.mjs`로 그 동일 경로의 서버를 기동하게 한다. 런타임 산출물은 재생성 가능한 파생 파일이며 원본 소스·Git 이력·Teams 업로드 ZIP의 기준이 아니다.

FileProvider 다운로드를 기다리기 위해 Finder·새 브라우저 탭·새 로그인 세션을 만들지 않는다. 업로드는 원본에서 생성하고 SHA-256 및 내부 manifest를 확인한 최신 ZIP의 절대 경로를 직접 선택한다. 화면이 잠겨 파일 선택기가 열리지 않으면 `PORTAL_UPLOAD_UNVERIFIED`로 보류하고 잠금 해제 우회나 자격 증명 추측을 하지 않는다.

### 0.1 단일 재개 가능 릴리스 루프

기능 추가와 버그 수정은 모두 아래 loop를 사용한다. `release-gate`가 기계 검증을 담당하고 `release-loop`가 동일 run의 커밋·패키지·공개 health·외부 UI 증거를 묶는다.

```bash
npm run release:loop -- start
npm run release:loop -- machine
npm run release:loop -- package
npm run release:loop -- public
# 포털/설치본/데스크톱/모바일을 실제로 확인한 뒤 각각 evidence JSON 등록
npm run release:loop -- evidence --file <evidence.json>
npm run release:loop -- status
npm run release:loop -- complete
```

상태는 `.release/current.json`에 저장되며 토큰·비밀번호·API key·원문 Teams 메시지는 저장하지 않는다. `start`, `package`, `complete`는 현재 Git 커밋과 clean worktree를 확인한다. `machine`, `package`, `public` 실패는 마지막 성공 상태를 보존하고 다시 실행할 수 있다. `complete`는 네 개 UI 증거가 모두 현재 커밋·버전·ZIP SHA와 일치할 때만 `READY`와 Teams 전송용 보고서를 출력한다.

외부 증거 파일은 임의의 이미지 한 장으로 통과할 수 없다. `release-loop`는 전·후 스크린샷, 접근성 증거, 런타임 로그, 현재 커밋/버전에 결합된 전수 매트릭스 결과를 모두 요구한다. 아래는 `desktop`의 예시이며 실제 경로와 해시는 실행 결과로 채운다.

```json
{
  "surface": "desktop",
  "observedAt": "2026-08-09T12:00:00.000Z",
  "commit": "<현재 커밋>",
  "version": "X.Y.Z",
  "packageSha256": "<release:package 결과>",
  "summary": "실제 배포 Teams 데스크톱에서 status 답장과 카드/탭을 확인함",
  "screenshotBeforePath": "/absolute/path/teams-desktop-before.png",
  "screenshotAfterPath": "/absolute/path/teams-desktop-after.png",
  "accessibilityPath": "/absolute/path/teams-desktop-ax.json",
  "runtimeLogPath": "/absolute/path/teams-desktop-runtime.log",
  "coverage": {
    "matrixPath": "/absolute/path/teams-ui-matrix.json",
    "matrixSha256": "<sha256>",
    "commit": "<현재 커밋>",
    "version": "X.Y.Z",
    "totalRows": 0,
    "passedRows": 0,
    "blockedRows": 0,
    "unverifiedRows": 0
  },
  "artifactPaths": ["/absolute/path/teams-desktop-after.png"]
}
```

`totalRows`는 0이 될 수 없고 `passedRows === totalRows`, `blockedRows === 0`, `unverifiedRows === 0`이어야 한다. 각 매트릭스 행에는 기능·surface·location·branch·precondition·action·expected·전/후 스크린샷·접근성·런타임 증거가 있어야 한다. 이 조건을 충족하지 못하면 해당 surface는 완료가 아니다.

이 JSON은 화면 확인 사실을 입력하는 계약이며, loop가 화면을 합성하거나 모바일 확인을 추정하는 기능이 아니다. 포털 업로드·설치 버전·데스크톱·모바일 순서가 어긋나거나 증거 identity가 다르면 등록을 거부한다.

설치본 증거는 Teams 앱 정보 화면에서 확인한 버전을 별도로 기록해야 한다.

```json
{
  "surface": "installed",
  "observedAt": "2026-08-09T12:00:00.000Z",
  "commit": "<현재 커밋>",
  "version": "X.Y.Z",
  "packageSha256": "<release:package 결과>",
  "installedVersion": "X.Y.Z",
  "summary": "Teams 앱 정보 화면에서 설치 버전 X.Y.Z를 확인하고 status 왕복을 확인함",
  "screenshotBeforePath": "/absolute/path/teams-installed-before.png",
  "screenshotAfterPath": "/absolute/path/teams-installed-after.png",
  "accessibilityPath": "/absolute/path/teams-installed-ax.json",
  "runtimeLogPath": "/absolute/path/teams-installed-runtime.log",
  "coverage": {
    "matrixPath": "/absolute/path/teams-installed-matrix.json",
    "matrixSha256": "<sha256>",
    "commit": "<현재 커밋>",
    "version": "X.Y.Z",
    "totalRows": 0,
    "passedRows": 0,
    "blockedRows": 0,
    "unverifiedRows": 0
  },
  "artifactPaths": ["/absolute/path/teams-installed-after.png"]
}
```

`mobile` 증거에는 위 필드와 함께 사용자가 실제 배포 앱에서 직접 확인했다는 `"userConfirmed": true`가 필요하다. 사용자가 확인하지 않은 모바일 화면, 이전 버전 채팅, API 테스트 출력은 이 값을 대신할 수 없다.

관리자 센터의 게시 버전이나 채팅 응답만으로 `installedVersion`을 추정해서는 안 된다.

### 1. 구현과 로컬 검증

- 사용자의 요청사항을 코드·매니페스트·문서에 반영한다.
- 로컬 테스트 모드에서 `npm test`와 변경 범위에 맞는 런타임 검증을 실행한다.
- 로컬 테스트 모드의 결과는 개발 증거일 뿐 공개 운영 증거로 보고하지 않는다.

### 2. 새 버전과 패키지

- Teams 앱 버전을 올린다.
- `npm run check:deployment`, `npm run validate:manifest`, `npm run package:app`를 실행한다.
- 생성된 ZIP을 열어 실제 `manifest.json`의 버전, 앱 ID, 도메인, `devicePermissions`를 확인한다.
- ZIP의 SHA-256을 기록한다. 이전 ZIP을 재사용하거나 “패키지를 만들었다”고 추정하지 않는다.
- `npm run test:package-determinism`으로 같은 입력의 ZIP SHA-256이 항상 같은지 확인한다. 릴리스 루프 package 단계 이후에는 ZIP을 다시 생성하지 않고, 기록된 절대 경로의 동일 파일만 업로드한다.

Dev Tunnel을 다시 만들었으면 tunnel ID를 공개 호스트로 간주하지 않는다. 다음 순서로 실제 호스트를 확인한다.

```bash
devtunnel user login --use-browser-auth --entra
devtunnel create <tunnel-id> --allow-anonymous
devtunnel port create <tunnel-id> -p 3978 --protocol http
devtunnel host <tunnel-id> --allow-anonymous
devtunnel show <tunnel-id> --json
```

`ports[].portUri`의 실제 HTTPS 호스트로 `TAB_DOMAIN`을 설정해 패키지를 생성한다. 기존 주소가 더 이상 응답하지 않으면 이전 주소를 재사용한다고 가정하지 않는다.

매니페스트의 `TAB_DOMAIN`과 Teams 관리 봇의 메시징 엔드포인트는 별도 등록이다. 공개 호스트가 바뀌면 Teams 외부 앱 ID를 사용해 `teams app update <external-app-id> --endpoint https://<portUri>/api/messages --json`으로 `messagingEndpoint`를 갱신하고, 출력의 `updated.endpoint`가 현재 주소인지 확인한다. `needsReinstall: true`가 나오면 반드시 새 ZIP 생성·업로드와 Teams 앱 재설치를 수행한다. `/api/health`가 200이어도 이전 엔드포인트가 남아 있으면 모바일 Bot은 응답하지 않는다.

### 3. Git 이력

- `git diff`, `git status`, 테스트 결과를 검토한다.
- 구현·매니페스트·지침 변경을 의미 있는 커밋으로 남긴다.
- 업로드 대상 ZIP은 커밋된 소스와 매니페스트에서 생성한다.

### 4. 실제 업로드

- 승인된 Developer Portal 또는 Teams Admin Center의 배포 대상에 새 ZIP을 업로드한다. 동일 앱 ID 업데이트는 Teams Admin Center의 `앱 관리 → 사용자 지정 앱 검색 → 기존 앱 상세 → 새 버전 → 파일 업로드`를 사용한다. `동작 → 새 앱 업로드`에서 동일 앱 ID 오류가 나면 신규 앱 생성 문제가 아니라 업데이트 경로를 잘못 선택한 것이다.
- 업로드 후 대상 화면에서 새 버전과 검증 결과를 직접 확인한다.
- 인증·정책·업로드 대상이 없으면 안전한 범위까지만 진행하고 `BLOCKER`로 보고한다. 성공을 추측하지 않는다.

### 5. 로컬 모드 종료와 공개 프로세스 전환

로컬 테스트 프로세스가 공개 터널 포트를 점유한 채 남아 있지 않은지 확인한다. 공개 프로세스는 실제 자격 증명을 사용하고 다음 우회 설정을 사용하지 않아야 한다.

```bash
npm start
```

`npm start`는 존재하는 `.env.runtime`을 자동으로 로드한다. 운영 서버를 `node dist/server/index.js`로 직접 실행하면 인증 환경이 누락될 수 있으므로 사용하지 않는다. 재시작 직후 아래 공개 health 값이 모두 맞는지 확인한 다음 Teams UI 검증을 시작한다.

공개 URL의 `/api/health`에서 다음을 직접 확인한다.

```json
{
  "auth": "teams-authenticated",
  "bot": "teams-sdk",
  "outbound": "teams-sdk"
}
```

`local-handler`, `local-outbox`, `local-bypass`, `outbound=disabled`가 하나라도 보이면 공개 전환이 완료되지 않은 것이다. 이 상태에서는 완료 메시지를 보내지 않는다.

공개 Dev Tunnel 인증이 필요한 경우 디바이스 코드가 보안 기본값으로 차단될 수 있다. 이때 브라우저 인증을 사용하고 사용자가 Auth 앱 승인을 완료한 뒤 `devtunnel user show`가 로그인 상태인지 확인한다. 터널 호스트가 출력한 `Connect via browser` URL과 `devtunnel show --json`의 `portUri`가 패키지의 `TAB_DOMAIN`과 일치해야 한다.

Entra SSO는 패키지 업로드 성공만으로 완료된 것으로 보지 않는다. 봇과 탭을 함께 사용하는 Teams SDK 앱에서는 Bot Entra 앱의 실제 Application ID URI가 결합 계약인 `api://<TAB_DOMAIN>/botid-<BOT_CLIENT_ID>`인지, `access_as_user` 범위와 Teams Web/Desktop 사전 승인 및 Bot Framework redirect URI가 구성됐는지 확인한다. manifest `validDomains`에는 탭 호스트와 `token.botframework.com`이 모두 있어야 한다. 실제 Teams 탭 iframe에서 `authentication.getAuthToken()`을 호출해 `App resource defined in manifest and iframe origin do not match`가 없는지도 검증한다. 불일치가 재현되고 관리자 접근이 작업 범위에 있으면 Bot Entra 리소스, `webApplicationInfo.resource`, `APPLICATION_ID_URI`를 동일 값으로 맞추고 반드시 새 버전 패키지를 다시 생성·업로드한다.

### 6. 엔드투엔드 런타임 검증

- 공개 HTTPS 탭 URL이 새 UI를 제공하는지 확인한다.
- Teams 데스크톱 앱을 독립 검증 호스트로 사용한다. `node_repl`의 Computer Use와 `@oai/sky`로 기존 로그인 창을 열고, 접근성 트리와 전·후 스크린샷을 수집한다. 사용자가 모바일 스크린샷을 제공하지 않아도 이 단계는 반드시 수행한다.
- 데스크톱에서 대상 `업무 허브` 채팅, 실제 Bot 답장, 카드 전용 렌더링, 카드와 top-level 텍스트 중복 여부, `업무 허브` 개인 탭, 변경된 UI와 핵심 버튼을 직접 확인한다. 탭 전환이나 메시지 전송 후에는 최신 접근성 트리를 다시 읽어 stale element index를 사용하지 않는다.
- 공개 검증 후 작업을 사용자에게 넘겨, 사용자가 배포된 Teams 앱(우선 모바일 Teams)에서 `status`, `list`, `help`, 변경 기능 또는 이번 요청에 해당하는 실제 메시지를 직접 보낸다. 사용자는 모바일 스크린샷을 보낼 필요가 없으며, 데스크톱 Teams에서 같은 대화의 수신 답장을 확인할 수 있다.
- 실제 Teams 앱 정보 화면의 설치 버전이 이번 ZIP/manifest 버전과 일치하는지 별도로 확인한다. 설치본이 이전 버전이면 앱 업데이트 전파를 기다리거나 기존 설치를 제거 후 최신 패키지로 다시 추가한 뒤에만 SSO·UI 결과를 판정한다.
- 사용자가 같은 배포 앱에서 받은 Bot 답장, Adaptive Card/GenUI, 승인·취소 결과, 필요한 proactive 진행·완료 메시지를 확인한다. API 호출·로컬 테스트·오케스트레이터가 만든 합성 Activity는 이 사용자 확인을 대체하지 않는다.
- Adaptive Card Activity에는 카드와 동일한 요약을 top-level `text`로 중복 포함하지 않는다. 카드 렌더링 경로는 attachment-only이고, text-only Activity는 legacy 또는 카드 전송 실패 fallback으로만 허용한다.
- 장시간 작업이면 진행 메시지, 승인·취소 경계, proactive 완료 메시지까지 확인한다.
- Codex CLI가 정상 종료되어도 실제 최종 `agent_message`가 없으면 성공/완료 메시지를 보내지 않는다. `completed` 상태에는 비어 있지 않은 결과가 필요하며, 누락 시 실패·차단 상태로 남긴다.
- 커밋 카드는 `committed=true`와 실제 Git hash를 동시에 확인할 때만 완료로 표시한다. 읽기 전용 작업, 기록된 소유 경로가 없는 작업, 변경 파일이 없는 작업은 오류 카드로 표시하고 완료로 포장하지 않는다.
- AgentJobStore와 업무 저장소는 mutation 직렬화·원자적 저장·실패 롤백을 통과해야 한다. 파일 저장 실패 뒤 메모리 목록이 바뀐 상태로 남으면 런타임 검증을 중단한다.
- 모바일 기능은 데스크톱 확인과 별도로 분리한다. 데스크톱에서는 모바일 스크린샷 없이도 Bot·탭·카드의 일반 동작을 확인할 수 있지만, iOS WebView 레이아웃, Teams 모바일 앱 권한, iPhone GPS는 데스크톱으로 증명할 수 없다. 이 항목은 `MOBILE_UNVERIFIED`로 보고하고 모바일 통과로 표현하지 않는다.

### 6.1 실사용 UI 전수 검증 매트릭스 — 필수

실제 사용자가 보는 결과를 확인하는 릴리스에서는 기능을 대표 몇 개만 클릭해서 통과시키지 않는다. 구현된 모든 기능을 사용자 화면 위치와 동작 분기로 분해하고, 공개 배포본에서 각 행을 직접 실행한다.

각 매트릭스 행은 다음 필드를 갖는다.

```text
feature / surface / location / branch / precondition / action
expected / screenshotBefore / screenshotAfter / accessibilityEvidence
runtimeEvidence / result(PASS|FAIL|BLOCKED|N/A)
```

필수 분기에는 초기·로딩·성공·빈 상태·오류·권한 거부·인증 만료·재시도·승인 필요·승인 완료·취소·중복 클릭·잘못된 입력·경계값·모바일 대체 안내가 포함된다. 기능에 해당하지 않는 분기는 `N/A`와 근거를 남긴다.

- 채팅: 프롬프트 보기 열기, 프롬프트 항목별 선택, 명령 전송, 봇 회신, 카드/텍스트 중복 여부, 탭 링크를 각각 캡처한다.
- Adaptive Card: 모든 기본 명령 버튼(`help`, `weather`, `status`, `list`)을 각각 실행하고, 버튼 표시·서버 도달·회신 카드·실패/재전송 결과를 개별 캡처한다. `Action.Execute`와 호환 fallback은 별도 분기로 확인한다.
- 탭: 서비스 정상/인증/저장소 표시, 업무 추가·수정·완료·삭제, 새로고침·필터·빈 목록·오류, 위치 사용·위치 권한 허용·거부·재시도, 날씨 정상/실패 UI를 각각 캡처한다.
- 작업: read-only 실행·진행·완료·실패, write 승인·취소·재시도, 잘못된 작업 ID, 중복 승인·취소, proactive 진행·완료 메시지를 각각 캡처한다.

클릭·입력·탭 전환 후에는 반드시 최신 접근성 트리를 다시 읽고, 새 `element_index`를 사용한다. 스크린샷에 대상 컨트롤과 결과가 실제로 보이지 않거나 현재 공개 버전이 식별되지 않으면 통과가 아니다. API·로컬 하네스·사용자가 준 과거 스크린샷은 이 매트릭스의 행을 대체하지 않는다. 매트릭스가 모두 `PASS`이거나 근거 있는 `N/A`가 되기 전에는 `DESKTOP_READY`/`MOBILE_READY`를 등록하지 않는다.

데스크톱 스크린샷·접근성 증거에는 최소한 다음을 남긴다.

- Teams 창 제목과 검증 시각
- 대상 채팅과 활성 탭 이름
- 실제로 보낸 테스트 명령과 작업 ID
- Bot 답장·카드·탭 UI가 보이는 스크린샷
- 접근성 트리에서 확인한 핵심 텍스트와 버튼
- 앱 버전, 공개 `/api/health`, 커밋 SHA

### 7. Teams 완료 메시지

다음 조건을 모두 충족한 후에만 Teams 채팅에 완료 메시지를 보낸다.

- 새 패키지 생성 및 실제 업로드 확인
- 공개 프로세스 health 기준 충족
- Teams 왕복 응답 확인
- 사용자가 배포된 Teams 앱에서 메시지를 보내고 답장을 확인했다는 증거
- Git 커밋 SHA 확보

완료 메시지에는 최소한 다음을 적는다.

- 앱 버전과 커밋 SHA
- 패키지 검증·업로드 결과와 ZIP SHA-256
- 공개 URL health의 `auth`·`bot`·`outbound` 값
- 실행한 테스트와 Teams 런타임 증거
- 사용자 메시지 원문 요약과 배포 앱 답장/스크린샷 또는 사용자의 확인 보고
- Teams 데스크톱 앱 독립 스크린샷·접근성 검증 결과 및 `MOBILE_UNVERIFIED` 여부
- 실사용 UI 전수 검증 매트릭스의 경로별 스크린샷·접근성·런타임 증거와 미통과 분기
- 모바일에서 사용자가 이어서 확인할 단계

## 보고 형식

모든 작업 결과는 다음 형식을 사용한다.

```text
STATUS: READY | BLOCKED
EVIDENCE: 관찰한 명령·화면·health·Teams 응답
COMPLETED: 구현·검증·패키지·업로드·공개 전환 결과
BLOCKER: 없으면 NONE, 있으면 정확한 외부 의존성
NEXT ACTION: 사용자 또는 다음 실행자가 할 일
```

업로드, 공개 프로세스 전환, Teams 응답, 사용자의 배포 앱 메시지 확인을 직접 관찰하지 못한 경우 `COMPLETED`로 표시하지 않는다.
