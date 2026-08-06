# Teams 원격 Codex 트러블슈팅

## 목적

Teams Bot에서 실행되는 Codex CLI 작업이 부모 Codex 앱의 브라우저 상태를 볼 수 없다는 실행 경계를 명확히 하고, 인증·업로드·모바일 기능 문제를 서로 다른 케이스로 진단한다.

## 실행 경계

| 확인 대상 | 확인 방법 | 원격 Codex 작업에서 직접 해결 가능 여부 |
| --- | --- | --- |
| Codex CLI 인증 | `codex login status` | 상태 확인 가능, 대화형 인증은 사용자 승인 필요 |
| Teams CLI 인증 | `teams status` | 상태 확인 가능, 디바이스 인증은 사용자 승인 필요 |
| Codex 앱 인앱 브라우저 | 부모 Codex 세션의 Browser 도구 | 불가 |
| 사용자 iPhone Teams 권한 | 실제 iPhone Teams 앱 | 불가 |
| 패키지 생성·검증 | `npm test`, `npm run package:app` | 가능 |
| Developer Portal 업로드 | 로그인된 부모 브라우저 | 부모 세션에서만 가능 |
| CLI sideload | `teams app ...` | Teams 사용자 정책에 따라 차단될 수 있음 |

## 케이스별 대응

### `Browser is not available`, `iab unavailable`

원격 Codex 프로세스가 부모 Codex 앱의 인앱 브라우저를 제어하려고 시도한 것이다. 브라우저 재연결을 반복하지 않는다.

1. 로컬 코드·패키지·검증을 완료한다.
2. 부모 세션에서 로그인·Developer Portal 업로드가 필요한 정확한 단계 하나만 보고한다.
3. 브라우저 연결이 없다는 이유로 CLI 인증 실패라고 단정하지 않는다.

### Codex CLI 인증 실패

`codex login status`로만 판단한다. `teams status`나 Microsoft 웹 세션을 근거로 Codex CLI 로그인 완료를 주장하지 않는다. 로그인이 필요하면 `codex login --device-auth` 흐름을 별도 승인 단계로 안내한다.

### Teams CLI 인증 실패

`teams login --device-code` → 사용자가 Microsoft 디바이스 페이지에서 승인 → `teams status`가 `Logged in`인지 확인하는 단일 흐름을 사용한다. Teams CLI 인증과 Codex CLI 인증을 섞지 않는다.

### `sideloading not allowed`, `Upload custom apps`

코드나 ZIP 문제가 아니다. Developer Portal의 앱 가져오기는 CLI sideload 정책과 별개다. Portal 업로드를 시도하고, CLI 설치가 필요하면 Teams Admin Center의 사용자 앱 설정 정책을 관리자에게 요청한다.

### `APPLICATION_ID_URI` 불일치

`.env`의 실제 Entra Application ID URI와 매니페스트 `webApplicationInfo.resource`를 맞춘다. Dev Tunnel의 `api://<domain>/<client-id>`를 추측해 실제 등록값을 덮어쓰지 않는다. 실제 Entra 등록값을 바꾸는 작업은 별도 관리자 권한과 SSO 재동의가 필요하다.

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
