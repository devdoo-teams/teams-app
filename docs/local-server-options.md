---
type: concept
sources:
  - url: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
    title: Quick Tunnels
    section: "Overview, usage and limitations; observed lines 92-154, updated 2026-09-30"
  - url: https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/
    title: Create a locally-managed tunnel
    section: "Prerequisites and steps 2-6; observed lines 98-213, updated 2026-09-11"
  - url: https://developers.cloudflare.com/network/websockets/
    title: WebSockets
    section: "Cloudflare edge support and connection lifecycle; HTML line positions are not stable"
  - url: https://ngrok.com/docs/pricing-limits/free-plan-limits
    title: Free Plan Limits
    section: "Quotas, assigned development domain and browser interstitial; observed lines 29-115; no page update date displayed"
  - url: https://ngrok.com/docs/http
    title: HTTP/S Agent Endpoints
    section: "CLI HTTP endpoint and explicit --url; observed lines 170-197; no page update date displayed"
  - url: https://ngrok.com/docs/using-ngrok-with/websockets
    title: Using ngrok with WebSockets
    section: "Requirements and WebSocket upgrade; observed lines 206-219; no page update date displayed"
  - url: https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/tab-requirements
    title: Prerequisites for Teams tabs
    section: "HTTPS, frame policy and validDomains; observed lines 31-71, updated 2025-02-06"
  - url: https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-register-aad
    title: Register your tab app with Microsoft Entra ID
    section: "Redirect URI note and Application ID URI; observed lines 100 and 161-176"
  - url: https://api.github.com/repos/cloudflare/cloudflared/releases/latest
    title: Official cloudflared release metadata
    section: "Resolved 2026.10.0; published 2026-10-05; Darwin arm64 asset digest and size read back"
  - url: https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.0/LICENSE
    title: cloudflared 2026.10.0 license
    section: "Apache License 2.0; observed lines 0-2"
  - url: https://raw.githubusercontent.com/nodejs/node/v24.13.1/doc/api/child_process.md
    title: Node 24.13.1 child_process contract
    section: "execFile timeout/killSignal and subprocess.kill; a signal does not prove termination; descendants require separate handling"
generated: 2026-10-15
verified: 2026-10-15
status: LOCAL_VERIFIED_EXTERNAL_UNVERIFIED
stale_after: 2026-10-22
---

# 로컬 서버·터널 선택

## 범위

기존 Core 실행과 공개 URL 해석을 유지하면서 운영자가 서버와 터널을 독립적으로 선택하는 **계획·로컬 점검 도구**다. `npm start`, `.env.runtime`, 기존 DevTunnel, Teams 앱과 Entra 등록은 그대로 사용한다. 서버 시작·종료, 외부 터널 생성·연결, 계정 생성, 토큰 입력, DNS·Bot·SSO·매니페스트 변경은 이 CLI가 수행하지 않는다.

`plan`과 `check`는 `.env.runtime`을 읽지 않는다. 선택한 JSON 설정만 사용한다. `TAB_DOMAIN` 등 환경변수의 기존 릴리스 해석 순서는 바뀌지 않는다.

## 사용

```bash
# 기존 3978 서버 + DevTunnel이 기본값
npm run local:server:plan
npm run local:server:check

# 개별 선택 예시
npm run local:server:plan -- --config examples/local-server/node.json
npm run local:server:plan -- --config examples/local-server/cloudflare-quick.json
npm run local:server:plan -- --config examples/local-server/cloudflare-named.json
npm run local:server:plan -- --config examples/local-server/ngrok.json
npm run local:server:plan -- --config examples/local-server/docker.json
npm run test:local-exposure
```

예제의 Cloudflare/ngrok 호스트명·터널명·파일 경로와 Docker digest는 **합성 입력**이다. 실제 계정에 할당된 값이나 준비된 이미지라는 뜻이 아니다. `plan`은 실행 파일·인수·환경변수를 분리해 보여 주며 shell 문자열을 실행하지 않는다.

