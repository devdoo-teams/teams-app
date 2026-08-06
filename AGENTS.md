# Project delivery instructions

- Teams 앱을 변경할 때는 구현과 검증(`npm test`, 매니페스트 검증) 후 업데이트된 Teams 앱 패키지를 생성하고, 저장소에 설정된 배포 대상이 있으면 업로드까지 진행한다. 별도의 재요청을 기다리지 않는다.
- 업로드 전에 반드시 앱 패키지 버전과 매니페스트 권한을 확인하고, 실제 업로드에 필요한 인증정보·환경변수·배포 대상이 없으면 패키지 생성 단계에서 멈춘 뒤 누락된 항목을 명확히 보고한다.
- 인증정보를 임의로 만들거나 추측하지 않으며, 업로드 대상이 불명확하거나 외부 서비스에 대한 추가 권한이 필요한 경우에는 안전한 범위까지만 진행한다.

## Teams 원격 Codex 트러블슈팅 지침

- 이 작업은 Teams Bot이 별도 프로세스로 실행하는 Codex CLI 작업이다. 부모 Codex 앱의 인앱 브라우저, Safari, 사용자의 iPhone을 제어할 수 없으므로 `Browser is not available`, `iab unavailable`을 브라우저 재연결 루프로 처리하지 않는다.
- 인증을 반드시 분리한다. `codex login status`는 Codex CLI, `teams status`는 Teams CLI이며 한쪽 결과를 다른 쪽 인증 증거로 사용하지 않는다.
- 업로드 요청 전에는 `codex login status`, 필요한 경우 `teams status`, 패키지 ZIP의 실제 매니페스트 버전·`devicePermissions`, 배포 환경 검증을 각각 확인한다.
- `sideloading not allowed` 또는 `Upload custom apps`는 코드 오류가 아니라 Teams Admin Center 정책이다. Developer Portal 업로드와 CLI sideload를 구분하고 CLI 재시도 루프를 만들지 않는다.
- `APPLICATION_ID_URI` 불일치는 Entra에 등록된 실제 URI를 보존하고 Dev Tunnel URI를 추측해 바꾸지 않는다. 개발 터널의 SSO 경고와 패키지 업로드 가능 여부를 별도로 보고한다.
- 결과는 반드시 `STATUS / EVIDENCE / COMPLETED / BLOCKER / NEXT ACTION` 형식으로 보고한다. 관찰하지 않은 로그인·브라우저 연결·모바일 GPS·업로드 완료를 주장하지 않는다.
