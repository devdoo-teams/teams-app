# Local GitHub result reader — P1

`read-github.mjs` converts existing GitHub REST response files, optional original
normalized producer receipts and local artifact bytes into the common result
contract. It reads source files and writes one new local packet. It never starts
CI, executes artifact contents, sends a notification or creates an ACK.

## Run

Use the package's pinned install described in [README.md](README.md). From the
repository root, supply an existing capture directory, a separately reviewed
local policy and a new output directory:

```sh
node tools/ci-contract/read-github.mjs --capture-dir /tmp/ci-capture --policy /tmp/reviewed-policy.json --output-dir /tmp/ci-packet-new
```

The six arguments must appear in that order. Exit 0 means `REPORT_WRITTEN`, and
the printed summary includes the API conclusion, evidence gate and contract
digest. Inspect those fields before drawing a conclusion about CI. Exit 2 emits
the fixed diagnostic `GITHUB_CAPTURE_INPUT_OR_OUTPUT_REJECTED`; supplied source
values and private paths are not echoed. A failed output can leave an incomplete
new directory. Require and verify its entire `SHA256SUMS` before consuming it.

The library interface is:

```js
import { readGithubCapture } from './lib/github-reader.mjs';
const { result, provenance } = readGithubCapture(captureDirectory, policyFile);
```

`fixtures/github.mjs` exports `githubFixture()` with a complete synthetic
`{ capture, policy, files }` input. Tests materialize these in temporary
directories. No actual API responses, logs or downloaded artifacts are checked
into the source tree.

## Capture files

Place `capture.json` and the referenced files directly inside the capture
directory. Descriptor filenames are flat names of up to 80 ASCII letters,
digits, dots, underscores or hyphens, beginning with a letter or digit. A
descriptor cannot select an absolute path, parent path, URL or command.

```json
{
  "captureVersion": "1.0.0",
  "evidenceKind": "FIXTURE",
  "repository": "devdoo-teams/teams-app",
  "runId": "1001",
  "attempt": 1,
  "run": { "file": "run.json", "fetchedAt": "2026-10-20T00:03:00Z" },
  "jobPages": [
    { "file": "jobs-1.json", "attempt": 1, "page": 1, "perPage": 100, "fetchedAt": "2026-10-20T00:03:00Z" }
  ],
  "historyJobPages": [],
  "artifactPages": [
    { "file": "artifacts-1.json", "page": 1, "perPage": 100, "fetchedAt": "2026-10-20T00:03:00Z" }
  ],
  "receiptFiles": [],
  "artifactFiles": [ { "artifactId": "7001", "file": "artifact.zip" } ],
  "releaseIdentityFiles": []
}
```

The example is synthetic and only illustrates the manifest; all referenced files
must exist. Use `OBSERVATION` for a captured observation, retaining its read
receipts separately. That label does not authenticate the files.

| Descriptor | Expected source |
| --- | --- |
| `run` | Response from the requested workflow-run attempt endpoint |
| `jobPages` | Responses from that exact attempt's jobs endpoint |
| `historyJobPages` | Earlier attempts of the same run; candidate-origin clues only |
| `artifactPages` | Run artifact listing responses, preserving API digests and expiry |
| `receiptFiles` | Original receipt in the common contract's receipt schema, explicitly bound to a listed job ID |
| `artifactFiles` | Opaque regular files hashed in place, bound to listed artifact IDs |
| `releaseIdentityFiles` | Legacy `schema=1` release identity with source commit, version and Teams package hash |

Do not pass arbitrary build logs as receipts. The reader does not invent a
receipt from a successful step or a legacy release identity. It also does not
extract ZIPs or prove that a caller-supplied legacy identity came from its
declared archive. Such identities are marked `archiveMembership=UNVERIFIED`.

## Local policy

The policy schema is exported from `lib/github-schemas.mjs`. Its required fields
are `policyVersion="github-reader/1"`, `repository`, `workflow`, `runHeadSha`,
`profile`, `requirements` and `bindings`.

`requirements` uses the common scope/required/expected-count/job-slot contract.
Each binding names an exact API display name and supplies `key`, `matrixDigest`,
`kind`, `expectedInputs` and `expectedDependencyDigests`. Missing input digests,
matrix identity and dependency inventory must be `null`; they cannot be inferred
from a green API conclusion. `runHeadSha=null` leaves the policy pin absent.
When a non-null pin is supplied, a different API head is rejected.

Keep the policy in a trusted local review path and derive its job inventory from
the workflow at the original source commit. Its hash is recorded in provenance.
This reader does not establish which branch-protection checks are required, or
authenticate that a policy was approved. A policy used to demonstrate conversion
must not be presented as proof of release admission.

Unmapped API jobs receive an `api-<id>` key, `keySource=API_ID`, unknown kind,
null matrix and unknown inputs. They remain unverified. A policy binding is
recorded as `keySource=POLICY`; it is not an API-supplied workflow job key.

