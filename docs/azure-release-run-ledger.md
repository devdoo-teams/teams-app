# Azure Teams release run ledger

이 문서는 Azure canary 릴리스 시도에서 확인된 실패와 재발 방지 게이트를 append-only 방식으로 기록한다. 플랫폼의 `running`/`succeeded` 상태만으로 완료를 판정하지 않고, Azure DevOps 로그·커밋·receipt·실제 런타임을 서로 대조한다.

팀 배포용 OKF bundle은 [`docs/okf/teamsapp-release/index.md`](okf/teamsapp-release/index.md)다. 릴리스·승인·재시도 전에 OKF의 `failure-history.md`, `official-contracts.md`, `gates.md`, 관련 `faq.md`를 읽고, 새 실패는 concept 또는 `log.md`에 갱신한다. 공식 출처는 URL·문서 제목·섹션/관찰 line range를, 내부 근거는 정확한 `file:line`을 남긴다.

## 판정 규칙

각 실행은 다음 identity를 하나의 묶음으로 취급한다.

- 릴리스 소스 커밋
- 앱/매니페스트 버전
- GitHub release artifact 및 ZIP SHA-256
- 컨테이너 이미지 digest
- Azure preflight/what-if/RBAC receipt
- Azure revision과 `/api/health`
- Teams 포털·데스크톱·모바일 증거

위 항목 중 하나라도 다른 실행의 값을 사용하면 `MIXED_IDENTITY`이며 릴리스 완료가 아니다.

## 실패 이력

| Run | 파이프라인 소스 | 승인 대상 릴리스 | 실패/상태 | 최초 탐지 근거 | 수정 또는 게이트 |
|---|---|---|---|---|---|
| 26 | `71df02e` | `71df02e`, `1.0.103` | `FAIL` | Deploy 단계에서 Key Vault `teams-bot-client-secret`가 없음 | Key Vault secret metadata preflight 및 실제 생성 후 재시도 |
| 27 | `71df02e` | `71df02e`, `1.0.103` | `FAIL` | 현재 5개 Key Vault secret reference 변경이 `Modify`로 나타났지만 preflight allowlist가 구형 3개만 허용 | `45e31b7`의 `azure-canary-preflight` allowlist + `azure-what-if-receipt-test` 회귀 |
| 28 | `45e31b7` | `71df02e`, `1.0.103` | `FAIL` | pre-approval AzureCLI task에서 `HEAD == release commit` 검사가 `az --version` 전에 실패 | source materialization 회귀가 아직 파이프라인에 반영되지 않은 상태 |
| 29 | `dada852` | `71df02e`, `1.0.103` | `FAIL` | run 28의 동일 불일치를 진단 출력으로 재현. `HEAD`가 CI 커밋이고 receipt는 `71df02e` | `dada852`는 실패 출력 보강만 수행; 근본 수정 아님 |
| 30 | `18cea41` | `71df02e`, `1.0.103` | `FAIL` | 사용자가 수동 승인한 뒤 `DeployCanaryRevision`의 단일 AzureCLI task가 `Script failed with exit code: 1`로 종료. Run summary와 실패 job log에는 named boundary·durable failure receipt가 없음 | `UNKNOWN_POST_APPROVAL_DEPLOY_BOUNDARY`; 진단 손실을 재현 테스트로 고정하고 secret-free failure receipt/boundary artifact를 추가. exact failing Azure subcommand는 Run 30에서 복구 불가 |
| 31 | `f6cce7c` | `f6cce7c`를 release artifact로 잘못 지정 | `FAIL_BEFORE_APPROVAL` | authenticated handoff가 `teams-runtime-identity-f6cce7c...`를 0개 반환하고 `ValidateHandoff`에서 종료. GHCR login과 exact source checkout은 통과했고 Azure 승인/변경은 시작하지 않음 | `RELEASE_ARTIFACT_UNAVAILABLE`; pipeline source commit과 deploy-only GitHub release commit을 분리하고 handoff failure receipt/artifact를 보존 |

## 실패에서 승격한 필수 게이트

