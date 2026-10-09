import { parseCodexModelCatalogPayload } from '../../src/server/codex-model-catalog.js';
import type { CoreCodexModelSelection } from '../../src/shared/core-orchestration.js';

// Synthetic observations for operational tests; never evidence of a live CLI run.
export const teamsCliTestCatalog = parseCodexModelCatalogPayload([{
  slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list',
  default_reasoning_level: 'xhigh', supported_reasoning_levels: [{ effort: 'xhigh' }],
}], '2026-10-09T09:00:00.000Z');
export const observeTeamsCliTestCatalog = () => teamsCliTestCatalog;
export const teamsCliTestSelection: CoreCodexModelSelection = {
  model: 'gpt-6-luna', reasoningEffort: 'xhigh', catalogRevision: teamsCliTestCatalog.revision,
};
