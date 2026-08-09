# SDD ledger — plan: /Users/doosansmacbookpro/Documents/TeamsApp/docs/superpowers/plans/2026-08-09-teams-production-recovery.md

Baseline: 4875b9d; npm test exit 0 on 2026-08-09.
Task 1: complete (commits 4875b9d..50bd9b5, review clean)
Task 2: complete (commits 50bd9b5..922c83f, review clean; focused tests and typecheck re-run by orchestrator)
Task 3 observation: Entra app 32127cdd-f19d-4fce-95c9-431e27cca739 was missing its Application ID URI, exposed scope, authorized Teams clients, and Bot Framework redirect URI. The approved recovery configured requestedAccessTokenVersion=2, api://dxshc7dx-3978.jpe1.devtunnels.ms/botid-32127cdd-f19d-4fce-95c9-431e27cca739, access_as_user, Teams desktop/mobile and web clients, and https://token.botframework.com/.auth/web/redirect.
Task 3 root cause: commit cf4db95 changed the tab-origin URI contract to bare api://botid-...; the deployed tab reproduces an iframe-origin mismatch. Microsoft documents the FQDN/botid resource for a combined bot+tab app. After the Entra recovery, Teams Doctor improved from 4 failures to 1 legacy standalone-bot URI expectation; scope, clients, and redirect now pass. The Teams manifest still requires the FQDN/botid URI and token.botframework.com validDomain.
Task 3: fix round 1/5 (5 addressed, 2 open — production startup required explicit TAB_DOMAIN/BOT_CLIENT_ID validation; source manifest validation required both literal validDomains; commits 4c5219f..30a376b)
Task 3: fix round 2/5 (2 addressed, 0 open — shared public-hostname guard and pure source-manifest validation; commit 0896d02)
Task 3: complete (commits 922c83f..0896d02, review clean; orchestrator full npm test exit 0 on 2026-08-09)