`check` 종료 코드는 `0=로컬 점검 통과`, `1=입력 오류`, `2=도구 또는 로컬 health 차단`이다. CLI 버전과 literal loopback의 `/api/health`만 읽는다. 각각 조회 한도는 2초다. CLI는 timeout 뒤 소유 프로세스 그룹에 TERM을 보내고 100ms 뒤 KILL, 최대 1초의 종료 확인을 더한다. 종료 실패는 `EPROCESSREAPTIMEOUT`으로 차단한다. health 본문은 64 KiB로 제한하고 외부 redirect를 추적하지 않는다. HTTP 200이어도 올바른 버전·full SHA가 없으면 `identity-unverified`다. 임의 응답 본문과 CLI 출력은 내보내지 않고 허용된 버전/SHA만 반환한다. 설치된 CLI의 버전 조회는 해당 도구의 정상 metadata 서비스/cache를 사용할 수 있다. 공개 앱 URL은 조회하지 않는다. 통과해도 runtime 인증·탭 자산·외부 인증·HTTP·WebSocket·SSE·Teams 설치·실기기 결과는 `unverified`다.

## 서버 선택

| 선택 | 계획 | 필요한 실제 확인 |
| --- | --- | --- |
| `existing` | 프로세스 실행 없이 지정 loopback 확인 | 기존 PID·릴리스·포트·사용자 작업을 보존 |
| `node` | 기존 `npm start`, 명시적 `PORT`, `TEAMS_BIND_HOST=127.0.0.1` | Core 빌드, 기존 runtime 환경, 시작 전 빈 포트 확인. 기본 인증을 해제하지 않음. 현재 Node bind 계약에 맞춰 IPv4 literal만 허용 |
| `docker` | 준비된 digest 이미지의 `docker run --pull=never` 계획 | Docker 설치, 로컬 이미지, container용 auth·저장소 경로·worker 구성 검토 필요. host의 경로를 자동 마운트하거나 기존 데이터를 복제하지 않음 |

Docker 계획은 loopback 포트만 publish한다. `.env.runtime`과 이미지의 환경이 호환되는지, durable store와 CLI worker가 실제로 연결되는지는 별도 게이트다. 이 도구는 Docker 준비·운영 통과를 주장하지 않는다.

## OFFICIAL CONTRACT — 터널 비교

2026-10-15 공식 문서 확인. 아래는 서비스 계약과 미검증 항목을 구분한다.

| 공급자 | 안정 URL·계정 | HTTP / WebSocket / SSE | 제한·Teams 영향 |
| --- | --- | --- | --- |
| 기존 DevTunnel | 기존 ID·포트·ACL 유지 | 기존 HTTP 경로 사용. 새 WS/SSE 시험은 미실행 | 기존 quota를 다른 계정으로 우회하지 않음. 현재 공개 차단은 로컬 health 통과로 해소되지 않음 |
| Cloudflare Quick | 계정·도메인 없이 임시 URL. 재시작 시 호스트 변경 | HTTP, Cloudflare의 WS 지원 계약. **Quick SSE 미지원** | 200 동시 요청, SLA 없음. 합성 실험 선택지이며 고정 Teams/SSO 본 경로로 판정하지 않음 |
| Cloudflare named | 기존 Cloudflare 계정·소유 도메인·터널·DNS·credentials 필요 | HTTP와 WS 계약. 이 경로의 SSE는 **UNVERIFIED** | 고정 호스트 후보. config ingress의 실제 목적지와 계정별 비용·한도 확인 전 준비 완료 아님 |
| ngrok HTTP | 계정·authtoken, 무료 계정에 배정된 개발 도메인 | HTTP/WS 계약. SSE는 **UNVERIFIED** | 무료: 월 outbound 1 GB·HTTP 20,000건, 개발 도메인 1개. HTML 경고 화면이 Teams iframe을 막는지 실제 시험 필요 |

