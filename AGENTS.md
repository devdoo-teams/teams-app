# Project delivery instructions

- Teams 앱 변경 요청은 아래의 필수 릴리스 워크플로우를 따른다. 구현만 끝내거나 로컬 테스트 결과만으로 완료 처리하지 않는다.
- 소스·매니페스트·패키징·런타임 설정 변경은 Git diff를 확인하고 의미 있는 단위로 커밋한다. 완료 보고에는 해당 커밋 SHA를 포함한다.
- 업로드 전에 반드시 앱 패키지 버전, ZIP 내부의 실제 매니페스트, `devicePermissions`, 배포 환경 검증을 확인한다. 인증정보·환경변수·배포 대상이 없으면 추측하지 말고 업로드 단계에서 멈춘 뒤 누락 항목을 명확히 보고한다.
- 인증정보를 임의로 만들거나 추측하지 않으며, 업로드 대상이 불명확하거나 외부 서비스에 대한 추가 권한이 필요한 경우에는 안전한 범위까지만 진행한다.

## 필수 Teams 변경·배포·완료 워크플로우

Teams 앱 변경 요청에는 별도 예외 승인이 없는 한 다음 순서를 반드시 지킨다. 상세 체크리스트와 보고 템플릿은 [`docs/teams-release-workflow.md`](docs/teams-release-workflow.md)에 있다.

1. 요청사항을 구현하고 로컬 테스트 모드에서 `npm test`, 매니페스트 검증, 필요한 런타임 테스트를 실행한다.
2. 앱 버전을 올리고 새 Teams ZIP 패키지를 생성한다. 이전 ZIP을 재사용하지 않으며, ZIP 내부 매니페스트와 SHA-256을 확인한다.
3. Git 변경사항을 검토하고 커밋한다. 커밋되지 않은 구현 상태를 업로드하지 않는다.
4. 새 패키지를 Developer Portal 또는 승인된 배포 대상에 업로드한다. 업로드 성공 화면·버전·검증 결과를 직접 확인한다. 업로드가 막히면 완료로 보고하지 않는다.
5. 로컬 테스트 프로세스와 `TEAMS_SKIP_AUTH=true`, `TEAMS_SKIP_OUTBOUND=true`를 종료·제거하고, 실제 자격 증명을 로드한 공개 프로세스로 전환한다. 공개 프로세스는 최소한 `auth=teams-authenticated`, `bot=teams-sdk`, `outbound=teams-sdk`를 `/api/health`에서 보여야 한다.
6. 공개 HTTPS URL과 Teams 호스트에서 새 버전의 UI·핵심 명령·변경 기능을 런타임 검증한다. 실제 Teams 대화에서 테스트 메시지를 보내고 Bot 응답 및 필요한 proactive 진행·완료 메시지를 확인한다.
7. 위 업로드·공개 프로세스·Teams 왕복 검증이 모두 끝난 뒤에만 Teams 채팅으로 완료 메시지를 보낸다. 완료 메시지에는 버전, 커밋 SHA, 패키지 검증/업로드 증거, 공개 health 결과, 런타임 테스트 결과를 포함한다.

`local-handler`, `local-outbox`, `local-bypass` 상태를 공개 완료 상태로 간주하지 않는다. 공개 health가 위 기준을 충족하지 않거나 Teams 응답이 확인되지 않으면 완료 메시지를 보내지 말고 `BLOCKER`로 보고한다. 순수 읽기 전용 진단으로 앱 산출물을 변경하지 않은 경우에만 패키지 업로드 절차를 생략할 수 있다.

## Teams 원격 Codex 트러블슈팅 지침

- 이 작업은 Teams Bot이 별도 프로세스로 실행하는 Codex CLI 작업이다. 부모 Codex 앱의 인앱 브라우저, Safari, 사용자의 iPhone을 제어할 수 없으므로 `Browser is not available`, `iab unavailable`을 브라우저 재연결 루프로 처리하지 않는다.
- 인증을 반드시 분리한다. `codex login status`는 Codex CLI, `teams status`는 Teams CLI이며 한쪽 결과를 다른 쪽 인증 증거로 사용하지 않는다.
- 업로드 요청 전에는 `codex login status`, 필요한 경우 `teams status`, 패키지 ZIP의 실제 매니페스트 버전·`devicePermissions`, 배포 환경 검증을 각각 확인한다.
- `sideloading not allowed` 또는 `Upload custom apps`는 코드 오류가 아니라 Teams Admin Center 정책이다. Developer Portal 업로드와 CLI sideload를 구분하고 CLI 재시도 루프를 만들지 않는다.
- `APPLICATION_ID_URI` 불일치는 Entra에 등록된 실제 URI를 보존하고 Dev Tunnel URI를 추측해 바꾸지 않는다. 개발 터널의 SSO 경고와 패키지 업로드 가능 여부를 별도로 보고한다.
- 결과는 반드시 `STATUS / EVIDENCE / COMPLETED / BLOCKER / NEXT ACTION` 형식으로 보고한다. 관찰하지 않은 로그인·브라우저 연결·모바일 GPS·업로드 완료를 주장하지 않는다.
