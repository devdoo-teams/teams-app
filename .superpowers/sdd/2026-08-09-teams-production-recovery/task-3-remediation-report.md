# Task 3 remediation report — Teams release SSO contract review findings

## STATUS

Implemented and locally verified. This remediation is limited to local source, test, and documentation changes. No Teams, Entra, portal, deployment, or other external system was changed.

## RED EVIDENCE

### Group 1 — I-1 / I-3 release-gate contract

Tests were updated first with a distinct Bot client fixture, the combined bot+tab resource, both required valid domains, and negative cases for each missing domain plus a Bot ID/resource mismatch.

Command:

```text
$ npm run test:release-gate
```

Observed failure against the pre-remediation implementation:

```text
AssertionError [ERR_ASSERTION]: Missing expected exception.
    at file:///Users/doosansmacbookpro/Documents/TeamsApp/scripts/release-gate-test.mjs:53:8
```

The first missing-domain case passed through `assertPackagedManifest`, proving the packaged-manifest gate did not yet enforce the tab domain.

### Group 2 — I-2 runtime production contract

A focused startup regression was added for a production process whose resource URI uses the auth `CLIENT_ID` after `botid-` instead of the `BOT_CLIENT_ID`.

Command:

```text
$ npm run test:runtime
```

Observed failure against the pre-remediation built server:

```text
Error: FAIL: production with a mismatched combined SSO resource exits instead of starting
    at expectStartupFailure (file:///Users/doosansmacbookpro/Documents/TeamsApp/scripts/runtime-test.mjs:374:5)
```

The process started instead of rejecting the invalid production SSO resource, so a startup contract guard is required.

After the focused production startup guard and both fixture corrections were implemented, the server bundle and client prerequisite were rebuilt and the runtime suite passed:

```text
$ npm run build:server && npm run build:client && npm run test:runtime

Runtime verification complete.
```

Exit code: 0. The runtime output includes successful rejection of the mismatched `botid-…` resource, the existing demo-weather production rejection, and the production health flow with the combined URI fixture.

The first post-implementation run omitted `build:client` and exposed the pre-existing local artifact prerequisite (`dist/client/index.html` was absent); rebuilding the client resolved that environmental setup issue without a source change.

### Group 3 — M-1 `TAB_DOMAIN` hostname validation

Focused deployment-environment cases were added for ports, query strings, fragments, whitespace, empty labels, leading/trailing dots, leading/trailing hyphens, underscores, and a valid public Dev Tunnel hostname.

Command:

```text
$ npm run test:deployment-env
```

Observed failure against the pre-remediation validator:

```text
AssertionError [ERR_ASSERTION]: port TAB_DOMAIN must fail at hostname validation
actual: APPLICATION_ID_URI must match the Teams SDK combined bot+tab resource: expected api://runtime.example.com:3978/botid-…
```

The malformed port value reached URI derivation instead of being rejected as a hostname.

After replacing the permissive substring checks with a DNS hostname grammar (including label length and boundary rules) while retaining the loopback/localhost restrictions:

```text
$ npm run test:deployment-env

Deployment environment tests passed: combined Teams SDK bot+tab resource URI is mandatory.
```

Exit code: 0. The valid `dxshc7dx-3978.jpe1.devtunnels.ms` fixture remains accepted.

### Follow-up group R-1 — production startup contract

Focused startup cases were added before implementation for a missing `TAB_DOMAIN`, a missing `BOT_CLIENT_ID` with `CLIENT_ID` still present, and a malformed hostname paired with the correspondingly malformed URI.

```text
$ npm run test:runtime

Error: FAIL: production without TAB_DOMAIN exits instead of starting
    at expectStartupFailure (file:///Users/doosansmacbookpro/Documents/TeamsApp/scripts/runtime-test.mjs:374:5)
```

Exit code: 1. The pre-remediation production process accepted `APPLICATION_ID_URI=api:///botid-<BOT_CLIENT_ID>` and started, proving the empty-domain boundary was not fail closed.

### Follow-up group R-2 — source manifest domains

The in-memory negative test was added before implementation and does not write the checked-in manifest. Its first run established the missing pure validation boundary:

