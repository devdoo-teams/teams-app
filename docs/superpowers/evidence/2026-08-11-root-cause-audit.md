# 반복 실패 근본 원인 감사

## 결론

현재 증거만으로는 긴 대화 컨텍스트가 런타임 장애의 직접 원인이라고 볼 수 없다. 컨텍스트가 길어지면서 이전 상태·배포 버전·검증 증거를 혼동하기 쉬워진 것은 워크플로우 위험이지만, 실제 실패는 로컬 파일 제공자 지연과 오래된 산출물 재사용에서 재현됐다.

## 재현된 원인

1. **오래된 산출물 재사용**
   - 기존 서버 표식은 커밋 SHA만 기록했다.
   - 같은 HEAD에서 tracked worktree가 변경된 상태에서도 번들이 재사용될 수 있어, 현재 소스와 실행 산출물이 달라졌다.
   - 이 때문에 배포·검증 메시지는 최신 변경을 설명하지만 실제 공개 서버는 이전 버전을 계속 제공할 수 있었다.

2. **macOS FileProvider 지연**
   - 원본 로컬 워크스페이스에서 `git status`, `git commit`, `typecheck`가 장시간 정지하거나 timeout됐다.
   - 동일 테스트가 system temp에 커밋된 소스를 물질화하고 런타임 의존성을 별도 캐시로 연결하면 진행됐다.
   - 간헐적으로 esbuild가 `The service was stopped`로 종료됐고, 기존에는 일부 소스 검사에만 bounded retry가 있었다.

3. **검증 순서와 대기 경계 부족**
   - 이전 흐름은 장시간 프로세스를 완료까지 기다리는 동안 새 프로세스·브라우저·배포 상태를 동시에 추적하기 쉬웠다.
   - 공개 엔드포인트, Admin Center 업로드 상태, 설치된 Teams 앱, 데스크톱·모바일 사용자 화면을 동일 릴리스 표식으로 묶는 게이트가 없으면 서로 다른 버전을 확인하게 된다.

4. **실제 라우팅 결함**
   - packaged Teams SDK 런타임에서 `/tabs/home/` 요청이 SDK 정적 탭 미들웨어에 도달하기 전에 `sendFile` 분기로 들어가 404가 됐다.
   - 이는 Core runtime smoke에서 직접 재현됐고 trailing-slash 요청을 다음 정적 라우트로 넘기도록 수정했다.

## 적용한 방지책

- 서버 산출물 표식을 `schemaVersion: 2`, `commit`, `mode`, `worktree: clean`으로 고정했다.
- FileProvider fallback은 tracked worktree가 clean일 때만 허용하고, Git 검사 timeout은 즉시 실패시킨다.
- 소스와 의존성을 system temp에서 물질화하는 Core 빌드 경로를 사용한다.
- 테스트 child process는 개별 timeout·kill signal·정확한 실패 명령을 남긴다.
- esbuild의 알려진 service-stop 오류만 1회 재시도하고 두 번째 실패에서는 즉시 중단한다.
- `/tabs/home/`와 `/tabs/home`의 canonical redirect/static serving을 Core smoke에서 함께 확인한다.
- `AGENTS.md`와 `docs/teams-release-workflow.md`에 위 게이트와 “배포 완료 전 동일 버전 증거 필수” 규칙을 반영했다.

## 검증 증거

- 코드 수정 검증 커밋: `77b65b8c8ef70f5a8ad7f58c4a152514d8d1b461`
- 감사 문서 포함 HEAD: `64fbe168b9ee54ea8253403585da6bdc31495221`
- Core 서버 표식: `schemaVersion=2`, 동일 커밋, `mode=core`, `worktree=clean`
- system temp clean worktree에서 Core server build 성공
- 마지막 재빌드에서 esbuild service-stop이 실제 발생했으나 bounded 1회 재시도로 성공
- `core-runtime-smoke`: health와 `/tabs/home/` 모두 통과
- `core-bundle-boundary`: 선택적 CopilotKit/MCP 파일이 Core 산출물에 없음
- `server-build-mode`: Core/optional 표식 계약 통과
- 전체 bounded `test:core`: 통과

## 남은 릴리스 블로커

- 이 커밋이 Teams Admin Center에 업로드되거나 공개 엔드포인트·설치 앱·데스크톱·모바일에 동일 버전으로 전파됐다는 증거는 아직 없다.
- 기존 Teams 웹 탭은 연결 오류 상태였고, Admin Center에는 파일 선택 대화상자가 남아 있었다.
- 따라서 현재 상태를 사용자용 “배포 완료”로 보고하거나 모바일 확인을 완료 처리하면 안 된다.
