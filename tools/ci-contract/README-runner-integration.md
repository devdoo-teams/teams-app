# Runner observation integration (local preparation)

Version 1.3 prepares prospective observation collection for the existing Teams
`core-ci.yml`. Local synthetic Git workspaces execute real bounded shell
commands; their receipts remain `FIXTURE`. No GitHub run, push, upload, deployment,
credential or iPhone repository change was performed for this integration.

## Workflow preservation

`lib/workflow-integration.mjs` deterministically adds the integration and reverses
it. Removing only the generated observer additions must restore the complete
original workflow bytes with SHA-256:

```text
1954404f5c8f9f06460991f76b1aad4c68075ddcc0374f18817c55cce679b031
```

The workflow contract test checks this property and exact regeneration. All
original **8 jobs, 47 steps and 58 npm commands**, triggers, needs, permissions,
action pins, timeouts and run bodies remain. Two helper steps are appended to
each job. The existing job timeout includes their extra work; it is not extended.

Each original step gets a stable `ci_original_N` ID. Original `run` steps use:

```yaml
shell: 'node tools/ci-contract/capture-run.mjs step-N {0}'
```

The wrapper reads the runner-generated temporary script and runs it **once**
with the original implicit Linux Bash semantics, `bash -e {0}`. It preserves
cwd, environment, inherited output and actual nonzero exit. It does not add
`pipefail`, rerun commands, parse PASS text, launch models or rebuild artifacts.
The bootstrap uses Node builtins before either npm install has completed.
It reuses `createProcessTreeTerminator` from the existing Core test runner.

SIGINT/SIGTERM are forwarded to the owned process group. The GitHub runner keeps
control of its cancellation deadlines; the wrapper adds no earlier kill timer.
An observed child signal keeps `exitCode=null`; the CLI transport status is a
separate `128+signal` value. A self-signalled command is `SIGNALLED`, not an
invented engine cancellation. Descendant cleanup remains `UNKNOWN`.

## Original identity and source

The private runner directory is keyed by run ID / attempt / job. A fresh session
adds a random invocation ID and retains the separate run number. Start/result
files use exclusive writes; duplicate scope invocation cannot execute twice.
A new attempt uses a new directory and invocation, leaving old bytes untouched.
Fixture sessions cannot be promoted into observation sessions.

Before execution and finalization, capture requires a clean tracked worktree,
actual Git HEAD matching the event SHA, and workflow/package/lock bytes matching
that Git object. It records the Git tree and separate workflow-source SHA. Node
and Git versions are measured. Observer/bootstrap/cleanup helper files are also
hashed; observation mode requires those bytes to match checked-out Git objects.
The local fixture uses external observer bytes explicitly labeled
`LOCAL_OBSERVER_BYTES`.

These checks bind local bytes, not GitHub provenance authenticity. A job can
write its own workspace and evidence; no attestation is created. Source and
producer authenticity and release admission remain `UNVERIFIED`.

## Finalization and retention

An `always()` finalizer receives only the fixed original step IDs' engine
`outcome` and `conclusion` values plus the pre-finalizer job status. It records:

| Observation | Evidence retained |
| --- | --- |
| Completed `run` | Actual start/end, exit or signal, script and original definition hashes |
| Action | `OUTCOME_ONLY`; actual action exit and times remain null |
| Explicit skipped run | `NOT_RUN`; no invented execution or zero exit |
| Started but no terminal receipt | `MISSING` / `TERMINAL_RECEIPT_MISSING`; integrity BLOCKED |
| No run receipt | `MISSING` / `RUN_RECEIPT_MISSING`; integrity BLOCKED |
| Contradictory identity, source or result | Reject or integrity BLOCKED; safe existing failure metadata retained when available |

All 47 original steps stay in their job's inventory. Action metadata and missing
observations declare `coverageComplete=false`. RUN_SCOPES timestamps represent
the observed command window, not the complete API job boundary. P1 requires
known enclosing API job timestamps for attribution and never adjusts times.
Without complete coverage, the whole execution relation remains UNKNOWN.

The finalizer installs the small pinned helper lockfile once with
`npm ci --prefix tools/ci-contract --ignore-scripts --no-audit --no-fund`, then
uses the existing P2 producer. Capture, dependency or normalization failure fails
the helper step; no `continue-on-error` masks failure. A known original command
failure stays a failure even if partial evidence prevents execution attribution.
No actual test reporter is added, so test totals and model measurements stay
null. A command count is not a test count.

