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
21. 기존 서비스는 canary revision이 ready/healthy하고 rollback identity가 확보될 때까지 변경하지 않는다. `activation failed`와 readiness timeout은 즉시 BLOCKED이다. `ScaledToZero`/`0 replicas`는 Azure의 정상 HTTP scale-to-zero 상태일 수 있으므로 `healthState`, provisioning, active, traffic, public health를 함께 확인한다.

### F. 공개 런타임과 Teams 사용자 증거

22. Azure revision이 readiness/liveness를 통과한다. HTTP canary는 `Running` 또는 관찰된 `ScaledToZero + Healthy`를 허용하되 public health와 identity를 별도로 확인한다.
22a. 24/7 promoted service는 별도 조건으로 deployed `minReplicas >= 1`, worker VM service/heartbeat, restart recovery, and durable terminal receipt를 read-back한다. HTTP canary의 scale-to-zero PASS를 24/7 PASS로 승격하지 않는다.
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

## 현재 run 40 read-back

- Pipeline source: `e91b7aa020cf44f53727616194cc19c225df100a`
- Requested release: `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, app `1.0.103`, image digest `sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`
- Outcome: `FAIL_AFTER_APPROVAL` at `revision-and-health`; worker Blob staging passed with `fe36475c64b74a39876df0734569ad9f880089f37413299035f783598cddc74b`
- Exact failure: `Expected release revision did not reach Running/Succeeded/100%: teamsapp-canary-goictvxm--71df02e2ea`
- Azure Portal read-back: latest revision `Healthy`, `ScaledToZero`, traffic `100`, replicas `0`
- Failure artifact: artifact `221`, reported size `0`; log 46 `Processed 0 files`, because explicit `exit 1` did not invoke the prior `ERR` trap
- Source correction: shared `ScaledToZero + Healthy` readiness contract and nonzero `EXIT` receipt trap are locally GREEN; no version bump or Teams upload
- Decision: retain Run 40 as failed; run `npm run test:azure-core` from the clean correction commit, then use one bounded hosted rerun. Do not claim 24/7 until `minReplicas >= 1` and worker evidence pass.

## 현재 run 41 read-back

- Pipeline source: `3a5549770d25ce914959653bdb1fe9acc11b8bae`
- Requested release artifact: `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, app `1.0.103`, same attested image digest
- Outcome: `FAIL_AFTER_APPROVAL` at `revision-and-health`; handoff, preflight, manual approval, and worker Blob SHA passed
- Exact task output: `Expected release revision did not reach Running/Succeeded/100%: teamsapp-canary-goictvxm--71df02e2ea`
- Failure receipt: artifact `229`, UI `541 B` total (`476 B` JSON + `65 B` SHA sidecar); JSON read-back confirmed `pipelineRunId=41`, `boundary=revision-and-health`, `exitCode=1`; task SHA `aaa1fb75a08c5b8dd3ff7141c36cee72fa401a07590cdb73bb8de5b9012c65f3`
- Cross-check: existing Ego Lite Azure Container Apps UI showed `Healthy`, `ScaledToZero`, traffic `100`, replicas `0`
- Classification: receipt evidence `VERIFIED`; exact raw revision provisioning state `UNVERIFIED` because Run 41 predates the safe state diagnostic. Official `Provisioned` mismatch is `REVIEW_REQUIRED`, not confirmed live root cause.
- Source correction pending: accept `Provisioned` and legacy `Succeeded`, log safe state fields, preserve `ScaledToZero + Healthy`; no version bump or Teams upload
- Decision: after clean Core 28/28 from the correction commit, run one bounded Run 42 and read back the safe state diagnostic before promotion.

## 현재 run 42 read-back

