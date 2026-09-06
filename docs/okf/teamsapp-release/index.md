---
okf_version: 0.2
---

# TeamsApp release knowledge bundle

이 OKF bundle은 TeamsApp 릴리스 실패, 공식 계약, 재발 방지 게이트, FAQ를 한 곳에서 관리한다. 릴리스·Azure·Teams·A2A 작업 시작 전에 이 index와 필요한 concept 문서를 읽는다.

## Concepts

* [실패 이력과 원인](failure-history.md) - Run 26–31과 이전에 확인된 실패군, 개선 및 현재 판정
* [팀 배포 FAQ](faq.md) - 공식 계약과 내부 증거를 질문·답변으로 정리한 운영 FAQ
* [재발 방지 릴리스 게이트](gates.md) - source, artifact, Azure, runtime, Teams, 종료 조건
* [공식 계약 참조](official-contracts.md) - Google OKF, Microsoft Azure, Teams 공식 문서의 URL·섹션·관찰 line

## Reading order

1. failure-history.md
2. official-contracts.md
3. gates.md
4. faq.md
5. log.md

## Trust rule

이 bundle은 실행 당시 관찰한 증거의 snapshot이다. 각 concept의 verified, status, stale_after와 sources를 확인한다. stale_after 이후에는 최신 공식 문서와 최신 run read-back으로 갱신하기 전까지 live 성공의 근거로 사용하지 않는다.