The candidate job hashes/copies its already-produced ZIP, server-tree checksum
manifest and release identity for normalization. It neither rebuilds nor replaces
the original candidate artifact/upload. Missing expected files block integrity.
Hashing the server manifest is not independent verification of each server file
or the container image.

The separate pinned `upload-artifact` helper is `always()`, with an artifact name
containing run ID, attempt and job, retention 14 days and missing-files error.
Only `export/` is selected: projected runner/source proof, closed raw command
metadata originals, their checksum file, and the five-file P2 packet. Raw
environment, stdout, temporary scripts, package contents, local capture inputs
and binary artifacts are not selected for upload. Original command metadata is
bounded to 16 KiB and a fixed field allowlist; unknown fields are never exported.
Its exact byte hashes remain independently recomputable after runner disposal.

If source validation fails after a command changed a tracked file, finalization
still exits nonzero. A separate `capture-failure.json` and checksum manifest can
retain the already-existing safe command metadata, including the original exit,
without producing a normal receipt or relaxing clean-source admission. Invalid
raw metadata is omitted with `RAW_METADATA_REJECTED`. No session is reconstructed
when the original session is unavailable.

Retention is best effort. Checkout/bootstrap failure, runner loss, timeout,
forced cancellation or artifact service failure can prevent finalization/upload.
An `always()` condition is not proof that either step ran. An absent receipt is
UNKNOWN on read-back; it must never be recreated from historical API success.

## Local verification

```sh
npm test --prefix tools/ci-contract
node scripts/ci-workflow-contract-test.mjs
```

The runner tests create isolated synthetic Git repositories. They execute shell
success/failure, pipeline/environment inheritance, signal forwarding, actual
observer SIGKILL, duplicate invocation and separate attempts. They reject dirty
or mismatched source, old-attempt raw metadata, engine contradictions and fixture
promotion. A secret sentinel must never occur in emitted metadata. They do not
run the original Core/optional/Azure/container jobs or contact external services.
Local verification uses Node 24.13.1, Apple Bash 3.2.57 and Git 2.54.0; the
workflow's existing Node 24.19.0 pin is unchanged and unexecuted by this phase.

## Remote integration prerequisites (not performed)

1. Review/commit these bytes, then separately authorize normal push and a new
   workflow run. This phase prepares local integration only.
2. Reuse the workflow's existing `contents: read` checkout and existing artifact
   action runtime authorization. No new permission, token or OIDC setting is
   added. Actual runner/artifact service support is UNVERIFIED until read-back.
3. The later read-only collector needs authorized Actions read access. Resolve
   repository/workflow/run/attempt, compare actual checkout/workflow provenance,
   download each original artifact by ID, and verify its API digest and packet
   checksum chain. Existing P1 parses captured REST data; it does not perform
   these remote requests. Current authorization was not rechecked here.
4. GitHub provenance attestation is not implemented. Any future write/OIDC or
   other permission change requires a separate decision; it is not inferred
   from this local byte-binding proof.
5. No delivery transport or authenticated receiver ACK exists in this adapter.
   Notification output remains a candidate; delivery is `NOT_ATTEMPTED`, and ACK
   authenticity remains UNVERIFIED. No ACK success may be synthesized.

Teams deployment, installation, desktop/web/iPhone UI and live worker gates
remain separate. This package cannot admit a release or prove a live host pass.

## Official contracts checked 2026-10-21 KST

- [Workflow shell syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell): custom `{0}` shell and implicit `bash -e` versus explicit Bash `-eo pipefail`.
- [Steps context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#steps-context): outcome before continue-on-error and conclusion after; neither is an actual action exit code or timestamp.
- [Workflow cancellation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation): SIGINT, later SIGTERM and runner process-tree termination; finalization is not guaranteed.
- [Node 24.13.1 child processes](https://nodejs.org/download/release/v24.13.1/docs/api/child_process.html#event-close): close code is null for signal termination; detached POSIX children form a process group.
- [Pinned upload-artifact](https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/README.md): unique immutable artifacts, retention and missing-file behavior.
- [Actions artifact REST API](https://docs.github.com/en/rest/actions/artifacts#list-workflow-run-artifacts): artifact identity/digest and Actions read permission for later capture.
- Installed Node `--help` confirmed `--test`, `--test-name-pattern`, `--test-reporter`;
  Git `--version` and Bash `--version` were read. Local commands are bounded by
  fixture subprocess timeouts and the outer 30-second test limit.
