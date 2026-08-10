# Teams Adaptive Card carousel and image slice

## Goal

Add a small, deterministic Teams-first GenUI slice that demonstrates a message-level Adaptive Card carousel and safe inline images in each card. Keep the payload compatible with the Teams mobile Adaptive Card 1.2 subset and preserve the existing single-card path.

## Constraints

- The source of truth is `/Users/doosansmacbookpro/Documents/TeamsApp`.
- Use `attachmentLayout: "carousel"` with at most 10 Adaptive Card attachments for the bot message path.
- Use public HTTPS image URLs only; reject unsafe protocols and do not fetch or proxy arbitrary image bytes from the server.
- Use `ImageSet` for multiple images inside one card; do not use horizontal scrolling inside an Adaptive Card because Teams mobile does not support it reliably.
- Keep card version `1.2` for the mobile-compatible bot contract.
- Adaptive Card-based Loop components are not part of this slice: Microsoft documents them as unavailable in Teams macOS and mobile clients. Revisit only for a desktop/web message-extension feature after the Teams mobile core converges.
- Every new command must perform real server-side rendering and be covered by unit/contract tests plus local `/api/messages` runtime evidence.
- Release only from the committed local source, reuse existing browser tabs, and do not claim mobile completion without user-confirmed mobile evidence.

## Tasks

1. Add failing schema and renderer tests for image validation, `ImageSet`, carousel attachment layout, max-card enforcement, and fallback behavior.
2. Implement `GenUiImage` in the shared envelope, Teams image rendering, and `createAdaptiveCardCarouselActivity`.
3. Add a deterministic `carousel` bot command and help-card button so the feature is reachable from Teams chat.
4. Run focused tests, core build/tests, package/release loop, and local runtime checks.
5. Upload the new package through the existing Teams Admin Center tab, verify the installed desktop app and every carousel/image branch with fresh AX and screenshots, then request mobile confirmation.
