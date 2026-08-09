# Task 3 report — Teams tab SSO release recovery

## STATUS

Implemented and locally verified. No Entra, Teams Admin, portal upload, deployment, or Teams message action was performed by this task.

## EVIDENCE

### RED

The contract tests were updated before implementation and failed against the old repository contract:

```text
$ npm run test:deployment-env
AssertionError: APPLICATION_ID_URI must match the Teams SDK bot resource: expected api://botid-00000000-0000-4000-8000-000000000004

$ npm run validate:manifest
Manifest validDomains must include token.botframework.com for Teams SSO redirect handling.
```

### GREEN

The final required command completed successfully on the committed clean worktree:

```text
npm run test:deployment-env && npm run validate:manifest && npm test
PASS
```

Also verified `git diff --check` and the package/manifest version contract. The app package version, manifest version, and lockfile root versions are all `1.0.15`.

## COMPLETED

- Aligned `scripts/validate-deployment-env.mjs` and deployment tests to `api://<TAB_DOMAIN>/botid-<BOT_CLIENT_ID>`.
- Updated ignored `.env.runtime` `APPLICATION_ID_URI` to `api://dxshc7dx-3978.jpe1.devtunnels.ms/botid-32127cdd-f19d-4fce-95c9-431e27cca739`; no secret value was changed or printed.
- Bumped `appPackage/manifest.json`, `package.json`, and `package-lock.json` to `1.0.15`.
- Added `token.botframework.com` to manifest `validDomains` and made manifest validation enforce it.
- Updated release/runtime tests, AGENTS.md, README.md, app-package guidance, and Teams release/troubleshooting docs to the combined bot+tab contract.

## ENTRA OBSERVATIONS

The orchestrator confirmed the external registration contract for bot client `32127cdd-f19d-4fce-95c9-431e27cca739`:

- `requestedAccessTokenVersion = 2`
- Application ID URI: `api://dxshc7dx-3978.jpe1.devtunnels.ms/botid-32127cdd-f19d-4fce-95c9-431e27cca739`
- `access_as_user` exists
- Teams desktop/mobile client `1fec8e78-bce4-4aaf-ab1b-5451cc387264` is preauthorized
- Teams web client `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` is preauthorized
- Bot Framework redirect URI: `https://token.botframework.com/.auth/web/redirect`

Teams Doctor now passes `access_as_user`, clients, and redirect URI. Its only SSO failure is the CLI standalone-bot bare-URI expectation; that expectation conflicts with the Microsoft combined bot+tab FQDN/botid contract and the deployed iframe-origin mismatch.

## TESTS

- `npm run test:deployment-env`
- `npm run validate:manifest`
- `npm test`
- `git diff --check`

## BLOCKER

None for Task 3 implementation. Portal upload, installed-version, desktop, and mobile evidence remain intentionally unverified for Task 4.

## NEXT ACTION

Task 4 may create a new `1.0.15` ZIP, inspect its internal manifest and SHA-256, and continue the approved existing-app release loop. Commit SHA: pending at report authoring.
