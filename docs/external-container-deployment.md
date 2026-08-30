# 외부 컨테이너 배포 운영 계약

`.github/workflows/external-container-release.yml`은 Teams Core를 검증한 뒤
immutable GHCR 이미지와 release identity를 보관하고, 명시적인 manual dispatch와
protected `production` environment가 있을 때만 Azure Container Apps를 갱신한다.

이 문서는 Azure 리소스나 인증정보를 생성하지 않는다. 실제 값이 준비되기 전에는
`deploy_external=true`를 실행하지 않는다.

## 선택한 운영 대상

- public HTTPS ingress가 있는 기존 Azure Container App
- Container App managed environment에 연결된 Azure Files share
- revision의 AzureFile volume이 `/app/data`에 read/write mount
- 현재 `file-json-single-process` 계약을 위해 `maxReplicas=1`
- Container App이 pull할 수 있는 기존 Azure Container Registry
- Bot Service `messagingEndpoint`가 같은 public origin의 `/api/messages`를 가리키는 상태

Cloud Run은 별도 대안이다. 현재 파일 JSON 저장과 장기 worker를 그대로 Cloud Run에
옮기지 않으며, 외부 DB/object storage와 worker 분리를 먼저 설계한다. Cloudflare
Workers Free는 현재 Express/child-process 서버의 primary runtime이 아니고, Tunnel은
호스팅 대체가 아니다.

## GitHub repository variables

검증 및 package 단계는 실제 Teams/Entra 값을 repository variables에서 받는다.
값을 소스나 workflow에 literal로 넣지 않는다.

```text
TEAMS_APP_ID
TEAMS_CATALOG_APP_ID
BOT_ID
BOT_CLIENT_ID
TENANT_ID
TAB_DOMAIN
CLIENT_ID
APPLICATION_ID_URI
```

protected `production` environment에는 다음을 둔다.

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
AZURE_RESOURCE_GROUP
AZURE_CONTAINER_APP
AZURE_CONTAINER_REGISTRY
AZURE_CONTAINER_REGISTRY_REPOSITORY
AZURE_DATA_VOLUME_NAME
PUBLIC_BASE_URL
```

`AZURE_CONTAINER_REGISTRY`는 ACR 리소스 이름이고,
`AZURE_CONTAINER_REGISTRY_REPOSITORY`는 target image repository다.
`AZURE_DATA_VOLUME_NAME`은 revision `template.volumes[].name`이며, workflow가
실제 `storageType=AzureFile`, non-empty `storageName`, `/app/data` mount,
`maxReplicas=1`을 조회하지 못하면 배포를 중단한다.

`PUBLIC_BASE_URL`은 HTTPS여야 하며 새 package manifest의 static tab origin과
같아야 한다. workflow는 이 값을 추측하거나 DNS를 만들지 않는다.

## 실행 경계

### Verify

`verify` job은 main에서만 실행한다.

- bounded Core source check와 workflow/Docker contract
- `npm run build:core` 직후 `test:docker-build-inputs`
- Core runtime test, runtime marker, manifest, deployment env
- 새 Teams ZIP과 deterministic/atomic package tests
- `dist/`와 ZIP을 commit-scoped artifact로 업로드

### Publish

`publish` job은 verify 성공 후에만 실행한다.

- CI artifact의 dist만 Docker context에 사용
- pinned Node image와 `TEAMS_SOURCE_COMMIT`를 사용
- GHCR에 `sha-<full-commit>` tag와 digest를 publish
- source commit, app version, ZIP SHA-256, server bundle SHA-256, client asset SHA-256,
  manifest SHA-256, image digest를 `release-identity.json`에 기록
- pushed digest로 image smoke를 수행하고 `/api/health`, `/tabs/home/`, hashed asset을 확인
- public repository만 artifact attestation을 시도하며 private repository는 한계를
  identity에 명시한다

### Deploy

`deploy` job은 `workflow_dispatch`에서 `deploy_external=true`를 직접 선택하고
protected environment 승인이 완료된 경우에만 실행한다.

1. GitHub OIDC로 Azure에 로그인한다.
2. Azure Files volume과 `/app/data`, single replica를 읽기 전용 조회로 확인한다.
3. GHCR digest 이미지를 ACR로 mirror하고 push digest가 원본 digest와 같은지 확인한다.
4. Container App을 ACR의 immutable digest로 업데이트한다.
5. Container App 설정이 실제 digest를 가리키는지 read-back한다.
6. 같은 public origin의 health, version, source commit, server bundle SHA,
   Teams auth/user auth/bot/outbound, tab HTTP 200, client asset hash를 검증한다.
7. 검증 JSON만 artifact로 보관한다.

이 workflow는 새 Teams package 업로드, Bot endpoint 변경, mobile/desktop 검증을
자동으로 완료했다고 주장하지 않는다. 외부 runtime identity가 통과한 뒤 기존
Teams 업데이트 경로와 실사용 UI 전수 검증을 별도 단계로 진행한다. 기존 Dev Tunnel은
새 release identity가 완전히 검증되기 전까지 유지한다.

## Codex worker/A2A 경계

- `AGENT_CODEX_HOME_<ordinal>`과 `CODEX_BIN`은 image, GitHub artifact, source에 넣지 않는다.
- worker별 owner-only 절대경로 auth home과 실행 파일 SHA-256은 별도 운영 gate다.
- 외부 컨테이너 배포 성공이나 HTTP 200은 live A2A 인증/parallel/cancel/restart/telemetry
  증거가 아니다.
- 실제 worker 인증이 없으면 health의 A2A 상태는 `unavailable`로 유지한다.
- file JSON을 유지하는 동안 replica를 늘리지 않는다. worker와 store를 수평 확장하려면
  DB/queue/lease 설계와 실제 재시작 검증을 별도 변경으로 진행한다.

## 공식 근거

- [Microsoft Teams 앱을 Container Service에 배포](https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/deploy-teams-app-to-container-service)
- [Azure Container Apps Azure Files volume mount](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts-azure-files)
- [Azure Container Apps storage mounts](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
