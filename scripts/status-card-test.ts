import assert from 'node:assert/strict';

import { buildTeamsPersonalTabDeepLink } from '../src/server/teams-tab-link.js';
import {
  probeCliCapabilities,
  type CliCommandResult,
} from '../src/server/codex-capability.js';
import { GenUiResponseFactory } from '../src/server/genui-response.js';
import { createAdaptiveCardActivity } from '../src/server/genui-teams.js';
import type { GenUiStatusFacts } from '../src/server/genui-response.js';
import type { GenUiActionStore } from '../src/server/genui-action-store.js';

const personalTabUrl = buildTeamsPersonalTabDeepLink({
  appId: '9b20fd94-2ac9-4423-ac1f-ff528ab245c1',
  tabDomain: 'example.com',
  tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
});
assert.ok(personalTabUrl);
assert.match(new URL(personalTabUrl).searchParams.get('webUrl') ?? '', /\/tabs\/home\/$/);

function result(outcome: CliCommandResult['outcome'], output = ''): CliCommandResult {
  return { outcome, stdout: output, stderr: output };
}

const available = await probeCliCapabilities({
  codexCommand: { command: 'codex' },
  ghcpCommand: { command: 'gh', args: ['copilot'] },
  runCommand: async (_command, args) => {
    if (args[0] === 'login') return result('success', 'Logged in');
    if (args[0] === 'copilot') return result('success', 'GitHub Copilot CLI');
    if (args[0] === 'auth') return result('success', 'Logged in to github.com');
    return result('error', 'unexpected command');
  },
});
assert.equal(available.codex.state, 'available');
assert.equal(available.codex.executable, 'present');
assert.equal(available.codex.login, 'authenticated');
assert.equal(available.ghcp.state, 'available');
assert.equal(available.ghcp.executable, 'present');
assert.equal(available.ghcp.login, 'authenticated');

const officialGhcp = await probeCliCapabilities({
  codexCommand: { command: 'codex' },
  ghcpCommand: { command: 'copilot' },
  runCommand: async (command, args) => {
    if (command === 'codex' && args[0] === 'login') return result('success', 'Logged in');
    if (command === 'copilot' && args[0] === '--help') return result('success', 'GitHub Copilot CLI');
    return result('error', `unexpected command: ${command} ${args.join(' ')}`);
  },
});
assert.equal(officialGhcp.ghcp.state, 'unknown', 'official Copilot CLI help must not pretend login is verified');
assert.equal(officialGhcp.ghcp.executable, 'present');
assert.equal(officialGhcp.ghcp.login, 'unknown');

let defaultGhcpCommand = '';
let defaultGhcpArgs: readonly string[] = [];
await probeCliCapabilities({
  codexCommand: { command: 'codex' },
  runCommand: async (command, args) => {
    if (command === 'copilot') {
      defaultGhcpCommand = command;
      defaultGhcpArgs = args;
      return result('success', 'GitHub Copilot CLI');
    }
    return result('success', 'Logged in');
  },
});
assert.equal(defaultGhcpCommand, 'copilot', 'GHCP defaults to the official executable');
assert.deepEqual(defaultGhcpArgs, ['--help'], 'GHCP probe uses the official help command');

const unavailable = await probeCliCapabilities({
  codexCommand: { command: 'codex' },
  ghcpCommand: { command: 'copilot' },
  runCommand: async (command, args) => {
    if (args[0] === 'login') return result('missing');
    if (command === 'copilot' && args[0] === '--help') return result('missing');
    return result('error');
  },
});
assert.equal(unavailable.codex.state, 'unavailable');
assert.equal(unavailable.codex.executable, 'absent');
assert.equal(unavailable.codex.login, 'unknown');
assert.equal(unavailable.ghcp.state, 'unavailable');

const unknown = await probeCliCapabilities({
  codexCommand: { command: 'codex' },
  ghcpCommand: { command: 'gh' },
  runCommand: async (_command, args) => {
    if (args[0] === 'login') return result('timeout');
    if (args[0] === 'copilot') return result('success', 'GitHub Copilot CLI');
    if (args[0] === 'auth') return result('error', 'temporary network failure');
    return result('error');
  },
});
assert.equal(unknown.codex.state, 'unknown');
assert.equal(unknown.ghcp.state, 'unknown');
assert.equal(unknown.ghcp.login, 'unknown');

const factory = new GenUiResponseFactory({} as GenUiActionStore, { openTabUrl: personalTabUrl });
const statusFacts: GenUiStatusFacts = {
  teamsSdk: true,
  environment: 'local',
  authMode: 'teams-authenticated',
  storage: 'file-json-single-process',
  deterministic: true,
  codex: available.codex,
  ghcp: unknown.ghcp,
};
const statusEnvelope = factory.status(statusFacts);
const statusActivity = createAdaptiveCardActivity(statusEnvelope);
const statusCard = statusActivity.attachments?.[0]?.content;
assert.equal(statusActivity.type, 'message');
assert.equal('text' in statusActivity, false, 'Teams status activity is attachment-only');
assert.equal(statusActivity.attachments?.length, 1);
assert.equal(statusActivity.attachmentLayout, 'list');
assert.equal(statusCard?.actions?.at(-1)?.type, 'Action.OpenUrl');
assert.equal(statusCard?.actions?.at(-1)?.url, personalTabUrl);
assert.equal(JSON.stringify(statusActivity).includes('OPENAI_API_KEY'), false, 'status does not require or expose an API key');

function findFactSet(elements: Array<Record<string, unknown>> | undefined): Record<string, unknown> | undefined {
  for (const element of elements ?? []) {
    if (element.type === 'FactSet') return element;
    const nested = element.items;
    if (Array.isArray(nested)) {
      const found = findFactSet(nested.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)));
      if (found) return found;
    }
  }
  return undefined;
}

const facts = findFactSet(statusCard?.body);
const factEntries = facts?.facts as Array<Record<string, unknown>> | undefined;
assert.ok(factEntries?.some((fact) => fact.title === 'Teams SDK' && fact.value === 'enabled'));
assert.ok(factEntries?.some((fact) => fact.title === 'Codex CLI' && fact.value === 'available'));
assert.ok(factEntries?.some((fact) => fact.title === 'GHCP CLI' && fact.value === 'unknown'));

const invalidStatus = factory.status({
  ...statusFacts,
  codex: { state: 'available', executable: 'unknown', login: 'unknown' } as never,
});
const invalidCard = createAdaptiveCardActivity(invalidStatus).attachments?.[0]?.content;
const invalidFacts = findFactSet(invalidCard?.body);
const invalidEntries = invalidFacts?.facts as Array<Record<string, unknown>> | undefined;
assert.ok(invalidEntries?.some((fact) => fact.title === 'Codex CLI' && fact.value === 'unknown'));

console.log('PASS: deterministic status card reports measured CLI capabilities without duplicate activity text');
