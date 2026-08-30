# Teams 에이전트 작업공간 벤치마크

## 조사 범위

이 문서는 2026-08-31 기준으로 Block Buzz 저장소와 GitHub의 공식 Copilot-in-Teams 문서를 대조해, 현재 TeamsApp에 재사용할 수 있는 설계만 분리한 기록이다. Buzz를 이 저장소에 복사하거나 Teams가 Buzz/Nostr 프로토콜을 지원한다고 해석하지 않는다. 이번 문서는 공식 저장소·문서의 구조 조사이며, 실제 Buzz 설치/운영 또는 GitHub Copilot 유료 서비스 연결의 증거가 아니다.

## 확인된 외부 계약

### Block Buzz

Buzz는 자체 호스팅 가능한 workspace이며, relay를 하나의 진실 공급원으로 두고 사람·에이전트·workflow·git 이벤트를 서명된 이벤트 로그에 기록한다. 에이전트는 사람과 구별되는 키·채널 멤버십·감사 기록을 가진다. 공식 quick start는 Docker/Rust/Node/pnpm/just 기반이고, production Compose는 Postgres·Redis·MinIO·TLS를 포함하는 단일 노드/VPS 경로다. `buzz-cli`는 에이전트 도구 호출을 위한 JSON in/JSON out 인터페이스다.

현재 TeamsApp에 재사용할 패턴:

1. 작업 제출·진행·승인·완료·실패·취소를 하나의 서버 소유 event ledger로 남긴다.
2. 에이전트별 identity와 권한 범위를 작업 기록에 고정하고, 다른 에이전트나 사용자로 조용히 전환하지 않는다.
3. Git branch, CI, review, merge 결정을 같은 작업 단위와 release identity에 연결한다.
4. 긴 작업은 즉시 acknowledgement를 반환하고, durable 상태·재시작 복구·감사 조회를 별도로 제공한다.

차용하지 않는 부분:

- Nostr/NIP 서명 이벤트, Buzz relay WebSocket, Buzz desktop UI를 Teams Bot/TeamsJS 개인 탭의 계약으로 사용하지 않는다.
- Buzz의 Postgres/Redis/MinIO 운영 스택을 현재 file-json-single-process 서버에 부분 도입하지 않는다. 외부 서버로 옮길 때 저장소·큐·worker 분리를 먼저 설계한다.

### GitHub Copilot in Microsoft Teams

GitHub 공식 문서는 Teams에서 GitHub 앱을 설치하고 `@GitHub`로 Copilot cloud agent 세션을 시작하는 흐름을 설명한다. 이 기능은 유료 Copilot 플랜·Teams 계정·Public Developer Preview·Cloud Sandbox 활성화가 필요하다. 개인 메시지는 연결된 GitHub 개인 계정의 권한을 사용하고, 공유 채널/스레드는 앱 identity로 artifact를 만들며 repository ruleset에 추가 승인이 필요할 수 있다. 전체 대화 스레드가 agent context가 되므로 민감한 내용은 DM 등 범위를 제한해야 한다.

현재 TeamsApp과의 대조:

| 항목 | GitHub Copilot Teams | TeamsApp 현재 경계 |
| --- | --- | --- |
| 작업 실행 | GitHub가 관리하는 cloud sandbox | 서버가 명시적으로 허용한 Codex/선택 provider runner |
| identity | DM의 사용자 또는 공유 context의 GitHub app identity | tenant/user scope + provider/agent identity |
| 결과물 | GitHub issue/PR/artifact | Teams 카드·작업 상태·서버 event ledger·A2A 결과 |
| 권한 | GitHub write access, 조직 정책, Copilot plan | Teams/Entra auth, provider isolation, 서버 allowlist |
| 완료 조건 | GitHub artifact와 approval policy | 동일 release identity의 CI·패키지·public runtime·Teams UI 증거 |

따라서 `@GitHub` 통합이 설치·활성화됐다고 가정해 현재 Codex runner를 대신하지 않는다. 필요하면 나중에 GitHub issue/PR webhook 또는 공식 GitHub app을 별도 adapter로 연결하되, Core Teams 기능과 optional provider를 분리한다.

## 저장소에 반영된 결과

- `src/server/agent-event-store.ts`와 AgentService lifecycle callback은 Buzz의 event-ledger/audit 방향을 Teams·tenant·job scope, redaction, atomic persistence, bounded retention으로 번역한다.
- A2A collaboration audit는 child key, role, agent/provider identity, status를 기록하고 실패 시에도 Core Teams 응답을 중단시키지 않는다.
- 외부 컨테이너 workflow는 source commit, package version, ZIP/server/client SHA, image digest, public health, revision readiness를 묶으며, 실제 GitHub Copilot cloud sandbox나 Buzz relay 연결을 성공으로 표시하지 않는다.

## 남은 검증 경계

- Buzz 실제 설치·relay 기동·`buzz-cli` 왕복은 별도 실험 증거가 필요하다.
- GitHub Copilot Teams는 유료 플랜, 조직 정책, cloud sandbox, Teams 설치와 실제 issue/PR 세션 증거가 필요하다.
- 현재 A2A/Codex는 fixture 및 bounded Core 검증을 통과했지만, 독립 인증 home을 가진 실제 worker의 live round trip은 아직 미검증이다.

## 공식 1차 출처

- Block Buzz repository: <https://github.com/block/buzz>
- GitHub Changelog, shared agentic work in Teams: <https://github.blog/changelog/2026-08-21-shared-agentic-work-with-github-copilot-in-microsoft-teams/>
- GitHub Docs, integrating Copilot cloud agent with Teams: <https://docs.github.com/en/copilot/how-tos/copilot-integrations/integrate-cloud-agent-with-teams>
- Microsoft Teams SDK overview: <https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/teams-sdk-overview>
- Microsoft Teams bot overview: <https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/create-a-bot-for-teams>
