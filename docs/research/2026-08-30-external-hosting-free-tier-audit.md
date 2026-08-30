# 외부 Teams 서버 및 무료·저비용 호스팅 감사

## 조사 범위와 결론

- 조사 기준일: 2026-08-30 (Asia/Seoul)
- 목적: 현재 Teams Bot/개인 탭 서버를 로컬 Dev Tunnel 의존성에서 외부 HTTPS 서버로 옮기고, 이후 서버 측 Codex worker/A2A를 붙일 수 있는 호스팅 모델을 비교한다.
- 이 문서는 모든 인터넷 호스팅 사업자를 문자 그대로 전수 조사했다고 주장하지 않는다. 현재 저장소의 Node/Express·Teams webhook·서버 프로세스·파일 저장·child-process 요구사항을 만족할 가능성이 있는 주요 후보를 공식 문서로 확인한 범위의 감사다.
- 현재 결론: 무료 플랜만으로 상용 운영을 확정할 수 있는 후보는 확인되지 않았다. Cloudflare Workers Free는 현재 서버의 실행 모델과 맞지 않고, Cloudflare Containers는 Workers Paid 전용이며 디스크가 임시적이다. Google Cloud Run과 Azure Container Apps가 컨테이너 운영 후보이고, 현재 파일 JSON 저장을 보존하면서 Microsoft Teams/Entra와 직접 정렬하는 Azure Container Apps를 우선 경로로 구현한다. 실제 계정·결제·리소스·DNS·운영 자격증명은 아직 구성하지 않았다.
- 기존 Dev Tunnel/public 서비스는 새 외부 서버의 동일 릴리스 identity와 Teams UI 증거가 통과하기 전까지 중단·교체하지 않는다.

## 현재 저장소가 요구하는 계약

1. `npm start`가 `scripts/start-server.mjs`를 거쳐 `TEAMS_RUNTIME_DIST_DIR`와 서버 bundle marker를 사용해야 한다. Docker에서 `node dist/server/index.js`를 직접 실행하면 이 계약을 우회한다.
2. Teams가 접근할 공개 HTTPS origin과 `/api/messages` messaging endpoint가 필요하다. 개인 탭은 `/tabs/home/` trailing slash, `/api/health`, 해시된 client asset을 함께 확인해야 한다.
3. Core 서버는 `PORT` 환경변수를 사용하는 Express/Teams SDK 프로세스다. 기본 저장소는 `file-json-single-process`이므로 수평 복제 전에는 단일 replica와 명시적 영속 저장소가 필요하다.
4. 선택적인 Codex worker/A2A 경로는 worker별 분리된 auth home, 실행 파일 무결성, durable 결과/취소/재시작 상태를 요구한다. 인증 파일·토큰·API key를 이미지나 Git에 넣을 수 없다.
5. 릴리스 identity는 source commit, package/manifest version, ZIP SHA-256, server bundle SHA-256, image digest, public health, Teams portal/installed/desktop/mobile 증거를 한 릴리스에 묶어야 한다.

## 후보 비교

판정의 의미는 다음과 같다.

- `PRIMARY_CANDIDATE`: 현재 컨테이너를 유지할 수 있고 추가 운영 전제가 확인되면 주 후보
- `CANARY_ONLY`: 외부 smoke/데모에는 가능하지만 현재 상용 계약을 충족하지 않음
- `NOT_A_PRIMARY_RUNTIME`: 서버 재설계 또는 다른 역할이 필요함
- `NOT_A_FREE_OPTION`: 컨테이너 적합성은 있어도 무료 운영 전제와 맞지 않음

