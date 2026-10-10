---
okf_version: 0.2
---

# TeamsApp release knowledge bundle

이 OKF bundle은 TeamsApp 릴리스 실패, 공식 계약, 재발 방지 게이트, FAQ를 한 곳에서 관리한다. 릴리스·Azure·Teams·A2A 작업 시작 전에 이 index와 필요한 concept 문서를 읽는다.

## Concepts

* [Safe CLI launch metadata](cli-launch-metadata.md) - MP377 immutable prelaunch model/effort/version, provider observations kept separate, cancellation and privacy gates

* [Fixed Luna CLI and saved execution views](luna-and-execution-presentation.md) - MP368/369 fixed Teams-only launcher policy, real optional OSS SDK and independent live gates

* [Worker receipt adapter propagation](worker-receipt-adapter-propagation.md) - MP366 source/time/platform transport, shape versus authenticity and hash-bound RED/GREEN
* [CLI command terminal observation](codex-command-terminal-observation.md) - MP364 pinned wire, adapter/store loss, privacy RED/GREEN and independent live gates
* [Tab prompt bounds and mutation failures](tab-prompt-and-mutation-errors.md) - MP360/361 distinct source and fixture defects, bounded synthetic126 observations and candidate127 gates
* [Core native plan tool availability](codex-native-plan-tool-config.md) - MP358 official opt-in default, launch RED/GREEN and actual todo lifecycle
* [Strict source typecheck and preserved user files](strict-source-typecheck.md) - MP352–355 clean baseline, strict semantic CI and SDK payload preservation
* [Codex JSONL 계획 업데이트와 완료 결과](codex-jsonl-todo-updates.md) - MP-351 producer lifecycle, RED/GREEN, 중복 부작용과 실제 pin/운영 경계 분리
* [실패 이력과 원인](failure-history.md) - Run 26–54와 이전에 확인된 실패군, 개선 및 현재 판정
* [팀 배포 FAQ](faq.md) - 공식 계약과 내부 증거를 질문·답변으로 정리한 운영 FAQ
* [재발 방지 릴리스 게이트](gates.md) - source, artifact, Azure, runtime, Teams, 종료 조건
* [공식 계약 참조](official-contracts.md) - Google OKF, Microsoft Azure, Teams 공식 문서의 URL·섹션·관찰 line
* [설치본·런타임 독립 증거](installation-observations.md) - 2026-10-06 공식 계약 재확인, 실행 가능한 설치/현재 런타임/데스크톱 판정과 Dev Tunnel 안내 구분
* [Azure DevOps·Linux VM/ACA 근본원인 지식그래프](../../research/2026-09-07-azure-devops-linux-vm-root-cause.md) - Run 32–54와 Azure 배포 책임 경계의 공식 계약 대조, root-cause 분류, 목표 구조

* [개인 작업 카드 페이지](job-card-pages.md) - 같은 activity의 페이지 상태와 Core 기본/Universal opt-in 계약

* [A2A read-back snapshot 경쟁](a2a-readback-race.md) - 간헐 회귀 검사의 stale write 재현과 순수 read-back
* [103→111 기능·설치·런타임 독립 판정](functional-version-boundaries.md) - 실제 manifest 능력 차이, 현재111 read-back, 기능별 회귀와 남은 UI 게이트
* [Codex 후속 세션·합성 Git fixture](codex-followup-session-contract.md) - ephemeral native resume 결함과 별도 합성 승인 시험의 RED/GREEN
* [Catalog·carousel 계약과 후보 릴리스](catalog-carousel-release113.md) - 최신 Teams 카드 컬렉션/기존 앱 업데이트,112 서비스 유지와 후보 fixture/live 독립 판정
* [A2A completion fingerprint 속성 순서](a2a-completion-fingerprint-order.md) - MP345의 실제 accepted binding과 합성 restart RED, receipt 보존 및 새 후보 검증 경계
* [캐러셀 본문 여백](carousel-content-inset.md) - MP347의116 실제 화살표 겹침, 최소 Container 후보와 RED/GREEN 및 새 릴리스 UI 경계
* [개인 알림 체크박스 배치](personal-notification-layout.md) - MP349의 실제 분리 배치, native label 유지, 렌더링 RED/GREEN과 독립 live 검증 경계

## Reading order

1. failure-history.md
2. official-contracts.md
3. gates.md
4. faq.md
5. log.md
6. ../../research/2026-09-07-azure-devops-linux-vm-root-cause.md

## Trust rule

이 bundle은 실행 당시 관찰한 증거의 snapshot이다. 각 concept의 verified, status, stale_after와 sources를 확인한다. stale_after 이후에는 최신 공식 문서와 최신 run read-back으로 갱신하기 전까지 live 성공의 근거로 사용하지 않는다.
