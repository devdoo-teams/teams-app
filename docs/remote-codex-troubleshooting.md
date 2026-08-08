# Teams 원격 Codex 트러블슈팅

## 목적

Teams Bot에서 실행되는 Codex CLI 작업이 부모 Codex 앱의 브라우저 상태를 볼 수 없다는 실행 경계를 명확히 하고, 인증·업로드·모바일 기능 문제를 서로 다른 케이스로 진단한다.

## 실행 경계

| 확인 대상 | 확인 방법 | 원격 Codex 작업에서 직접 해결 가능 여부 |
| --- | --- | --- |
| Codex CLI 인증 | `codex login status` | 상태 확인 가능, 대화형 인증은 사용자 승인 필요 |
| Teams CLI 인증 | `teams status` | 상태 확인 가능, 디바이스 인증은 사용자 승인 필요 |
| Codex 앱 인앱 브라우저 | 부모 Codex 세션의 로그인된 기존 탭 | 가능(기존 탭 재사용) |
| 사용자 iPhone Teams 권한 | 실제 iPhone Teams 앱 | 불가 |
| 패키지 생성·검증 | `npm test`, `npm run package:app` | 가능 |
| Developer Portal 업로드 | 로그인된 부모 브라우저 또는 Teams Admin Center 기존 앱 상세 | 부모 세션에서만 가능 |
| CLI sideload | `teams app ...` | Teams 사용자 정책에 따라 차단될 수 있음 |

## 케이스별 대응

### `Browser is not available`, `iab unavailable`

Teams Bot에서 실행된 하위 Codex 프로세스가 부모 Codex 앱의 인앱 브라우저를 직접 제어하려고 시도한 것이다. 하위 프로세스에서 브라우저 재연결을 반복하지 않는다. 부모 Codex 오케스트레이터가 기존 로그인 탭을 URL·제목으로 확인해 재사용하고, 없을 때만 사용자에게 탭을 열도록 요청한다.

1. 로컬 코드·패키지·검증을 완료한다.
2. 부모 세션에서 로그인·Developer Portal 업로드가 필요한 정확한 단계 하나만 보고한다.
3. 브라우저 연결이 없다는 이유로 CLI 인증 실패라고 단정하지 않는다.

### Codex CLI 인증 실패

`codex login status`로만 판단한다. `teams status`나 Microsoft 웹 세션을 근거로 Codex CLI 로그인 완료를 주장하지 않는다. 로그인이 필요하면 `codex login --device-auth` 흐름을 별도 승인 단계로 안내한다.

### Teams CLI 인증 실패

`teams login --device-code` → 사용자가 Microsoft 디바이스 페이지에서 승인 → `teams status`가 `Logged in`인지 확인하는 단일 흐름을 사용한다. Teams CLI 인증과 Codex CLI 인증을 섞지 않는다.

### `sideloading not allowed`, `Upload custom apps`

코드나 ZIP 문제가 아니다. Developer Portal의 앱 가져오기는 CLI sideload 정책과 별개다. Portal 업로드를 시도하고, CLI 설치가 필요하면 Teams Admin Center의 사용자 앱 설정 정책을 관리자에게 요청한다.

동일 앱 ID를 업데이트할 때 Teams Admin Center의 `동작 → 새 앱 업로드`를 사용하면 “앱 ID가 동일한 앱이 이미 카탈로그에 있다”는 오류가 난다. `앱 관리`에서 사용자 지정 앱을 검색하고 기존 앱 상세의 `새 버전 → 파일 업로드`를 사용한다. 업로드 후 상세 화면의 `게시된 버전`을 직접 확인한다.

### `APPLICATION_ID_URI` 불일치

`.env`의 실제 Entra Application ID URI와 매니페스트 `webApplicationInfo.resource`를 맞춘다. Dev Tunnel의 `api://<domain>/<client-id>`를 추측해 실제 등록값을 덮어쓰지 않는다. 실제 Entra 등록값을 바꾸는 작업은 별도 관리자 권한과 SSO 재동의가 필요하다.

### 인앱 브라우저와 Dev Tunnel 재사용

- 기존 Developer Portal·Teams Admin Center·Teams 채팅·공개 Teams 탭을 닫지 않고 재사용한다.
- 같은 URL을 불필요하게 다시 로드하지 않으며, 로그인·Auth 앱 승인·파일 선택 중인 탭을 새로 만들거나 교체하지 않는다.
- Dev Tunnel 디바이스 코드가 차단되면 `devtunnel user login --use-browser-auth --entra`를 사용한다. 사용자 비밀번호와 Auth 앱 승인은 사용자가 직접 처리한다.
- `devtunnel show <tunnel-id> --json`의 `ports[].portUri`를 실제 공개 주소로 사용한다. tunnel ID와 호스트명이 같다고 가정하지 않는다.
- 공개 주소가 바뀌면 매니페스트 도메인과 패키지를 함께 갱신하고 기존 앱 업데이트 절차를 반복한다.

### Teams 모바일 Bot 무응답과 오래된 메시징 엔드포인트

공개 탭의 `/api/health`가 정상이어도 Teams 관리 봇 등록의 `messagingEndpoint`가 이전 Dev Tunnel을 가리키면 모바일 메시지가 Bot까지 도달하지 않는다. 현재 `devtunnel show --json`의 `ports[].portUri`를 기준으로 다음을 실행한다.

```bash
teams app update <external-app-id> \
  --endpoint https://<portUri>/api/messages \
  --json
```

출력의 `updated.endpoint`가 현재 호스트인지 확인하고, `needsReinstall: true`이면 버전 증가·새 ZIP 생성·기존 앱 상세의 파일 업로드·앱 재설치까지 다시 진행한다. 죽은 이전 호스트를 재사용하거나 health 200만으로 모바일 왕복을 완료했다고 판단하지 않는다.

### 패키지 업로드 전 필수 증거

- `npm test` 통과
- 매니페스트 버전 증가
- 생성된 ZIP 내부 `manifest.json` 확인
- `devicePermissions`에 `geolocation` 포함
- 업로드 후 Developer Portal 대시보드의 버전 확인
- 위치 권한 페이지의 `사용자 위치 가져오기` 체크 확인

## 결과 보고 형식

```text
STATUS: READY | BLOCKED | FAILED
EVIDENCE: 실제로 실행하거나 화면에서 확인한 결과
COMPLETED: 완료한 작업
BLOCKER: 남은 단일 블로커 또는 NONE
NEXT ACTION: 가장 작은 해결 행동
```
