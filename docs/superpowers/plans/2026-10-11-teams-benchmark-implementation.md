# Teams benchmark implementation

**Goal:** Implement the supplied complete Teams chat benchmark lessons in the existing Core product, preserve current identity/access/execution contracts, and bind final code, package, running assets and actual host observations.

**Architecture:** Keep Teams SDK transport/authentication and the existing durable job ledger. Add exact approval identity/settlement to that ledger, deliberate owner-authorized history pages, recoverable Core controls in the installed CopilotKit view, and a conditional Channels native-card codec. Native progress and explicit result publication use durable reservations before outbound calls. Personal private review never accepts a client-selected destination. Existing direct cards remain available.

**Stack/spec:** TypeScript/React/Express, Teams Apps/API 2.0.15, TeamsJS 2.54.0, CopilotKit React/runtime 1.66.2, Channels 0.7.3. Source: `Teams_채팅_UI_벤치마크_종합_재검토_2026-10-11.docx`, Library `libfile_b832e496a1248191bf6980f4c6f4d8af`, SHA256 `f91f3d62abbb29866fb8eb5507559f6394f9b3336012ff791a112162cab2fda0`; all 342 extracted lines read. User approved full implementation and parallel work; no further design permission is required.

**Constraints:** No new LLM/cloud service, permission, deployment target, account or long-running service. Preserve initial user untracked files. One Mac UI controller. Run esbuild/tsx/npm checks sequentially with time limits. No original capture/report uploads after the prior privacy review rejection. Real iPhone/Android results require those devices; viewports and Simulator do not qualify.

## Tasks and ownership

1. Approval agent: new `core-approval-recovery.ts`, Core service/routes/projection and focused tests. Parent: AgentJob/store/service integration, callbacks/cards/client wiring and deadline sweep. RED stale-revision -> GREEN owner/tenant/revision/deadline/duplicate/restart/settlement/write rollback.
2. Stop agent: Copilot conversation/controller/client and focused SDK tests. RED missing Stop/lost history/draft/unknown-delivery -> GREEN explicit confirmation, single cancel, read-only recovery and retained locks.
3. History agent: shared/client conversation, view/CSS/position helpers/tests. RED 20-turn truncation -> GREEN deliberate 20-turn pages/125-turn ancestry/owner revalidation/anchor/privacy cache.
4. Channels agent: native renderer/shadow and tests. RED protocol/style drift -> GREEN exact Core 1.6 direct-data parity, scoped grants and text fallbacks. Parent integrates conditional artifact; direct renderer retained.
5. Progress agent: new native progress transport/tests. RED missing initial stream -> GREEN rate/budget/single-chat ownership, retained activity/thread, final/approval flush, unknown-send recovery. Parent: atomic state/SDK adapter/pump.
6. Read-only auditor: all 30 benchmark lessons, all acceptance and conditional requirements. Parent writes traceability and resolves actual gaps; no agent report/worktree writes.
7. Approval agent second independent slice: result publication/resources module/tests. Parent: same-job origin/publication persistence, authenticated download, private review UI, original-conversation routing.
8. Parent integration: actual text serializer, native same-job Dialog/close-return, release fingerprint observations, test registration, exact final commit tests/build/package/CI and runtime/catalog/installed/read-back/host verification.

Each implementation retains RED/GREEN evidence under `/tmp/teams-benchmark-20261011/`. Final pinned checks require clean committed source. Proposed commits group durable backend/transport; conversation/rendering UI; release identity/evidence. Reviewer focus: no authority from navigation hints, no sending before durable reservation, no automatic replay after ambiguous outcomes, no owner-history restoration after denial, exact payload/version preservation.

## Thirty lessons: source mapping and adoption disposition

