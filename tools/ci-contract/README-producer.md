# Local original receipt producer

This is a local receipt writer for prospective structured observations from the
existing Teams CI jobs. It is not a command runner, log parser, CI dispatcher or
source attestation service. It reads original job/step observation files and
measures local source/input/artifact file hashes. It never reconstructs receipts
from historical API success or rewrites an earlier attempt's producer identity.

The writer itself does not execute commands or edit workflows. Version 1.3 adds
a separate [runner integration](README-runner-integration.md) that supplies these
observations. No application runtime or iPhone source file is changed.

## Use and public boundaries

The existing lockfile installation and test command in [README.md](README.md)
apply. Node 20 or newer is required; local verification used Node 24.13.1.

```sh
node tools/ci-contract/produce-receipt.mjs --capture-dir /tmp/job-observations --output-dir /tmp/new-receipt-packet
```

The four arguments must appear in that order. `producer.json` and its referenced
source files must exist directly in the capture directory. The output must not
exist. Exit 0 and `RECEIPT_WRITTEN` mean serialization succeeded, not CI or release
admission. Exit 2 emits the fixed `CI_PRODUCER_INPUT_OR_OUTPUT_REJECTED` diagnostic
without source values, paths or raw logs. Require and verify all entries in
`SHA256SUMS` before using output left by an interrupted write.

Public library boundaries under test:

```js
import { readProducerCapture, writeProducerPacket, workflowJobPlan } from './lib/producer.mjs';
const { receipt, provenance, scopeReport } = readProducerCapture(captureDirectory);
const summary = writeProducerPacket(captureDirectory, newOutputDirectory);
```

The producer input, receipt output and P1 consumption boundaries were chosen
from the delegated local-producer/fixture/P1-reuse scope. No test executes a
production workflow or provider.

For a synthetic sample, from the repository root:

```sh
node --input-type=module <<'JS'
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { producerFixture } from './tools/ci-contract/fixtures/producer.mjs';
const { capture, files } = producerFixture();
const directory = mkdtempSync(join(tmpdir(), 'synthetic-ci-producer-'));
for (const [file, value] of Object.entries({ ...files, 'producer.json': JSON.stringify(capture) })) {
  writeFileSync(join(directory, file), value, { flag: 'wx', mode: 0o600 });
}
console.log(directory);
JS
```

Use the printed directory as `--capture-dir`. All identities, execution times,
counters and artifact bytes in this sample are synthetic.

## Input and original sources

`lib/producer-schemas.mjs` defines the closed, bounded input formats. Unknown
properties are rejected. Every file descriptor includes a flat safe `file` name
and an expected raw `sha256`; the writer hashes the actual file and rejects a
mismatch. It does not copy raw workflow scripts, package contents or logs into
the output packet.

| `producer.json` field | Original evidence required |
| --- | --- |
| `schemaVersion` | `ci-producer/1` |
| `evidenceKind` | `FIXTURE` or `OBSERVATION`, retained inside the receipt |
| `context` | Explicit repository, workflow, run ID, run number, attempt, stable job key, invocation ID and actual tested SHA |
| `source` | `ci-source/1`: original declared clean source SHA and workflow/package/lock byte hashes |
| `workflow`, `package`, `lock` | Full original source files, bound to that source observation |
| `toolchain` | `ci-toolchain/1`: explicit runner OS/architecture/Node/variant matrix and measured tool versions |
| `profile` | `ci-profile/1`: profile, scope, job kind and exact produced/consumed artifact names |
| `job` | `ci-job-observation/1`: same original context, original start/end, nullable actual exit code, cleanup, optional partial coverage and execution boundary |
| `inputs` | Nonempty named original input-file inventory and hashes |
| `scopes` | One `ci-scope-observation/1` file for every workflow step, with original context, step-definition digest and execution result |
| `evidenceFiles` | Optional bounded original runner/source-proof JSON files, included in provenance by raw byte hash |
| `producedArtifacts`, `consumedArtifacts` | Exact named regular-file inventories from the profile, with actual byte hashes |

No run number or attempt is defaulted. `GITHUB_RUN_ID`, `GITHUB_RUN_NUMBER` and
`GITHUB_RUN_ATTEMPT` have distinct meanings. Runner capture must record
their original values once, together with `GITHUB_JOB`, workflow identity and the
actually checked-out source. It must not derive actual tested SHA from an event's
selected `GITHUB_SHA`, or import an entire environment containing credentials.

The writer verifies agreement with the supplied source observation; it does not
run Git or independently establish that its files came from that commit. Its
`sourceBinding=SUPPLIED_SOURCE_OBSERVATION` and `sourceAuthenticity=UNVERIFIED`
make this limit explicit. Supplying consistent metadata is not an attestation.

## Complete step scope and counters

`workflowJobPlan` inventories the existing named-step text layout and hashes each
entire step block verbatim, including run/uses settings. It is not a general YAML
interpreter. Unsupported layouts, CRLF, missing/ambiguous step blocks and unknown
requested jobs fail closed. Full workflow, package and lock bytes also contribute
to the receipt suite identity; shell content and nested npm commands are retained
through those source hashes rather than being executed or simplified.

The current workflow fixtures cover all **8 jobs / 47 steps**:

| Job | Scope | Kind | Steps |
| --- | --- | --- | --- |
| `core` | `teams-core` | TEST | 8 |
| `a2a` | `teams-a2a` | TEST | 7 |
| `continuity` | `teams-continuity` | TEST | 6 |
| `azure` | `teams-azure` | TEST | 4 |
| `optional` | `teams-optional` | TEST | 5 |
| `copilot_ui` | `teams-optional` | TEST | 5 |
| `container` | `teams-container` | BUILD | 6 |
| `artifact` | `teams-candidate` | BUILD | 6 |

Every planned step needs an original observation, including explicit `NOT_RUN`,
`SKIPPED` or `CANCELLED` evidence after a failure. Version 1.3 also accepts
`SIGNALLED`, explicitly partial `OUTCOME_ONLY` action metadata and `MISSING`
observations. Missing, extra, duplicated or different step definitions are
rejected. A missing observation row is different from an explicit `MISSING` row.
An exit-zero receipt cannot conceal a nonzero step or reported failed tests;
partial observations must declare `coverageComplete=false`, preventing full
execution attribution. Original failed job
exit and cleanup states remain unchanged; partial execution does not become a
successful full scope.

An executed observation uses `testEvidence=COUNTS` with its original counters,
`NONE` with no counters when the producer explicitly measured no test scope, or
`UNKNOWN` with no counters. Incomplete counters keep the aggregate null. Commands
and steps are never counted as tests. BUILD jobs retain null test totals and
their separate detailed execution scope. Model calls and blocked attempts remain
null; this writer does not meter child/provider activity or prove credential
isolation.

For an exit-zero job, each reported suite must independently match its expected
count, contain a positive expected count and have no unexpected skip. Deficits
and excess cannot cancel in the job total. A failed job retains its original
per-scope partial counters and nonzero exit.

## Packet and P1 consumption

| File | Meaning |
| --- | --- |
| `receipt.json` | P0/P1-compatible original producer receipt, run number and evidence-kind label |
| `execution-scope.json` | Complete planned and observed step inventory, source definition digests, original status/times/counters |
| `producer-provenance.json` | Original source-file byte hashes, producer/common digests, supplied-source boundary and artifact inventories |
| `receipt-index.json` | Receipt canonical digest, packet file hashes and explicit unverified release/authenticity/delivery states |
| `SHA256SUMS` | Raw byte hashes of the four content files above |

`receipt.sourceEvidenceDigest` binds the raw provenance file. Provenance binds
the raw scope report. Canonical receipt digest and original receipt-file byte
hash are different values. Original source files stay in their capture location;
consumers must retain them with the packet under their approved retention policy.

P1 accepts the generated receipt without replacing its run number, producer
attempt, source or provenance digest. A new listed attempt containing an old
receipt remains `CARRY_FORWARD_CANDIDATE` without explicit reuse proof. A fresh
receipt has its own context/times/invocation; unchanged input digests do not mean
an earlier receipt should be rewritten. A fixture receipt in an `OBSERVATION`
result blocks with `FIXTURE_RECEIPT_IN_OBSERVATION`.
P1 also preserves the API `run_number` separately: a known mismatch with the
receipt blocks, and a missing API number leaves a new receipt's execution
unverified. Older receipts without the optional number remain accepted.

Legacy/API_JOB receipts require exact receipt/API job timestamp agreement.
Version 1.3 RUN_SCOPES receipts require containment inside known API job bounds;
missing bounds or partial coverage keep attribution UNKNOWN. No timestamp is
altered to force agreement. Live runner/API read-back remains unverified.
P1 currently retains the provenance digest but does not fetch
or authenticate the paired producer packet automatically.

## Bounds and remaining live gates

Inputs use P1's bounded regular-file readers: no final-component symlinks or
non-regular inputs, 2 MiB per UTF-8 source, 16 MiB cumulative structured/text
sources, 64 MiB per opaque input/artifact and 128 MiB cumulative opaque bytes.
There are at most 200 source files, 100 scopes, 100 input descriptors and 20
produced/20 consumed artifact descriptors, subject to the total-file cap. Output
uses fixed names in a new owner-only directory and does not overwrite a packet.

Local tests preserve original failure, cancellation/unknown evidence, rerun
identity, digest mismatch rejection, all current job steps and P1 compatibility.
The eight-job observations are synthetic; reading their current workflow
definitions is not execution of those jobs. Existing Core/optional/Azure tests
and required-check names were not removed or replaced.

Remaining: actual GitHub runner observation and source authentication; actual
test-counter formats; live runner/API timing and artifact read-back; transport/ACK;
installation/runtime/host UI. Prospective workflow wiring and local Node/Git
measurement are provided by the separate adapter. No new CI, push,
deployment, upload, credential or persistent access is performed here.

## Official contracts checked 2026-10-21 KST

- [GitHub variables reference](https://docs.github.com/en/actions/reference/workflows-and-actions/variables): `GITHUB_RUN_ID`, `GITHUB_RUN_NUMBER`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`, `GITHUB_SHA` and workflow identity have distinct meanings.
- [GitHub reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs): a rerun retains run identity; it does not prove every listed job newly executed.
- [Node test runner reporters](https://nodejs.org/download/release/v24.13.1/docs/api/test.html#custom-reporters): machine-readable producer integration needs an actual supported reporter. No arbitrary PASS-line parser is implemented here.
- Installed Node `v24.13.1`; `node --help` confirmed `--test`, `--test-reporter`,
  `--test-reporter-destination`, `--test-timeout` and `--input-type` options.
