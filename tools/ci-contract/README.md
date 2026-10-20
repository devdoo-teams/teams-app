# Common CI evidence contract

This directory is an independent, private Node package for the Teams and iPhone
projects. It implements the common result schema, record consistency checks,
notification template, synthetic regression fixtures and bounded local CLIs.
It does not change either application's runtime. The Teams workflow has a
locally prepared observation integration; no remote workflow was run for it.

Package/result schema 1.3.0 adds [runner observation integration](README-runner-integration.md),
following the 1.2.0 [local receipt producer](README-producer.md) and 1.1.0
[GitHub result reader](README-github-reader.md).
Existing 1.0.0/1.1.0/1.2.0 result records remain accepted. The reader converts captured REST
responses and hashes local artifact bytes; it preserves absent producer identity,
inputs and counts as unknown. It performs no network requests itself.

## Use

Requires Node 20 or newer on macOS/Linux. The implementation was exercised on
Node 24.13.1. Install the exact lockfile without lifecycle scripts:

```sh
npm ci --prefix tools/ci-contract --ignore-scripts --no-audit --no-fund
npm test --prefix tools/ci-contract
node tools/ci-contract/cli.mjs --input tools/ci-contract/fixtures/teams-complete.json --output-dir /tmp/ci-evidence-new-directory
```

The destination must not exist. Inputs must be regular, non-symlink UTF-8 JSON
files of at most 2 MiB. The CLI accepts the two flags shown above in that order.
Unknown properties, URLs used as endpoints, arbitrary commands, invalid dates,
oversized collections and unsafe workflow paths are rejected. ZIP files are not
supported or extracted. Invalid input produces a fixed diagnostic without
echoing supplied values. An output failure can leave an incomplete new directory;
consumers must require and verify all entries in `SHA256SUMS` before using it.

A packet contains:

| File | Meaning |
| --- | --- |
| `ci-result.json` | Validated input, serialized with stable object key ordering |
| `notification.md` | Deterministic report; candidate content only, never sent |
| `evidence-index.json` | Identity, consistency assessment, notification candidate, contract digest and content hashes |
| `SHA256SUMS` | Hashes of the three files above; no self-referential manifest hash |

The GitHub reader also emits `source-provenance.json`; the index and `SHA256SUMS`
bind that fourth content file. Its usage and capture/policy formats are documented
in the reader guide.

Exit 0 means the packet was generated. It does **not** mean the producer's CI,
deployment or installation passed. Exit 2 means the input/output boundary was
rejected. Callers must inspect `assessment`, rather than treating the CLI's exit
code as a required CI check result.

## Trust boundary

The contract validates structure and internal consistency of a normalized record. An input
receipt, compatibility proof, artifact hash-check flag, measurement-coverage flag
or ACK is still supplied data. P0 does not fetch its producer or authenticate those
claims. `*_VERIFIED` execution relations refer to the consistency checks described
below; they are not GitHub attestations or independent execution observations.

`evidenceKind=FIXTURE` is printed prominently. `OBSERVATION` labels a record intended
to describe an observation; changing that field does not authenticate it.
The index and report always preserve `producerAuthenticity/releaseAdmission` as
`UNVERIFIED`. Host gates remain `UNVERIFIED` even if an input declares PASS.
Do not use this package alone for release admission or proof of zero model use.

P1 adds local captured-response normalization and artifact byte hash read-back.
The local producer serializes original structured job/step observations into
receipts with source and artifact hashes. The runner adapter captures real local
command exits and prepares prospective CI collection. Actual GitHub runner
read-back, source authentication, instrumentation verification, authenticated
delivery and ACK verification remain
separate work. No GitHub run, rerun, webhook, schedule, service, credential or persistent
access is created by this package. The common contract imports Node builtins and
pinned MIT-licensed Ajv dependencies; the runner adapter also reuses the existing
process-tree terminator. Input records cannot select modules,
commands, URLs to fetch, notification destinations or output filenames.

## Contract and consistency policy

`lib/schema.mjs` is the schema source. Run `npm run schema --prefix tools/ci-contract`
after editing it. `ci-result.schema.json` is the portable JSON Schema 2020-12 export.
Schema objects reject additional properties; all unknown counts use explicit null.
GitHub IDs are decimal strings so they are not truncated to JavaScript numbers.

The contract separates tested, API run-head, PR-head, merge and collector SHAs; a run/attempt,
profile and workflow never collapse into a SHA-only lookup key. Both repository
names are explicit in the v1 allowlist. A future repository needs a reviewed
contract change. Native full/SE/Help scope expectations remain 31/2/4 in policy v1;
new legitimate inventories require an explicit policy revision.

Each profile must include its primary scope as required: `core → teams-core`,
`optional → teams-optional`, `native-full → iphone-native-full`,
`native-se → iphone-se`, `native-help → iphone-help`, `collector → collector`.
Candidate profiles require `teams-candidate` or `iphone-candidate` respectively.
Seed and successful auxiliary jobs cannot substitute for that primary scope.