| 후보 | 공식 문서에서 확인한 사실 | 현재 앱과의 대조 | 판정 |
| --- | --- | --- | --- |
| Cloudflare Workers Free | Free 한도는 100,000 requests/day, invocation CPU 10ms, memory 128MB이며 Node API는 부분 호환이다. | Express/Teams SDK 서버와 독립 Codex child process를 그대로 실행하는 대상이 아니다. edge/API adapter로 별도 설계해야 한다. | `NOT_A_PRIMARY_RUNTIME` |
| Cloudflare Containers | 임의 Linux container를 실행할 수 있지만 Workers Paid 전용이다. 컨테이너 디스크는 ephemeral이고 재시작·sleep 뒤 보존되지 않는다. | 현재 file JSON 저장과 무료 상용 운영에 맞지 않는다. Durable Objects/R2/외부 DB로 재설계하고 유료 플랜을 써야 한다. | `CANARY_ONLY` / 유료 전제 |
| Cloudflare Tunnel | origin에서 Cloudflare로 outbound 연결을 만들고 public hostname으로 origin을 노출하는 연결 계층이다. | 호스팅/컴퓨트가 아니므로 로컬 Mac 또는 다른 서버를 대체하지 않는다. | `NOT_A_PRIMARY_RUNTIME` |
| Google Cloud Run | `0.0.0.0`의 `PORT` listen 컨테이너 계약과 public HTTPS를 제공한다. request/instance 기반 free grant가 있지만 billing account가 필요하다. | Docker Core를 유지하기 쉬운 주 후보다. 파일 저장은 외부 저장소로 바꾸고, scale-to-zero와 long-lived worker를 분리해야 한다. | `PRIMARY_CANDIDATE` |
| Azure Container Apps | Microsoft가 Teams bot/tab를 Container Apps에 배포하는 경로를 제공하며 public HTTPS ingress와 Azure Files volume을 지원한다. | Teams/Entra/Bot Service와 직접 정렬되고 Azure Files + maxReplicas=1로 현재 file-json 계약을 보존할 수 있다. subscription/OIDC/resource 검증이 필요하다. | `PRIMARY_CANDIDATE` |
| Render Free | idle sleep, 재시작/배포 시 local filesystem 소실, free Postgres 만료 및 free instance의 production 사용 제한이 있다. | Teams webhook cold start와 durable A2A state에 부적합하다. | `CANARY_ONLY` |
| Railway Trial/Free | trial credit이 한시적이고 이후 무료 credit이 작다. volume 서비스는 replica 제약과 배포 downtime이 있다. | Docker canary에는 유용하지만 장기 production/A2A 저장소 계약에는 부족하다. | `CANARY_ONLY` |
| Koyeb Free | 조직당 1개 512MB/0.1 vCPU/2GB 인스턴스, volume 불가, idle scale-to-zero이며 production 사용을 제한한다. | smoke 외에는 memory·sleep·persistence 제약이 크다. | `CANARY_ONLY` |
| Fly.io | 일반 free tier가 없고 trial은 제한된 VM 시간/기간이며 종료 후 앱이 중지된다. | volume/컨테이너 모델은 가능하지만 무료 외부 서버 조건과 맞지 않는다. | `NOT_A_FREE_OPTION` |
| Oracle Always Free VM | home region에 lifetime Always Free 자원이 있으나 capacity 부족·idle reclaim 가능성이 있다. | Docker와 장기 프로세스를 직접 운용할 수 있지만 ARM 호환성, TLS, 보안 패치, rollback, monitoring을 직접 책임져야 한다. | `CANARY_ONLY` / 운영 부담 큼 |
| Deno Deploy Free | request/egress 사용량 중심의 serverless 런타임이다. | 현재 Node/Express Docker와 Codex child process를 그대로 옮길 수 없다. | `NOT_A_PRIMARY_RUNTIME` |
| Vercel Functions | Node function 실행시간·플랫폼 제한이 있고 serverless 단위다. | 정적 탭/얇은 API adapter에는 가능하지만 현재 단일 Express process와 worker에 맞지 않는다. | `NOT_A_PRIMARY_RUNTIME` |
| Netlify Background Functions | 202 응답 이후 최대 15분 비동기 함수다. | 장기 Teams 서버와 durable worker host가 아니다. | `NOT_A_PRIMARY_RUNTIME` |
| AWS Lambda | 월별 free request/compute grant가 있지만 함수 실행 모델이다. | API Gateway + queue + 별도 worker/DB 재설계가 필요하다. | `NOT_A_PRIMARY_RUNTIME` |

## 권고 및 선택

### 1. 현재 Core 외부 서버

Azure Container Apps를 1차 구현 대상으로 선택한다.

