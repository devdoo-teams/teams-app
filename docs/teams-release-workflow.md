# Teams 앱 필수 릴리스 워크플로우

이 문서는 Teams 앱 변경 요청의 종료 조건을 정의한다. 로컬 화면이 열리고 `npm test`가 통과한 것만으로는 완료가 아니다.

## 현시점 구현 기준: Teams Core 우선

현재 MVP의 필수 경로는 Microsoft Teams SDK + TypeScript/React 개인 탭 + Express/결정형 서버 + Adaptive Cards 동작이다. CopilotKit, OpenAI API, MCP, 로컬 모델은 선택 provider로 격리하며 API 키나 추가 모델 인증이 없다는 이유로 Teams Core 기능을 만들거나 검증하지 못했다고 보고하지 않는다. MCP/MCP Apps는 Teams 모바일 UI의 대체재가 아니다. 현재 Jira/Confluence/Bitbucket optional registry는 실제 REST 계약을 검증하는 서버 adapter로 구현되어 있지만, 공개 provider connector·자격증명·MCP host 왕복 증거가 없으면 배포 완료나 Teams Core 완료로 보고하지 않는다. 단계별 범위는 [`docs/api-free-teams-roadmap.md`](api-free-teams-roadmap.md)에 고정한다.

1. Teams Core에서 사용자 화면·서버 동작·오류/재시도·권한 대체 경로를 최소 기능으로 구현한다.
2. 명령어·카드·탭 링크·API·런타임을 테스트하고, 실제 Teams 화면에서 해당 단위의 전·후 상태를 확인한다.
3. 새 버전·새 ZIP·커밋·공개 전환·기존 탭 재사용·전수 UI 증거를 완료한다.
4. Core가 안정된 뒤에만 선택 provider를 별도 기능 플래그와 별도 릴리스로 추가한다.

따라서 선택 provider가 설정되지 않은 상태는 Core의 실패가 아니라 `OPTIONAL_PROVIDER_NOT_CONFIGURED`로 분리한다. Core 응답이 저장된 값을 단순히 되돌리는지 여부는 실제 작업 mutation, 상태 변화, 오류, 재시작 보존을 통해 검증한다.

### Optional Jira/Confluence/Bitbucket MCP 게이트

provider registry 변경은 다음 순서를 추가로 따른다.

1. Jira에 `teams-core:task:external-provider-adapters` idempotency key를 가진 단일 이슈를 검색·재사용한다.
2. Jira/Confluence/Bitbucket REST client contract 테스트와 `test:mcp-provider-tools`, `test:mcp-provider-auth-boundary`를 실행한다. 실제 토큰은 fixture·로그·Jira 설명에 기록하지 않는다.
3. `TEAMS_MCP_PROVIDER_TOOLS=true`는 기본적으로 local safe gate에서만 켠다. 공개 optional 경로를 별도로 활성화할 때는 `TEAMS_MCP_AUTHENTICATED_ENABLED=true`, 별도 MCP Entra resource app/audience/scope, 명시된 HTTPS resource/authorization-server metadata, Teams Entra bearer 검증, 요청별 principal factory를 모두 함께 확인한다. 클라이언트 입력의 tenant/requester/conversation 값은 credential scope로 사용하지 않는다.
4. Core preflight와 Core bundle boundary에서 provider module이 제외되는지, optional bundle marker가 `mode=optional`인지 확인한다.
5. 공개 provider route를 활성화하려면 별도 connector 인증, provider identity, protected-resource metadata/`WWW-Authenticate`, timeout/error/redaction evidence, public health와 installed UI identity를 같은 release SHA에 결합한다. 외부 MCP client OAuth discovery까지 증명하지 못하면 이를 지원한다고 보고하지 않는다. 이 증거가 없으면 Jira 이슈는 `In Progress`로 유지한다.
6. 패키지 manifest version, server marker commit/digest, public `/api/health`의 version/commit/digest가 일치하는지 `test:release-identity-consistency` 계약으로 확인한다. 불일치하면 업로드·완료 보고를 중단한다.

### 카드 갤러리와 인라인 이미지 기준

- 모바일에서 확인 가능한 갤러리는 Bot Framework 메시지의 `attachmentLayout: "carousel"`과 카드별 Adaptive Card attachment를 사용한다. 한 메시지에는 최대 10개의 카드만 넣고, 카드 내부 여러 이미지는 Adaptive Card `ImageSet`으로 표현한다.
- 이미지 URL은 Teams 클라이언트가 접근할 수 있는 공개 HTTPS URL만 허용하며, 스키마에서 HTTP·데이터 URI·6개 초과 이미지를 거부한다. 각 이미지에는 접근성용 `altText`를 필수로 넣는다.
- Teams의 기본 명령 버튼과 기본 탭 링크를 합쳐 공식 권장 한도인 6개를 넘기지 않는다. 따라서 카드에는 5개 명령 버튼과 탭 링크를 제공하고 `collaboration`과 `carousel`은 텍스트 명령으로 제공한다. 카드 렌더링만 통과하고 실제 명령 왕복·이미지 로드·탭 이동을 확인하지 않은 상태는 완료로 기록하지 않는다.
- Adaptive Card 기반 Loop 컴포넌트는 현재 Teams 모바일 및 macOS 클라이언트에서 사용할 수 없으므로 모바일 MVP의 필수 경로가 아니다. Loop가 필요한 별도 기능은 메시지 확장·링크 언퍼링·Universal Actions와 클라이언트 지원 여부를 별도 검증한 후에만 제안한다.

## 인앱 브라우저 세션과 업로드 대상 보존 원칙

배포 작업은 Codex 인앱 브라우저에 이미 열려 있는 로그인 세션과 탭을 기반으로 이어간다.

### 사용자가 사전 승인한 릴리스 절차의 범위

