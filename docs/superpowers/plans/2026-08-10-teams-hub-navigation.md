# Teams 업무 허브 P0 내비게이션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for implementation tasks and `superpowers:verification-before-completion` before claiming completion.

## Goal

기존에 실제 동작 중인 업무·협업·응답 모드 기능을 모바일 Teams 사용자가 하나의 긴 화면에서 찾지 않아도 되도록 `오늘`, `내 업무`, `활동`, `설정`으로 분리한다. 외부 API 키, Jira/Trello 연동, MCP, CopilotKit 런타임은 이 P0 범위에 포함하지 않는다.

## Constraints

- 원본 로컬 소스 `/Users/doosansmacbookpro/Documents/TeamsApp`만 사용한다. iCloud 폴더나 존재하지 않는 원격 저장소를 참조하지 않는다.
- 현재 Codex 앱의 작업 브랜치와 기존 Teams 데스크톱/인앱 브라우저 탭을 재사용한다. 인증·업로드를 위해 새 브라우저 탭을 만들지 않는다.
- 기존 `/api/items`, `/api/work-items`, `/api/collaboration`, `/api/health`의 실제 결과를 사용한다. 저장된 문자열만 응답하는 가짜 화면을 추가하지 않는다.
- 모바일 Adaptive Card 1.2와 Teams 탭 링크를 유지한다.
- 테스트를 먼저 추가하고, 전체 타입체크·코어 테스트·공개 런타임·데스크톱 UI·모바일 UI 분기를 증거로 남긴다.
- 새 패키지는 한 번 생성하고 SHA-256을 기록한다. 완료 메시지는 배포된 Teams 앱에서 런타임 확인 뒤에만 보낸다.

## Tasks

1. `hub-navigation.ts`에 허브 뷰 파서와 URL 보존 함수를 추가하고 순수 함수 테스트를 만든다.
2. `App.tsx`에 접근 가능한 4개 뷰 내비게이션을 추가한다. `workItemId` 딥링크는 `내 업무`로 열고, 기존 WorkItemPanel/CollaborationPanel은 해당 뷰에서 실제 API를 호출하도록 조건부 마운트한다.
3. 모바일에서 4개 내비게이션이 한 화면에 보이고, 활성/포커스/로딩/오류 상태가 식별되도록 CSS를 추가한다. 구형 업무 CRUD는 `내 업무` 뷰 아래에만 유지해 중복 노출을 없앤다.
4. 릴리스 상태 조회가 완료된 실행을 `MOBILE_READY`로 되돌려 표시하지 않도록 terminal state를 보존하고 테스트한다.
5. 로컬에서 기능 분기와 API를 검증한 뒤 원본 소스에서 패키지·공개 런타임을 갱신한다. 기존 Teams 탭을 재사용해 데스크톱에서 네 개 뷰와 실제 상태 변경을 스크린샷/접근성 트리로 확인하고, 모바일은 사용자 확인 증거를 받기 전 완료로 표시하지 않는다.

## Acceptance criteria

- 새로고침 후 기본 뷰는 `오늘`이며 서비스/인증/봇/응답 모드/저장소 상태가 실제 `/api/health` 결과로 표시된다.
- `내 업무`를 누르면 검색·필터·생성·상태변경·상세·댓글·watch·딥링크가 기존 API로 동작한다.
- `활동`을 누르면 협업 구독·채널 바인딩·알림/다이제스트 UI가 실제 API로 동작한다.
- `설정`을 누르면 결정형/OpenAI/로컬·사내 응답 모드의 사용 가능 여부가 실제 설정 결과로 표시된다.
- 모바일의 `workItemId` 링크가 즉시 `내 업무`를 선택하고, 탭 링크가 동일한 허브 탭으로 돌아온다.
- 새 릴리스의 패키지 SHA, 공개 health, 탭 200, 데스크톱 분기 증거가 모두 현재 커밋과 일치한다.
