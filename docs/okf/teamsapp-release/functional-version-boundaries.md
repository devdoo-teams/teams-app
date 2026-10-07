---
type: "Concept"
sources:
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package"
    title: "Teams app package"
    location: "Teams doesn't host your app / App manifest; observed lines31–53 on2026-10-07; last updated2026-05-08; HTML lines may change"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/action-commands/define-action-command"
    title: "Define message extension action commands"
    location: "Select action command invoke locations; observed lines43–64 on2026-10-07; HTML lines may change"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/action-commands/respond-to-task-module-submit"
    title: "Respond to message extension action commands"
    location: "Response table and submitAction invoke / Teams SDK example; observed lines53–59,88–95,109–127 on2026-10-07; HTML lines may change"
  - resource: "https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference"
    title: "Types of cards"
    location: "Support for Adaptive Cards; canonical en-us observed lines146–152 on2026-10-07; HTML lines may change"
  - resource: "https://cli.github.com/manual/gh_run_list"
    title: "GitHub CLI gh run list"
    location: "Options --commit, --json, --repo; observed lines551–560,573–574 on2026-10-07; no stable page update date exposed"
  - resource: "https://git-scm.com/docs/git-ls-remote"
    title: "git-ls-remote"
    location: "DESCRIPTION / OPTIONS --exit-code; observed current documentation on2026-10-07"
generated: { by: "process:codex", at: "2026-10-07T09:15:27Z" }
verified: { by: "process:retained-zip-current-health-assets-focused-regressions-remote-readback", at: "2026-10-07T09:15:27Z" }
status: "UNVERIFIED"
stale_after: "2026-10-14T09:12:00Z"
---

# 업무 허브103→111: 기능별 독립 판정

## 판정

103과111은 버전 문자열만 다른 패키지가 아니다. 실제 보존 ZIP의103에는 `composeExtensions`가 없고111에는 메시지 메뉴의 `delegateMessage`가 있다. 반면 앱 ID, 탭 URL, 봇 ID·scope·명령, SSO resource, validDomains, devicePermissions, resource-specific permissions 선언은 같다. 호스트가 같은103 탭·봇도 현재111 서버의 코드를 사용할 수 있다. 따라서 About의 과거103 표시만으로 현재 탭·봇 기능 전체를 차단하거나, 반대로 탭111만으로 메시지 메뉴 능력을 증명하지 않는다.

2026-10-07 부모가 확인한 웹·모바일 런타임111 증거와 실제 Graph 개인 설치 정의111을 반영한다. 과거 About103와 메뉴 누락은 **HISTORICAL ONLY**이며 현재 상태는 미재검증이다. 이 감사는 사용자 브라우저를 제어하지 않았다.

## OFFICIAL CONTRACT

Microsoft의 [앱 패키지 계약](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package)은 설치 패키지의 매니페스트·아이콘과 HTTPS로 호스팅되는 앱 로직을 분리한다. 매니페스트가 탭·봇·메시지 확장 능력을 선언한다.