사용자가 명시적으로 “앞으로 필요한 모든 절차를 승인한다”고 승인한 경우, 현재 Teams 릴리스와
직접 연결된 Entra 설정 저장, 패키지 생성·검증·업로드, 기존 앱 업데이트, Jira 증거 동기화,
Teams 완료 보고 같은 정상적인 변경 절차는 같은 작업 범위 안에서 반복적인 일반 승인 요청 없이
진행한다. 이 승인은 현재 릴리스의 앱 ID·배포 대상·기능 범위를 바꾸거나 삭제·새 계정 생성·관련
없는 권한 확대를 허용하는 것으로 해석하지 않는다.

비밀번호·OTP·device code·passkey·bearer token·API key를 입력하거나 저장하지 않으며, Authenticator,
MFA, CAPTCHA와 같은 사용자만 처리할 수 있는 보안 프롬프트는 사용자에게 넘긴다. 승인된 범위라도
작업 전후에 기존 인앱 브라우저 탭, 로그인 계정, 앱 ID, 버전, 커밋, 패키지 SHA, 공개 origin을
다시 확인하고, 외부 쓰기의 응답을 원격 화면 또는 공식 API read-back으로 검증한다.

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
- 단계별 UI 증거는 `coverage.scope`를 사용한다. `portal`, `installed`, `desktop`은 해당 단계의 스코프 행만 PASS/N/A이면 다음 단계로 진행할 수 있다. 마지막 `mobile` 증거만 `scope=full`인 전체 matrix에서 BLOCKED/UNVERIFIED 없이 모든 행이 PASS/N/A여야 한다. 이 순서가 없으면 첫 포털 증거 등록 전에 이후 화면 증거를 요구하는 교착이 발생한다.
- 하위 에이전트는 작업 ID별 상태를 `pending_init`/`running`/`needs_attention`/`completed`/`errored`/`interrupted`로 확인한다. 즉시 결과가 필요한 경우를 제외하고 반복 폴링하지 않으며, 진행률이 없는 동일 상태는 다시 보고하지 않는다.
- 감사·검증·구현 대기열에서 서로 독립적이고 쓰기 범위가 겹치지 않는 작업은 가용 슬롯 한도까지 병렬 배정한다. 부모는 임계 경로를 직접 진행하며, 하위 에이전트가 맡은 범위를 중복 조사하지 않는다.
- 완료·오류·중단 결과는 즉시 회수·검토하고 에이전트를 종료한다. 비중복 대기 작업이 있으면 확보된 슬롯을 우선순위 순으로 즉시 재사용하고, 각 결과의 발견 항목을 Jira 전수 매핑 게이트에 합친다.
- 두 번 연속 상태·로그 변화가 없으면 `STALE_PROCESS_SUSPECTED`로 분리 보고한다. PID, 부모 PID, 경과 시간, CPU/메모리, 마지막 로그, 대체 경로를 남기고, 공개 서버·Dev Tunnel·사용자 브라우저를 임의 종료하지 않는다.
- 응답 없는 하위 에이전트는 체크포인트 요청 후에도 두 번 연속 변화가 없으면 이전 상태를 회수해 종료하고 더 작은 독립 작업으로 재배정한다. 슬롯만 점유하는 작업을 무기한 유지하지 않는다.
- 각 단계 보고에 다음 모니터링 표를 남긴다.

  | process/agent | id 또는 PID | elapsed | last activity | health/status | next action |
  | --- | --- | --- | --- | --- | --- |

- 이 표의 상태가 확인되지 않은 장기 작업을 완료로 간주하지 않는다. UI 잠금·인증·네이티브 파일 선택은 별도 `BLOCKED`로 분리해 다른 단계의 진행률을 가리지 않는다.

## 순서

### Jira 이슈 전수 매핑 게이트

구현·테스트·코드 리뷰·공개 런타임·포털·Teams 데스크톱·모바일에서 발견한 각 재현
결함, 릴리스 blocker, 검증 가능한 개선은 서로 다른 원인과 수락 조건을 기준으로 Jira
`MP`의 개별 이슈에 매핑한다.

1. 안정 키 `teams-core:<issue-kind>:<stable-test-or-row-id>`로 기존 이슈를 먼저 검색한다.
2. 일치하면 갱신하고, 없으면 `Bug`/`Task`/`Improvement` 중 실제 Jira에서 제공되는 유형으로
   만든다. 커밋 SHA는 증거이지 안정 키의 일부가 아니다.
3. 구현을 시작할 때 현재 로그인 사용자에게 할당하고, 실제 노출된 transition으로
   `In Progress`에 둔다.
4. 발견 증거, 재현 절차, 원본 경로, 앱/패키지 identity, 수정 커밋, 다음 동작, 수락 조건을
   기록한다. 비밀번호·토큰·device code는 기록하지 않는다.
5. 현재 릴리스의 패키지·공개 런타임·필수 UI 증거가 수락 조건을 만족한 뒤에만 `Done`으로
   전환한다. 코드/테스트 통과만으로 닫지 않는다.
6. `release:loop complete` 직전에 발견 항목과 Jira key/URL을 전수 대조한다. 현재 릴리스
   blocker가 열려 있거나 매핑되지 않은 항목이 하나라도 있으면 완료와 Teams 완료 메시지를
   차단한다. 후속으로 미루는 비차단 개선은 Jira 상태·담당자·사유를 완료보고에 포함한다.

진행 메시지, 단순 재시도, 선택 provider의 의도된 `N/A`는 새 이슈가 아니라 기존 이슈의
증거 또는 로그다. 브라우저 폼을 채운 것만으로 생성으로 간주하지 않고 Jira가 반환한
key/URL을 확인한다.

### 0. 명령어 우선 기계 게이트

화면 잠금·Computer Use·인앱 브라우저의 가용 여부와 무관하게 반복 검사를 먼저 실행한다.

```bash
npm run release:preflight   # source-check 60s, core build 300s, deterministic fallback build 300s, core test 300s, deployment 30s
npm run release:package     # 새 ZIP, 내부 manifest, SHA-256
npm run release:public      # 공개 /api/health와 /tabs/home/
# 또는 위 세 단계를 순서대로 한 번에 실행
npm run release:gate
```

