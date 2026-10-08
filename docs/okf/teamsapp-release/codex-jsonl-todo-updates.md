---
type: "Concept"
sources:
  - resource: "https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/exec/src/exec_events.rs"
    title: "Codex exec JSONL event definitions, rust-v0.162.0-alpha.2"
    location: "Pinned source lines8–36 and314–324; observed2026-10-08; source commit74e804deeb1241d5fe699b31fb319f7d46454c42"
  - resource: "https://github.com/openai/codex/blob/74e804deeb1241d5fe699b31fb319f7d46454c42/codex-rs/exec/src/event_processor_with_jsonl_output.rs"
    title: "Codex exec JSONL producer, rust-v0.162.0-alpha.2"
    location: "Pinned source lines513–535 and568–591; observed2026-10-08; release published2026-10-02T01:44:23Z"
  - resource: "https://github.com/openai/codex/releases/tag/rust-v0.161.0"
    title: "Codex rust-v0.161.0 stable release"
    location: "Release metadata observed2026-10-08; published2026-10-07T15:58:45Z; event definitions also compared with commit979011409de0a60b52f179721948e65531d26144"
generated: { by: "process:codex", at: "2026-10-08T10:52:00Z" }
verified: { by: "process:official-pinned-source-and-fixtures", at: "2026-10-08T10:52:00Z" }
status: "UNVERIFIED"
stale_after: "2026-10-15T10:52:00Z"
---

# Codex JSONL 계획 업데이트와 완료 결과 분리

## OFFICIAL CONTRACT

`item.updated`는 진행 중인 item의 갱신이고 `item.completed`는 item의 종료다. Pinned producer의 `TurnPlanUpdated`는 첫 계획에 `item.started(type=todo_list)`를, 다음 갱신에 같은 ID의 `item.updated`를 보낸다. `TodoItem`은 `text:string`과 `completed:boolean`을 갖는다. 빈 목록과 미완료 항목도 유효하다. Producer는 turn 종료에서 활성 계획의 `item.completed`를 보낸 뒤 terminal `turn.completed`와 사용량을 보낸다. 계획 종료가 마지막 `agent_message` 뒤에 올 수 있으며, 이 producer 경로는 turn마다 계획을 하나 유지한다. 계획 갱신이나 종료는 최종 사용자 결과가 아니다.

설치 runtime 대상의 `--version`은0.162.0-alpha.2다. `exec --help`/`exec resume --help`는 `--json`·`--ephemeral`을, `sandbox --help`는 `-P/--permissions`·`-C/--cd`와 command 전달을 확인했다. 실제 binary가 해당 release archive/source와 일치하는지는 별도 `UNVERIFIED`다. Event 정의는 이전0.160.0과 안정판0.161.0에서도 동일하므로 이번 alpha에서 새로 도입한 이벤트라고 추정하지 않는다.

## OBSERVED EVIDENCE

[MP-351](https://devdoo.atlassian.net/browse/MP-351), idempotency `teams-core:bug:codex-jsonl-item-updated`: 기존 runner는 공식 계획 갱신을 unknown root event로 거절했다. 실제 provider 요청 없이 합성 JSONL 자식이 `thread.started → turn.started → todo.started → todo.updated → agent_message → todo.completed → turn.completed`를 출력하면 RED `unsupported JSONL event: item.updated`로 종료했다. 독립 리뷰에서 완료 계획을 같은/다른 ID로 다시 열 수 있는 경계값도 발견했으며, 추가 RED `Missing expected rejection: todo-reopen-same-id`를 보존했다.

내부 source: `src/server/codex-runner.ts:353` 계획 상태; `:383` raw ID/공식 목록 projection 검증; `:450` 시작/갱신/완료 FSM; `:513` 열린 계획 terminal 거부. `scripts/codex-runner-security-test.ts:1`, `scripts/cli-agent-runner-test.ts:1`, `scripts/agent-service-transition-test.ts:1`에 lifecycle/소비자 회귀가 있다. 로그는 `/tmp/teams-mp351-fix-20261008/*-RED.log`와 `todo-reopen-GREEN.log`다.

## 최소 수정과 FIXTURE

확인된 `todo_list` 갱신만 허용한다. 활성 ID와 text/boolean 항목 구조를 검증하고, 시작 전·종료 후·다른 ID·중복 시작/종료·완료 후 재시작·열린 계획 terminal·알 수 없는 이벤트는 계속 거절한다. 연속 동일한 공식 목록 projection은 callback에서 한 번만 관찰하지만 wire event budget에는 모두 포함한다. Sanitizer가 제외한 ID/목록/추가 field를 소비자에 새로 노출하지 않는다.

계획 이벤트는 마지막 사용자 메시지 상태를 보존한다. `agent_message`만 결과를 만들고 `turn.completed`만 기존 canonical 사용량을 제공한다. CLI 정상화 소비자는 계획으로 메시지·tool·terminal을 추가하지 않는다. AgentService fixture는 진행·결과·사용량·tool·알림 수가 변하지 않음을 검증한다. 기존 lease/auth/timeout/nonzero/signal/process-tree/failure와 unknown-event 검증을 약화하지 않는다.

재현 명령:

```sh
node --import tsx/esm scripts/run-module-test.mjs scripts/codex-runner-security-test.ts
node --import tsx/esm scripts/run-module-test.mjs scripts/cli-agent-runner-test.ts
node --import tsx/esm scripts/run-module-test.mjs scripts/agent-service-transition-test.ts
```

위 focused GREEN과 독립 diff 리뷰는 로컬 fixture 증거다. 필수 clean pinned Core/default/source/build/package 검증은 동일 새 commit으로 별도 보존한다. 추가 broad semantic TypeScript5.9.3 검사는11개 기존 오류로 FAIL이며 baseline/candidate 동일 진단과 runner 신규 오류0을 확인했다. 추적 소스의3개 오류는 [MP-352](https://devdoo.atlassian.net/browse/MP-352), [MP-353](https://devdoo.atlassian.net/browse/MP-353), [MP-354](https://devdoo.atlassian.net/browse/MP-354)로 분리하고 사용자 미추적 복사본은 보존했다. Core source check 통과를 broad semantic 검사 통과로 바꾸어 말하지 않는다. 전체 dirty worktree fixture는 사용자 미추적 `src/client/location.ts`가 있는 삭제 계약에서 실패하므로 사용자 파일을 제거하는 방식으로 통과시키지 않는다.

## INFERENCE / LIVE RESULT

[MP-350](https://devdoo.atlassian.net/browse/MP-350)의 signed runtime executable SHA와 승인 pin 불일치는 독립적인 실제 차단이다. Fixture 수정이나 pin 변경만으로 운영 호환성·실제 provider 결과를 증명할 수 없다. Pin 갱신 승인은 아직 없으므로 환경·신뢰 설정·CLI 설치·기존 공개122 서버와 tunnel을 변경하지 않는다. 실제 canary/provider/UI 검증은 수행하지 않았고 `LIVE_UNVERIFIED`를 유지한다. 새 package는 후보일 뿐 카탈로그/설치본/공개 release identity와 혼동하지 않는다. Jira Done·release:loop complete·Teams 완료 메시지를 보내지 않는다.
