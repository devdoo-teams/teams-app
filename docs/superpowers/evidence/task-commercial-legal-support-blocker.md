# Commercial legal/support surface blocker

Date: 2026-08-20
Scope: frontend/card UX worker audit; no browser, credentials, Jira write, or
external service was used.

## STATUS

`BLOCKED — BRAND_LEGAL_AUTHORITY_MISSING`

The current repository still exposes the manifest privacy and terms URLs as
placeholder MVP pages:

- `appPackage/manifest.json` points `privacyUrl` to `/privacy` and
  `termsOfUseUrl` to `/termsOfUse`.
- `src/server/index.ts` currently serves `Internal MVP privacy information.`
  and `Internal MVP terms of use.`.
- No approved privacy policy, terms of use, support owner, retention/deletion
  statement, or publisher-controlled production legal URLs were supplied in
  this task.

The repository commercial-compliance audit identifies the proposed stable
blocker key `teams-core:release-blocker:commercial-legal-and-support` and
requires approved, public HTTPS privacy, terms, and support surfaces before a
commercial/Store readiness claim. This local record is not a live Jira
read-back and must not be treated as one.

## FAIL-CLOSED DECISION

This frontend/card slice does not add or alter legal copy, URLs, manifest
metadata, or backend legal routes. Until the product/legal owner supplies
approved content and the deployment domain, the release remains blocked for
commercial distribution. Do not mark the legal surfaces as `PASS`, package
them as Store-ready, or report commercial completion based on the placeholder
responses.

## ACCEPTANCE EVIDENCE REQUIRED

1. Approved privacy and terms content, including the actual data-handling,
   retention/deletion, protection, and contact facts for this product.
2. An approved publisher-controlled HTTPS origin and a no-auth support path.
3. Manifest, bot/listing metadata (where applicable), and deployed responses
   aligned to the same approved URLs.
4. Read-only HTTP evidence for each page from the same release identity, plus
   live Jira reconciliation of the stable key before any transition.

No legal approval was inferred, and no fabricated terms or privacy statements
were committed.