근거: [Quick](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [named](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/), [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/), [ngrok 한도](https://ngrok.com/docs/pricing-limits/free-plan-limits), [ngrok HTTP](https://ngrok.com/docs/http), [ngrok WebSockets](https://ngrok.com/docs/using-ngrok-with/websockets).

Cloudflare는 장기 WS 연결이 인프라 재시작 때 끊길 수 있다고 명시한다. ngrok 무료의 HTML 경고를 API 호출 성공으로 통과시키거나 Teams에 임의 header/UA 주입을 가정하지 않는다. 새 Access 로그인·이메일 PIN·TLS 우회·anonymous ACL은 계획에 추가하지 않는다.

## Teams·Bot·Entra 정합

[Teams 탭 계약](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/tab-requirements)은 HTTPS와 호스트 frame policy, `validDomains`를 요구한다. [Entra 탭 SSO 계약](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-register-aad)은 서비스 도메인과 Application ID URI 도메인의 일치를 요구하며, Bot+탭 앱은 `api://<fqdn>/botid-<bot-client-id>`를 사용한다. 순수 탭 SSO만을 위해 redirect URI가 필요한 것은 아니다. 현재 앱의 다른 로그인 흐름에 따른 redirect 변경 필요성을 따로 확인한다.

공개 origin이 명시되면 `teamsProposal`에 다음 **제안**이 출력된다. 등록이나 앱 패키지는 수정되지 않는다.

- `TAB_DOMAIN`, 탭 `contentUrl=/tabs/home/`, website URL, 필요한 `validDomains` 항목
- 이 저장소의 Bot 경로 `<origin>/api/messages`
- 기존 Bot client ID를 유지한 Application ID URI template
- 기존 auth flow의 redirect 검토

기존 `validDomains` 전체를 이 제안 배열로 덮어쓰지 않는다. 다른 필수 도메인, 기존 app/Bot/client ID, 권한과 복구 경로를 유지하며 검증된 delta만 별도 적용한다.

## OBSERVED EVIDENCE / FIXTURE / LIVE RESULT

- 구현 경계: `scripts/local-exposure.mjs:61`의 JSON 입력, `:71`의 계획 생성, `:202`의 health probe, `:237`의 로컬 점검. `scripts/local-exposure-cli.mjs:18`은 `plan|check`만 받는다. `scripts/core-test-runner.mjs:30`이 회귀시험을 Core 목록에 등록한다.
- 합성 회귀시험: `scripts/local-exposure-test.mjs`. 정상 조합, 잘못된 origin·토큰 필드·argv, 미설치 도구, 변조된 계획, 4자리 CLI 버전, HTTP 성공·redirect·timeout·본문 초과·잘못된 JSON을 구분한다.
- 독립 Standards/Spec 리뷰가 지적한 CLI timeout을 SIGTERM 무시·stdout 유지 자손 fixture로 재현했다. 단순 `execFile(timeout)`에서 약 7초 지연 RED를 확인한 뒤 기존 `scripts/release-gate.mjs:323`의 그룹 종료 도구를 재사용했다. 조회 프로세스와 자손의 종료를 함께 검증한다. 기존 운영 프로세스를 종료하지 않는다.
- 실제 Mac 관찰: Node 24.13.1, npm 11.8.0, DevTunnel CLI `1.0.2014+3c9645ccd8`. 설치 help의 `devtunnel host [<tunnel-id>]`와 생성 인수가 일치한다. ngrok·Docker는 미설치이므로 설치 help·실제 실행은 **UNVERIFIED**다.
- Cloudflare CLI `2026.10.0`을 OS 임시 경로에만 materialize해 버전·`tunnel --help`·`tunnel run --help`를 직접 실행했다. 공식 Darwin arm64 archive SHA-256은 `a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70`, 실행 파일은 `72edfd3eea463aef4d5cb89e2e209cecb048cc756c2b01915de2e0ad7cb39830`로 일치했다. 생성 계획의 `--url`, `--config`, `run` 계약을 확인했다. 라이선스는 Apache 2.0이다. 시스템 설치·PATH 변경·로그인·터널 연결·service 등록은 하지 않았다.
- 생성된 Node `npm start` 계획을 기존 검증된 Core 1.0.154/`ea17384ef2202f5fa8122394d146108ded4a81a7` 번들, 별도 loopback 포트, 빈 합성 저장소에서 실행했다. health identity·탭 HTML·JS 200, loopback bind, 시험 종료 후 포트 닫힘을 확인했다. 이 번들을 새 ops 변경 커밋에서 재빌드했다고 주장하지 않는다.
- safe-local은 기존 계약(`src/server/index.ts:1620`)에 따라 무인증 health를 401로 차단한다. fixture 토큰으로만 health를 확인했으며 CLI는 토큰을 받거나 자동 추측하지 않는다. 최초 fixture의 토큰 누락 및 Python 3.9의 308 redirect 처리 실패 기록을 보존하고, 계약에 맞춘 최종 시험을 별도 PASS로 기록했다. 이를 제품 결함 수정으로 보고하지 않는다.
- 외부 공급자 연결, 실제 Teams Web/Desktop/iPhone, native foreground/팝업, 변경된 도메인의 Bot/SSO는 **UNVERIFIED**다. 합성 HTTP 시험은 이를 증명하지 않는다.

## 외부 연결을 진행할 때

고정 Teams 후보는 기존에 소유·승인된 도메인이 있다면 Cloudflare named를 우선 검토하고, 계정에 배정된 ngrok 도메인을 대안으로 검토한다. 이는 현재 준비된 서비스라는 뜻이 아니다. Quick은 별도 포트의 합성 서버 실험용이다.

실행 전에 정확한 공급자·계정/도메인·로컬 포트·전송 데이터·기존 복구 경로를 제시한다. 새 credentials·지속 접근·보안 설정·추가 비용·외부 데이터 전송·Bot/Entra/패키지 도메인 변경이 필요한 단계는 사용자가 승인한 구체적 범위에서만 진행한다. 설치 후 해당 CLI의 `--version`/`--help`를 공식 계약과 대조한다. 계정 또는 quota 우회용 추가 계정·터널을 만들지 않는다.

승인된 경로는 합성 HTTP → 외부 HTTP/탭 자산 → WS/SSE 지원 여부 → Bot/SSO 정합 → 같은 ZIP·설치 버전 → Teams Web/Desktop/iPhone 증거 순으로 검증한다. 운영 3978의 서버/터널 교체는 이 로컬 계획·점검과 별도다.

## 실행·복구 계획

1. 선택된 계정·할당/소유 호스트명, 설치 CLI 버전·해시, 전송 데이터와 비용을 read-back한다. 새 계정·credentials·DNS·지속 service는 자동 생성하지 않는다.
2. 비어 있는 별도 loopback 포트와 빈 합성 저장소를 사용한다. safe-local 인증 우회를 공개 터널에 연결하지 않는다. 첫 외부 시험은 비밀·사용자 데이터가 전혀 없는 별도 HTTP fixture만 대상으로 한다.
3. 터널/fixture의 소유 PID·시작 시각·제한시간·로그 경로를 실행 receipt에 기록한다. 임시 Cloudflare 시험은 설치 help가 확인한 `--no-autoupdate`를 사용해 검증한 실행 파일을 유지한다.
4. 실패·시간 초과·사용자 중단 시 이번 시험이 만든 PID만 정상 종료하고 종료/포트 닫힘을 확인한다. 기존 3978 서버·DevTunnel·앱·Entra·개인 저장소와 이전 정상 산출물은 복구 기준으로 유지한다.
5. 실제 운영 경로 전환은 별도 승인된 도메인 delta와 canonical `release:update` run에서 수행한다. 이 ops 구현만으로 진행 중인 154 run을 supersede하거나 패키지·태그를 새로 발행하지 않는다.
