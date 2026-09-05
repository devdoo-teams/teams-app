# ChatGPT 기능 전체를 Teams에서 사용하는 설계 제안

상태: 설계 제안, 전체 목표 미달성. 구현 지시서는 하위 기능별로 작성한다.
조사일: 2026-09-06 KST. 소스 기준: `6323bba465e28a6ee3268e4eff201cc98c9f2e16`.

## 목표와 완료 정의

사용자 목표는 “대화창만 Teams일 뿐 현재 ChatGPT 앱에서 할 수 있는 모든 기능을 사용”하는 것이다. 서버 복구, agent-only Core, 비슷한 응답 생성, API 기능 일부를 전체 달성으로 바꾸지 않는다. 아래 기능군을 실제 사용자 계정의 노출 기능과 대조하고, 각 기능의 입력·출력·상태·권한·이력·동기화까지 검증해야 한다. 현재 계정별 기능 목록 전수 확인은 미완료이므로 이 목록 자체도 완전성 PASS가 아니다.

`docs/api-free-teams-roadmap.md`의 agent-only Core는 보존할 기반 제품이다. 본 제안은 그 제품을 현재 전체 목표와 동일시하지 않는다. 날씨 제거, 작은 업무허브, 프롬프트·도구 이력, 모델·추론 선택 요구는 유지한다. 과거 ChatGPT 대화·프로젝트·기억을 새 로컬 데이터로 대체하고 동기화 완료라고 표시하지 않는다.

## 현재 증거와 기능 차이

- 소스: `src/server/core-orchestration-service.ts`, `core-orchestration-route.ts`, `agent-job-store.ts` 및 `src/client/core-orchestration-client.ts`가 기존 작업 lifecycle의 확인 지점이다. 존재만으로 live PASS가 아니다.
- 로드맵에 명시된 탭 갱신은 3초 비중첩 polling이며 streaming과 다르다.
- `src/server/agent-token-usage.ts`는 Codex가 보고한 사용량을 파싱한다. 계정 잔여 할당량이나 컨텍스트 잔여량을 증명하지 않는다.
- 발행 산출물은 1.0.102/6323bba이고 Teams ZIP은 기존 q3 Dev Tunnel 도메인이다. Azure 서버 배포와 설치 앱 연결 전환은 서로 다른 게이트다.
- Azure 실행 21은 이 커밋을 고정한 서버/worker 복구 작업이다. 현재 진행 상태는 Azure DevOps에서 다시 조회한다. 문서의 실행 번호를 성공 증거로 사용하지 않는다.

## 확인한 공식 계약

