# Task 1 report — personal Teams tab runtime

## STATUS

IMPLEMENTED / FOCUSED TESTS PASS, INCLUDING THE P2 RETRY FOLLOW-UP. This task only covers the client bootstrap, public client document, source manifest contract, and focused client tests. It does not claim Teams release, desktop, mobile, or Entra end-to-end completion.

## EVIDENCE

Before the change, `src/client/main.tsx` used a 2,000 ms application timeout, called `app.initialize()` unconditionally, and retried through the generic controller without resetting TeamsJS state after a rejected initialization. The source document had only the initial loading text and no client CSP contract. The source manifest used a non-trailing-slash personal `websiteUrl` and the validator accepted any trailing-slash `contentUrl` path.

The new red regressions reproduced those gaps:

- a 2,050 ms successful initialization returned `recovery` instead of `ready`;
- a retry test had no TeamsJS reset hook;
- a personal tab URL targeting `/other/` passed manifest validation;
- the built public document had no CSP meta policy.

After the change:

- bootstrap allows a 10,000 ms host-startup window, keeps the loading state during retry, and guards duplicate/late attempts;
- a timed-out TeamsJS initialization no longer blocks retry behind its still-pending native promise; a retry starts a new bounded generation immediately, while the old generation remains stale if it resolves later;
- the production bootstrap skips an already initialized TeamsJS instance and calls TeamsJS `_uninitialize()` before retrying a failed initialization when it is safe to reset;
- the public client document declares a self-bound CSP and keeps the built module and stylesheet relative to the `/tabs/home/` prefix;
- the personal tab manifest uses `https://${{TAB_DOMAIN}}/` for both website URLs and requires exactly `https://${{TAB_DOMAIN}}/tabs/home/` for the home content URL;
- existing auth coverage confirms failed SSO token refresh removes stale authorization headers; no credential or environment value was changed.

The focused retry regression reproduces the P2 finding: after the first initialization times out and its promise remains unresolved, duplicate retry clicks start exactly one fresh attempt without waiting for the original. The fresh attempt reaches `ready`; resolving the original later does not mark the host ready or mount the app again. Before the fix, this test failed with `AssertionError: retry starts a fresh Teams attempt without waiting for the timed-out initialization (1 !== 2)`.

## COMPLETED

Changed files:

- `src/client/main.tsx`
- `src/client/index.html`
- `appPackage/manifest.json`
- `scripts/validate-manifest.mjs`
- `scripts/validate-manifest-test.mjs`
- `scripts/client-bootstrap-test.ts`
- `scripts/client-public-assets-test.mjs`
- this report

Verified commands:

- `npm run typecheck` — pass
- `npm run test:client-bootstrap` — pass
- `npm run test:client-auth` — pass
- `npm run test:client-refresh-recovery` — pass
- `npm run test:client-location` — pass
- `npm run test:manifest` — pass
- `npm run build:client` — pass
- `node scripts/client-public-assets-test.mjs` — pass; `/tabs/home/`, the hashed module, and stylesheet returned 200 from a local HTTP fixture without opening a browser tab
- `git diff --check` — pass

## BLOCKER

- Actual public HTTPS reachability, Teams desktop host loading, installed app version, TeamsJS runtime messaging, and Entra SSO token issuance were not exercised. No browser tab was opened or waited on, and no credentials were changed.
- The client source can declare resource CSP, but the effective production response headers (including iframe embedding policy) remain deployment-owned and were not observable in this bounded task.
- Source inspection still shows the `/tabs/home` static route in the pre-existing non-Teams-SDK server branch. I did not change `src/server/index.ts` because this task explicitly limits edits to client/bootstrap/manifest/focused client test files; the controller should review that production public-serving path separately.
- No Teams ZIP was created or uploaded, and no mobile result is claimed.

## NEXT ACTION

Review and integrate this commit, then verify the public process and existing Teams installation using the release workflow. In particular, confirm the production Teams-SDK process serves the packaged `/tabs/home/` document and emits the required iframe/CSP headers before any package upload or completion message.