- Pipeline source: `b38a1eb786b5da639314ecf2d04a81edb0190d50`
- Requested release artifact: `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, app `1.0.103`, image digest `sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`
- Outcome: `FAIL_AFTER_APPROVAL` at `final-identity-contract`
- Completed boundaries: handoff, Azure Core/RBAC, approval, worker Blob SHA, workload deployment, accepted revision readiness, and public `/api/health` response
- Exact failure: `Invalid Azure deployment contract: revision readiness or traffic state is not complete`
- Root cause: pipeline source used the updated readiness contract, but release checkout replaced the final identity helper with the older `71df02e` copy; `git show` confirmed old `Running/Succeeded` checks
- Live health: HTTP 200 with `ok=true`, version `1.0.103`, release source/image/server identity, `auth=teams-authenticated`, `bot=teams-sdk`, `outbound=teams-sdk`; worker heartbeat/A2A remain unavailable
- Failure receipt: task logged `receiptWriteStatus=READY`, SHA `6e8a536eccb8da674b37f33b3b60dc713ab637a72a572e759ebc61addbb846af`; it is not a release-complete receipt
- Source correction pending: snapshot `scripts/azure-deployment-contract.mjs` before release checkout and invoke that absolute path; focused tests are GREEN, hosted verification pending
- Decision: do not bump app version or upload Teams package; run clean Core, then one bounded hosted rerun before any promotion or completion report

## 현재 run 43 read-back

- Pipeline source: `10d340b5f7bd04b3d14f2e407c02e567ed2eef5c`
- Requested release artifact: `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, app `1.0.103`, image digest `sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`
- Outcome: `FAIL_AFTER_APPROVAL` at `final-identity-contract`
- Completed boundaries: handoff, hosted Core 26/26, approval, worker Blob SHA, workload deployment, accepted revision readiness, and public health fetch
- Exact failure: `ERR_MODULE_NOT_FOUND` for `/home/vsts/work/_temp/azure-what-if-receipt-tools/azure-release-input.mjs`, imported by the preserved `/home/vsts/work/_temp/azure-what-if-receipt-tools/azure-deployment-contract.mjs`
- Root cause: the Run42 fix snapshotted only the top-level final identity helper, not its relative local import closure; Node failed at module resolution after release checkout
- Failure receipt: artifact `245`, listed size `545 B`; task logged `receiptWriteStatus=READY`, checksum `2651ec69422d53fa8a0674ff4101c195e16b2fc4c778c61e57a80950dabd2019`
- Public health: 2920-byte response fetched before final identity module-load failure; HTTP/API core evidence is separate from release completion
- Decision: Run43 remains failed; add/test the explicit dependency closure, update docs, commit/push, run clean Core, then one bounded rerun. No version bump or Teams upload.

## 현재 run 44 read-back

- Pipeline source: `95771889b31b42ffca8a218315e2bff1dfd50557`
- Requested release artifact: `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`, app `1.0.103`, image digest `sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`
- Outcome: `SUCCEEDED` / Azure canary deployment identity verified
- Completed boundaries: handoff, hosted Core `26/26`, approval, worker Blob SHA, workload deployment, revision readiness, public health, and final identity contract
- Exact final log: `Azure release deployment verified: 71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a, 1.0.103, sha256:a52d4d53baee73cd3769ac297b723f8b05883500692d2ce4b4eb856f07ee1f27`
- Public health: HTTP 200, `ok=true`, version `1.0.103`, source commit `71df02e2...`, server bundle SHA `c7be700...`, production authenticated Teams Core; external worker/A2A readiness unavailable
- ACA revision read-back: `teamsapp-canary-goictvxm--71df02e2ea`, `Healthy`, `ScaledToZero`, traffic `100`, replicas `0`
- Decision: Azure canary gate PASS only. Continue with 24/7 worker/A2A and same-release Teams package/desktop/mobile evidence; no version bump or completion message yet.

## 다음 실행 전 필수 명령

