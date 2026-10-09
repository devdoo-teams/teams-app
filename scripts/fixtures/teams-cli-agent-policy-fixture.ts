import { parseCodexModelCatalogPayload, selectTeamsCodexModel } from '../../src/server/codex-model-catalog.js';
import type { CoreCodexModelSelection } from '../../src/shared/core-orchestration.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
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

/** Copied test bundle preserves actual A2A policy failure codes before sanitization. */
export async function createIndexedA2ACodexServerFixture(
  sourceEntry: string, directory: string, environment: NodeJS.ProcessEnv,
): Promise<string> {
  if (!environment.CODEX_BIN || !environment.AGENT_CODEX_HOME || !environment.CODEX_BIN_SHA256
    || !path.isAbsolute(environment.CODEX_BIN) || !path.isAbsolute(environment.AGENT_CODEX_HOME)) {
    throw new Error('Synthetic CLI fixture requires an explicit executable, digest and home.');
  }
  const executable = await fs.realpath(environment.CODEX_BIN);
  const executableSha256 = crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex');
  if (executableSha256 !== environment.CODEX_BIN_SHA256) throw new Error('Synthetic CLI executable digest changed.');
  const ordinaryHome = await fs.realpath(environment.AGENT_CODEX_HOME);
  const profiles: Array<{ ordinal: number; codexHome: string; codexExecutable: string; codexExecutableSha256: string }> = [];
  const observations = [];
  for (const ordinal of [1, 2]) {
    const home = path.join(directory, `indexed-codex-home-${ordinal}`);
    await fs.mkdir(home, { mode: 0o700 });
    const codexHome = await fs.realpath(home);
    if (codexHome === ordinaryHome || profiles.some(profile => profile.codexHome === codexHome)) {
      throw new Error('Synthetic A2A profiles must have distinct private homes.');
    }
    const started = Date.now();
    const { stdout } = await promisify(execFile)(executable, ['debug', 'models'], {
      timeout: 2_000, maxBuffer: 16_384, env: { CI: '1', CODEX_HOME: codexHome },
    });
    const catalog = parseCodexModelCatalogPayload(JSON.parse(stdout), new Date().toISOString());
    const selection = selectTeamsCodexModel(catalog);
    profiles.push({ ordinal, codexHome, codexExecutable: executable, codexExecutableSha256: executableSha256 });
    observations.push({ ordinal, command: ['debug', 'models'], elapsedMs: Date.now() - started,
      catalogRevision: catalog.revision, requestedModel: selection.model, requestedReasoningEffort: selection.reasoningEffort,
      observedModel: null, observedReasoningEffort: null });
  }
  const receipt = { source: 'synthetic-cli-fixture', observedAt: new Date().toISOString(),
    executableSha256, profiles, observations };
  await fs.writeFile(path.join(directory, 'synthetic-a2a-catalog.json'), JSON.stringify(receipt), { mode: 0o600 });
  console.log(`SYNTHETIC_A2A_CATALOG=${JSON.stringify(receipt)}`);
  const source = await fs.readFile(sourceEntry, 'utf8');
  const start = source.indexOf('async function executeA2AProviderChild(');
  const end = source.indexOf('async function cancelA2AProviderChild(', start);
  if (start < 0 || end < 0) throw new Error('Synthetic A2A diagnostic insertion point has changed.');
  const body = source.slice(start, end);
  const marker = /\n    \}\);\n    return job\.status/u;
  if (!marker.test(body)) throw new Error('Synthetic A2A execution diagnostic insertion point has changed.');
  const diagnosticBody = body.replace(marker, `
    }).catch(error => {
      console.error('SYNTHETIC_A2A_POLICY_FAILURE=' + JSON.stringify({
        source: 'test-fixture-only', agentId, code: error?.code ?? null,
        name: error?.name ?? null, message: error?.message ?? null,
      }));
      throw error;
    });
    return job.status`);
  const fixtureServerRoot = path.join(directory, 'runtime-server');
  await copySyntheticServerClosure(path.dirname(sourceEntry), fixtureServerRoot);
  await fs.writeFile(path.join(fixtureServerRoot, 'package.json'), JSON.stringify({ type: 'module' }), { mode: 0o600 });
  const fixtureEntry = path.join(fixtureServerRoot, path.basename(sourceEntry));
  const profileMarker = /a2aCodexProfileErrors = (?:\/\*[^]*?\*\/\s*)?new Map\(\);/u;
  const diagnosticSource = source.slice(0, start) + diagnosticBody + source.slice(end);
  if (!profileMarker.test(diagnosticSource)) throw new Error('Synthetic A2A profile insertion point has changed.');
  const profileJson = JSON.stringify(JSON.stringify(profiles));
  await fs.writeFile(fixtureEntry, diagnosticSource.replace(profileMarker, matched => `${matched}
// TEST FIXTURE ONLY: catalog command observed in distinct synthetic homes; no real model execution observed.
if (process.env.NODE_ENV !== 'test' || process.env.TEAMS_TEST_PROCESS_ISOLATION !== 'true') {
  throw new Error('Synthetic A2A profiles are restricted to the explicit isolated test runtime.');
}
for (const fixtureProfile of JSON.parse(${profileJson})) {
  a2aCodexProfileByOrdinal.set(fixtureProfile.ordinal, Object.freeze(fixtureProfile));
}`), { mode: 0o600 });
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
