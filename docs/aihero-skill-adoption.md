# AIHero Skills 적용 판정

작성일: 2026-08-11

이 문서는 [Matt Pocock의 공식 skills 저장소](https://github.com/mattpocock/skills)를 현재 TeamsApp 워크플로우에 대조한 결과다. 사용자의 2026-08-11 결정에 따라 공식 저장소 커밋 `84fdeffd12f2ee307994d1eb6feb48173b6e0502`의 공개 스킬 35개를 전역 Codex 스킬 디렉터리에 설치했다. 설치와 호출은 분리하며, 현재의 Teams 네이티브 카드·Jira MP·기존 인앱 브라우저 탭·스크린샷 증거·공개 배포 게이트를 보존하는 범위에서 관련 스킬만 실행한다.

## 카탈로그 기준일과 명칭

AIHero의 현재 카탈로그 레슨 페이지는 25개 항목을 열거하며, `/wizard`와 `/to-questionnaire`도 별도 문서가 아니라 카탈로그 항목으로 포함한다. 따라서 “23개 + 2개 문서형”이라는 이전 집계는 현재 공식 카탈로그와 일치하지 않는다. 또한 v1.1에서 `/writing-great-skills`가 `/writing-for-agents`로 이름이 바뀌었으므로 새 문서와 설치 판정에는 후자를 사용한다. 이 문서의 평가는 2026-08-11에 확인한 [공식 카탈로그](https://www.aihero.dev/skills-catalog), [변경 이력](https://www.aihero.dev/skills/skills-changelog-v1-announcement), [writing-for-agents](https://www.aihero.dev/skills-writing-for-agents)를 기준으로 한다.

## 즉시 적용

| 스킬 | 적용 지점 | 확인 가능한 개선 증거 |
| --- | --- | --- |
| `diagnosing-bugs` | 런타임 무응답, Dev Tunnel/업로드/인증 실패, stale process | 재현 절차, 원인/비원인, 복구 명령, 재검증 결과를 한 기록으로 남긴다. 추측으로 Teams 모바일 완료를 선언하지 않는다. |
| `tdd` | Activity 알림, collaboration deep-link, Today 요약, GenUI 액션 제한 | 실패 회귀 테스트를 먼저 만들고 수정 후 같은 테스트가 통과한다. loading/empty/error/retry/permission/auth-expiry/duplicate 분기를 테스트 목록에 넣는다. |
| `code-review` | 커밋 직전 및 패키지 생성 직전 | 요구사항·보안·Teams 카드 제한·소스/ZIP/매니페스트/증거 ID 불일치를 독립 검토로 차단한다. |
| `research` | Teams SDK/Adaptive Card/모바일 호스트/Loop 등 외부 동작 | Microsoft 공식 문서와 실제 호스트 증거를 분리해 기록한다. 지원 여부를 코드 존재만으로 추정하지 않는다. |
| `writing-for-agents` | `AGENTS.md`, 릴리스 지침, 스펙, 티켓처럼 에이전트가 읽는 문서를 수정할 때 | 기존 탭 재사용, 로컬 원본 우선, 스크린샷 필수, 공개 전환 후 Teams 확인이라는 정책을 중복 없이 실행 가능한 체크 항목으로 유지한다. `/writing-great-skills`의 현재 명칭이다. |
| `setup-matt-pocock-skills` | Jira MP, 기본 triage 라벨, 단일 컨텍스트 domain docs | `docs/agents/`와 `AGENTS.md`의 짧은 포인터를 통해 tracker·label·domain 규칙을 한 번 설정한다. |
| `wayfinder` | 여러 세션에 걸친 Teams Core 릴리스 복구 | Jira map과 결정 티켓의 frontier·blocking 관계로 현재 복구 경로를 추적한다. 실제 Jira 응답 전에는 map 생성을 완료로 주장하지 않는다. |

## 조건부 적용

- `grill-with-docs` / `grill-me`: 새 기능의 제품 결정이 모호할 때만 시작 단계에 적용한다. 이미 승인된 작은 수직 슬라이스를 다시 질문해 지연시키지 않는다.
- `domain-modeling` / `codebase-design`: `/api/items`와 `/api/work-items` 상태 모델 통합처럼 구조 변경을 시작할 때 적용한다.
- `to-spec` / `to-tickets` / `triage`: 사용할 수 있지만 기본 추적 시스템은 Jira 프로젝트 `MP`, 기본 담당자는 사용자로 고정한다. GitHub/Linear로 자동 전환하는 설치 흐름은 사용하지 않는다.
- `to-tickets` 결과는 Jira 이슈와 연결되기 전까지 완료 증거로 보지 않는다.

## 설치 완료, 현재 호출하지 않음

- `prototype`: 현재 Teams 탭/카드의 제품 결정보다 런타임 복구가 먼저이므로 UI 결정이 새로 생길 때만 호출한다.
- `handoff`, `claude-handoff`, `loop-me`, `teach`, `wait-what`, `to-questionnaire`: 세션 경계, 교육, 설명 실패, 외부 의사결정이 실제로 생길 때 호출한다.
- `git-guardrails-claude-code`, `setup-pre-commit`, `setup-ts-deep-modules`, `migrate-to-shoehorn`, `scaffold-exercises`: 현재 Teams 릴리스 복구와 무관하므로 설치 상태만 유지한다.
- `writing-beats`, `writing-fragments`, `writing-shape`: 콘텐츠 집필 요청이 아니므로 현재 작업에서는 호출하지 않는다.

전체 설치는 기능 완료 증거가 아니다. 각 스킬은 설명과 현재 작업이 일치할 때만 읽고 실행하며, 무관한 스킬을 호출해 저장소 범위를 넓히지 않는다.

## 프로젝트 적용 순서

1. `diagnosing-bugs`로 현재 실패를 재현하고 원인을 분류한다.
2. `tdd`로 해당 사용자 노출 분기의 회귀 테스트를 먼저 추가한다.
3. 작은 수직 슬라이스를 구현하고 로컬 API/클라이언트 테스트를 통과시킨다.
4. `code-review`로 소스·매니페스트·패키지·증거 ID를 대조한다.
5. `research`로 공식 Teams 호스트 제약을 확인하고, 기존 Teams 탭의 데스크톱 스크린샷과 접근성 트리로 실제 동작을 검증한다.
6. 공개 앱 업데이트와 모바일 사용자 확인 전에는 완료 메시지를 보내지 않는다.

이 매핑은 설치 성공과 작업 성공을 구분한다. 각 항목은 해당 단계의 증거와 함께 적용되며, 효과가 확인되지 않은 호출은 릴리스 완료 근거로 사용하지 않는다.

## 2026-08-11 즉시 적용 결과

전체 스킬은 설치했지만, 현재 장애·릴리스·실사용 검증에 직접 연결되는 항목만 실행했다.

| 스킬 | 이번 적용 증거 | 판정 |
| --- | --- | --- |
| `diagnosing-bugs` | Core 번들 검사를 실행해 선택형 응답 엔진이 산출물에 포함되는 실패를 재현했다. `mcpEnabled=false`인 런타임 health만으로 번들 경계를 통과했다고 판단하지 않았다. | 즉시 유효 |
| `tdd` | 릴리스 루프에 sourceCommit 일치, 행별 증거 경로 중복, full-matrix 범위, 미완료 `IN_PROGRESS` 상태 회귀 테스트를 추가했다. 기존에 파일만 있던 `client-health`, `work-item-today-summary` 테스트도 npm 명령으로 노출했다. | 즉시 유효 |
| `code-review` | Core·릴리스·UI·Jira 영역을 독립 감사하고, 코드 PASS와 포털/설치/데스크톱/모바일 증거를 분리했다. | 즉시 유효 |
| `research` | AIHero 공식 카탈로그가 기존 23+2 집계가 아니라 25개 항목이라는 점을 확인하고, Teams 공식 호스트 동작과 실제 화면 증거를 별도 취급했다. | 즉시 유효 |
| `writing-for-agents` | 기존 탭 재사용, 로컬 원본 우선, full UI matrix, 동일 릴리스 identity, 공개 전환 후 Teams 확인 규칙을 이 문서·`AGENTS.md`·릴리스 루프에 연결했다. | 즉시 유효 |

현재까지 확인된 개선은 “코드가 있다”가 아니라 “실패를 재현하고 다음 릴리스에서 다시 실패하지 않도록 게이트가 생겼다”는 점이다. 아직 포털 업로드·설치 버전·데스크톱/모바일 스크린샷과 접근성 트리 증거는 확보되지 않았으므로, 이 적용 기록만으로 Teams 실사용 완료를 선언하지 않는다.