기본 릴리스 프로필은 `core`이며 위 명령은 기존 결정형 Teams 서비스를 기준으로 실행한다. Grok을 운영 Bot으로 승격할 때만 배포 환경에서 아래 세 값을 명시적으로 주입해 `optional` 프로필을 선택한다. `XAI_API_KEY`는 저장소·문서·릴리스 상태 파일에 기록하지 않고 호스팅 provider의 secret manager에서만 주입한다.

```bash
TEAMS_RELEASE_RUNTIME=optional \
TEAMS_OPTIONAL_RUNTIME=true \
XAI_API_KEY='(secret manager에서 주입)' \
TEAMS_RESPONSE_MODE_DEFAULT=grok \
npm run release:preflight
```

`XAI_BASE_URL`은 운영에서 공식 xAI Responses endpoint인 `https://api.x.ai/v1`만 허용한다. 로컬 mock은 운영 프로세스와 분리된 `NODE_ENV=test` 환경에서만 `XAI_ALLOW_LOOPBACK_TEST=true`, `TEAMS_LOCAL_DEV=true`, `TEAMS_SKIP_AUTH=true`, 별도의 `XAI_LOOPBACK_TEST_KEY`를 함께 지정하고 loopback 주소를 사용한다. loopback 요청에는 `XAI_API_KEY`가 절대 사용되지 않으며, `NODE_ENV=development`를 포함한 다른 환경에서는 예외가 거부된다.

`TEAMS_RESPONSE_MODE_DEFAULT=grok`은 새 사용자/대화의 서버 소유 응답 모드를 Grok으로 시작하게 하는 선택값이며, 이미 저장된 scope별 모드가 우선한다. 이 값을 생략하면 optional 런타임도 기존처럼 결정형 모드로 시작한다. 이 프로필은 Core 회귀 테스트를 먼저 실행한 뒤 optional 서버를 마지막에 빌드해 `mode=optional` marker를 남긴다. `TEAMS_RELEASE_RUNTIME=optional`인데 optional flag 또는 xAI key가 없으면 게이트가 닫힌 상태로 실패한다. 반대로 Core 프로필에서는 xAI key가 없어도 기존 서비스 검증을 계속할 수 있다. 두 프로필 모두 공개 health, `/tabs/home/`, 패키지 identity, 설치본, 데스크톱·모바일 UI 증거가 필요하며, optional preflight 통과만으로 Grok의 실제 xAI 왕복이나 Teams 배포를 완료로 보고하지 않는다.

게이트는 하위 명령어의 출력·종료 코드·제한시간을 기록한다. timeout 또는 비정상 종료는 `BLOCKED`로 보고하고, 프로세스 그룹만 정리한다. 공개 서버·Dev Tunnel·기존 로그인 탭은 이 과정에서 종료하지 않는다. `release:public`이 HTTP 200을 확인하기 전에는 Teams UI 검증이나 완료 메시지로 넘어가지 않는다.

`release:public`은 `--url`을 우선 사용하고, 없으면 `TEAMS_PUBLIC_URL`, `PUBLIC_BASE_URL`, `.env.runtime`의 `TAB_DOMAIN` 순서로 현재 공개 origin을 해석한다. 별도 URL을 매번 복사해 넣지 않아도 되지만, 실제 `portUri`가 바뀌면 `.env.runtime`을 먼저 갱신하고 패키지·업로드 절차를 다시 시작한다. `typecheck:core`는 direct bounded esbuild CLI stdin transform을 사용하고 workspace tsconfig auto-discovery를 끄며 long-lived service mode를 사용하지 않는다. 실제 패키지 선언은 별도 bounded 진단에서만 확인하고, 필요할 때만 `npm run typecheck:vendor`를 사용한다.

### iCloud와 무관한 CI 이미지 승격 및 호스팅 경계

배포를 로컬 작업공간의 iCloud/FileProvider 상태에 의존시키지 않는다. GitHub Actions의 `core-ci.yml`은 GitHub checkout에서 Core 소스·A2A·결정적 빌드·Docker 런타임 smoke를 확인하고, `publish-image.yml`은 사용자가 명시적으로 실행하거나 `vX.Y.Z` 태그를 push했을 때 같은 커밋을 다시 검증한 뒤 GHCR에 커밋 태그 이미지를 publish한다. 공개 저장소에서는 이미지 digest provenance를 GitHub artifact attestation으로 기록하고, GitHub Free/Pro/Team의 private 저장소에서는 공식 plan 제한으로 attestation을 만들 수 없으므로 release identity에 `private-repository-plan` 사유를 남긴다. 태그 이벤트에서는 `v`를 제거한 값과 `package.json` 버전이 다르면 publish를 차단한다. 이 경로에는 로컬 Finder, iCloud 다운로드, 별도 브라우저, 임의의 호스팅 제공자 URL이 없다.

이미지 publish는 “검증된 불변 산출물을 레지스트리에 보관”하는 단계일 뿐 “공개 HTTPS 서비스가 실행 중”이라는 뜻이 아니다. 실제 서비스 승격은 다음 독립 게이트를 추가로 요구한다.

immutable release identity artifact에는 CI가 만든 서버 bundle·build marker·client assets도 hidden 파일을 포함해 함께 보관한다.

1. 승인된 호스팅 대상과 자격증명을 확인하고, 이미지 digest를 정확히 지정한다. 현재 저장소에는 특정 호스팅 provider와 배포 자격증명이 고정되어 있지 않으므로 provider를 추측하거나 자동 배포하지 않는다.
2. `file-json-single-process` 저장소를 유지하는 동안에는 한 replica와 persistent writable volume을 사용한다. 수평 확장·무중단 재시작이 필요하면 transactional shared database와 durable queue/outbox로 바꾼 뒤 별도 Core 검증을 통과한다.
3. 호스팅된 origin에서 `/api/health`, `/tabs/home/`, 해시 자산을 확인하고 health의 `sourceCommit`·`serverBundleSha256`이 이미지 digest에서 파생된 release identity와 일치하는지 확인한다.
4. 그 다음에만 Teams Bot `messagingEndpoint`, 매니페스트 `TAB_DOMAIN`, Teams 포털 업데이트, 데스크톱·모바일 설치본을 같은 identity로 검증한다.

