# Teams 데스크톱 AX/픽셀 표면 불일치 진단

작성일: 2026-08-10 22:39 KST
릴리스: `1.0.31`
공개 origin: `https://dxshc7dx-3978.jpe1.devtunnels.ms`
판정: `DESKTOP_BLOCKED`

## 재현 조건

기존에 로그인된 Microsoft Teams 데스크톱 창에서 동일한 `업무 허브` 채팅을 사용했다. 새 창이나 새 로그인 세션은 만들지 않았다.

1. 픽셀 캡처에서 `업무 허브` 개인 탭의 `오늘` 화면이 보이는 상태를 캡처한다.
2. 최신 접근성 트리에서 기존 봇 채팅 행을 클릭한다.
3. 접근성 트리는 `채팅` 탭 선택과 메시지 입력 영역을 보고하지만, 같은 시점의 픽셀 캡처는 계속 `오늘` 탭과 `내 업무 열기`를 보인다.
4. 같은 상태에서 Teams 호스트 새로고침(`super+r`)을 수행한다.
5. 6초 후 다시 캡처해도 접근성 트리는 `채팅` 탭, 픽셀 캡처는 `오늘` 탭으로 남는다.
6. 픽셀 위치의 `내 업무 열기`를 클릭해도 픽셀 화면은 변하지 않고 접근성 트리의 숨은 채팅 composer가 포커스를 얻는다.

## 증거

| 단계 | 픽셀 캡처 | 접근성 트리 | 관찰 결과 |
| --- | --- | --- | --- |
| 채팅 행 클릭 후 | `/tmp/teams-desktop-1.0.31-bot-chat-row-after.png` | `/tmp/teams-desktop-1.0.31-bot-chat-row-after-ax.txt` | AX는 `tab (selected) 채팅`, 픽셀은 `오늘` |
| 호스트 새로고침 후 | `/tmp/teams-desktop-1.0.31-after-host-refresh.png` | `/tmp/teams-desktop-1.0.31-after-host-refresh-ax.txt` | 새로고침 후에도 동일 |
| 픽셀 `내 업무 열기` 클릭 후 | `/tmp/teams-desktop-1.0.31-work-coordinate-after.png` | `/tmp/teams-desktop-1.0.31-work-coordinate-after-ax.txt` | AX composer 포커스, 픽셀은 오늘 화면 유지 |
| OS 앱 캡처 | `/var/folders/q6/hjw2kzp543s99f0rhdm77b5m0000gn/T/codex-shot-2026-08-10_22-39-44.png` | 해당 시점의 위 AX 파일 | 실제 화면은 오늘 탭 |

## 판정과 다음 조치

- 이는 현재 증거만으로 앱 소스 결함이라고 단정할 수 없다. Teams 데스크톱 호스트의 접근성 대상과 전면에 보이는 WebView가 서로 다른 표면을 가리키는 현상으로 분류한다.
- 이 상태에서는 `채팅 메시지 전송`, `탭 버튼`, `위치 권한`, `업무 CRUD`를 데스크톱 PASS로 기록하지 않는다. AX만으로 전송 성공을 주장하지 않는다.
- 동일 창에서 화면과 접근성 대상이 다시 일치하거나, 사용자에게 보이는 Teams 웹/모바일 표면에서 전후 캡처를 얻은 뒤에만 해당 매트릭스 행을 갱신한다.
- 공개 health와 Core 테스트는 이 UI 차단을 해소하지 않으므로 `DESKTOP_READY`로 승격하지 않는다.