## Identity, provenance and missing evidence

| Observed field | Preserved meaning |
| --- | --- |
| Requested attempt | Capture query identity, retained for every API read |
| Listed `run_attempt` | Raw job's attempt or null; never filled from the request |
| Receipt producer | Original run/attempt/job/matrix; never rewritten during reruns |
| Run `head_sha` | `identity.runHeadSha`; not evidence of what an absent test executed |
| Receipt input SHA | `identity.testedSha` when original same-run receipts agree; otherwise null and conflicts block |
| Original receipt bytes | Raw file SHA-256 in provenance, separate from canonical receipt digest |
| Artifact API digest and local byte hash | Retained separately; disagreement blocks the record |
| Earlier job with matching name and original timestamps | Carry-forward candidate; no reuse proof is synthesized |

Known contradictory identities, including a future producer attempt, block even
when unrelated inputs are unknown. Unknown job kind cannot yield PASS or a zero
test total. Successful API outcomes remain visible independently from missing
receipt evidence. Model calls and costs stay unknown without complete coverage.

The five-file packet contains `ci-result.json`, `notification.md`,
`source-provenance.json`, `evidence-index.json` and `SHA256SUMS`. Provenance binds
the adapter/common contract digests, policy hash, source-file byte counts and
hashes, fixed API endpoint/page/attempt/fetch identity, original job producers,
candidate origins, artifact hashes and pagination completeness. One current
job page uses its raw response byte hash; multiple pages use a sorted page
manifest hash labeled `responseDigestKind=PAGE_MANIFEST`.

The adapter is a local snapshot reader. Supplied capture metadata, producer
receipts and downloaded bytes are not independent attestations. Provenance and
producer authenticity remain `UNVERIFIED`. Delivery is `NOT_ATTEMPTED`, and host
and release gates remain `UNVERIFIED`.

## Bounds and regression evidence

- Regular files only, no final-component symlinks or non-regular inputs. Reads
  are bounded and size/mtime changes during a read are rejected.
- JSON: 2 MiB per source, 256 KiB policy, at most 64 JSON source reads and
  16 MiB cumulative JSON source bytes. Artifact bytes are handled separately.
- At most 30 API page descriptors total, 100 rows per page, 500 current jobs,
  500 history jobs per attempt and 200 artifacts. Missing pages or inconsistent
  totals retain incomplete collection; duplicate pages/IDs are rejected.
- At most 20 local artifacts, 64 MiB each and 128 MiB total. Archives are opaque
  byte streams; there is no extraction or execution path.
- Output requires a fresh owner-only directory and uses fixed filenames. Source
  files are not changed.

P1 verification on Node 24.13.1 passed 78 local tests, including all P0 tests.
They cover original producer preservation on partial reruns, missing attempt,
null input identity, raw/API provenance, absent timestamps, incomplete pages,
artifact mismatch, legacy identities, unsafe IDs/paths, symlinks and CLI packet
hashes. Review found unknown-kind counting and future-attempt masking defects;
both were reproduced with failing tests and fixed before the full green run.

### Actual historical connection read-back

Using existing authentication and read-only `gh api --method GET`, the local
verification read [run 38501877218, attempt 1](https://github.com/devdoo-teams/teams-app/actions/runs/38501877218/attempts/1)
at source commit `823a2e41a64e5a1e17a4debaf18d775b62b63365` (release 1.0.151).
It returned all 8 jobs and 2 artifacts. Both downloaded archive hashes matched
their API digests:

| Artifact ID | Downloaded SHA-256 |
| --- | --- |
| `11866646920` | `9e1107e6ffd0e2da29e8bf73dc536c4a02b1ed56e53974823958236b67273aa7` |
| `11865723420` | `988f291690f49ee7a251dccba6468131400985ca5538f3d3ae99b53e073170f0` |

The cached response conversion preserved API `success`, null tested SHA, no
job-level receipts, `evidenceGate=UNKNOWN`, unknown model calls and
`releaseAdmission=UNVERIFIED`. The local demonstration policy is not a
branch-protection read-back. This historic run does not test the new reader code.
The partial-rerun proof is synthetic; an actual partial-rerun receipt connection,
new-code CI, authenticated delivery and iPhone repository integration remain
unverified.

## Official contracts checked 2026-10-21 KST

- [Get a workflow run attempt](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt): exact attempt identity and raw run fields.
- [List jobs for a workflow run attempt](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt): query attempt and pagination.
- [List workflow run artifacts](https://docs.github.com/en/rest/actions/artifacts#list-workflow-run-artifacts): run-level artifact identity, digest and expiry.
- Installed GitHub CLI: `gh version 2.87.2`; `gh api --help` confirmed explicit
  `--method GET`, `--hostname` and pagination options. The bounded capture used
  API version header `X-GitHub-Api-Version: 2026-03-10`; the adapter itself has no
  CLI dependency or network behavior.
