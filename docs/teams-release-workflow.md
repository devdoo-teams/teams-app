# Teams 앱 필수 릴리스 워크플로우

이 문서는 Teams 앱 변경 요청의 종료 조건을 정의한다. 로컬 화면이 열리고 `npm test`가 통과한 것만으로는 완료가 아니다.

## 순서

### 1. 구현과 로컬 검증

- 사용자의 요청사항을 코드·매니페스트·문서에 반영한다.
- 로컬 테스트 모드에서 `npm test`와 변경 범위에 맞는 런타임 검증을 실행한다.
- 로컬 테스트 모드의 결과는 개발 증거일 뿐 공개 운영 증거로 보고하지 않는다.

### 2. 새 버전과 패키지

- Teams 앱 버전을 올린다.
- `npm run check:deployment`, `npm run validate:manifest`, `npm run package:app`를 실행한다.
- 생성된 ZIP을 열어 실제 `manifest.json`의 버전, 앱 ID, 도메인, `devicePermissions`를 확인한다.
- ZIP의 SHA-256을 기록한다. 이전 ZIP을 재사용하거나 “패키지를 만들었다”고 추정하지 않는다.

### 3. Git 이력

- `git diff`, `git status`, 테스트 결과를 검토한다.
- 구현·매니페스트·지침 변경을 의미 있는 커밋으로 남긴다.
- 업로드 대상 ZIP은 커밋된 소스와 매니페스트에서 생성한다.

### 4. 실제 업로드

- 승인된 Developer Portal 또는 Teams Admin Center의 배포 대상에 새 ZIP을 업로드한다.
- 업로드 후 대상 화면에서 새 버전과 검증 결과를 직접 확인한다.
- 인증·정책·업로드 대상이 없으면 안전한 범위까지만 진행하고 `BLOCKER`로 보고한다. 성공을 추측하지 않는다.

### 5. 로컬 모드 종료와 공개 프로세스 전환

로컬 테스트 프로세스가 공개 터널 포트를 점유한 채 남아 있지 않은지 확인한다. 공개 프로세스는 실제 자격 증명을 사용하고 다음 우회 설정을 사용하지 않아야 한다.

```bash
set -a
source .env.runtime
set +a
unset TEAMS_SKIP_AUTH TEAMS_SKIP_OUTBOUND
export NODE_ENV=production TEAMS_USE_SDK=true PORT=3978
npm run start
```

공개 URL의 `/api/health`에서 다음을 직접 확인한다.

```json
{
  "auth": "teams-authenticated",
  "bot": "teams-sdk",
  "outbound": "teams-sdk"
}
```

`local-handler`, `local-outbox`, `local-bypass`, `outbound=disabled`가 하나라도 보이면 공개 전환이 완료되지 않은 것이다. 이 상태에서는 완료 메시지를 보내지 않는다.

### 6. 엔드투엔드 런타임 검증

- 공개 HTTPS 탭 URL이 새 UI를 제공하는지 확인한다.
- Teams 호스트에서 변경된 UI와 핵심 명령을 확인한다.
- 실제 Teams 대화에 `status` 또는 변경 기능에 해당하는 테스트 요청을 보내고 답장을 확인한다.
- 장시간 작업이면 진행 메시지, 승인·취소 경계, proactive 완료 메시지까지 확인한다.
- 모바일 기능은 모바일 Teams에서 권한과 실제 화면을 별도로 확인하고, 직접 확인하지 못한 것은 확인했다고 보고하지 않는다.

### 7. Teams 완료 메시지

다음 조건을 모두 충족한 후에만 Teams 채팅에 완료 메시지를 보낸다.

- 새 패키지 생성 및 실제 업로드 확인
- 공개 프로세스 health 기준 충족
- Teams 왕복 응답 확인
- Git 커밋 SHA 확보

완료 메시지에는 최소한 다음을 적는다.

- 앱 버전과 커밋 SHA
- 패키지 검증·업로드 결과와 ZIP SHA-256
- 공개 URL health의 `auth`·`bot`·`outbound` 값
- 실행한 테스트와 Teams 런타임 증거
- 모바일에서 사용자가 이어서 확인할 단계

## 보고 형식

모든 작업 결과는 다음 형식을 사용한다.

```text
STATUS: READY | BLOCKED
EVIDENCE: 관찰한 명령·화면·health·Teams 응답
COMPLETED: 구현·검증·패키지·업로드·공개 전환 결과
BLOCKER: 없으면 NONE, 있으면 정확한 외부 의존성
NEXT ACTION: 사용자 또는 다음 실행자가 할 일
```

업로드, 공개 프로세스 전환, Teams 응답을 직접 관찰하지 못한 경우 `COMPLETED`로 표시하지 않는다.