Dev Tunnel은 로컬 서비스의 개발·임시 테스트용 공개 경로로 분리한다. 안정 운영 endpoint로 승격하거나 CI 이미지 publish의 성공 증거로 재사용하지 않는다. 이미지 publish가 성공해도 호스팅·Teams 포털·설치본·UI 게이트가 남아 있으면 릴리스는 완료가 아니다.

클라이언트는 `dist/client`를 선삭제하지 않고 임시 디렉터리에서 성공적으로 만든 뒤 교체한다. CopilotKit v2 대형 번들에서 현재 Node 24 + esbuild API의 source map 생성이 무기한 대기하는 회귀가 있으므로 운영 빌드 source map은 끈다. 이 문제를 다시 만나도 제한시간 게이트가 공개 산출물을 비우지 않은 채 중단되어야 한다.
`release:preflight`는 `npm run test:server-build-determinism`을 포함한다. 이 검사는 동일한 pinned Git commit을 서로 다른 로컬 임시 경로에 두 번 materialize해 서버 `index.js` 바이트·SHA-256·marker가 모두 같은지 확인한다. 결정성이 깨지면 공개 서버의 기존 프로세스나 업로드 탭을 건드리지 않고 `BLOCKED`로 중단한다. 임시 절대 경로를 esbuild entry point로 전달하거나 서버 SHA 검사를 완화해 우회하지 않는다.
패키지 단계는 `check:deployment`·`validate:manifest`·ZIP 생성·결정성·원자 교체·timeout reaping 검사를 순차 실행하므로 단일 30초/60초 제한으로 감싸지 않는다. `packageGateTimeoutMs()`가 내부 네 단계의 bounded timeout과 정리 여유를 합산하고, 바깥 `release-loop`와 `release:update`가 그 값을 재사용한다. 하위 게이트가 반환한 `ETIMEDOUT`, `EPROCESSREAPTIMEOUT`, `ECOMMAND` 같은 원인 코드는 상위 상태에 그대로 보존한다.
`/api/health`가 200이어도 탭이 정상이라는 뜻은 아니다. 공개 프로세스 교체 직후에는 반드시 같은 origin에서 `/api/health` 200 → `/tabs/home/` 200 → HTML에 선언된 해시 자산 200을 연속 확인한다. health만 살아 있고 탭이 404이면 `TAB_RUNTIME_UNAVAILABLE`로 실패 처리하고, 이전 공개 프로세스를 유지한 채 산출물 경로·FileProvider 상태를 조사한다. Teams SDK 봇 분기에서도 개인 탭 HTTP 라우트가 항상 등록되어야 한다. `dist/client`가 `dist/client <n>`처럼 충돌 이름으로 바뀌었거나 원래 경로가 사라진 경우에는 빌드 성공으로 간주하지 않고, 새 `index.html`과 해시 자산을 확인한 뒤 3단계 HTTP probe를 재실행한다.

Core 서버 번들은 Teams SDK·Express 등 필수 런타임을 포함하고 CopilotKit/MCP는 선택 청크로 분리한다. 기본 `npm run build`는 `build:core`만 실행하고, 선택 provider는 `npm run build:all` 또는 명시적 optional 명령에서만 만든다. `npm run test:core`는 `scripts/core-runtime-smoke.mjs`로 API 키 없이 production Teams SDK 프로세스를 실제 기동해 `listen()`, `/api/health`, `/tabs/home/`을 확인한다. 이 스모크가 통과하지 않은 상태에서 기존 공개 서버나 포털 업로드를 최신 버전으로 교체하지 않는다.

기본 `npm test`/`npm run test:api-free`는 API 키 없이 완료되어야 하며, 장시간 대기하는 전체 `npm run typecheck`를 포함하지 않는다. 기본 runner는 제한된 `typecheck:core`와 core/API-free 기능 테스트를 사용한다. 전체 선언 그래프 진단이 필요할 때만 `npm run typecheck`를 별도 bounded 진단으로 실행하고, 그 프로세스가 정체되면 기본 릴리스 게이트를 막지 않은 채 `TYPECHECK_DIAGNOSTIC_BLOCKED`로 기록한다.

### 로컬 원본 소스 기준

- `/Users/doosansmacbookpro/Documents/TeamsApp`이 로컬 원본 소스이며 유일한 Git 이력 기준이다. 다른 폴더나 임시 경로를 원본·원격·복구 기준으로 추정하지 않는다.
- 현재 Git `origin`은 `https://github.com/devdoo-teams/teams-app.git`이다. Bitbucket은 선택적인 추가 remote일 뿐이며, 인증된 Bitbucket 화면에서 workspace·repository slug·visibility·clone URL을 확인하기 전에는 추론·추가하거나 절차의 전제로 두지 않는다. 이후 PR이 필요해지면 저장소 설정이 명시적으로 바뀌지 않은 한 현재 구성된 GitHub `origin` 워크플로우를 사용한다.
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
`dist` 자체가 `blocks=0`인 경우에는 `build:core`가 OS 안정 런타임 경로를 선택하고, `npm start`가 `scripts/start-server.mjs`로 그 동일 경로의 서버를 기동하게 한다. 클라이언트·서버 source materialize와 실행 의존성은 작업공간 바깥 OS 임시 경로에서 수행하고, `scripts/fileprovider-runtime-deps.mjs`가 준비한 로컬 dependency cache를 esbuild `nodePaths`와 서버 `node_modules` 링크에 명시적으로 사용한다. 테스트가 서버를 기동할 때도 `resolveRuntimeDistRoot()`의 동일한 검증 산출물을 사용하며 workspace `dist/server/index.js`를 직접 실행하지 않는다. 런타임 산출물은 재생성 가능한 파생 파일이며 원본 소스·Git 이력·Teams 업로드 ZIP의 기준이 아니다.

`typecheck:core`에서 정확히 legacy `The service was stopped` 시그니처가 나오면 새 CLI invocation 하나로만 재시도한다. 두 번째 실패나 timeout은 실제 게이트 실패로 기록한다. 기본 API-free 테스트에는 CopilotKit Channels shadow 같은 optional provider를 섞지 않고, 별도 명령에서만 실행한다.

