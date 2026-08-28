# Teams 모바일 위치 날씨 계약 및 검증 경계

검증일: 2026-08-20

## 공식 계약

이 문서는 모바일 Teams WebView의 위치 날씨 기능을 `src/client`에서 해석하는 기준이다.

1. [TeamsJS location capability](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/location-capability)는 Teams 네이티브 위치 경로를 `location.getLocation`/`showLocation`으로 정의하고, 앱 매니페스트에 다음 권한을 선언하도록 한다.

   ```json
   "devicePermissions": ["geolocation"]
   ```

   `getLocation({ allowChooseLocation: false, showMap: false }, callback)`의 성공만 `source: "teams-native"`의 근거가 될 수 있다. `PERMISSION_DENIED`(1000), `NOT_SUPPORTED_ON_PLATFORM`(100), timeout, user abort는 각각 실제 SDK 결과로 기록해야 한다.

2. [Teams browser device permissions](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/device-capabilities/browser-device-permissions)는 브라우저 기반 탭의 권한이 일반 브라우저 권한만으로 끝나지 않고 Teams의 앱별 **App permissions**에서 활성화되어야 한다고 설명한다. 사용자가 권한을 변경한 뒤 Teams 탭을 다시 로드해야 하며, 앱은 이 위치와 절차를 안내해야 한다.

3. [New Microsoft Teams client limitations](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/teams-updates)는 새 Teams 클라이언트에서 TeamsJS Location API가 지원되지 않는 경우 HTML5 Geolocation API를 사용하도록 안내한다. 따라서 HTML5 경로와 TeamsJS 네이티브 경로는 호스트별 선택지이지 서로의 검증 증거가 아니다.

4. [Teams tab context](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/access-teams-context)의 TeamsJS v2 context는 `context.app.host.clientType`와 `context.app.host.name`을 제공한다. 현재 앱은 이 값을 `src/client/App.tsx`에서 위치 서비스의 런타임 정보로 정규화한다.

## 코드 기준의 원인

기존 `createClientLocationService`의 `allowTeamsNativeFallback` 기본값은 `true`였다. iOS/Android에서 HTML5 위치 요청이 실패하거나 지연되면 deprecated `location` 또는 preview `geoLocation` API로 넘어갈 수 있었다. 이 경로가 사용되면 사용자가 제공한 증거처럼 Teams 네이티브 위치 요청 대기/권한 안내가 표시될 수 있다.

현재 수정은 다음과 같다.

- `src/client/location.ts`: 네이티브 fallback 기본값을 `false`로 변경했다.
- `src/client/App.tsx`: Core 앱은 계속 `allowTeamsNativeFallback: false`를 명시한다.
- 네이티브 호환성 경로는 테스트나 별도 호환 호스트가 `allowTeamsNativeFallback: true`를 명시할 때만 활성화한다.
- 모바일 HTML5 요청은 `enableHighAccuracy: true`, `maximumAge: 0`으로 새 기기 fix를 요청한다. 이는 캐시된 데스크톱 위치를 재사용하지 않도록 하는 요청 옵션이지, 모바일 기기 위치가 실제로 반환됐다는 증거가 아니다.
- 런타임 배지는 HTML5 경로를 `Teams 탭 · 네이티브 위치`로 표시하지 않고 `Teams 탭 · 기기 위치 권한`으로 표시한다.
- 브라우저 권한 오류는 Teams 탭의 App permissions, 모바일 OS 권한, 탭 새로고침을 함께 안내한다.

현재 매니페스트의 `devicePermissions`에는 `geolocation`이 이미 포함되어 있으며, 이 작업에서는 매니페스트나 버전 파일을 수정하지 않았다.

## RED → GREEN 재현

추가된 `testDefaultTeamsLocationUsesHtml5OnNewMobileHosts`는 iOS Teams context, 지원되는 legacy/preview 네이티브 API, 성공하는 HTML5 위치 provider를 함께 구성한다.

- 수정 전 RED: `teams-native` 좌표가 반환되고 `browserCalls === 0`이었다.
- 수정 후 GREEN: 모바일 HTML5 좌표가 반환되고 `browserCalls === 1`, 네이티브 호출은 `0`이다.

실행 명령:

```bash
npm run test:client-location
```

이 테스트의 `source: "browser"` 결과는 HTML5 provider 선택만 검증한다. TeamsJS `location.getLocation` 성공이나 Teams 모바일 권한 승인을 검증하지 않는다.

## 증거 분류

| source | 의미 | Teams 네이티브 증거인가 |
| --- | --- | --- |
| `browser` | `navigator.geolocation`이 반환한 HTML5 위치 | 아니오 |
| `teams-native` | TeamsJS `location`/명시적 호환 `geoLocation` 결과 | 코드·SDK 호출 증거만 가능; 실제 모바일 권한은 별도 확인 필요 |
| `demo` | 위치를 얻지 못한 상태의 표시값 | 아니오 |

실제 모바일 PASS에는 다음이 모두 필요하다.

- 동일 릴리스 identity의 iOS 또는 Android Teams 앱 설치본
- Teams 탭의 App permissions에서 geolocation을 허용하고 탭을 새로고침한 실제 흐름
- 위치 권한 요청 전후 화면 캡처와 실제 반환 좌표/정확도
- 날씨 요청에 같은 좌표가 전달된 네트워크 또는 서버 증거
- 성공·거부·timeout·reload/retry 분기의 모바일 화면 증거

위 증거가 없는 현재 상태는 `MOBILE_UNVERIFIED`다. 데스크톱 테스트, HTML5 fixture, 단위 테스트, 매니페스트의 `geolocation` 선언만으로 모바일 PASS 또는 TeamsJS 네이티브 PASS를 기록하지 않는다.
