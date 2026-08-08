# Teams Card Response Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Teams Adaptive Card activities are attachment-only so mobile Teams does not render duplicate gray text bubbles, while preserving explicit text-only fallback activities.

**Architecture:** Keep the existing activity shape and delivery flow unchanged. Card-mode constructors will retain the message type, Adaptive Card attachment, and `attachmentLayout: 'list'`, but omit the top-level `text`; fallback constructors and failure/legacy delivery paths remain text-only.

**Tech Stack:** TypeScript, Node `assert` contract scripts, `tsx`, npm TypeScript typecheck.

## Global Constraints

- Do not change provider behavior, authorization, GenUI schema, or external-platform code.
- Card-mode activities must be card-only.
- Text-only fallback functions must remain text-only.
- Preserve `attachmentLayout: 'list'`.
- Follow strict TDD: assertions first, observe focused failure, then production change.
- Commit with message: `fix: prevent duplicate Teams card responses`.

### Task 1: Add failing Teams activity contract assertions

**Files:**
- Modify: `scripts/genui-contract-test.ts`

**Interfaces:**
- Consumes: `createAdaptiveCardActivity`, `createTextFallbackActivity`, `createResponseModeCardActivity`.
- Produces: executable assertions that card-mode activities omit top-level `text`, retain one Adaptive Card attachment and `attachmentLayout: 'list'`, and preserve text-only fallback behavior.

- [x] **Step 1: Add assertions before production changes**

Add `createResponseModeCardActivity` to the existing import and assert:

```ts
assert.equal('text' in activity, false);
assert.equal(activity.attachmentLayout, 'list');
assert.equal(activity.attachments?.length, 1);

const responseModeActivity = createResponseModeCardActivity('deterministic', [
  { mode: 'deterministic', label: '결정형', configured: true },
  { mode: 'openai', label: 'OpenAI', configured: false },
]);
assert.equal('text' in responseModeActivity, false);
assert.equal(responseModeActivity.attachmentLayout, 'list');
assert.equal(responseModeActivity.attachments?.length, 1);

const textFallback = createTextFallbackActivity(nonAiEnvelope);
assert.equal(textFallback.text, '업무 허브 응답입니다.');
assert.equal(textFallback.attachments, undefined);
assert.equal(textFallback.attachmentLayout, undefined);
```

- [x] **Step 2: Run the focused contract test and observe the expected failure**

Run: `npx tsx scripts/genui-contract-test.ts`

Expected: FAIL at the new card-only assertion because the current card activity includes a top-level `text`.

### Task 2: Remove duplicate top-level text from card-mode activities

**Files:**
- Modify: `src/server/genui-teams.ts:378-384`
- Modify: `src/server/response-mode-card.ts:71-85`

**Interfaces:**
- Consumes: Existing envelope/response-mode inputs.
- Produces: Existing `TeamsMessageActivity` shape with attachment-only card-mode delivery and unchanged fallback behavior.

- [x] **Step 1: Remove only the top-level `text` properties from the two card-mode activity returns**
- [x] **Step 2: Leave `createTextFallbackActivity`, delivery failure fallback, legacy mode, attachment payloads, and `attachmentLayout: 'list'` unchanged**

### Task 3: Verify and commit

**Files:**
- No additional production files.

- [x] **Step 1: Run the focused contract test**

Run: `npx tsx scripts/genui-contract-test.ts`

Expected: PASS.

- [x] **Step 2: Run TypeScript typecheck**

Run: `npm run typecheck`

Expected: PASS with exit code 0.

- [x] **Step 3: Review the diff and commit**

Run:
```bash
git diff --check
git diff -- src/server/genui-teams.ts src/server/response-mode-card.ts scripts/genui-contract-test.ts
git status --short
git add src/server/genui-teams.ts src/server/response-mode-card.ts scripts/genui-contract-test.ts
git commit -m "fix: prevent duplicate Teams card responses"
```

Expected: one implementation commit with the requested message and no unrelated changes.

## Release/runtime evidence

- [x] `npm test` passed after the v1.0.10 package bump.
- [x] `teams-sdk-mvp.zip` v1.0.10 was generated, inspected, and uploaded to the existing Teams app.
- [x] Public health reports `auth=teams-authenticated`, `bot=teams-sdk`, `outbound=teams-sdk`, and `genUi=adaptive-cards`.
- [x] Teams web-host runtime `help` round-trip returned one Adaptive Card without a duplicate text bubble.
- [ ] Teams mobile-host confirmation remains the final user acceptance step.