매니페스트의 `developer.websiteUrl`·static-tab `websiteUrl`이 origin root를 가리키므로 공개 검증은 `/api/health`와 `/tabs/home/`뿐 아니라 `/`도 따라간다. `/`의 최종 URL은 canonical `/tabs/home/`와 같아야 하며, root 404는 `TAB_RUNTIME_UNAVAILABLE`이다.

FileProvider 다운로드를 기다리기 위해 Finder·새 브라우저 탭·새 로그인 세션을 만들지 않는다. 업로드는 원본에서 생성하고 SHA-256 및 내부 manifest를 확인한 최신 ZIP의 절대 경로를 직접 선택한다. 화면이 잠겨 파일 선택기가 열리지 않으면 `PORTAL_UPLOAD_UNVERIFIED`로 보류하고 잠금 해제 우회나 자격 증명 추측을 하지 않는다.

### 0.1 내부 릴리스 상태 머신

`release-loop`는 `release:update`가 호출하는 내부 상태 머신이다. 운영자나 하위 에이전트가
이 파일을 직접 실행하면 별도 상태 파일과 lock이 생겨 재시도 identity가 갈라질 수 있으므로,
외부 실행은 항상 `release:update`를 사용한다. `release-loop` 직접 실행은 의도적으로
`ERELEASEENTRYPOINT` blocker가 된다.

```bash
npm run release:update -- run --url https://<verified-public-origin>
npm run release:update -- status
# 포털/설치본/데스크톱/모바일을 실제로 확인한 뒤 surface별 evidence JSON 등록
npm run release:update -- browser --surface <portal|installed|desktop|mobile> --evidence <evidence.json>
npm run release:update -- reconcile --evidence <jira-reconciliation.json>
npm run release:update -- complete
```

이전 run이 커밋 변경으로 재개할 수 없는 상태라면 상태 파일을 삭제하거나 완료로 위장하지 않는다. 원인을 확인한 뒤 다음 명령으로 기존 run을 보존하면서 명시적으로 폐기하고 같은 상태 경로에서 새 run을 시작한다.

```bash
npm run release:update -- supersede --reason "source commit changed after the previous run"
npm run release:update -- start
```

`SUPERSEDED`는 완료·배포 성공·UI 검증을 의미하지 않으며, 새 run의 `machine → package → public → evidence → complete` 게이트를 다시 통과해야 한다.

상태는 `.release/update-current.json`에 저장되며 토큰·비밀번호·API key·원문 Teams 메시지는 저장하지 않는다. `start`, `package`, `complete`는 현재 Git 커밋과 clean worktree를 확인한다. clean 판정에서 추적 파일 수정은 차단하지만, 기존 사용자 소유 미추적 파일은 삭제하거나 원본으로 취급하지 않고 `untrackedAtStart`에 기록한 뒤 계속한다. 미추적 파일을 포함한 패키지·업로드 경로는 사용하지 않는다. macOS FileProvider 때문에 전체 `git status`가 시간 초과하면 HEAD tree와 index tree가 정확히 같고 미추적 목록을 별도로 읽은 경우에만 `sourceIoMode=index-tree-fileprovider-fallback`으로 제한 진행하며, 이 모드는 바이트 검증이 불가능했다는 사실을 상태에 남긴다. 두 tree가 다르면 계속하지 않는다. 이 fallback에서는 검증된 materialized 서버 `index.js`와 marker가 있으면 현재 Git HEAD의 `src/server`·`src/shared`를 OS 임시 경로에서 다시 materialize해 새 번들을 만들고, marker가 현재 HEAD와 같을 때만 기존 번들을 재사용한다. 클라이언트와 core source check는 같은 조건에서 Git HEAD의 `src/client`/검사 대상 소스를 OS 임시 경로로 materialize해 실행한다. `machine`, `package`, `public` 실패는 마지막 성공 상태를 보존하고 같은 명령으로 다시 실행할 수 있다. `complete`는 네 개 UI 증거가 모두 현재 커밋·버전·ZIP SHA와 일치할 때만 `READY`와 Teams 전송용 보고서를 출력한다.

### 0.2 반복 배포용 고정 실행기

같은 앱 ID의 업데이트를 반복할 때는 수동으로 `release-loop` 단계를 조합하지 말고
`release:update`를 재사용한다. 이 실행기는 `release-loop`의 단일 상태 파일을 기준으로
머신·패키지·공개 런타임을 제한 시간 안에 순서대로 실행하고, 중단되면 마지막 성공 단계에서
재개한다. 기본 상태 파일은 `.release/update-current.json`이며 토큰·비밀번호·MFA 값은 저장하지
않는다. 시작 시 기록한 미추적 파일은 `untrackedAtStart`로만 보존한다.

여기서 `run`은 자동 게이트(`machine → package → public`)를 뜻한다. 포털 업로드와
설치본·데스크톱·모바일 증거는 의도적으로 별도 handoff이며, `run`의 성공 출력만으로
Teams 배포 완료를 보고하지 않는다. 실패 JSON에는 run ID·상태 경로·다음 게이트·identity·
시도 횟수·마지막 활동 시각·현재 runner PID가 남으므로 같은 phase를 안전하게 재시도한다.

#### 버전 증가 게이트

새 릴리스의 `start`는 현재 `appPackage/manifest.json` 버전과 직전 Git 커밋의
manifest 버전을 비교한다. 현재 버전이 같거나 낮으면 `EVERSIONNOTBUMPED`로 즉시
중단하며 ZIP·공개 프로세스·포털 업로드를 시작하지 않는다. 이 게이트는 과거처럼 서로
다른 커밋이 같은 Teams 앱 버전을 반복해서 배포하는 시행착오를 막는다.

세 버전 파일을 수동으로 각각 수정하지 않는다. `release:prepare`는 현재 세 파일이
서로 같은 stable `X.Y.Z`인지 먼저 검증한 뒤, 명시적으로 더 큰 버전 하나만 세 파일에
동시에 반영한다. `--dry-run`으로 먼저 확인할 수 있고, 이 명령은 커밋·패키징·업로드를
수행하지 않는다. 부분 쓰기 오류가 나면 이미 바뀐 파일을 원래 바이트로 되돌린다.

