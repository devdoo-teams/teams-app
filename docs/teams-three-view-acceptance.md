# 원본 데모 3안 수용 기준 (MP-369)

기준은 사용자에게 2026-10-09 12:01 KST 전달한 ①채팅 중심 ②요약 카드+선택형 상세 ③채팅+별도 상세와, 이후 세 안을 모두 선택형으로 구현하라는 요청이다. 단순 text/summary/rich 이름 존재로 완료하지 않는다. 원본 `/tmp/teams-ui-comparison-20261009` artifact SHA256 `b475ed3f6ca585692bc03a020a54fe8d8ec49fd47e61e51b1a6ae4e81362ad38`. 현재 기준135 commit1c8548b는 실제 Teams 기본 화면과 SDK Dialog 모두 확인했지만 원본 fidelity가 부족했다.

| ID | 수용 기준 | 표면 / 검증 |
|---|---|---|
|D01|일반 앱 진입 상단에서 ①채팅 ②요약 카드 ③별도 상세를 모두 발견하고 선택할 수 있다.|Core 개인 탭, SSR/상태 테스트 + 배포 후 실제 화면|
|D02|도구 결과·진행 단계·진단 정보 체크박스를 상단에서 각각 선택한다. 빈 선택도 허용한다.|Core 탭 / 동일 owner 설정|
|D03|모드·상세항목·Tab/Dialog 선택은 owner별 저장/재시작 유지, 다른 user/tenant와 격리된다.135의 mode-only 저장은 읽을 수 있다.|실제 store/route regression|
|D04|표시 선택/창 열기/접기/닫기/조회 실패가 CLI 작업을 제출·승인·취소·재시도하지 않는다.|클라이언트/adapter 호출 ledger|
|D05|①은 요청·응답 대화와 짧은 상태/진행 요약을 보여 주고, 같은 위치에서 선택한 상세를 펼치고 접는다.|앱 탭 대화; Teams Bot은 supported nested card로 구현|
|D06|②는 짧은 결과와 핵심 사실을 카드로 보여 주며 상세는 펼쳤을 때만 나타난다. 진단/도구/단계 선택을 따른다.|탭/AdaptiveCard payload|
|D07|③은 결과 요약과 직접 상세 진입을 제공하고 Tab과 Dialog를 선택할 수 있다. 작업 상세 맨 아래를 찾는 절차를 강요하지 않는다.|상단/작업 UI + hosted SDK entry|
|D08|실제 CopilotKit1.66.2 대화 UI에 사용자 요청·응답·도구 결과가 보이고 입력할 수 있다. null 슬롯으로 대화 전체를 숨기지 않는다.|optional SDK public component/types + rendering test|
|D09|SDK에서 명시적으로 메시지를 보내면 기존 authenticated Core continuation을 사용한다. 표시 agent 자체는 계속 read-only이며 job/model 선택을 변경하지 않는다.|controller/transport fixtures; 실제 실행은 별도 승인·UI 게이트|
|D10|같은 job identity/result, CLI 인자와 provider 실제 관측의 구분, safe tool evidence를 모든 조합에서 유지한다.|projection/card/SDK regression|
|D11|실패·승인 필요·취소는 상세를 모두 꺼도 상태·오류를 숨기지 않는다. 없는 진행/도구는 실제 없음을 표시하고 fixture를 만들지 않는다.|완료/진행/실패/승인/취소 payload/SSR|
|D12|SDK 또는 host가 사용 불가면 이유와 현재 탭의 대체 경로를 표시한다. auth 만료/권한거부/조회실패에는 stale 내용이 남지 않는다.|auth/route/controller regression|
|D13|메시지 중복 클릭 및 모호한 응답을 자동 재전송하지 않는다. loading/validation/error/retry/empty 분기를 분리한다.|controller tests|
|D14|Core 기본 build/runtime는 SDK provider 없이 유지하고 실제 SDK는 explicit build로 검사한다. 새 API key·권한·정책·대상·상시서버를 추가하지 않는다.|Core boundary/default/SDK checks|
|D15|원본과 실제 화면의 시각 차이는 별도 기록한다. local SSR/schema/fixtures는 Teams/native/mobile 사용자 수락 증거가 아니다.|미배포/실서비스 미검증 상태 유지|

## 플랫폼 계약과 차이

OFFICIAL CONTRACT(2026-10-10 확인): Teams Bot 메시지는 지원 카드 및 JSON action으로 상호작용한다. `Action.ShowCard`는 nested card를 펼친다. HTML/React Dialog는 같은 앱 URL을 iframe으로 열고 TeamsJS initialize가 필요하다. 임의 React CopilotKit chat을 Teams 네이티브 메시지 본문에 mount할 공식 경로는 이 계약에 없다. 따라서 네이티브 채팅의 상세 펼침은 ShowCard, 실제 React 대화는 앱 탭/Dialog에 둔다. plain text 메시지 자체의 HTML details/CSS는 동일하게 구현할 수 없으므로 text-centered card와 탭 대화의 차이를 명시한다.

- https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference — supported card types / Adaptive Card1.6/mobile/style constraints, observed lines32–85,137–152.
- https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions — action table, ShowCard progressive disclosure, observed39–46.
- https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/task-modules/task-modules-tabs — URL iframe/initialize, observed80–87. Flattened tutorial size example conflicts with installed/current size object; use installed TeamsJS2.54.0 `size:{width,height}` contract already verified in OKF.
- https://docs.copilotkit.ai/reference/v2/components/CopilotChatView — controlled messages/input/submit slots; installed1.66.2 declarations confirm. This display component can connect explicit input to Core without enabling an API-backed optional model provider.
- https://docs.copilotkit.ai/reference/v2/components/CopilotChat — agent wiring and slots. Display transport remains existing real read-only AG-UI adapter; do not remove auth/owner/request restrictions to make SDK input work.

## 실행 범위

This corrective phase implements and tests against these rows. No new catalog upload or public runtime version switch. User-owned browser remains untouched. Candidate/source/local checks may pass while deployed135 and all new live/native/mobile/screenshot acceptance remain UNVERIFIED. MP-369 stays In Progress. No Teams completion message.