- Microsoft 공식 Teams 컨테이너 배포 경로와 Entra/Bot Service 정렬이 가장 직접적이다.
- Azure Files를 `/app/data`에 mount하고 `maxReplicas=1`을 확인하면 현재 JSON 저장소의 단일 프로세스 전제를 보존할 수 있다.
- GitHub Actions OIDC로 배포하고, 이미지에는 `sha-<commit>` tag와 digest를 함께 기록한다.
- workflow는 실제 storage type/name/mount path/replica 수를 조회한다. 리소스가 없거나 storage가 비영속이면 배포하지 않는다.

### 2. Cloud Run 대안

Cloud Run은 컨테이너 계약과 사용량 기반 무료 구간 때문에 유력한 대안이지만, 현재 앱의 `/app/data` 파일 저장을 그대로 production에 두지 않는다. Cloud SQL/Firestore/Cloud Storage 등으로 저장소를 이전하고, scale-to-zero·request timeout·long-lived Codex worker를 별도 queue/worker 서비스로 나누는 변경이 선행되어야 한다.

### 3. Cloudflare의 역할

Cloudflare는 현재 primary compute가 아니다. Workers Free는 Edge/API facade, Tunnel은 기존 외부 서버 앞단의 연결·보호 계층, Containers는 유료 canary/재설계 후 선택지로 분리한다. Cloudflare가 무료라는 이유만으로 현재 Express 서버와 worker를 옮겼다고 보고하지 않는다.

### 4. 무료 데이터·큐 서비스까지 포함한 재검토

호스팅 비용만 비교하면 판단이 불완전하므로, 앱을 Cloudflare-native로 재작성했을 때 사용할 수 있는 무료 데이터 계층도 별도로 확인했다.

| 서비스 | 공식 무료 조건 | 현재 앱에 적용할 수 있는 범위 | 판정 |
| --- | --- | --- | --- |
| Cloudflare D1 | Workers Free에 일일 500만 rows read, 10만 rows written, 총 5GB storage가 포함된다. 한도 초과 시 쿼리가 오류를 반환한다. | JSON job/event store를 SQL로 이전하는 후보다. 단, 현재 Node `fs`/atomic file store를 그대로 연결할 수 없고 Worker adapter와 schema/migration이 필요하다. | `FUTURE_STORAGE_CANDIDATE` |
| Cloudflare R2 | Standard storage 10GB-month, Class A 100만, Class B 1,000만 operations/month가 free이고 인터넷 egress는 무료다. | ZIP·로그 아카이브·큰 agent artifact 저장 후보다. 트랜잭션 job state의 대체 DB로 사용하지 않는다. | `STORAGE_CANDIDATE` |
| Cloudflare Queues | Workers Free에 10,000 operations/day가 포함되지만 message retention은 24시간으로 고정된다. | 짧은 webhook-to-worker handoff에는 쓸 수 있지만, 장기 실행 Codex job·재시작 복구·감사 보존의 유일한 저장소로 쓰지 않는다. | `SHORT_LIVED_QUEUE_ONLY` |
| Supabase Free | 500MB DB, 1GB file storage, 2개 active free project가 제공되지만 7일 낮은 활동 후 프로젝트가 pause될 수 있다. | Cloud Run/Azure/VM의 외부 DB 후보와 staging/canary에는 유용하다. 상시 Teams webhook의 production SLA로 확정하지 않는다. | `CANARY_OR_LOW_TRAFFIC` |

따라서 Cloudflare를 활용하는 현실적인 2단계 경로는 다음과 같다.

1. 현재 릴리스: Express/Teams SDK와 서버 측 agent worker를 유지하고, Cloudflare는 DNS/Tunnel/WAF 또는 정적 asset 계층으로만 사용한다. 원본 Dev Tunnel을 교체하지 않는다.
2. 재설계 릴리스: Teams webhook/tab facade를 Workers로 별도 구현하고 D1을 job/event state, R2를 artifact, Queues를 짧은 handoff로 사용한다. Codex CLI를 실행하는 worker는 Cloud Run·Azure Container Apps·Oracle VM 같은 별도 컴퓨트에 두고, 인증 home과 실행 파일을 분리한다. 이 경로는 새 adapter, 인증 계약, 분산 lock, 장애 복구 및 동일-release UI 검증을 통과하기 전에는 현재 서비스에 병합하지 않는다.