```bash
# 소스 수정·리뷰 후 명시적인 다음 버전을 한 번만 입력한다.
npm run release:prepare -- --version X.Y.Z --dry-run --json
npm run release:prepare -- --version X.Y.Z

# 변경된 버전 파일만 검토하고 커밋한다. 이 명령은 업로드하지 않는다.
git diff -- package.json package-lock.json appPackage/manifest.json
git diff --check
git commit -m "chore(release): bump Teams package to X.Y.Z"

# 이후부터는 이 한 명령만 반복한다. 실패하면 같은 명령을 다시 실행한다.
npm run release:update -- run --url https://<verified-public-origin>
```

`release:loop`를 직접 실행하거나 이전 ZIP을 지정해 재시도하지 않는다. 소스 커밋이
바뀌었으면 기존 run을 `supersede --reason`으로 보존한 뒤, `release:prepare`로 새 버전
커밋을 만들고 새 identity를 시작한다. 버전 증가 오류는 코드 실패가 아니라 릴리스 입력
계약 위반이므로, 버전을 올린 커밋을 먼저 만들기 전에는 포털 단계로 진행하지 않는다.

```bash
# 새 릴리스 identity를 고정하고 기계 단계부터 다음 사용자 단계까지 실행
npm run release:update -- start
npm run release:update

# 재개할 때는 같은 명령을 반복한다. 시작 단계에서 현재 HEAD·추적 worktree·초기 미추적 파일
# baseline을 다시 확인하고, READY 단계도 ZIP·공개 identity를 재검증한다.
npm run release:update

# 기존 인앱 브라우저 탭에서 다음 표면을 수행하기 위한 handoff만 출력
npm run release:update -- browser --surface portal
npm run release:update -- browser --surface installed
npm run release:update -- browser --surface desktop
npm run release:update -- browser --surface mobile

# 부모 오케스트레이터가 같은 탭에서 캡처한 증거 JSON을 등록
npm run release:update -- browser --surface portal --evidence /absolute/path/portal.json
npm run release:update -- browser --surface installed --evidence /absolute/path/installed.json
npm run release:update -- browser --surface desktop --evidence /absolute/path/desktop.json
npm run release:update -- browser --surface mobile --evidence /absolute/path/mobile.json

# 실제 Jira 원격 read-back과 발견 항목 매핑을 확인한 뒤에만 최종화
npm run release:update -- reconcile --evidence /absolute/path/jira-reconciliation.json
npm run release:update -- complete
```

실행기는 다음을 자동으로 차단한다: 임의의 오래된 ZIP 경로, 이전 커밋의 공개 서버,
동일 앱 ID의 신규 업로드 경로, 다른 인앱 브라우저 탭, 탭·버전·패키지 SHA가 불일치한
증거, Jira 원격 read-back이 없는 완료, 열린 release blocker, MFA를 포함한 자격 증명 텍스트.
포털 증거에는 제출 결과와 원격 operation ID 또는 ID를 제공하지 않은 사유를 기록하고,
설치본 증거에는 전후 스크린샷·접근성 트리·런타임 로그와 동일 인앱 브라우저 탭 ID를
기록한다. 데스크톱 증거는 `verificationMode: "computer-use"`와 실제 Teams 앱 식별자
(기본 `com.microsoft.teams2`), 최신 AX 트리·스크린샷·런타임 결과를 기록하며 브라우저 탭
필드는 요구하지 않는다. 모바일 증거는 `verificationMode: "user-confirmed-mobile"`와
`userConfirmed: true`, 현재 사용자 스크린샷 및 설치 버전/런타임 identity를 요구하며,
브라우저 탭 필드 없이 등록한다. 모바일 권한·GPS는 사용자의 현재 증거 없이는 통과로
판정하지 않는다. `release:update`의 브라우저 명령은 화면을 자동 조작하지 않는 handoff이며,
부모 오케스트레이터가 이미 로그인된 인앱 브라우저 탭에서만 수행한다.

`status`는 현재 identity·다음 단계·마지막 활동 시각을 출력한다. 프로세스가 비정상 종료되어
오래된 lock 파일이 남아도 살아 있는 PID나 최근 lock은 보존하며, 죽은 PID의 충분히 오래된
lock만 한 번 회수한다. `SUPERSEDED`는 배포 성공이 아니므로 `start` 이후 모든 단계를 다시
실행해야 한다. 공개 health가 이전 커밋을 제공하면 실행기는 상세 blocker와 실제 source
commit을 남기고 포털 업로드를 진행하지 않는다.

`run`은 이미 `PUBLIC_READY` 같은 사용자 단계 handoff가 저장되어 있어도 먼저
`release-loop status`를 호출한다. 따라서 코드 커밋이 바뀌었거나 추적 worktree가 dirty인
상태에서 이전 ZIP·공개 서버·포털 작업을 조용히 재사용하지 않는다. 이 경우 기록된 상태를
보존한 채 `ESTALERELEASE`/정확한 blocker를 출력한다. 동일 checkout의 일시적 단계 실패만
같은 단계 재시도로 허용하며, 새 코드 릴리스는 명시적으로 `supersede --reason` 후 `start`해
새 run ID와 새 패키지 identity를 만든다.

외부 증거 파일은 임의의 이미지 한 장으로 통과할 수 없다. `release-loop`는 전·후 스크린샷, 접근성 증거, 런타임 로그, 현재 커밋/버전에 결합된 스코프 매트릭스 결과를 모두 요구한다. 아래는 `desktop`의 예시이며 실제 경로와 해시는 실행 결과로 채운다. 최종 `mobile` 증거만 전체 매트릭스를 사용한다.

`release:update browser --evidence`의 권위 형식은 브라우저 관찰과 `release-loop` full evidence를 한 파일에 분리해 담는 envelope이다. `attestation`에는 기존 인앱 브라우저 탭 ID·URL·제출 결과 같은 부모 오케스트레이터의 관찰만 넣고, `evidence`에는 아래 예시의 `surface`·커밋·버전·패키지 SHA·전/후 스크린샷·접근성·런타임·coverage matrix를 넣는다.