[메시지 액션 계약](https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/action-commands/define-action-command#select-action-command-invoke-locations)에서 `context: message`는 기존 메시지의 더보기 메뉴를 뜻한다. 조직 앱의 액션은 기본 더보기 목록에 바로 보이지 않을 수 있어 **More actions**까지 확인해야 한다. 이를 확인하기 전 단순 메뉴 첫 화면 부재로 실패 판정하지 않는다.

[submitAction 계약](https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/action-commands/respond-to-task-module-submit)은 메시지 컨텍스트에서 다음 dialog 응답을 허용하고 `message.ext.submit` SDK 이벤트와 `commandContext`·`data`를 문서화한다. Core는 개인 작업 제출 결과를 원래 대화에 삽입하지 않고 다음 dialog로 반환한다. [canonical 카드 계약](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference#support-for-adaptive-cards)은 bot·action extension·dialog 및 모바일1.6 지원과 action style 제한을 명시한다. 실제 호스트 동작은 별도로 시험한다.

## OBSERVED EVIDENCE: 패키지·런타임·원격

| 항목 |103 보존 ZIP|111 보존 ZIP / 현재 관찰|
|---|---|---|
| ZIP SHA-256 |`a7f06330ebe6f0306211402a78a4aea44da9dc9bb53ac0b6143e6d09c298e814`|`3f15d9eb323a0602309a8c603474b6a5fe96c192ddedee84d8b8d3f164bc6d14`|
| 앱 ID |`e915b402-eed4-4ee2-ba1f-c31d75c870a5`|동일|
| staticTabs·봇 ID·scope·명령 |기존 개인 탭 / 개인·팀·그룹 봇|동일, scope 배열 순서는 의미 차이가 아님|
| 메시지 확장 |선언 없음|`delegateMessage`, action / message / fetchTask|
| SSO·도메인 |기존 botid resource / 공개 Dev Tunnel / token.botframework.com|동일|
| devicePermissions·authorization |선언 없음|선언 없음, 추가 권한 선언 없음|
| calling / video |명시적 false|필드 생략; 전화·영상 지원을 추가 선언하지 않음|
| 공개 health |이전 패키지는 서버 구현을 담지 않음|09:03:52Z:111 / `ad1e78f7713ed4da5e741e038ba88c18cfe7ad79`|
| 인증·outbound |별도 런타임 증거 필요|teams-authenticated / entra-sso / teams-sdk / teams-sdk|
| 공개 클라이언트 자산 |현재 같은 URL로 호스팅 가능|09:09:23Z: SHA `cac8400394a3e5052cef4687046423ce9e04e882370d91efb82d7d85aeec8345`, 준비111 자산과 일치|
| Graph 개인 설치 정의 |과거 About와 독립|04:04:50Z 실제 GET200, organization catalog / published111|
| GitHub main |업로드와 독립|09:03Z 실제 ls-remote=`9a08e7c166368013080df062eef76a1004b4dc51`; 해당 커밋 CI success|

`manifestVersion:1.25`는 앱의111 버전과 별도다. 이름·개발자의 기존 MVP 문구는 실제 메타데이터에 남아 있지만 기능 수정이나103의 증거로 취급하지 않는다. 서버에서 업로드 ZIP 자체를 다시 다운로드한 암호학적 증거는 없다. 패키지 SHA 연결은 보존 업로드 영수증과 실제 게시/설치 메타데이터에 한정한다.

## OBSERVED EVIDENCE: 소스 차이와 기능 상태

마지막 main의103 선언 소스 `d823b853c9b4ff9a11ee94ed84dd53dfc78232f5`와111 배포 소스 `ad1e78f`를 대조했다. 이는 추적 Git 소스의 차이이며 과거 사용자의 모든103 화면이 어떤 서버 커밋을 사용했는지 증명하지 않는다. 역사적 release baseline `71df02e`와의 비교도 별도 보존했다.

| 기능 | 소스 변화 / 현재 확인 | 남은 실제 UI 시험 |
|---|---|---|
| 탭 작업 |기존 submit·status·lifecycle 유지; notify 선택과 pending projection 추가. 탭 HTTP200, API 인증 없는 GET401. 같은111 합성 작업 완료·상세·답변의 이전 웹 증거 있음|입력·모델 선택·제출·새로고침·상세 선택·추가 입력·재시도·중복 클릭·오류 분기|
| 사용자에게 공개하는 대화 상세 |기존 bounded owner 조회에 deep link·receipt·pending 표시 통합. 부모 chain·누락·마스킹·마지막 선택 경쟁 회귀 통과|현재 상세 링크, 누락 이력, 오류·경계값의 전후 화면|
| 개인 알림 |검증된 개인 Bot reference와 durable outbox/receipt 추가. explicit false·재시작·모호한 수락·미결 transport 회귀 통과|탭 opt-in 작업의 실제 개인 채팅 수신. A2A completion receipt는 이 broker 시험의 대체물이 아님|
| 카드 페이지 |같은 activity의 요약·진행·대화·결과·refresh 추가; 기본Submit. owner/activity binding·읽기 비변경·잘못된 키·만료·중복전송 회귀 통과|각 버튼 실행 전 카드와 실제 같은 메시지의 업데이트 후 화면·서버 결과|
| 승인함 |최근20개와 분리된 owner pending 목록 및 불변 revision projection 추가; 기존 approve/cancel 경로 유지|20개 밖 pending 선택, 두 단계 승인·확인 취소·실행 결과, 다른 표면에서 처리된 항목 제거|
| 실행 receipt |선택값과 worker 관찰값을 분리하고 탭·대화·카드 표시 수렴. 관측 없음을 명시하고 Codex 계정 잔여량 제공 없음 유지|같은 실제 작업의 각 표면 값을 대조. 미수집 응답ID·전송값을 성공으로 만들지 않음|
| 메시지 메뉴 |103에는 없던 선언과 SDK `message.ext.open`/`message.ext.submit` 연결 추가. 검토 token·권한·모델·읽기 제출·쓰기 승인 대기·단일 제출 fixture 통과|현재 More actions→delegateMessage→검토 dialog→개인 작업→상세 링크 전체 왕복|

내부 소스 위치: `src/client/OrchestrationPanel.tsx:308,419,448,488,539`; `src/client/job-deep-link.ts:1`; `src/client/job-conversation.ts:43`; `src/server/core-message-extension.ts:35,79`; `src/server/index.ts:4294,4710`; `src/server/personal-notification.ts:31`; `src/server/core-job-card-pages.ts:90,116`; `src/server/personal-approval-projection.ts:5`; `src/shared/receipt-presentation.ts:10`.

## FIXTURE / 실패 원문 / 동일 계약 GREEN

설치 도구: Node24.13.1, npm11.8.0, Git2.54.0(Apple Git-157), gh2.87.2. 설치 help에서 `git ls-remote --exit-code`, `gh run list --commit --json -R`를 확인했고 현재 공식 문서와 대조했다. 설치 Teams SDK2.0.15의 invoke routes가 fetchTask→message.ext.open, submitAction→message.ext.submit임을 실제 읽었다.

재현 명령:

```sh
node /tmp/teams-catalog-update-20261006/functional-audit-runner-20261007.mjs
node /tmp/teams-catalog-update-20261006/functional-audit-runner-20261007.mjs core-orchestration-route-test.ts
git ls-remote --exit-code origin refs/heads/main
gh run list -R devdoo-teams/teams-app --commit 9a08e7c166368013080df062eef76a1004b4dc51 --limit 5 --json databaseId,headSha,conclusion,status,url
curl --connect-timeout 5 --max-time 15 -fsS https://dxshc7dx-3978.jpe1.devtunnels.ms/api/health
```

* 첫 순차 검사에서11개PASS 뒤 route fixture가 `EPERM / syscall:listen / address:127.0.0.1`로 중단됐다. 제품 RED가 아니라 sandbox 실행 경계다. 원문을 보존하고 그 시험부터 남은9개만 호스트의 bounded loopback fixture에서 실행해 PASS했다.
* 각 시험 timeout60초, 절반 checkpoint30초, 종료 시 receipt/로그를 남겼다. 전체20개 고유 기능 회귀검사 PASS. pinned Git materialization은 clean HEAD `9a08e7c`를 사용했다. 해당 커밋의 앱 소스·manifest·package는 배포 `ad1e78f`와 동일하며 차이는 기존 시험 수정뿐이다.
* 샌드박스 curl DNS 실패 뒤 동일 공개 URL의 승인된 read-only 호스트 호출에서 health200을 얻었다. DNS 실패를 공개 서비스 장애로 보고하지 않는다.
* 실제 제품 RED가 재현되지 않아 앱 코드·버전·ZIP·공개 프로세스를 변경하지 않았다. 이 감사로 UI 미시험 항목이 해결됐다고 주장하지 않는다.

## LIVE RESULT / 다음 게이트

현재 공개111 서버PID53118, tunnelPID52764는 보존했다. 09:03Z 관찰에서 각각 elapsed 약10h07m·17h05m, health authenticated111, nextAction 기존 프로세스 유지·기능별 UI 시험. 이는24/7 운영 증거가 아니다.

웹은 사용자 제어 상태다. 현재 명시적 반환을 관찰하기 전 브라우저 제어·reload·새 탭·재로그인을 하지 않는다. 네이티브 desktop은 별도로15:15KST의 `Sky Computer Use native pipe startup failed` 때문에 AX·스크린샷이 없으며, 원인이 아직 미확정이다. 이를 웹 전체 불능으로 확대하지 않는다. 현재 모바일 runtime111 스크린샷은 모바일의 개별 카드·승인·메뉴 분기 통과를 뜻하지 않는다.

요청된7개 기능의37개 검증 위치,15개 필수 상태를 desktop/web/iOS별로 구분한 새 실행 큐는1665개 행이며 모두현재 해당 분기 미실행의 `BLOCKED`다. 각 행에 전후 스크린샷·AX·runtimeEvidence·result 필드를 채웠다. 이전 대표 성공·fixture·runtime 카드로 이 행들을 PASS 처리하지 않았다. 해당 기능에 없는 상태는 실제 branch 조사 후 근거와 함께N/A로 바꾼다. 이 큐는 전체 앱의 완료 수락 매트릭스가 아니다.

브라우저 반환 뒤 기존 개인 합성 대화·동일111 identity에서 메뉴→dialog→읽기 제출/쓰기 승인 대기, 탭 opt-in 개인 알림, 카드 페이지, 승인함,receipt 각 표면을 순서대로 시험한다. 현재 승인 범위에서 가능한 분기를 수행하고 재현된 결함은 Jira에 먼저 연결한 뒤 RED→최소 수정→GREEN→같은 release identity의 배포/UI 재검증을 진행한다. 로그인·MFA는 사용자 단계이며 추가 권한·관리정책·삭제는 이 감사에 포함하지 않는다.

Jira: [MP-118](https://devdoo.atlassian.net/browse/MP-118) 설치·호스트 증거 및 미시험 게이트; MP-314–318 개인 알림, MP-321 카드 계약, MP-323–329 카드 페이지, MP-330–332 승인함, MP-333 receipt, MP-284 기존CI 수정, MP-95 A2A는 실제 전체 수락 전까지 완료 처리하지 않는다.

## 보존 증거

내부 evidence root `/tmp/teams-catalog-update-20261006/`:

* `111-vs103-manifest-diff-20261007.json` — actual old/new ZIP 전체 manifest와diff.
* `111-functional-feature-audit-combined-20261007.json` —20개PASS, 초기sandbox 실패, identity와manifest 체크.
* `111-feature-focused-regression-sandbox-20261007.json` / `111-feature-focused-regression-host-20261007.json` —실제 순차 결과·timeout monitor.
* `111-feature-audit-public-health-20261007.json` / `111-live-public-readonly-route-probe-20261007.json` / `111-hosted-assets-readback-20261007.json` —현재 read-back.
* `111-current-functional-ui-matrix-20261007.json` —현재 분기별 미시험 실행 큐.
* `111-graph-personal-installation-live-readback.json` / `111-about-package-metadata-audit-20261007.json` —실제 설치111 및 업로드 기록 대조.
* `111-live-synthetic-a2a-receipt.json`, 실제 전후스크린샷·AX —동일111의 이전 제한된 웹 합성 실행 증거.

원본103 ZIP는 `/tmp/teams-message-actions-20261006/portal-before-104.zip`다. 미추적 파일은 시작 목록 그대로 보존했다. source/manifest/package/runtime 변경 없는 읽기 전용 진단이므로 새 패키지 업로드 단계는 적용하지 않는다. `DESKTOP_READY`, `MOBILE_READY`, Jira Done, Teams 완료 메시지는 이 감사의 결과가 아니다.

Git 보존 관찰: worktree는 원본main 하나이고 stash는 없다. 시작부터 있던 `codex/teams-mobile-genui`(2537a1d/1.0.62)는 현재main의 ancestor가 아니며 main에 포함되지 않은184개 commit이 있다. 이 head에 대한 실제GitHub PR조회는 빈 목록이었다. 내용을 폐기할 근거나 브랜치 정리 지시가 없으므로 삭제·병합하지 않는다. 다음 전체 릴리스의 Git 단순성 판정은 별도 조정이 필요하며 이 문서 동기화를 전체 릴리스 게이트 통과로 주장하지 않는다.
