import { parseCodexModelCatalogPayload } from '../../src/server/codex-model-catalog.js';
import type { CoreCodexModelSelection } from '../../src/shared/core-orchestration.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export { createFakeCodexRuntime } from '../fake-codex.mjs';

// Synthetic observations for operational tests; never evidence of a live CLI run.
export const teamsCliTestCatalog = parseCodexModelCatalogPayload([{
  slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list',
  default_reasoning_level: 'xhigh', supported_reasoning_levels: [{ effort: 'xhigh' }],
}], '2026-10-09T09:00:00.000Z');
export const observeTeamsCliTestCatalog = () => teamsCliTestCatalog;
export const teamsCliTestSelection: CoreCodexModelSelection = {
  model: 'gpt-6-luna', reasoningEffort: 'xhigh', catalogRevision: teamsCliTestCatalog.revision,
};

/** Real bounded synthetic completion supplies readiness only to a temporary test bundle. */
export async function createMeasuredTeamsCliServerFixture(
  sourceEntry: string, directory: string, environment: NodeJS.ProcessEnv,
): Promise<string> {
  if (!environment.CODEX_BIN || !environment.AGENT_CODEX_HOME) throw new Error('Synthetic CLI fixture is missing.');
  const command = [
    'exec', '--json', '--sandbox', 'read-only', '--model', 'gpt-6-luna',
    '--config', 'model_reasoning_effort="xhigh"', '--config', 'model_provider="openai"',
    '--', 'SYNTHETIC_READINESS_ONLY',
  ];
  const started = Date.now();
  const completion = promisify(execFile)(environment.CODEX_BIN, command, {
    timeout: 2_000, maxBuffer: 16_384,
    env: { CI: '1', CODEX_HOME: environment.AGENT_CODEX_HOME },
  });
  const { stdout } = await completion;
  const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  if (!events.some(event => event.type === 'turn.completed')
    || !events.some(event => event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text)) {
    throw new Error('Synthetic readiness requires an observed final message and completed turn.');
  }
  const receipt = { source: 'synthetic-cli-fixture', command, executableSha256: environment.CODEX_BIN_SHA256,
    elapsedMs: Date.now() - started, observedAt: new Date().toISOString(), terminal: 'turn.completed',
    requestedModel: 'gpt-6-luna', requestedReasoningEffort: 'xhigh', observedModel: null, observedReasoningEffort: null };
  await fs.writeFile(path.join(directory, 'synthetic-cli-readiness.json'), JSON.stringify(receipt), { mode: 0o600 });
  console.log(`SYNTHETIC_CLI_READINESS=${JSON.stringify(receipt)}`);
  const source = await fs.readFile(sourceEntry, 'utf8');
  const marker = /nativeExecutionVerified = nativeExecutionPreflight\?\.state === ["']configured["']/u;
  if (!marker.test(source)) throw new Error('Synthetic readiness insertion point has changed.');
  const fixtureServerRoot = path.join(directory, 'runtime-server');
  await copySyntheticServerClosure(path.dirname(sourceEntry), fixtureServerRoot);
  await fs.writeFile(path.join(fixtureServerRoot, 'package.json'), JSON.stringify({ type: 'module' }), { mode: 0o600 });
  const fixtureEntry = path.join(fixtureServerRoot, path.basename(sourceEntry));
  await fs.writeFile(fixtureEntry, source.replace(marker,
    'nativeExecutionVerified = true /* TEST FIXTURE ONLY: bounded synthetic completion observed */'), { mode: 0o600 });
  return fixtureEntry;
}

async function copySyntheticServerClosure(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    // The transformed fixture is never a clean release artifact or attestation.
    if (entry.name === '.teams-server-build-commit') continue;
    const sourceFile = path.join(source, entry.name), targetFile = path.join(target, entry.name);
    const stat = await fs.lstat(sourceFile);
    if (stat.isDirectory()) await copySyntheticServerClosure(sourceFile, targetFile);
    else if (stat.isFile()) await fs.copyFile(sourceFile, targetFile);
    else throw new Error('Synthetic server closure refuses a non-regular source entry.');
  }
}