| # | Benchmark | Core implementation / regression | Separate boundary |
|---|---|---|---|
|1|OpenClaw|PersonalNotificationBroker, outbound claims, core approval settlement; personal notification/outbound restart/approval tests|No shared DM access expansion|
|2|Ebi|AgentService progress/cancel; TeamsJobProgressTransport; progress and transition tests|File consent is distinct from delivery|
|3|Teams SDK|Native message/card routes, CoreMessageExtension, Core job Dialog; Teams chat/runtime/message-extension tests|Actual host results separately recorded|
|4|Agent Framework|AgentJobStore recovery/CAS, ProviderLifecycleRunner; durable ledger/lifecycle tests|No new framework dependency|
|5|GitHub Copilot Teams|AgentService/Core continue + controlled Core composer; ephemeral continuation/composer tests|Same job ancestry, result resources and explicit sharing|
|6|Letta Code|VisibleJobConversation and receipt presentation; conversation/receipt/isolation tests|Editable memory is absent; transcript is not memory|
|7|n8n|Durable approval and measured input-resume port; service/confirmation/input tests|No concrete provider resume; explicit unsupported result|
|8|OpenHands|History pages, Stop, workspace isolation; history/transition/workspace-lock tests|No invented separate project workspace|
|9|LibreChat|Owner job selection, history recovery, observed tools/resources; cross-surface/history/tool tests|No third-party conversation store|
|10|Open WebUI|Core approval/trace + exact result URL evidence; GenUI contract/action tests|Reminder recording is not scheduled automation; branding source not copied|
|11|Dify|Durable approval deadline/restart/old callbacks and measured resume port; approval/lifecycle tests|Provider input pause/resume remains unsupported|
|12|AnythingLLM|Existing queue lease/heartbeat/CAS, same-job follow-up/resources; queue/store tests|No scheduler/timezone job claim or unsupported Teams file delivery claimed|
|13|Agent Zero|Owner history, read-only continuation, execution isolation; continuation/isolation tests|Timezone scheduler, editable memory/project entities absent|
|14|gtapps Teams channel|Authenticated origin capture, original-scope explicit publication; publication/notification tests|No consent offer represented as file delivered|
|15|Entrabot|User auth/server scope/operator policy/audit; auth/scope/authorization tests|No Graph-wide permission equivalence|
|16|Teams Accelerator|Observed tools/progress/approval intervention; command-terminal/trace tests|Source identity and computer-control workflow unverified|
|17|M365 Agents SDK|Existing authenticated proactive reference/outbox; notification/auth tests|No human handoff capability assumed|
|18|Copilot Studio|A2A child dispatch/provider readiness/access contracts; collaboration/provider tests|Preview is not host auth/knowledge proof; no knowledge ingestion/human handoff|
|19|IBM watsonx|Draft/package/runtime/installed independent identity gates; release identity/update tests|About132 versus installed138 is unresolved evidence, not assumed cache|
|20|Kore.ai|Observed token usage/readiness/A2A dispatch latency; usage/provider/telemetry tests|No monetary cost/fallback transition history invented|
|21|Moveworks|Approve/deny reason/deadline/settlement and same-job links; approval/card/queue/health tests|Actual old-card settlement still needs host verification|
|22|Glean|Result source links with visible host and unverified retrieval; resource/safe URL tests|Safe URL does not grant access or prove retrieval|
|23|Rovo Teams|Private result preview/refinement then explicit original-chat publication; publication tests|No caller-selected destination or automatic shared publication|
|24|JSM virtual agent|WorkItem lifecycle + native input/approval; work-item/message-extension tests|External JSM/human handoff not present|
|25|ServiceNow|Own intake/status/approval/notifications; work-item/Core/notification tests|Portal navigation is not native execution or human handoff|
|26|Flowise|Own durable approval/input contracts; confirmation/input tests|Report EOL source not adopted; workflow editor absent|
|27|AutoGen|Own durable state/cancel/A2A lifecycle; lifecycle/cancel/parent tests|Maintenance framework not added; human handoff absent|
|28|Chat Copilot|Owner-scoped sessions/messages/access; cross-surface/history/auth tests|Archived sample not adopted; no new participants/access|
|29|Fibey / BRK241 / BRK242|Own deadline/grants/Teams origin/MCP boundary; approval/reference/MCP tests|All three exact upstream identities unverified; lessons retained separately|
|30|DRUID|Validated native inputs, Core commands and tool outcomes; cards/service/trace tests|Concrete provider input resume remains unsupported|

The six nonadopted source identities remain explicit: Flowise (report EOL), AutoGen (maintenance), Chat Copilot (archived sample), Fibey, BRK241 and BRK242 (unverified original identity). Their lessons use the Core alternatives in rows26–29. Teams Accelerator correspondence is additionally unverified. These source dispositions do not remove functional lessons.

## Conditional requirements

| Condition | Actual disposition / alternative |
|---|---|
|Scheduled execution/timezone/DST|Not implemented as a Core scheduler; recordReminder only records future metadata. Do not count worker queue claim as scheduled claim. No new service added.|
|Multiple worker claim|Existing dispatch CAS/owner/generation/heartbeat tests apply. Whole-stack multi-replica readiness remains unverified; file-backed grants/preferences/outbox are not shared CAS.|
|Editable memory/projects|Absent. Preserve transcript, receipt and execution-workspace isolation; no memory or file/project scope invented.|
|Multiple providers/fallback/cost/latency|Readiness and token usage are observed; A2A dispatch latency measured. No fallback event ledger or monetary cost evidence, so these remain unsupported/unverified.|
|Input pause/resume|Measured port exists; current runtime lacks concrete observeInputResume/resumeInput. Keep unsupported response.|
|Human/child handoff|Existing A2A child-agent lifecycle carries parent task identity; human handoff absent. Agent dispatch does not establish human acceptance/return.|
|Native streaming|Personal-only protocol and budget are implemented separately from group/channel activity updates. Actual native stream test required for live PASS.|
|Extended markdown/Stageview/Loop/new messenger/Python|Not necessary for this Core integration; preserve text/card/Dialog alternatives and explicit unsupported host capabilities.|
|Teams file delivery|Manifest supportsFiles remains false. Show unsupported Teams delivery plus owner-authenticated result.txt download; do not mint consent/upload/delivery receipts.|

## Host and release gates

Track independently: native composer new synthetic business question + same conversation follow-up; all three displays/same job/no new execution; personal streaming/final/Stop; group/channel origin/mention/thread/tenant; accept/deny/duplicates/expired/other user; pre-restart old approval callback; network/background/restart/unknown-send recovery;125-turn paging/reading position/Korean/code/table/image/keyboard; native card dark/narrow/fallback; file/source access and delivery states; card→Dialog→same-job return; package/catalog/install/About/loaded assets/running fingerprint.

Teams Web, native desktop, real iPhone and real Android each need PASS/FAIL/NOT RUN entries. Simulator/viewport fixtures do not substitute for real mobile. Full UI matrix completion and user actual message confirmation precede any Teams completion notification. Unsupported and unavailable surfaces receive explicit reasons and alternatives, never blank rows.