| Gate | 재발시킬 수 있었던 실패 | 검증 조건 | 구현/증거 |
|---|---|---|---|
| G1 exact source | 28, 29 | 모든 source-consuming Azure task가 receipt의 commit을 `git fetch --no-tags origin "$commit" --depth=1` 후 `git checkout --detach "$commit"`하고, 그 뒤 `HEAD`를 비교 | `azure-pipelines.yml`; `azure-platform-contract-test.mjs` |
| G2 release receipt | 26–30 | commit/version/image/imageDigest가 하나의 검증된 GitHub handoff에서 오고, 파라미터에 임의 URL을 받지 않음 | `azure-release-input.mjs`, `azure-github-handoff.mjs` |
| G3 pre-approval what-if | 27 | foundation what-if은 `--no-pretty-print`, `--validation-level Provider`, property-level result를 사용하고 진단/receipt 생성 후에만 approval로 진행 | `azure-pipelines.yml`, `azure-what-if-receipt.mjs` |
| G4 exact target allowlist | 27 | 허용된 현재 Key Vault 경로만 `Modify`를 허용하고 범위 밖 `Modify/Delete/Deploy/Ignore/Unsupported`는 차단 | `azure-canary-preflight.mjs`, `azure-what-if-receipt-test.mjs` |
| G5 secret metadata | 26 | workload mutation 전에 필요한 Key Vault secret의 이름/상태 metadata를 확인하며 secret value를 읽거나 로그에 남기지 않음 | deploy AzureCLI task, `teams-bot-client-secret` 생성 확인 |
| G6 same-run handoff | 27–30 | deploy가 현재 run의 platform/RBAC/worker/what-if receipt만 다운로드하고 receipt commit과 archive digest를 대조 | `azure-pipelines.yml`, `azure-deployment-contract.mjs` |
| G7 local proof boundary | 모든 run | 로컬 exit 0, fixture PASS, pipeline status만으로 Azure canary/Teams 설치 완료를 주장하지 않음 | release workflow 및 final identity gates |
| G8 approval/deploy separation | 30 | manual approval PASS는 deploy PASS가 아니며, 승인 후 실패는 exact task boundary와 Azure revision/log read-back 없이는 원인 확정 금지 | `docs/okf/teamsapp-release/failure-history.md`, Microsoft deployment-job contract |
| G9 failure receipt | 30 | AzureCLI failure가 발생하면 last named boundary, exit code, source/version/run identity를 secret-free receipt와 pipeline artifact로 보존 | `azure-pipelines.yml`, `scripts/azure-deployment-failure-receipt.mjs`, focused regression |
| G10 deployable release identity | 31 | pipeline source와 `githubReleaseCommit`을 독립 검증하고, release commit에 대해 정확히 하나의 만료되지 않은 이름·head SHA·digest artifact가 없으면 승인 전에 fail-closed | `azure-github-handoff.mjs`, GitHub artifact API contract, handoff failure receipt regression |

## 릴리스 진행 전 하드 게이트 목록

아래 항목은 순서대로 판정한다. `FAIL`, `BLOCKED`, `UNVERIFIED`, `MIXED_IDENTITY`가 하나라도 있으면 다음 단계로 진행하지 않는다.

### A. 소스와 작업공간

1. canonical worktree가 `/Users/doosansmacbookpro/Documents/TeamsApp`인지 확인한다.
2. `main`의 HEAD, origin/main, 큐잉한 pipeline source version을 기록한다.
3. 추적 변경·숨은 stash·설명되지 않은 worktree/detached checkout이 없음을 확인한다.
4. source-consuming Azure task마다 release receipt의 commit을 fetch/checkout한 뒤 `HEAD`를 비교한다. pipeline YAML의 commit과 release artifact commit이 달라도 실패하지 않아야 하며, 오히려 exact release commit으로 materialize되어야 한다.

### B. 불변 릴리스 입력

5. GitHub handoff가 repository, immutable commit, artifact ID, ZIP SHA-256, image digest, 앱 버전을 모두 read-back한다.
6. `package.json`, `appPackage/manifest.json`, ZIP 내부 manifest의 버전/app ID/device permissions가 일치한다.
7. CI 수정이나 재시도만으로 앱 버전을 올리지 않는다. 기능 추가/재현 버그 수정일 때만 재현 테스트·구현 테스트·Core evidence 뒤에 버전을 올린다.
8. 선택 provider, 로컬 우회, 예전 ZIP, 예전 public process의 receipt를 현재 release evidence로 재사용하지 않는다.

### C. Azure 도구와 비파괴 사전검증