```bash
git diff --check
node scripts/azure-platform-contract-test.mjs
node scripts/azure-deployment-contract-test.mjs
npm run test:azure-deployment-failure-receipt
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

## 현재 run 45 — invalid queue parameters

- Source: `930d4f7125b25a9b96ad2a11df1203a99b397903`, build `20260907.1`
- Outcome: `FAIL_BEFORE_MUTATION` at `ValidateHandoff/bootstrap`
- Evidence: MCP queue read-back contained empty `githubReleaseCommit`, `azureDevOpsEnvironmentId`, and Codex package URL/digest/version
- Classification: `CONFIRMED_OPERATOR_INVOCATION_ERROR`; no Azure mutation, approval, or release identity evidence
- Prevention: queue result must be reconciled for all template parameters before monitoring or approval

## 현재 run 46 — worker runtime gate

- Source: `930d4f7125b25a9b96ad2a11df1203a99b397903`; release `71df02e2ea9e9dbecbe864e0f1c6be3d649cbb4a`; app `1.0.103`; image `sha256:a52d4d53...`
- Outcome: `FAIL_AFTER_APPROVAL` at `worker-runtime` after handoff, Azure Core `29/29`, approval, what-if, Blob, workload deploy, revision readiness, and public health
- Probe: Azure VM `RunShellScript`; service/release/Codex/auth metadata check; failed `auth_file=missing`
- Failure receipt: artifact UI `536 B` total (`471 B` JSON + `65 B` sidecar), body and SHA sidecar read back in Ego Lite; JSON SHA matched `f8975bcf...`
- Classification: `CONFIRMED_ROOT_CAUSE / WORKER_AUTH_OUT_OF_BAND_MISSING`; existing VM worker service is active but cannot authenticate Codex
- Status: `AZURE_CANARY_HTTP_PASS / WORKER_RUNTIME_GATE_BLOCKED / RELEASE_BLOCKED`; no version bump, Teams upload, or completion report
- Next: user-only Codex device login on the existing VM, then bounded probe read-back; do not copy or log auth contents. Official Run Command contract: https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command

## 현재 source — 2026-09-08 24/7 Core replica correction

- Source change: `infra/azure/modules/container-app.bicep` now sets the promoted Core Container App to `minReplicas: 1` and `maxReplicas: 1`; `scripts/azure-platform-contract-test.mjs` requires the compiled ARM template to retain that invariant.
- TDD evidence: the modified contract test was RED against the prior source (`actual 0`, expected `1`), then GREEN after the minimal Bicep change. `node scripts/azure-platform-contract-test.mjs` and `npm run test:azure-worker-runtime-probe` are GREEN.
- Identity policy: app/package/Teams version remains `1.0.103`; this is an infrastructure/availability change, so no version bump, ZIP upload, or Teams completion message is justified.
- Hosted boundary: Run 46 still used source `930d4f7` and deployed release `71df02e2`; its VM `worker-runtime` gate failed because `auth_file=missing`. The new `minReplicas: 1` source has not been deployed or read back in Azure yet.
- Decision: `SOURCE_24_7_READY_FOR_HOSTED_PREFLIGHT / AZURE_24_7_UNVERIFIED / WORKER_RUNTIME_GATE_BLOCKED`. Before any Azure mutation, commit/push this source, run fresh Azure Core, generate a same-commit immutable handoff, and perform a non-mutating what-if plus explicit cost/runtime review. Keep the existing service untouched.

## 현재 run 47 — promoted 24/7 what-if allowlist gap

- Source/release: `0fff1b2d9195707d8c3363f2249955aed0eb559b`, app `1.0.103`, GitHub artifact handoff verified; Azure CLI `2.89.1`, Azure DevOps extension `1.0.7`, Bicep `0.46.1`.
- Outcome: `FAIL_AFTER_APPROVAL` at `workload-parameters-and-what-if`; Azure mutation did not start. Foundation what-if was `REVIEW_REQUIRED`, worker state reported `initialize=false`, and the workload diagnostic was retained before the deployment command.
- Exact observed delta: the existing canary Container App had the known Run 37 legacy env/secret reconciliation shape plus `properties.template.scale.minReplicas` with property change type `Modify`. The exact resource was `.../Microsoft.App/containerApps/teamsapp-canary-goictvxm`.
- Failure receipt: `azure-what-if-workload-receipt` artifact `268` reported `25,531` bytes; `azure-deployment-failure-receipt` artifact `269` reported `553` bytes. The failure receipt SHA logged by the task was `33d4245cb056122ade21d5e9c9fe170275efcd54c4ba9562a08805ef062ade37`.
- Classification: `CONFIRMED_ROOT_CAUSE / WORKLOAD_WHAT_IF_ALLOWLIST_MISSING_MIN_REPLICAS`. This is an allowlist fixture gap, not evidence that `minReplicas: 1` is invalid or that Azure mutation succeeded.
- Fix in progress: add the exact Run 47 property multiset as a separate planned-change fixture and a RED/GREEN regression; do not accept arbitrary Container App scale/environment changes. Keep version unchanged and do not retry until the clean fix is committed and hosted verification is performed.

## 현재 run 48 — promoted release identity what-if shape not yet allowlisted

- Source/release: `f17e40ac57905735aa5218efcd9399977822fc35`, app `1.0.103`, GitHub immutable handoff verified; Azure CLI `2.89.1`, Azure DevOps extension `1.0.7`, Bicep `0.46.1`.
- Outcome: `FAIL_AFTER_APPROVAL` at `workload-parameters-and-what-if`; the task performed no workload mutation. Azure DevOps read-back confirmed the run was actually executed from f17, so this is not a source-commit mismatch.
- Exact observed delta: the existing Container App emitted the Run 37 legacy env/secret reconciliation shape plus `env[19]` and `env[21]` release-identity value updates, `image`, `properties.template.revisionSuffix`, and `properties.template.scale.minReplicas`, all with the provider-reported `Modify`/`Array`/`Delete` entries. `env[19]` and `env[21]` correspond to the current Bicep release source/image fields; the source template also declares the image, revision suffix, and minimum replica.
- Evidence: workload diagnostic artifact `276` (`25,531` bytes) was read back through the existing authenticated Ego Lite Azure DevOps tab. It reported `status=BLOCKED`, `whatIf.status=Succeeded`, change counts `Modify:6`, `NoChange:20`, `Ignore:2`, `Unsupported:9`. Task log 44 recorded `sourceCommit=f17e40ac...`, `Azure workload what-if diagnostic: BLOCKED`, and the named boundary. Failure receipt artifact `277` was retained; the build summary recorded receipt SHA `bce72eb23cf742f3bec6722d0091dbbb312a3a7c5b741bd4dac5dcc10c184f3a`.
- Classification: `CONFIRMED_ROOT_CAUSE / WORKLOAD_WHAT_IF_ALLOWLIST_MISSING_RUN48_RELEASE_IDENTITY_SHAPE`. The previous Run 47 fixture was too narrow for the actual state drift. This is not evidence that the Bicep change or Azure deployment is invalid, and it is not a successful deployment.
- Prevention/fix: add one exact, value-free Run 48 multiset fixture and RED/GREEN regression. Continue rejecting any unobserved environment, image, or scale delta; do not bypass the what-if gate or bump the app version. A fresh clean Core gate and one bounded hosted rerun are required.

## 현재 run 49 — revision read-back inconsistency after workload mutation

- Source/release: `fb02f7a7dfa72637cfe19a3784fde0490c576418`, app `1.0.103`, GitHub immutable handoff verified; image digest `sha256:55dc5bc6...`, Teams package SHA `492bcf2a...`.
- Outcome: `FAIL_AFTER_APPROVAL` at `revision-and-health` after the workload what-if was observed and the worker Blob was staged. The workload deployment command returned far enough for the task to poll the exact expected revision, but the poll exhausted 30 attempts with the observed safe fields `active=null`, `provisioningState=null`, `runningState=null`, `healthState=null`, `trafficWeight=null`, `replicas=null`.
- Evidence: task log 44 recorded `Azure workload what-if diagnostic: OBSERVED`, `Azure workload what-if receipt: REVIEW_REQUIRED`, `Azure worker Blob staging: uploaded; sha256=59b727fba43a8904478da280780c399ec6d76d77c10876793bb71de1ead8fd9e`, then the exact revision failure at `16:39:51Z`. Failure artifact `285` was 541 B (`476 B` JSON plus `65 B` sidecar); the task recorded receipt SHA `1147c9218e16ef9788dca1ea6ebb99c7a7c1a33e643ece007d801e990a810d94`.
- Independent read-back: after the failed run, the existing Azure Portal Container App page showed `latestRevisionName=teamsapp-canary-goictvxm--fb02f7a7df` and Container App `provisioningState=Succeeded`; public `/api/health` at `2026-09-07T16:42:13Z` returned HTTP 200 with the same `fb02f7a7` correction commit, version `1.0.103`, image digest `sha256:55dc5bc6...`, authenticated Teams Core, and reachable Azure queue/state dependencies. This does not provide the missing historical revision fields at the exact poll time and does not prove the worker gate.
- Classification: `CONFIRMED_FAILURE_BOUNDARY / REVISION_READBACK_INCONSISTENCY`; the precise cause of the null `revision show` response is `ROOT_CAUSE_REVIEW_REQUIRED` because Run 49 did not retain a list response or raw revision body. It is not evidence of a source mismatch, and it is not evidence that the VM worker or full 24/7 release succeeded.
- Prevention/fix: use the official `az containerapp revision list --all` as a fallback when `revision show` is temporarily incomplete, evaluate the identical active/provisioned/running-or-healthy/100%-traffic predicate, and retain a value-free `azure-revision-state.json`. Keep version unchanged; run a clean Core gate and one bounded hosted rerun from the new fix before further promotion.

## 현재 run 50 — steady-state what-if variant not represented

- Source/release: `9cbed6663f34b9e8e0ac88508d5d7a9b63c44a5c`, app `1.0.103`, immutable handoff verified; the run queue and source read-back matched exactly.
- Outcome: `FAIL_AFTER_APPROVAL` at `workload-parameters-and-what-if`; no workload mutation started in Run 50. Hosted Core/RBAC and approval boundaries passed.
- Exact observed delta: the Run 48 release-identity shape after the promoted `minReplicas: 1` had already been reconciled by Run 49. The Container App delta retained the Run 37 legacy env/secret reconciliation plus `env[19]`, `env[21]`, `image`, and `properties.template.revisionSuffix`; it did not include `properties.template.scale.minReplicas`.
- Evidence: workload diagnostic artifact `292` was read back through the existing authenticated Ego Lite DevOps tab and reported `status=BLOCKED`, `whatIf.status=Succeeded`, `Modify:6`, `NoChange:20`, `Ignore:2`, `Unsupported:9`. Failure artifact `293` was retained; the build summary recorded receipt SHA `21fb7a533cd6350ed7d0a4d5cce62fc1db8f4b3e9dc3e0baa4b5a403bc2adfdd`.
- Classification: `CONFIRMED_ROOT_CAUSE / WORKLOAD_WHAT_IF_ALLOWLIST_MISSING_STEADY_STATE_RELEASE_IDENTITY_SHAPE`. This is a deterministic state-transition fixture gap, not evidence that the new list fallback failed or that the source commit was ignored.
- Prevention/fix: add explicit transition and steady-state exact value-free variants, with a RED/GREEN regression for the steady-state shape. Do not broaden the allowlist to arbitrary env/image/scale changes, bump the app version, or rerun until the clean fix is committed and a fresh immutable handoff is created.

## 현재 run 51 — revision collection envelope read-back gap

- Source/release: `bb157147b8ddf4f980114dc9a30321274562c734`, app `1.0.103`, GitHub immutable handoff and hosted checkout matched exactly; Azure CLI `2.89.1`, Azure DevOps extension `1.0.7`, Bicep `0.46.1`.
- Outcome: `FAIL_AFTER_APPROVAL` at `revision-and-health`. Handoff, Core `30/30`, RBAC, approval, workload what-if, Blob staging, and workload mutation completed; the worker-runtime probe was not reached.
- Exact task evidence: workload what-if `OBSERVED` / `REVIEW_REQUIRED`; worker Blob staging `sha256=f23662d5fcf44170a45b291d31e555691da4657d6d7e07b867e2e7da1f9e5ffc`; expected revision `teamsapp-canary-goictvxm--bb157147b8`; after the bounded poll the safe candidate fields were all `null`.
- Receipts: workload artifact `300` (`azure-revision-state.json` 271 B, diagnostic 25 KB, workload receipt 28 KB); failure artifact `301` (`476 B` JSON + `65 B` SHA sidecar). Failure receipt SHA: `ca67a517e84443b38a94a82427b4f86726ac0e01aa43d91c049d4ba51b290b11`.
- Independent live result: public `/api/health` returned `200/ok=true`, version `1.0.103`, source `bb15714`, server bundle SHA `c7be700...`, production authenticated Teams Core; worker heartbeat `not-observed`, readiness `unavailable`, A2A `unavailable`.
- Classification: `CONFIRMED_FAILURE_BOUNDARY / REVISION_READBACK_INCONSISTENCY`; `ROOT_CAUSE_REVIEW_REQUIRED` for the exact Azure response body because raw `show/list` bodies were intentionally not retained. The code path was missing normalization for an Azure `RevisionCollection.value` envelope, which is now a tested remediation hypothesis, not a claim about the unretained Run 51 body.
- Prevention/fix: add `scripts/azure-revision-readback.mjs` and a RED/GREEN test for array and `RevisionCollection.value` responses; snapshot the helper before release checkout; normalize before readiness evaluation; record `revisionListResponseShape` in the value-free receipt. Do not bump version or upload Teams package until a fresh immutable handoff and hosted run pass the worker gate.