1. [Codex 인증](https://learn.chatgpt.com/docs/auth): ChatGPT 구독 로그인과 API 키 사용 경로가 구분된다. 일반 API 호출에 Codex 또는 Workspace Agent 인증을 재사용할 수 있다고 추론하지 않는다. 실제 계정 자격과 운영 호스트 인증은 별도 read-back 대상이다.
2. [Responses 도구](https://developers.openai.com/api/docs/guides/tools): 웹/파일 검색, 함수, remote MCP 등 공식 확장 경로가 있다. 도구 지원이 ChatGPT의 전체 앱 기능·연결 계정·기록을 제공한다는 의미는 아니다.
3. [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state): Conversations/Responses의 durable ID로 여러 요청의 문맥을 유지할 수 있다. ChatGPT 기존 대화의 가져오기 계약으로 간주하지 않는다.
4. [Workspace Agent trigger](https://learn.chatgpt.com/workspace-agents/trigger-runs): 게시된 agent trigger, conversation key, idempotency와 beta run status를 지원한다. 답변 본문을 API로 조회할 수 없다고 명시한다. 이 경로는 Teams 내 완전한 답변 왕복의 단독 구현안이 아니다.
5. [Workspace Agent 인증](https://learn.chatgpt.com/workspace-agents/authentication): 관리자 허용 및 해당 scope의 token이 필요하며 Workspace Agents API 범위에 한정된다. 현재 계정의 자격은 미검증이다.

문서 조회일과 문서 갱신일은 다르다. 갱신일을 확인하지 못한 문서는 조회일만 기록했다. 아래 추가 기능군은 상세 공식 계약 확인 전까지 가능/지원으로 단정하지 않는다.

## 접근안과 권고

### A. Codex worker만 사용

기존 작업 실행·도구·파일 처리 기반을 재사용한다. 그러나 음성, ChatGPT 공유 기록, 개인 기억 및 모든 앱 권한을 자동 제공하지 않는다. 전체 목표의 최종안으로 불충분하다.

### B. 공식 기능별 혼합 실행 — 권고

Teams Bot은 대화 입력과 결과 전달, 작은 개인 탭은 이력·파일·승인·기능 상태를 담당한다. 기존 `ProviderRuntimeAdapter` 경계를 재사용하며 Codex, 허용된 공식 API, 개별 MCP 연결을 명시적으로 라우팅한다. 실제 사용자 identity와 실행 identity를 분리하고 각 작업에 provider/session/result provenance를 남긴다. 미지원 기능은 이유와 필요한 계약/자격을 표시한다. 별도 API 비용이 필요한 활성화는 비용 확인 전 시행하지 않는다.

이 안은 목표에 접근하는 권고이지 100% 지원 보장이 아니다. ChatGPT 원본 기록/기억/권한 연동이 입증되지 않는 동안 전체 목표는 미달성이다.

### C. ChatGPT UI 또는 Workspace Agent 링크 전달

원본 앱 접근을 유지할 수 있지만 Teams 밖으로 이동하는 링크는 “대화창만 Teams”의 수락 기준을 충족하지 않는다. 브라우저 세션 scraping/비공개 endpoint를 안정된 제품 계약으로 만들지 않는다. 명시적으로 구분된 보조 경로로만 검토한다.

## 우선순위별 독립 수락 단위

각 행은 별도 거절/수락 가능한 산출물이다. 병렬 슬롯을 채우기 위해 분할하지 않는다. 파일 경로는 기존 재사용 경계이며 아래 표는 상세 구현 코드를 대신하지 않는다. 각 구현 전 동일 원인의 기존 Jira 검색/연결과 RED 테스트가 필요하다.

| ID / 우선순위 | 산출물과 재사용 경계 | 의존성 | 독립 수락 기준 |
| --- | --- | --- | --- |
| F00 / P0 | 사용자 기능 목록과 지원·자격 매트릭스 | 없음 | 현재 계정에서 보이는 모든 기능을 공식 계약/구현/라이브 증거 행에 연결. 미확인 항목도 유지 |
| F01 / P0 | Azure worker 복구, `infra/azure/modules/worker-vm.bicep` | 기존 MP-307 | 정확한 release의 설치 파일, service 상태, 실제 agent 결과, 실패/취소/재시작 검증 |
| F02 / P0 | Teams 서버 연결 전환과 설치본 정합 | F01 | Azure HTTPS, Bot endpoint, SSO resource, ZIP, 설치 버전, desktop/mobile 실제 답장 정합 |
| F03 / P0 | 인증 주체별 provider capability 조회, `provider-runtime-adapter.ts` | F00 | 미설정/만료/거부/사용가능 구분. 다른 사용자 자격 누출 없음. 모델 목록은 실제 지원 집합 |
| F04 / P0 | 자연어 다중 턴 대화와 세션 재개, `core-orchestration-service.ts` | F03 | 후속 질문이 동일 문맥 사용. 새 대화는 격리. 재시작 후 복구, 중복 입력 한 번만 처리 |
| F05 / P0 | 작업 진행/최종 결과 전달, `core-orchestration-route.ts`와 client | F04 | 진행과 최종이 구분되고 reconnect 후 누락 복구. 빈 최종 결과는 성공이 아님 |
| F06 / P1 | 모델·추론 선택과 실제 사용량, `agent-token-usage.ts` | F03 | 선택값이 실행 receipt와 일치. 사용 토큰/컨텍스트/계정 quota 구분, 미제공 수치는 unknown |
| F07 / P1 | 사용자 파일 입력/다운로드 | F04 | 문서·이미지 업로드 실제 분석과 결과 회수. 사용자 범위, 크기/형식/만료/악성 입력 검증 |
| F08 / P1 | 웹 검색·출처 및 심층 조사 | F03,F05 | 실제 조회 출처와 답변 연결. 조사 진행/중단/실패, 허위 citation 방지 |
| F09 / P1 | 도구·스킬·플러그인 연결 및 관찰, `mcp-provider-tools.ts`, `agent-tool-observation.ts` | F03,F05 | 연결한 서비스별 실제 read/write·승인·취소. 설치/설정/실제 사용을 각각 구분 |
| F10 / P1 | 프로젝트·대화 검색/재개/분기/보관 | F04 | Teams 내부 기록과 ChatGPT 원본 기록을 표시로 구분. 원본 연동 계약 미확인은 별도 미달성 |
| F11 / P1 | 문서·표·슬라이드·코드 산출물 | F07,F09 | 실제 파일 생성, 열기, 편집, 다운로드 및 내용 검증. 경로 링크만 반환하면 미완료 |
| F12 / P2 | 개인 기억·사용자 지침 | F04,F10 | 사용자별 조회·수정·삭제·비활성화/임시대화. ChatGPT 원본 기억 동기화는 별도 계약 필요 |
| F13 / P2 | 이미지 생성·편집, 영상 입력/생성 | F07 | 각 modality 별 공식 지원과 자격 확인 후 실제 입력→파일 결과 왕복. 지원 안 된 modality 분리 |
| F14 / P2 | 음성 입력·출력·실시간 음성/화면 | F03,F05 | Teams desktop/mobile 권한·오디오 왕복·중단·재연결 검증. 채팅 음성파일과 realtime 구분 |
| F15 / P2 | 예약 작업·장기 agent·알림 | F05,F09 | 서버 재시작과 사용자 오프라인에도 예약 보존. 중복 알림/취소/시간대 검증 |
| F16 / P2 | 인터랙티브 편집/canvas·앱 UI·컴퓨터 제어 | F07,F09 | 실제 사용자 동작·격리·승인·결과 반영 검증. 일반 텍스트 요약으로 대체 완료 금지 |
| F17 / P0 완료게이트 | 전 기능 계정/권한/기록 동등성 대조 | F00–F16 | 기능별 동일 사용자 입력의 결과·권한·이력 확인. 한 행이라도 미검증이면 전체 완료 아님 |

## 단계별 실행 방법

1. F01/F02 복구 임계 경로를 기존 release identity로 유지한다. 이번 문서 때문에 버전·ZIP·서버를 다시 만들지 않는다.
2. F00은 현재 사용 계정의 기능 노출을 읽기 전용으로 확인하고 목록에 없는 기능도 추가한다. 권한, 비밀 입력, 별도 비용을 필요한 기능에만 연결한다.
3. F03/F04에 대해 기존 타입·테스트를 읽은 뒤 별도 구현 계획을 작성한다. 새로운 provider를 기본 Core에 몰래 연결하지 않는다.
4. 각 수락 단위마다 명시적 인터페이스, 실패 재현 테스트, 최소 수정, GREEN, 동일 release UI evidence를 완료한다. fixture만 통과한 단위는 SOURCE_TESTED로 남긴다.
5. F17에서 사용자 목표 그대로 대조한다. 전체 기능이 불가능하다는 공식 제한을 만나면 그 제한과 대안을 사용자에게 보고하고, 부분 제품을 100%라고 명명하지 않는다.

## 설계 검토 결과

- 범위: 현재 Core의 복구와 전체 목표를 구분했다. 전체 기능 목록은 계정별 F00 검증 전까지 닫지 않는다.
- 인증: Teams SSO, Codex, Workspace Agents, 일반 API, 각 MCP 연결을 별도로 판정한다.
- 개인정보: token/auth 파일/raw secret을 prompts·Jira·카드·로그에 저장하지 않는다. 다운로드는 사용자별 권한 및 만료를 검증한다.
- 의사결정: 권고 B를 제안한다. 별도 비용 활성화나 원본 데이터 마이그레이션은 이 문서로 승인하지 않는다.
- 구현 상태: 본 문서는 설계이며 F03–F17 구현 완료 또는 live 지원의 증거가 아니다.