9. hosted runner의 `az --version`, Azure DevOps extension, `az bicep version`, Bicep binary path를 로그에서 확인한다.
10. Azure CLI가 호출하는 자식 프로세스에 검증된 Bicep 디렉터리를 PATH 뒤쪽으로만 추가하고 pinned Node를 shadow하지 않는다.
11. `az deployment group what-if`를 `--subscription`, `--resource-group`, `--result-format FullResourcePayloads`, `--no-pretty-print`, `--validation-level Provider`, `--no-prompt true`로 실행한다.
12. what-if raw output, value-free diagnostic, validated receipt의 commit/version/subscription/resource group/template/parameter identity를 같은 run에 보관한다.
13. 현재 Key Vault reference 변경처럼 사전에 승인된 정확한 property path만 `Modify`를 허용한다. 범위 밖 `Modify`, `Delete`, `Deploy`, `Ignore`, `Unsupported`, 모호한 결과는 `REVIEW_REQUIRED` 또는 fail-closed로 둔다.

### D. 권한과 비밀

14. Azure service connection의 tenant/subscription/principal을 ARM access-token claims로 검증하고, resource-group caller permissions receipt가 `READY`인지 확인한다.
15. 필요한 Key Vault secret은 deploy mutation 전에 이름/상태 metadata만 확인한다. secret value, password, token, MFA/device code는 읽거나 로그·receipt·Jira에 기록하지 않는다.
16. Key Vault secret이 없거나 disabled/expired이면 deploy를 시작하지 않는다. 값 생성·입력은 사용자 handoff가 필요한 경우에만 중단하고, 생성 후 metadata read-back을 남긴다.

### E. 승인 후 동일성 보존과 배포

17. 환경 승인은 exact commit, attested artifact, package digest, what-if/RBAC receipt가 모두 확인된 뒤에만 요청/수락한다.
18. deploy job은 새 source build/npm install/package download를 하지 않고, 같은 run의 platform/RBAC/worker/what-if artifact를 검증한다.
19. deploy task도 receipt commit을 fetch/checkout하고 `HEAD`/worktree를 재검증한 뒤 Bicep을 실행한다.
20. 첫 Azure mutation 전 worker archive digest, Codex package version/digest, Bicep output, foundation what-if receipt를 모두 비교한다.
21. 기존 서비스는 canary revision이 ready/healthy하고 rollback identity가 확보될 때까지 변경하지 않는다. `activation failed`, `0 replicas`, readiness timeout은 즉시 BLOCKED이다.

### F. 공개 런타임과 Teams 사용자 증거

22. Azure revision이 실제 replica를 가지고 readiness/liveness를 통과한다.
23. 공개 HTTPS `/api/health`가 응답하고 `sourceCommit`, app version, image digest/server bundle identity가 같은 release identity와 일치한다. DNS failure, stale process, old Dev Tunnel, localhost는 PASS가 아니다.
24. Teams 포털 등록/다운로드 ZIP/설치 desktop/mobile의 버전과 app ID가 ZIP/health와 일치한다. 조직 게시 상태만으로 설치본 성공을 주장하지 않는다.
25. Teams 데스크톱에서 대상 채팅, 실제 Bot reply, 카드/탭/핵심 버튼을 최신 AX tree와 before/after screenshot으로 확인한다.
26. 모바일 WebView·OS 권한·GPS·모바일 UI는 데스크톱으로 대체하지 않고 `MOBILE_UNVERIFIED`를 유지한다. 실제 모바일 증거가 없으면 `MOBILE_READY`가 아니다.

### G. 종료·보고·추적

27. 모든 재현 결함과 release blocker가 Jira의 confirmed key/URL 또는 `JIRA_SYNC_UNVERIFIED`로 매핑된다.
28. 완료는 플랫폼 status나 exit code가 아니라 non-empty durable receipt, exact identity reconciliation, runtime/portal/desktop/mobile evidence로 판정한다.
29. 위 조건을 모두 통과하기 전에는 Teams 완료 메시지, Jira Done, production promotion을 실행하지 않는다.
30. run이 끝나면 로그 URL, run ID, source commit, artifact/ZIP SHA, image digest, result, blocker, next action을 이 ledger에 추가한다.

## 현재 run 30 read-back

