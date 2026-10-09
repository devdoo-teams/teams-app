---
type: "Concept"
sources:
  - resource: "https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/exec/src/exec_events.rs"
    title: "Pinned Codex command item identity and outcome"
    location: "ThreadItem/CommandExecutionItem/CommandExecutionStatus; HTML lines1001–1118 unstable; observed2026-10-09"
  - resource: "https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/exec/src/event_processor_with_jsonl_output.rs"
    title: "Pinned Codex JSONL command projection"
    location: "map_item_with_id CommandExecution; HTML lines1758–1788 unstable; observed2026-10-09"
  - resource: "https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable"
    title: "Codex non-interactive machine-readable output"
    location: "Named section; developers.openai.com/codex/noninteractive redirects here; observed2026-10-09"
  - resource: "https://nodejs.org/api/util.html#utilstripvtcontrolcharactersstr"
    title: "Node util stripVTControlCharacters"
    location: "Named section; added16.11.0; observed2026-10-09; installed Node24.13.1 fixture confirms ANSI removal"
generated: { by: "process:codex", at: "2026-10-09T02:00:00Z" }
verified: { by: "process:actual-signed-pinned-cli-and-regressions", at: "2026-10-09T01:59:47Z" }
status: "UNVERIFIED"
stale_after: "2026-10-16T02:00:00Z"
---

# CLI 종료 관측과 모델 보고 분리

## OFFICIAL CONTRACT

Pinned command item은 ID/command/status/aggregated_output/nullable i32 exit_code를 갖는다. Output은 합산 stdout/stderr다. Completed/failed/declined 및 process exit는 전체 업무 수락·성공과 별도다. SDK main과 pinned alpha의 declined enum 차이를 기록하고 실제 pinned wire를 우선한다. 설치 version0.162.0-alpha.2, SHA cb4e4994627e770800a940b42969c77855a3fc09a6e60b02aa6319f670d6b6ab, exec help --json/--ephemeral/--cd/--model 및 서명·pin·permission-profile preflight 확인. 공식 archive와 binary bytes 직접 비교는 별도 UNVERIFIED다.

## OBSERVED EVIDENCE

[MP-364](https://devdoo.atlassian.net/browse/MP-364), idempotency `teams-core:bug:codex-command-terminal-observation`. 01:43:13Z 기존 합성 fixture17,25/합42만 읽은 provider-owned child wire는 item_1 started/in_progress/null exit → completed/exit0/합성 출력이었다. Baseline47 `src/server/codex-runner.ts:213` sanitizer와 `src/server/cli-agent-runner.ts:284`/`src/server/provider-neutral-agent-runner.ts:34` adapters에서 필드/terminal이 빠졌다. `src/server/agent-service.ts:1144`는 시작만 저장했고 `src/server/agent-job-store.ts:425`는 도구 개수가 같으면 갱신하지 않았다. 위 line은 발견 baseline이다.

독립 리뷰에서 JSON quoted argv·ANSI/C1 비밀값·subshell/env -i 이름 파싱에 따른 유실을 재현했다. 원본 RED와 최소 GREEN은 `/tmp/teams-command-observation-20261009-1040/`에 보존한다. 임시 ESM/projection/selection 준비 실패도 보존하며 실제 job resume/인증·정책 변경으로 우회하지 않았다.

## FIXTURE

Structured ID/status/exit만 canonical source로 저장한다. 모델 결과의 exit_code 또는 요청의 model/OS를 실제 관측으로 승격하지 않는다. 같은 ID의 첫 terminal만 반영하고 호출별 ID를 구분한다. 늦은 시작·충돌 완료는 기존 terminal을 바꾸지 않는다.32개 cap에서도 기존 ID 갱신을 유지한다. Legacy는 종료 미관측이다. ACL/FSM/timeout/cancel/process-tree/terminal acceptance 유지.

ANSI/C0/C1 정규화→credential-shaped masking/URL/경로/열린 private key 보호→1024자 excerpt 순서다. command/argv/arguments payload는 전체 omission으로 nested/multiline JSON도 차단한다.64KiB 초과는 제한 표식; 화면 요약128자/3줄. 범용 회사정보 DLP 보장이 아니며 인증·범위·access control을 대신하지 않는다. MCP/optional/skill 권한 변경0. 출력 설정 구현0.

재현 명령은 `node --import tsx/esm scripts/run-module-test.mjs scripts/agent-command-terminal-test.ts` 및 기존 runner security/CLI adapter/AgentService/store/card/tab/conversation tests. 관측·same-length persistence/reload·foreign owner·nested clone·ID correlation·malformed exits·model text 분리·mask-before-cut·ANSI/C1/JSON argv persistence/card·fallback adapter·줄 cap의 RED→GREEN을 검증한다.

## LIVE RESULT / REMAINING BOUNDARIES

발견 시 실제128/full47 PID20844/tunnel8391 유지. 새 수정은 후보이며 새 commit/전체Core·default·strictsource·build·package/동일 앱 catalog·개인 설치·공개 runtime·실제 UI read-back이 필요하다. 이전128 task-mv08sne4-dc9725c2의 ephemeral terminal은 모델 exit0으로 재구성하지 않는다. CopilotKit showcase 복사·설치·통합/Core 교체0. Native tools/전역 화면 조정은 별도 BLOCKED; web/fixture가 native/full226/mobile/user acceptance를 대신하지 않는다. Jira In Progress, Done/Teams 완료 없음.
