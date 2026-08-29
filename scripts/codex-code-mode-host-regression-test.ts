import assert from 'node:assert/strict';

import {
  CODEX_EXTERNAL_TOOL_SURFACE_POLICY,
  CODEX_READ_ONLY_PERMISSION_ARGS,
} from '../src/server/codex-permission-profile-isolation-provider.js';

function disabledFeatures(args: readonly string[]): string[] {
  return args.flatMap((arg, index) => arg === '--disable' ? [args[index + 1] ?? ''] : []);
}

const disabled = disabledFeatures(CODEX_READ_ONLY_PERMISSION_ARGS);

assert.equal(
  disabled.includes('code_mode_host'),
  false,
  'the provider-owned read-only Codex launch must not disable the installed Code Mode host',
);

const requiredDisabledFeatures = [
  'apps',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'in_app_updates',
  'multi_agent',
  'plugin_sharing',
  'plugins',
  'remote_plugin',
  'skill_mcp_dependency_install',
  'skill_search',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'view_image',
] as const;

assert.deepEqual(
  disabled,
  requiredDisabledFeatures,
  'removing Code Mode host must not widen any other disabled tool surface',
);

assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.apps, false);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.browser, false);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.inAppBrowser, false);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.computerUse, false);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.plugins, false);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.mcp, false);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.multiAgent, false);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.webSearch, false);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.imageTools, false);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.requireEmptyMcpInventory, true);
assert.equal(CODEX_EXTERNAL_TOOL_SURFACE_POLICY.requireEmptyPluginInventory, true);

console.log('PASS: provider-owned Codex launch keeps the verified Code Mode host and preserves every other external-tool restriction');
