# AIHero Skills 적용 판정

작성일: 2026-08-10

이 문서는 [Matt Pocock의 공식 skills 저장소](https://github.com/mattpocock/skills)를 현재 TeamsApp 워크플로우에 대조한 결과다. 전체 스킬을 일괄 설치하지 않고, 현재의 Teams 네이티브 카드·Jira MP·기존 인앱 브라우저 탭·스크린샷 증거·공개 배포 게이트를 보존하는 범위에서 적용한다.

## 즉시 적용

| 스킬 | 적용 지점 | 확인 가능한 개선 증거 |
| --- | --- | --- |
| `diagnosing-bugs` | 런타임 무응답, Dev Tunnel/업로드/인증 실패, stale process | 재현 절차, 원인/비원인, 복구 명령, 재검증 결과를 한 기록으로 남긴다. 추측으로 Teams 모바일 완료를 선언하지 않는다. |
| `tdd` | Activity 알림, collaboration deep-link, Today 요약, GenUI 액션 제한 | 실패 회귀 테스트를 먼저 만들고 수정 후 같은 테스트가 통과한다. loading/empty/error/retry/permission/auth-expiry/duplicate 분기를 테스트 목록에 넣는다. |
| `code-review` | 커밋 직전 및 패키지 생성 직전 | 요구사항·보안·Teams 카드 제한·소스/ZIP/매니페스트/증거 ID 불일치를 독립 검토로 차단한다. |
| `research` | Teams SDK/Adaptive Card/모바일 호스트/Loop 등 외부 동작 | Microsoft 공식 문서와 실제 호스트 증거를 분리해 기록한다. 지원 여부를 코드 존재만으로 추정하지 않는다. |
| `writing-for-agents` | `AGENTS 2.md`와 릴리스 체크리스트 유지 | 기존 탭 재사용, 로컬 원본 우선, 스크린샷 필수, 공개 전환 후 Teams 확인이라는 정책을 실행 가능한 체크 항목으로 유지한다. |

## 조건부 적용

- `grill-with-docs` / `grill-me`: 새 기능의 제품 결정이 모호할 때만 시작 단계에 적용한다. 이미 승인된 작은 수직 슬라이스를 다시 질문해 지연시키지 않는다.
- `domain-modeling` / `codebase-design`: `/api/items`와 `/api/work-items` 상태 모델 통합처럼 구조 변경을 시작할 때 적용한다.
- `to-spec` / `to-tickets` / `triage`: 사용할 수 있지만 기본 추적 시스템은 Jira 프로젝트 `MP`, 기본 담당자는 사용자로 고정한다. GitHub/Linear로 자동 전환하는 설치 흐름은 사용하지 않는다.
- `to-tickets` 결과는 Jira 이슈와 연결되기 전까지 완료 증거로 보지 않는다.

## 당장 적용하지 않음

- `setup-matt-pocock-skills`: 현재 프로젝트의 Jira MP와 충돌할 수 있고 저장소 README의 기본 설정 선택지가 GitHub/Linear/local 중심이므로 원형 그대로 실행하지 않는다.
- `wayfinder`, `prototype`: 현재는 이미 존재하는 Teams 탭/카드의 런타임 결함을 고치는 단계라 우선순위가 낮다.
- `handoff`, `teach`, `wait-what`: 현재 병렬 에이전트 감독과 실행 로그가 이미 있어 이번 P0 수정에는 중복이다.
- 전체 스킬 일괄 설치: 스킬 수 자체를 성과로 보지 않고, 동일 요구사항의 전후 증거가 있는 항목만 채택한다.

## 프로젝트 적용 순서

1. `diagnosing-bugs`로 현재 실패를 재현하고 원인을 분류한다.
2. `tdd`로 해당 사용자 노출 분기의 회귀 테스트를 먼저 추가한다.
3. 작은 수직 슬라이스를 구현하고 로컬 API/클라이언트 테스트를 통과시킨다.
4. `code-review`로 소스·매니페스트·패키지·증거 ID를 대조한다.
5. `research`로 공식 Teams 호스트 제약을 확인하고, 기존 Teams 탭의 데스크톱 스크린샷과 접근성 트리로 실제 동작을 검증한다.
6. 공개 앱 업데이트와 모바일 사용자 확인 전에는 완료 메시지를 보내지 않는다.

이 매핑은 스킬 설치 완료를 의미하지 않는다. 각 항목은 해당 단계의 증거와 함께 적용되며, 효과가 확인되지 않은 스킬은 채택하지 않는다.