```text
$ npm run test:manifest

AssertionError [ERR_ASSERTION]: manifest validation must expose a pure function for in-memory negative fixtures
actual: 'undefined'
expected: 'function'
```

After the minimal behavior-preserving pure refactor, the same test reached the remaining contract gap:

```text
$ npm run test:manifest

AssertionError [ERR_ASSERTION]: source manifest validation rejects omission of ${{TAB_DOMAIN}}
actual: ''
expected: /\$\{\{TAB_DOMAIN\}\}/
```

Both runs exited 1 for the expected missing behavior; the second proves the pre-fix pure validator still accepted a source manifest without the tab-domain template.

## GREEN EVIDENCE

### Group 1 — I-1 / I-3 release-gate contract

After adding the minimum packaged-manifest checks for both domains and the combined Bot ID resource contract:

```text
$ npm run test:release-gate

Release gate contract tests passed.
```

Exit code: 0. The negative cases now reject a package missing the tab domain, a package missing `token.botframework.com`, and a resource URI whose `botid-…` value does not match the expected Bot client ID.

### Follow-up group R-1 — production startup contract

The deployment validator and production runtime now share one bounded DNS hostname helper. Production requires a trimmed explicit `BOT_CLIENT_ID`, a non-empty valid `TAB_DOMAIN`, and only then constructs and compares the combined resource URI; local `CLIENT_ID` fallback remains available outside production.

```text
$ npm run test:deployment-env && npm run build:server && npm run test:runtime

Deployment environment tests passed: combined Teams SDK bot+tab resource URI is mandatory.
Server bundle created: dist/server
Runtime verification complete.
```

Exit code: 0. Runtime output confirms focused failures for missing `TAB_DOMAIN`, missing explicit `BOT_CLIENT_ID`, and a malformed hostname with a matching malformed URI, while valid local and production flows pass.

### Follow-up group R-2 — source manifest domains

The source validator now exposes pure in-memory validation and requires both literal entries without test-time writes to `appPackage/manifest.json`.

```text
$ npm run test:manifest && npm run validate:manifest

Source manifest contract tests passed.
Manifest OK: v1.25, 1 static tab(s)
```

Exit code: 0. Separate negative fixtures reject omission of `${{TAB_DOMAIN}}` and `token.botframework.com`.

### Follow-up final verification

```text
$ npm run test:deployment-env && npm run test:manifest && npm run test:runtime && npm run validate:manifest && npm run typecheck && git diff --check

Deployment environment tests passed: combined Teams SDK bot+tab resource URI is mandatory.
Source manifest contract tests passed.
Runtime verification complete.
Manifest OK: v1.25, 1 static tab(s)
```

Exit code: 0. Typecheck and `git diff --check` produced no errors.

### Group 4 — M-2 environment example

Updated `.env.example` to show `api://<TAB_DOMAIN>/botid-<BOT_CLIENT_ID>` and require an exact match with the observed Bot Entra `Expose an API` URI. No secret or runtime value was added.

### Final requested verification

The complete focused verification command passed with exit code 0:

```text
$ npm run test:release-gate && npm run test:deployment-env && npm run test:runtime && npm run validate:manifest && npm run typecheck && git diff --check

Release gate contract tests passed.
Deployment environment tests passed: combined Teams SDK bot+tab resource URI is mandatory.
Runtime verification complete.
Manifest OK: v1.25, 1 static tab(s)
```

## COMPLETED

- Group 1 (I-1 / I-3) release-gate fixture and packaged-manifest validation is complete.
- Group 2 (I-2) production runtime fixtures and the focused startup contract guard are complete.
- Group 3 (M-1) strict `TAB_DOMAIN` hostname validation and focused cases are complete.
- Group 4 (M-2) `.env.example` combined URI guidance is complete.
- Follow-up R-1 production startup validation gaps are complete.
- Follow-up R-2 source-manifest validation gaps are complete.

## BLOCKER

None identified.

## NEXT ACTION

Run the final focused verification and commit the R-1/R-2 remediation with the requested message. Do not deploy or mutate external systems.
