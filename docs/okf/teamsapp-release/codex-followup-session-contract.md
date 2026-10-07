---
type: "Concept"
sources:
  - resource: "https://learn.chatgpt.com/docs/developer-commands?surface=cli"
    title: "Codex developer commands"
    location: "codex exec --ephemeral and exec resume; read 2026-10-07; redirected from developers.openai.com/codex/cli/reference; HTML lines are not stable"
  - resource: "https://git-scm.com/docs/git-init"
    title: "git-init"
    location: "DESCRIPTION and --template/--initial-branch; observed lines234–241/276–288 on2026-10-07; manual last updated2.54.0/2026-04-20; HTML lines are not stable"
generated: { by: "process:codex", at: "2026-10-07T10:55:13Z" }
verified: { by: "process:current-cli-source-regression-live-ui", at: "2026-10-07T10:55:13Z" }
status: "UNVERIFIED"
stale_after: "2026-10-14T10:55:13Z"
---

# Codex 읽기 전용 후속 작업과 합성 Git fixture

## OFFICIAL CONTRACT

Codex `exec --ephemeral`은 세션 파일을 디스크에 저장하지 않는다. `exec resume`은 기록된 UUID/name 세션을 다시 여는 명령이다. 이벤트에서 thread ID를 받았다는 사실만으로 ephemeral 실행을 resume할 수 있다고 판단하지 않는다. Git `init`은 지정된 작업공간에 `.git` 메타데이터를 생성하며 기존 작업 파일을 덮어쓰지 않는다. 이는 Codex의 Git 검사 우회 옵션과 다른 작업이다.

## OBSERVED EVIDENCE

현재 설정의 고정 실행 파일 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`는 실제 `--version`에서 **0.160.0**을 반환했다. SHA-256 `6b582e8813ce7e8ed4c52814ee5cf230dba647bf2292df747a4003f2657ef201`은 설정의 `CODEX_BIN_SHA256`과 일치한다. 셸 기본 CLI0.154.0과 혼동하지 않는다. 설치 `exec resume --help`는 UUID/name, `--last`/`--all`, `--ephemeral`을 확인했다. 인증 내용은 읽거나 복사하지 않았다.

내부 소스 `src/server/codex-permission-profile-isolation-provider.ts:83`은 read-only 실행에 `--ephemeral`을 사용한다. 이전 합성 A2A thread `01a11370-bbcf-72b3-a376-f2eb6b93cc66`의 세션 파일 메타데이터는 service-core/worker-1/worker-2에서 발견되지 않았다. 새 개인 합성 후속 job `task-muxxhgtx-f8565b79`는 실제 Teams 화면에서 `thread/resume failed: no rollout found ... (code -32600)`을 반환했다. [MP-334](https://devdoo.atlassian.net/browse/MP-334)의 직접 원인은 비저장 read-only 세션에 native resume을 요청한 것이다. A2A의 다른 home을 잘못 선택했을 가능성은 부가 추론이고 직접 원인과 구별한다.

## 최소 수정과 FIXTURE

`src/server/agent-service.ts:314`의 read-only Codex 후속 작업·retry는 native thread resume을 요청하지 않는다. 동일 tenant/requester/conversation의 parent 연결에서 최대4개 완료 요청·결과를 참고하는 새 실행을 만든다. 각 결과는 최대4,000자이며 잘린 결과는 `resultTruncated`를 명시한다. 원래 사용자 입력·parentJobId·선택 모델·권한·비공개 알림 설정은 유지한다. `src/server/agent-service.ts:709`의 개인 채팅 자동 선택은 private/A2A 알림 비활성 작업과 다른 provider를 제외한다. `src/server/codex-runner.ts:123`은 native ephemeral resume을 실행 전에 거절한다. 사용자 응답은 새 읽기 전용 실행이라고 설명한다. 세션 지속 저장·새 권한·다른 home으로 rollout 복사·인증 완화를 추가하지 않는다.

RED: 실제 AgentService/store 회귀가 이전 thread ID를 runner에 전달했고, native argument builder도 ephemeral resume을 허용했다. GREEN: `scripts/agent-service-ephemeral-continuation-test.ts:37`/`:68`은 새 실행의 scoped context·private delivery·다른 provider·retry·큰 결과 경계를 검증한다. 기존 transition/private-notify/deterministic/security/model-selection focused tests도 통과했다. 재현 명령:

```sh
node --import tsx/esm scripts/run-module-test.mjs scripts/agent-service-ephemeral-continuation-test.ts
```

Azure 외부 worker의 read-only isolation은 별도 미지원 경계다. 이 수정의 실제 실행 수락 범위는 현재 Mac local dispatcher이며, 외부 worker에 동일 context 동작이 검증됐다고 주장하지 않는다.

## LIVE RESULT

[MP-335](https://devdoo.atlassian.net/browse/MP-335)는 실제 승인 후 Codex의 Git 사전 검사에서 실패했다. 설치 Git **2.54.0(Apple Git-157)** help의 `--template`/`--initial-branch` 계약을 확인했다. `/tmp/teams-synthetic-workspace111-20261007`의 `rev-parse --is-inside-work-tree`는 RED128이었다. 이 합성 경로에만 private empty template로 Git을 초기화했다. 기존 합성 파일3개의 SHA는 전후 동일하고 인증·trust·검사 우회 설정은 바꾸지 않았다. 같은 명령은 GREEN0/true다.

그 뒤 기존 실패 작업을 재실행하지 않고 새 job `task-muxzggjo-cc278df6`를 실제 Teams 탭에서 제출했다. inline 승인 확인의 전후 화면을 직접 열어 검수하고 두 번째 confirm을 실행했다. **2026-10-07T10:49:35.704Z**, 같은 공개111/ad1e78f에서 `MP335-GREEN-20261007 OK`와 완료를 확인했다. 파일 변경을 요청하지 않은 합성 승인 시험이므로 실제 코드 쓰기 성공을 주장하지 않는다.

증거: `/tmp/teams-catalog-update-20261006/mp335-fixture-git-preflight.json`; `ui-live-20261007/060-mp335-green-before-submit-ax.txt:153`, `063-mp335-green-approval-confirmation-ax.txt`, `065-mp335-green-terminal-ax.txt:287`; 각 동일 prefix PNG를 직접 열었다. 부모의 핵심 화면 검수·필수 릴리스/UI 게이트는 미완료라 Jira Done이나 전체 UI 완료로 처리하지 않는다.

MP-334의 새 소스는 아직 새 package/public release/runtime UI에 반영되기 전이다. 로컬 GREEN을 공개 완료로 올리지 않는다. MP-118의 현재 Teams About103/Graph111·메뉴 누락은 독립된 blocker로 유지한다.