| Dimension | Policy |
| --- | --- |
| API outcome | Preserve exactly, including success with absent evidence |
| Missing receipt/artifact/page/matrix | UNKNOWN; no invented test count or success |
| Unknown job kind | UNKNOWN; unclassified work keeps test totals null |
| Current execution | Matching run, attempt, producer job/matrix, source/input/toolchain/suite/profile, timestamps and canonical receipt digest |
| Carry candidate | Earlier API time or candidate origins is only a clue |
| Carry consistency | Explicit unique origin receipt, earlier attempt, policy, input compatibility and actual recorded dependency consumption must agree; v1 does not reuse across run IDs |
| Duplicate invocation/job | Block the record; never count duplicated execution as new work |
| TEST jobs | Positive expected tests, executed count, no unexpected skips, exit and cleanup evidence |
| BUILD/SEED jobs | Separate kind; never counted as XCTest/whole-app coverage |
| Core/optional/native scope | Separate required flags and results; optional failure does not overwrite the Core receipt gate |
| Model measurement | Incomplete coverage, credential isolation, instrumentation identity or unobserved paths keep the normalized count null; positive blocked attempts remain distinct and block fixture admission |
| Live host state | Independent, always UNVERIFIED by P0 |

`evidenceGate=CONSISTENT` means the normalized fields agree, not that their source
has been authenticated. `requiredScopesGate` is a receipt-scope aggregate, not a
whole-workflow or release result. The requirement inventory is supplied by the
caller; P1 must bind it to a trusted, versioned policy rather than PR-controlled data.

`newExecutionTests`, `carriedForwardTests` and `newExecutionSeconds` count only
receipts attributed by the policy. They are not total actual execution when
`executionCountComplete=false`. A zero in that subtotal never fills in the missing
job's actual count. Missing or incomplete TEST counters remain null. Unclassified
job kinds also keep execution subtotals null. Runner/storage costs are unknown.
Measurement fields describe a normalized receipt's declared
instrumentation; this local tool does not independently instrument CI or all of its
descendants.

Receipt digests use UTF-8 `canonical(receipt)`: sort object keys recursively,
preserve array order, JSON primitive encoding, no trailing newline. This digest is
different from a hash of the original producer file bytes. P1 must record original
artifact/file digests separately and retain the source bytes.

## Notification candidates

The source key is repository/workflow/run/attempt/profile. Result revision hashes
the contract digest, normalized evidence and assessment while excluding fetch time, API response
digest, delivery state and revision-control metadata. It includes receipt and
artifact evidence, so evidence recovery can produce a revision even if the API
outcome stays success. Notification IDs also include event kind and sequence.
Set-like collections are sorted before revision hashing. Canonical receipt content
keeps its original array order and its own digest semantics.

`payloadDigest` hashes the semantic notification envelope, not the Markdown bytes;
the actual Markdown hash is in `evidence-index.json` and `SHA256SUMS`. Delivery must
define and authenticate the payload/ACK protocol before activating sends.

`compareNotifications` is a pure comparison of candidates created by
`notificationFor`: identical ID/digest is duplicate, same ID/different digest is
conflict, older events are stale, a different source key is unrelated. A new event
must explicitly name its predecessor. Late partial events cannot replace a final
event. P0 provides no persistent dedup store or exactly-once guarantee.

A supplied matching ACK is only `ACK_METADATA_MATCHED`; absent/mismatched ACK
metadata yields `UNCERTAIN`. Neither a schedule's enabled state nor its last-run
timestamp can create an ACK. ACK authenticity remains `UNVERIFIED` in the report.

## Fixtures and checks

All checked-in records are **synthetic**. The reduced iPhone rerun fixture uses a
historical run ID to label the previously observed failure mode; its jobs, times
and digests are constructed test data, not current GitHub read-back. It represents
new API job identity/attempt with old execution times and unavailable artifacts.

```sh
node tools/ci-contract/fixtures/generate.mjs
```

Regression tests cover malformed/missing inputs, partial results, reused work,
SHA/run/matrix/source identity, dependency mismatches, duplicate invocation,
zero/skip counts, cleanup, Core versus optional, Help versus full UI, incomplete
metering, blocked attempts, revisions, reverse events, ACK metadata, safe CLI input
and deterministic checksummed packets. Tests use local synthetic processes and
no provider invocation. Writing/reviewing this implementation uses the current
default development model; those model interactions are not the script's metrics.
The user's 2026-10-21 directive supersedes the original design's Astra assignment.

`contractDigest()` hashes a sorted manifest of the schema, runtime policy,
template, CLI and exact package/lockfile bytes. Both product integrations must
compare this digest before consuming records. This repository contains the common
package and both products' fixtures. Installing/wiring it into the iPhone repository
is a separate integration step; these P0/P1 changes do not modify that repository.

## Official contracts checked 2026-10-21 KST

- [JSON Schema Validation 2020-12](https://json-schema.org/draft/2020-12/json-schema-validation): types, required, additional properties, bounds and format vocabulary.
- [Ajv JSON Schema support](https://ajv.js.org/json-schema.html#draft-2020-12-breaking): separate 2020-12 class. The installed package is Ajv 8.20.0; date/time validation uses ajv-formats 3.0.1.
- [GitHub attempt-specific workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt): API observation identity is distinct from producer execution evidence.
- [GitHub reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs): reruns/selected failed jobs do not imply that every listed job executed anew.

No CI-wide success, producer authenticity, current installed version, actual host
UI readiness, end-to-end notification delivery or complete model metering is
claimed by these fixtures or their local tests.