```json
{
  "attestation": {
    "surface": "portal",
    "runId": "<release run>",
    "appId": "<manifest app ID>",
    "version": "X.Y.Z",
    "packageSha256": "<package SHA-256>",
    "observedAt": "2026-08-09T12:00:00.000Z",
    "titleBefore": "<observed title before>",
    "titleAfter": "<observed title after>",
    "observedAction": "<actual user-visible action>",
    "observedResult": "<actual read-back result>",
    "tabIdBefore": "<real existing in-app browser tab ID>",
    "tabIdAfter": "<same real tab ID>",
    "urlBefore": "https://admin.teams.microsoft.com/<path>",
    "urlAfter": "https://admin.teams.microsoft.com/<path>",
    "submissionStatus": "<observed submission status>",
    "remoteOperationIdUnavailableReason": "<only when the UI exposes no operation ID>"
  },
  "evidence": {
    "surface": "portal",
    "observedAt": "2026-08-09T12:00:00.000Z",
    "commit": "<current full commit>",
    "version": "X.Y.Z",
    "packageSha256": "<package SHA-256>",
    "summary": "<actual evidence summary>",
    "screenshotBeforePath": "/absolute/path/before.png",
    "screenshotAfterPath": "/absolute/path/after.png",
    "accessibilityPath": "/absolute/path/after-ax.json",
    "runtimeLogPath": "/absolute/path/runtime.log",
    "coverage": { "scope": "portal", "matrixPath": "/absolute/path/matrix.json", "matrixSha256": "<sha256>", "commit": "<current full commit>", "version": "X.Y.Z", "totalRows": 1, "passedRows": 1, "notApplicableRows": 0, "blockedRows": 0, "unverifiedRows": 0 }
  }
}
```

`release-update` validates `attestation`, while the child `release-loop evidence` command unwraps and validates only `evidence`. An attestation-only file is rejected; it must not be upgraded into full evidence because that would fabricate missing screenshots, AX/runtime artifacts, or matrix coverage. Existing merged top-level evidence files remain accepted for compatibility, but new files should use the explicit envelope. The `full` value here means the UI coverage scope defined below; it is not an A2A protocol claim.

### A2A 계약과 release-loop 증거의 경계

