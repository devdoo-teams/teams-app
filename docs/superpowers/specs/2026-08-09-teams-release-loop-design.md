# Teams 앱 단일 릴리스 루프 설계

**Date:** 2026-08-09

## 목표

버그 수정과 신규 기능 변경을 같은 검증 루프로 처리한다. 루프는 로컬 검증에서 시작해 패키지 생성, Git 기준점 확보, 공개 프로세스 health, 포털 업로드·설치 버전, Teams 데스크톱·모바일 확인, 사용자 확인, 완료 메시지 판정까지 연결한다.

## 현재 문제

기존 `release-gate`는 타입체크·전체 테스트·환경·ZIP·공개 HTTP를 묶지만, 브라우저에서 관찰해야 하는 업로드·설치 버전·데스크톱·모바일 증거는 문서에만 존재한다. 이 때문에 기계 검증이 통과해도 실제 설치본이 이전 버전이거나 사용자 모바일 왕복이 확인되지 않은 상태에서 작업이 종료될 위험이 있다.

## 권장 설계

`scripts/release-loop.mjs`를 얇은 상태 머신으로 추가한다. 기존 `scripts/release-gate.mjs`는 기계 검증의 단일 소스로 유지하고, release loop는 다음 세 가지 책임만 가진다.

1. 현재 Git commit, 앱 버전, ZIP SHA-256, 공개 health를 하나의 run 상태에 묶는다.
2. 브라우저·데스크톱·모바일에서 관찰한 외부 증거를 명시적으로 등록하고 현재 run과 일치하는지 검증한다.
3. 모든 필수 게이트가 통과할 때만 표준 완료 보고서와 Teams 전송용 메시지를 생성한다.

상태 파일은 `.release/` 아래에 두며 토큰, 비밀번호, API key, 메시지 본문 원문을 저장하지 않는다. 외부 화면 증거의 경로·관찰 시각·표면·요약·커밋·버전·패키지 SHA만 저장한다. `.release/`는 Git에 올리지 않고, 완료 시 비밀이 없는 요약 보고서만 별도 커밋할 수 있다.

## 상태와 명령

```text
INIT
  -> MACHINE_READY
  -> PACKAGE_READY
  -> PUBLIC_READY
  -> PORTAL_READY
  -> INSTALLED_READY
  -> DESKTOP_READY
  -> MOBILE_READY
  -> COMPLETE
```

실패·재시작은 현재 상태를 보존하고 마지막 통과 단계부터 재개한다. 다음 명령을 제공한다.

```bash
npm run release:loop -- start       # 새 run 생성, 현재 clean Git 기준점 기록
npm run release:loop -- machine     # release:preflight 실행
npm run release:loop -- package     # 새 ZIP·매니페스트·SHA 기록
npm run release:loop -- public      # 공개 health/tab 기록
npm run release:loop -- status      # 현재 상태와 다음 게이트 출력
npm run release:loop -- evidence --file <evidence.json>
npm run release:loop -- complete    # 모든 게이트 통과 때만 완료 보고서 출력
```

`machine`, `package`, `public`은 기존 gate를 호출하고 성공한 결과만 상태에 반영한다. `start`와 `package`는 dirty worktree를 거부하여 커밋되지 않은 소스가 업로드 대상이 되는 것을 막는다. 공개 서버·Dev Tunnel은 loop가 종료하지 않는다.

## 외부 증거 계약

`evidence` 입력은 아래 필드를 요구한다.

```json
{
  "surface": "portal|installed|desktop|mobile",
  "observedAt": "2026-08-09T12:00:00.000Z",
  "commit": "bb4c0f9...",
  "version": "1.0.13",
  "packageSha256": "...",
  "installedVersion": "1.0.13",
  "summary": "관찰한 사실을 짧게 기록",
  "artifactPaths": ["/absolute/path/screenshot.png"]
}
```

입력은 현재 run의 commit·version·package SHA와 모두 일치해야 한다. `surface=installed`는 Teams 앱 정보 화면에서 읽은 `installedVersion`을 요구하며 현재 ZIP 버전과 정확히 같아야 한다. 카탈로그 게시 버전이나 봇 왕복만으로는 설치본 버전 게이트를 통과할 수 없다. `surface=desktop`은 스크린샷과 접근성/실제 메시지 요약을 요구하고, `surface=mobile`은 사용자가 배포된 Teams 모바일에서 보낸 메시지와 답장 관찰 요약을 요구한다. loop는 파일이 존재하는지만 확인하며 화면 내용을 합성하거나 UI 통과를 추정하지 않는다.

## 완료 판정

`complete`는 다음 조건을 모두 확인한다.

- machine, package, public 단계가 READY
- 포털 업로드와 설치 버전 증거가 현재 ZIP과 일치
- 데스크톱 실제 메시지·카드·탭·스크린샷 증거 존재
- 모바일 사용자 메시지·답장 증거 존재
- Git commit과 worktree 상태가 기록과 일치

조건이 하나라도 없으면 `BLOCKED`와 정확한 게이트 목록을 출력하고 완료 메시지를 만들지 않는다. Teams connector나 브라우저를 자동 재인증하거나, 잠금·Auth 앱·파일 선택을 우회하지 않는다.

## 오류 처리와 복구

- 하위 명령 timeout/비정상 종료는 `MACHINE_BLOCKED`로 기록하고 자식 프로세스 그룹만 정리한다.
- 공개 health가 실패하면 이전 공개 프로세스를 유지한 채 해당 run을 중단한다.
- 증거가 다른 commit·버전·SHA이면 등록을 거부하고 새 package 단계부터 재개한다.
- 설치 버전이 이전 버전이면 `INSTALLED_UNVERIFIED`를 유지한다.
- 완료 후 새 변경이 생기면 새 run을 시작해야 하며 이전 증거를 재사용하지 않는다.

## 테스트 전략

`scripts/release-loop-test.mjs`에서 다음을 검증한다.

- 새 run은 clean Git 기준점을 요구한다.
- 단계 전이는 순서를 지키며 실패 결과는 상태에 반영되지 않는다.
- 다른 commit·버전·SHA의 증거는 거부된다.
- desktop/mobile 필수 증거가 없으면 `complete`가 실패한다.
- 모든 증거가 일치할 때만 완료 보고서가 생성된다.
- 상태 파일에는 비밀 패턴과 원문 메시지 본문이 저장되지 않는다.

실제 Teams 업로드·데스크톱·모바일 확인은 명령어 테스트로 대체하지 않고, 브라우저/Computer Use/사용자 관찰 증거로만 상태를 전진시킨다.
