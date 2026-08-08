# Teams 데스크톱 런타임 스크린샷 검증

이 절차는 사용자가 모바일 Teams 스크린샷을 제공하지 않아도 배포된 Teams 앱의 일반 동작을 오케스트레이터가 직접 확인하기 위한 필수 런타임 게이트다. 모바일 전용 동작을 데스크톱 결과로 추정하지 않는 것이 이 문서의 핵심 제약이다.

## 검증 범위

데스크톱 Teams에서 다음을 실제 화면으로 확인한다.

- 로그인된 대상 계정과 `업무 허브` 채팅
- 공개 프로세스에서 수신한 실제 Bot 답장
- Adaptive Card가 렌더링되고 동일 내용의 회색 top-level 텍스트 버블이 중복되지 않는지
- `채팅`, `업무 허브`, `정보` 탭과 변경된 개인 탭 UI
- 이번 변경의 핵심 버튼·상태·진행 메시지·완료 메시지

다음은 데스크톱 검증으로 통과 처리하지 않는다.

- iOS Teams WebView의 실제 화면 크기와 스크롤
- Teams 모바일 앱의 앱별 권한 UI
- iPhone의 위치 서비스와 GPS 결과
- 모바일에서만 발생하는 푸시·백그라운드·저대역폭 동작

위 항목은 최종 보고에 `MOBILE_UNVERIFIED`로 명시한다.

## 실행 절차

1. 기존 Teams 데스크톱 창을 재사용한다. 사용자 로그인·Auth 앱 승인·잠금 해제가 필요한 경우에는 사용자에게 넘기며 새 로그인 세션을 반복해서 만들지 않는다.
2. Computer Use의 `node_repl`에서 `@oai/sky`를 초기화하고 Teams 앱 상태를 읽는다.

```js
globalThis.sky = globalThis.sky ?? (await import("@oai/sky")).sky;
var state = await sky.get_app_state({app: "com.microsoft.teams2"});
nodeRepl.write(state.text);
```

3. `state.screenshot`이 있으면 파일 URL을 읽어 `nodeRepl.emitImage`로 Codex 패널에 표시한다. 접근성 트리와 스크린샷을 같은 시점의 증거로 취급한다.
4. `업무 허브` 채팅을 확인하고 기존 배포 채팅의 실제 명령을 사용한다. 기본 확인 명령은 `help`, `status`, `list`이며, 변경 기능에 맞는 고유 테스트 명령을 하나 추가한다.
5. 메시지 전송·탭 클릭·스크롤 뒤에는 항상 `sky.get_app_state`를 다시 호출한다. 이전 상태의 `element_index`를 재사용하지 않는다.
6. 최신 상태에서 다음을 확인하고 전·후 스크린샷을 남긴다.

   - 보낸 명령이 대상 채팅에 표시되는가
   - Bot 답장이 공개 프로세스에서 실제로 도착했는가
   - 카드 내용이 요청 결과와 일치하는가
   - 카드와 같은 텍스트가 별도 버블로 중복되지 않는가
   - `업무 허브` 개인 탭이 열리고 변경된 UI가 보이는가
   - 장시간 작업이면 진행·승인·취소·완료 상태가 순서대로 보이는가

7. 보고서에 창 제목, 시각, 명령, 작업 ID, 접근성 핵심 텍스트, 스크린샷, 앱 버전, 공개 health, 커밋 SHA를 기록한다.
8. 현재 release loop의 package SHA와 커밋을 포함한 evidence JSON을 만들고 등록한다. 데스크톱 검증 전에 Teams 앱 정보 화면에서 설치 버전이 현재 ZIP과 일치하는지 별도로 확인하고 `installedVersion`을 등록해야 한다.

```bash
npm run release:loop -- evidence --file /absolute/path/desktop-evidence.json
```

등록된 증거는 포털·설치본 확인 이후의 현재 run에만 귀속된다. 화면을 확인하지 못한 경우 파일을 만들거나 명령을 실행해 `DESKTOP_READY`로 바꾸지 않는다.

## 판정

- `DESKTOP_READY`: Teams 데스크톱에서 실제 메시지·답장·카드·탭 UI를 직접 확인함
- `DESKTOP_BLOCKED`: Teams 앱이 로그아웃·잠금·추가 인증 또는 공개 엔드포인트 오류로 화면 확인 불가
- `MOBILE_UNVERIFIED`: 데스크톱은 통과했지만 iOS 전용 동작을 직접 확인하지 못함

`DESKTOP_READY`는 API 테스트나 로컬 Activity 합성만으로 선언할 수 없다. 또한 `MOBILE_UNVERIFIED`를 모바일 통과로 바꾸어 보고하지 않는다.