`release-loop`의 `full` evidence는 Teams 포털/설치본/데스크톱/모바일 UI 증거의 coverage scope이며 A2A 상호운용성 판정이 아니다. A2A 계약은 별도의 서버·클라이언트 증거로 대조한다. [A2A 공식 Specification](https://a2a-protocol.org/latest/specification/) 기준으로 다음을 명시적으로 확인해야 한다.

- 핵심 작업은 `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`이며, 공식 method mapping은 JSON-RPC/gRPC의 해당 method와 REST의 `POST /message:send`, `GET /tasks/{id}`, `GET /tasks`, `POST /tasks/{id}:cancel`이다.
- 여러 protocol binding을 광고하는 Agent Card는 동일 기능 집합, 의미적으로 동등한 결과, 일관된 오류 처리, 동등한 인증 동작을 제공해야 한다. Agent Card의 `supportedInterfaces`, capabilities, skills, security 선언과 실제 endpoint가 일치해야 한다(functional equivalence).
- `GetTask`/`ListTasks` 같은 조회는 자연스럽게 idempotent이고, `SendMessage`는 `messageId`로 중복을 감지할 수 있으며, `CancelTask`는 반복 요청이 같은 효과를 내는 idempotent 동작이어야 한다. 이미 삭제된 task에 대한 중복 취소의 `TaskNotFoundError` 가능성은 공식 예외 의미로 기록한다.
- 현재 저장소의 A2A contract/fixture/localhost 검사는 위 method shape·lifecycle·idempotency의 로컬 증거일 뿐이다. 실제 공개 HTTPS endpoint에 대한 외부 Agent Card fetch, 인증된 `SendMessage → GetTask/ListTasks → CancelTask` 왕복, binding 간 functional equivalence, 외부 client interoperability는 아직 검증하지 않았으므로 `UNVERIFIED`/`BLOCKED`로 유지한다. `release-loop` UI evidence를 A2A PASS로 변환하지 않는다.

### UI evidence payload

```json
{
  "surface": "desktop",
  "observedAt": "2026-08-09T12:00:00.000Z",
  "commit": "<현재 커밋>",
  "version": "X.Y.Z",
  "packageSha256": "<release:package 결과>",
  "summary": "실제 배포 Teams 데스크톱에서 status 답장과 카드/탭을 확인함",
  "verificationMode": "computer-use",
  "applicationId": "com.microsoft.teams2",
  "screenshotBeforePath": "/absolute/path/teams-desktop-before.png",
  "screenshotAfterPath": "/absolute/path/teams-desktop-after.png",
  "accessibilityPath": "/absolute/path/teams-desktop-ax.json",
  "runtimeLogPath": "/absolute/path/teams-desktop-runtime.log",
  "coverage": {
    "scope": "desktop",
    "matrixPath": "/absolute/path/teams-ui-matrix.json",
    "matrixSha256": "<sha256>",
    "commit": "<현재 커밋>",
    "version": "X.Y.Z",
    "totalRows": 0,
    "passedRows": 0,
    "notApplicableRows": 0,
    "blockedRows": 0,
    "unverifiedRows": 0
  },
  "artifactPaths": ["/absolute/path/teams-desktop-after.png"]
}
```

`totalRows`는 0이 될 수 없고 `passedRows + notApplicableRows === totalRows`, `blockedRows === 0`, `unverifiedRows === 0`이어야 한다. `notApplicableRows`는 매트릭스 행의 명시적 `N/A` 수와 정확히 일치해야 한다. 매트릭스 파일 자체의 SHA-256, 행 ID·상태·릴리스 identity도 evidence 등록 시 다시 읽어 검증한다. 스코프 매트릭스는 해당 단계에 실제로 캡처한 행만 포함할 수 있지만 모든 포함 행에 기능·surface·location·branch·precondition·action·expected·전/후 스크린샷·접근성·런타임 증거가 있어야 한다. 마지막 `mobile`의 `scope=full`은 권위 매트릭스의 모든 coverage key를 포함해야 한다. 이 조건을 충족하지 못하면 해당 surface는 완료가 아니다.

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
    "scope": "installed",
    "matrixPath": "/absolute/path/teams-installed-matrix.json",
    "matrixSha256": "<sha256>",
    "commit": "<현재 커밋>",
    "version": "X.Y.Z",
    "totalRows": 0,
    "passedRows": 0,
    "notApplicableRows": 0,
    "blockedRows": 0,
    "unverifiedRows": 0
  },
  "artifactPaths": ["/absolute/path/teams-installed-after.png"]
}
```

`mobile` 증거에는 위 필드와 함께 `"verificationMode": "user-confirmed-mobile"`와 사용자가
실제 배포 앱에서 직접 확인했다는 `"userConfirmed": true`가 필요하다. 사용자가 확인하지
않은 모바일 화면, 이전 버전 채팅, API 테스트 출력은 이 값을 대신할 수 없다. 데스크톱/모바일
증거에는 인앱 브라우저 탭 ID를 억지로 넣지 않는다.

관리자 센터의 게시 버전이나 채팅 응답만으로 `installedVersion`을 추정해서는 안 된다.

### 1. 구현과 로컬 검증

- 사용자의 요청사항을 코드·매니페스트·문서에 반영한다.
- 로컬 테스트 모드에서 `npm test`와 변경 범위에 맞는 런타임 검증을 실행한다.
- 로컬 테스트 모드의 결과는 개발 증거일 뿐 공개 운영 증거로 보고하지 않는다.
- macOS FileProvider/iCloud에서 `blocks=0`, 읽기 지연, esbuild `The service was stopped`, 무출력 장기 대기가 관찰되면 `SOURCE_IO_UNSTABLE`로 기록한다. 테스트를 병렬로 재시도하지 말고 `TEAMS_FILEPROVIDER_SERVER_REUSE=1` fallback을 사용해 한 프로세스씩 순차 검증한다.
- FileProvider fallback은 Git `HEAD`를 임시 로컬 디렉터리에 materialize할 수 있으므로, 추적 worktree 변경이 있는 상태에서는 빌드·패키지를 실행하지 않는다. 변경을 먼저 커밋하고 현재 HEAD를 기준으로 다시 빌드한다. clean 확인 자체가 timeout이면 소스 I/O blocker로 중단한다.
- 서버 bundle marker는 단순 커밋 문자열이 아니다. schema, full commit, `mode=core|optional`, `worktree=clean`이 현재 빌드와 일치할 때만 재사용하며, 이전 형식·dirty·불명확 marker는 무효로 처리한다.
- `npm run test:server-build-determinism`은 FileProvider fallback의 반복 빌드를 고정하는 회귀 게이트다. 두 결과의 `index.js` 바이트가 다르면 `SOURCE_IO_BLOCKED`/결정성 blocker로 기록하고, 임시 산출물·이전 공개 bundle을 릴리스 identity로 재사용하지 않는다.
- 모든 `npm`/`tsx`/`tsc`/esbuild 장기 단계에는 timeout을 둔다. 기본 API-free runner는 `TEAMS_TEST_TIMEOUT_MS`(기본 120초)를 사용하고, timeout 시 PID·마지막 로그·health를 남긴다. `The service was stopped`가 반복되면 원인 분리 없이 재시도하지 않는다.

### 2. 새 버전과 패키지

- 실제 사용자 기능 추가 또는 재현된 버그 수정이 있는 경우에만 Teams 앱 버전을 올린다. 읽기 전용 감사·코드 리뷰·문서·증거 갱신·릴리스 상태 bookkeeping·실패한 재시도만으로는 버전을 올리거나 새 ZIP을 만들지 않는다. 버그 수정 버전은 재현/회귀 테스트, 구현 테스트, 해당 Core 검증이 모두 통과한 뒤에만 만든다.
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
- 포털 화면의 게시 표시만으로 설치/등록을 통과 처리하지 않는다. `release:update browser --surface portal --evidence ...`는 같은 앱 ID를 `teams app get --json`으로 읽고, 등록 ZIP을 `teams app package download`로 내려 받아 앱 ID·버전·현재 `/api/messages` endpoint·ZIP SHA-256을 현재 release identity와 대조한다. 등록 패키지가 이전 버전이면 `ETEAMSREGISTRATIONMISMATCH`로 포털 증거를 차단한다. 회귀 검사는 `npm run test:teams-registration`이다.
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
- Teams WebView에서는 브라우저 `window.confirm`/`window.prompt`를 삭제·승인·취소 확인 수단으로 사용하지 않는다. 확인이 필요한 mutation은 인라인 확인/취소 컨트롤로 제공하고, 확인 상태 렌더링과 실제 서버 결과를 별도 증거로 남긴다.

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
- 발견된 모든 버그·릴리스 blocker·검증 가능한 개선의 Jira key/URL 대조 완료
- 현재 릴리스 blocker Jira 이슈가 모두 같은 릴리스 증거로 `Done`; 후속 비차단 개선은
  상태·담당자·보류 사유가 명시됨

완료 메시지에는 최소한 다음을 적는다.

- 앱 버전과 커밋 SHA
- 패키지 검증·업로드 결과와 ZIP SHA-256
- 공개 URL health의 `auth`·`bot`·`outbound` 값
- 실행한 테스트와 Teams 런타임 증거
- 사용자 메시지 원문 요약과 배포 앱 답장/스크린샷 또는 사용자의 확인 보고
- Teams 데스크톱 앱 독립 스크린샷·접근성 검증 결과 및 `MOBILE_UNVERIFIED` 여부
- 실사용 UI 전수 검증 매트릭스의 경로별 스크린샷·접근성·런타임 증거와 미통과 분기
- 모바일에서 사용자가 이어서 확인할 단계
- 이번 릴리스에서 생성·갱신·완료한 Jira 이슈 링크와 후속 Improvement 상태

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