즉, Cloudflare의 무료 D1/R2/Queues는 “무료 외부 서비스가 전혀 없다”는 뜻을 뒤집지만, 현재 서버를 그대로 무료 Cloudflare Workers에 배포할 수 있다는 뜻은 아니다. 무료 쿼리·저장 한도도 초과 시 오류/보존 기간 제한이 있으므로 release gate와 운영 SLA에 포함해 측정해야 한다.

## 릴리스 및 교체 순서

1. PR/main에서 bounded Core source check, build, Core tests, manifest, deterministic package, Docker contract/smoke를 통과시킨다.
2. 검증된 dist와 Teams ZIP만 사용해 GHCR immutable image와 release identity를 만든다.
3. protected production environment와 GitHub OIDC로 외부 플랫폼에 로그인한다. 장기 cloud credential을 저장하지 않는다.
4. 새 origin에서 `/api/health`, `/tabs/home/`, hashed asset을 같은 identity로 확인한다.
5. 새 origin에 Teams endpoint를 바꾸기 전 현재 Dev Tunnel을 보존한다.
6. 새 ZIP을 만들 때만 기존 Teams 앱 업데이트 경로를 사용하고, 설치본/desktop/mobile의 같은-version 증거를 새로 수집한다.
7. 모든 gate가 통과한 후에만 endpoint를 전환하고 이전 서비스를 rollback 대상으로 유지한다.

## 공식 1차 출처

- Microsoft Teams container deployment: <https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/deploy-teams-app-to-container-service>
- Microsoft Teams app configuration: <https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/teams/configuration/manual-configuration>
- Azure Container Apps Azure Files: <https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts-azure-files>
- GitHub Actions OIDC: <https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc>
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Workers pricing: <https://developers.cloudflare.com/workers/platform/pricing/>
- Cloudflare Node.js compatibility: <https://developers.cloudflare.com/workers/runtime-apis/nodejs/>
- Cloudflare Containers pricing: <https://developers.cloudflare.com/containers/platform/pricing/>
- Cloudflare Containers architecture: <https://developers.cloudflare.com/containers/concepts/architecture/>
- Cloudflare Tunnel: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>
- Cloudflare D1 pricing: <https://developers.cloudflare.com/d1/platform/pricing/>
- Cloudflare R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
- Cloudflare Queues pricing: <https://developers.cloudflare.com/queues/platform/pricing/>
- Google Cloud Run pricing: <https://cloud.google.com/run/pricing>
- Google Cloud Run container contract: <https://docs.cloud.google.com/run/docs/container-contract>
- Google Cloud free program: <https://docs.cloud.google.com/free/docs/free-cloud-features>
- Render free services: <https://render.com/docs/free>
- Railway free trial: <https://docs.railway.com/pricing/free-trial>
- Railway volumes: <https://docs.railway.com/volumes/reference>
- Koyeb instances: <https://www.koyeb.com/docs/reference/instances>
- Fly.io free trial: <https://fly.io/docs/about/free-trial/>
- Oracle Always Free resources: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
- Deno Deploy pricing: <https://deno.com/deploy/pricing>
- Vercel function limits: <https://vercel.com/docs/functions/limitations>
- Netlify Background Functions: <https://docs.netlify.com/build/functions/background-functions/>
- AWS Lambda pricing: <https://aws.amazon.com/lambda/pricing/>
- Supabase pricing: <https://supabase.com/pricing>
- Supabase Free project pausing: <https://supabase.com/docs/guides/platform/free-project-pausing>

## 증거 경계

- 조사한 것은 위 목록의 주요 후보에 대한 공식 문서 대조다. 계정 생성, 결제 수단 등록, DNS 변경, 외부 image publish, production deploy, Teams endpoint 변경은 이 감사에서 하지 않았다.
- 가격·한도·약관은 변경될 수 있으므로 실제 배포 직전에 해당 공급자의 공식 페이지를 다시 확인한다.
- 정적 테스트 통과, HTTP 200, image build, health 응답만으로 외부 production 또는 Teams desktop/mobile/A2A live 완료를 주장하지 않는다.
