# Teams app agent execution policy

This policy applies to CLI agents launched by this Teams application, including Core, A2A workers, queue workers, and execution canaries. It does not change the development agent or another project's configuration.

- Fix the model to `gpt-6-luna` and reasoning effort to `xhigh`. The current pinned operational Codex CLI is `0.162.0-alpha.2`; its actual bundled catalog and the existing Teams role-home catalogs support this pair.
- Apply the common policy in `src/shared/teams-cli-agent-policy.ts` at admission, model catalog selection, launcher argv, isolation lease, and worker execution. Refuse unsupported catalogs and conflicting model, effort, provider, config, profile, or environment overrides. Never substitute a default or another model.
- Preserve historical jobs and their recorded selections. Incompatible historical retry, continuation, or approval must be refused before another execution starts.
- Keep selected model and actual worker observations separate. Missing actual model or effort remains unverified.
- Do not edit the user's global Codex configuration or create another login/session. Keep Teams role homes and existing authentication/isolation boundaries.
- Verify Core/default builds independently from the explicit `build:copilot-ui` artifact and `TEAMS_COPILOT_UI_RUNTIME=true` feature. The SDK display agent reads an existing authenticated job and cannot submit, retry, approve, or cancel it.
- Use scoped commits and verify the actual remote SHA. Catalog upload and installed-version/UI evidence must match that committed release before declaring delivery complete.