- Pipeline source: `18cea41fd16d97b39038a00761a272ae23d310d5`
- Requested release: `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, app `1.0.103`
- Completed: authenticated GitHub handoff; Azure Core 26/26; Azure RBAC receipt; foundation what-if diagnostic/receipt; worker runtime receipt
- Outcome: user manually approved the environment; Azure DevOps UI then shows `Provision and deploy immutable canary revision` / `DeployCanaryRevision` as `Failed`
- Failed task: `Script failed with exit code: 1`; log URL: `https://dev.azure.com/devdoo/TeamsApp/_build/results?buildId=30&view=logs&s=4762d5d2-aebb-53b8-a7cb-14d48d3e23e5&j=95b50d7d-ef90-5e8d-33e5-e2c5603024e8`
- Evidence gap: Run 30 retained no failure receipt or named boundary, so the exact Azure subcommand is `UNVERIFIED`; do not label foundation/workload/revision as the root cause
- Decision: Run 30 is `FAIL`; do not retry until the failure-receipt fix is committed and the next run publishes its boundary artifact

## 현재 run 31 read-back

- Pipeline source: `f6cce7cc3fc1a3787f4db6e4d104d7b6720417f1`
- Requested release artifact commit: `f6cce7cc3fc1a3787f4db6e4d104d7b6720417f1` (CI/documentation fix commit; no matching immutable runtime artifact)
- Exact log evidence: Azure DevOps Run 31 log 11 recorded `Login Succeeded`, exact checkout at `f6cce7c`, then `Invalid GitHub release handoff: expected exactly one unexpired teams-runtime-identity-f6cce7cc3fc1a3787f4db6e4d104d7b6720417f1 artifact, found 0`, followed by `Bash exited with code '1'`
- Outcome: `FAIL_BEFORE_APPROVAL`; ValidateHandoff stopped before Azure DevOps environment approval and before any Azure mutation
- Classification: `OFFICIAL CONTRACT` — GitHub's artifact API exposes artifact name filtering, `digest`, and `workflow_run.head_sha`; artifact attestations bind repository/commit/build provenance. `OBSERVED EVIDENCE` — Run 31 authenticated and checked out the requested source but found no deployable artifact. `INFERENCE` — the parameter pair was invalid for a deploy-only artifact handoff; this is not an Azure foundation/revision/health failure.
- Fix: add named `ValidateHandoff` boundaries and a secret-free `github-handoff-failure-receipt` artifact on failed handoff tasks; preserve the separation between pipeline source and deploy-only release artifact commit.
- Verification: RED test failed before the change; `npm run test:azure-deployment-failure-receipt`, `node scripts/azure-platform-contract-test.mjs`, and `npm run test:azure-core` are GREEN on the fix commit. A new Azure run is still required to exercise the receipt in hosted execution.

## 다음 실행 전 필수 명령

```bash
git diff --check
node scripts/azure-platform-contract-test.mjs
npm run test:azure-core
git status --short --branch
```

Azure DevOps 큐잉 후에는 다음 순서로 read-back한다.

1. pipeline source commit과 template parameters를 확인한다.
2. GitHub handoff가 선택한 release commit/version/image digest와 일치하는지 확인한다.
3. platform, RBAC, worker, what-if receipt가 모두 같은 run에서 생성됐는지 확인한다.
4. 승인 이후 첫 mutation, Azure revision readiness, `/api/health` identity를 확인한다.
5. 포털·데스크톱·모바일은 같은 release identity가 보일 때만 검증한다.

## 공식 계약

- [ARM what-if operation](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if)
- [`az deployment group what-if`](https://learn.microsoft.com/en-us/cli/azure/deployment/group?view=azure-cli-latest)
- [Azure Key Vault secrets with Azure CLI](https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli)
- [Azure DevOps approvals and checks](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops)
- [Azure Pipelines deployment jobs and failure hooks](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops)
- [Troubleshoot start failures in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-start-failures)
- [Troubleshoot Container Exit Failures in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-container-create-failures)

이 문서의 `IN_PROGRESS` 항목은 실제 run read-back이 끝난 뒤에만 `PASS` 또는 구체적 `FAIL/BLOCKED`로 갱신한다. 승인 성공은 배포 성공이 아니며, failure receipt와 Azure revision/log read-back이 없으면 원인을 확정하지 않는다. 완료 메시지나 Jira Done 전환의 근거로 `IN_PROGRESS` 또는 generic exit code만 사용하지 않는다.
