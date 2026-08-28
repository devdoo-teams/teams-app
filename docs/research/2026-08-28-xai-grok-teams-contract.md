# xAI/Grok and Microsoft Teams integration contract

Checked: 2026-08-28 (Asia/Seoul)

This note records the first-party contracts used for the optional Grok
provider. It does not claim that this repository has a live xAI key, model
entitlement, public Teams installation, or mobile UI proof.

## Documented contracts

- xAI documents `POST https://api.x.ai/v1/responses` and Bearer authentication
  with an xAI API key. The provider keeps that key on the server; the Teams
  tab never receives it.
  Source: <https://docs.x.ai/developers/rest-api-reference/inference>
- xAI's current model documentation uses `grok-4.6` as a model identifier.
  Key-specific access must still be checked with the authenticated model list.
  Sources: <https://docs.x.ai/developers/models> and
  <https://docs.x.ai/developers/rest-api-reference/inference/models>
- xAI documents Responses output as an `output` array, with assistant text in
  a `message` item containing `output_text`. Responses also support
  `previous_response_id` for continuation.
  Source: <https://docs.x.ai/developers/rest-api-reference/inference/chat>
- xAI documents custom function tools with a JSON-Schema `parameters` object.
  Function calls are returned as `function_call` items and application results
  are sent back as `function_call_output` items. `parallel_tool_calls: false`
  is available when the application wants a serialized tool boundary.
  Source: <https://docs.x.ai/developers/tools/function-calling>
- xAI documents SSE streaming with `stream: true`, but a synchronous response
  does not prove that streaming works for a particular key, model, or network.
  Source: <https://docs.x.ai/developers/model-capabilities/text/streaming>
- Microsoft documents Bot Framework `message` Activities and Adaptive Card
  attachments with content type
  `application/vnd.microsoft.card.adaptive`. Slow model work must respect the
  documented acknowledgement window; it is not proof of a live Teams route.
  Sources: <https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability>
  and <https://learn.microsoft.com/en-us/azure/bot-service/bot-builder-basics?view=azure-bot-service-4.0>
- Microsoft documents Teams streaming as cumulative updates with client,
  throttling, cancellation, and size constraints. xAI SSE frames cannot be
  forwarded directly as Teams activities.
  Source: <https://learn.microsoft.com/en-us/microsoftteams/platform/bots/streaming-ux>

## Implemented boundary in this branch

`GrokResponseEngine` is an explicitly optional server-side adapter. It uses
the documented Responses endpoint, normalizes assistant text, maps the
existing narrow Teams tool allowlist to xAI's flat function-tool shape, and
validates every returned call before executing any one of them. File changes
still cross the existing `workspaceApproval` boundary. The engine is not
loaded by the Core build and is selectable only when `TEAMS_OPTIONAL_RUNTIME`
and `XAI_API_KEY` are present.

The adapter deliberately does not expose arbitrary shell, filesystem, Jira,
or Teams mutation to the model. xAI function calling is a model/application
handoff, not a Teams authorization grant. The existing tenant/requester
authorization and approval checks remain authoritative.

## Live gates still required

Before calling this a working Grok Teams bot, the release candidate must
separately prove all of the following with redacted evidence:

1. `GET /v1/models` (and, where applicable, `/v1/language-models`) succeeds
   for the actual server key and confirms the selected model.
2. A bounded non-streaming Responses request returns a valid assistant output.
3. A non-destructive function-call round trip returns a valid follow-up.
4. Authentication, permission, unknown-model, rate-limit, timeout, and
   malformed-output paths are handled without leaking credentials.
5. The same release identity is present in the server health response, package
   manifest, deployed public host, installed Teams app, and desktop/mobile UI.
6. Teams desktop accessibility-tree and screenshot evidence proves the real
   chat/card response. iOS WebView, mobile permission, and GPS evidence remain
   `MOBILE_UNVERIFIED` until captured on the device.

Until those gates pass, the correct status is: **documented contract ready;
live Grok provider and Teams integration unverified**.
