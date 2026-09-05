import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

import type {
  CoreCodexModelCatalog,
  CoreCodexModelOption,
  CoreCodexModelSelection,
  CoreCodexReasoningEffort,
} from '../shared/core-orchestration.js';

const REASONING_EFFORTS = new Set<CoreCodexReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CATALOG_REVISION = /^[a-f0-9]{64}$/u;
const MAX_MODEL_LABEL_LENGTH = 128;
const MAX_VISIBLE_MODELS = 64;
const MAX_CATALOG_OUTPUT_BYTES = 1024 * 1024;
const CATALOG_ENV_ALLOWLIST = [
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const;

export type CodexModelCatalogCommand = Readonly<{
  executable: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}>;

export type CodexModelCatalogCommandResult = Readonly<{ stdout: string }>;

export class CodexModelCatalogError extends Error {
  readonly code = 'CODEX_MODEL_CATALOG_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CodexModelCatalogError';
  }
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function reasoningEffort(value: unknown, field: string): CoreCodexReasoningEffort {
  if (typeof value !== 'string' || !REASONING_EFFORTS.has(value as CoreCodexReasoningEffort)) {
    throw new CodexModelCatalogError(`${field} contains an unsupported reasoning effort.`);
  }
  return value as CoreCodexReasoningEffort;
}

function visibleModel(value: unknown, index: number): CoreCodexModelOption | undefined {
  const model = recordOf(value);
  if (!model || model.visibility !== 'list') return undefined;
  if (typeof model.slug !== 'string' || !MODEL_ID.test(model.slug)) {
    throw new CodexModelCatalogError(`visible model ${index} has an invalid model identifier.`);
  }
  if (typeof model.display_name !== 'string'
    || !model.display_name.trim()
    || model.display_name.trim() !== model.display_name
    || model.display_name.length > MAX_MODEL_LABEL_LENGTH) {
    throw new CodexModelCatalogError(`visible model ${model.slug} has an invalid label.`);
  }
  if (!Array.isArray(model.supported_reasoning_levels) || model.supported_reasoning_levels.length === 0) {
    throw new CodexModelCatalogError(`visible model ${model.slug} has no supported reasoning levels.`);
  }
  const efforts = model.supported_reasoning_levels.map((entry, effortIndex) => {
    const level = recordOf(entry);
    if (!level) throw new CodexModelCatalogError(`visible model ${model.slug} reasoning level ${effortIndex} is invalid.`);
    return reasoningEffort(level.effort, `visible model ${model.slug}`);
  });
  if (new Set(efforts).size !== efforts.length) {
    throw new CodexModelCatalogError(`visible model ${model.slug} has duplicate reasoning levels.`);
  }
  const defaultReasoningEffort = reasoningEffort(
    model.default_reasoning_level,
    `visible model ${model.slug} default`,
  );
  if (!efforts.includes(defaultReasoningEffort)) {
    throw new CodexModelCatalogError(`visible model ${model.slug} default reasoning is not supported.`);
  }
  return Object.freeze({
    id: model.slug,
    label: model.display_name,
    defaultReasoningEffort,
    reasoningEfforts: Object.freeze(efforts),
  });
}

/** Parse only the installed CLI's bounded, user-visible model catalog. */
export function parseCodexModelCatalogPayload(value: unknown, observedAt: string): CoreCodexModelCatalog {
  const envelope = recordOf(value);
  const entries = Array.isArray(value)
    ? value
    : envelope && Array.isArray(envelope.models)
      ? envelope.models
      : undefined;
  if (!entries) {
    throw new CodexModelCatalogError('Codex model catalog must be an array or an object containing a models array.');
  }
  if (!Number.isFinite(Date.parse(observedAt))) throw new CodexModelCatalogError('catalog observation time is invalid.');
  const models = entries
    .map(visibleModel)
    .filter((model): model is CoreCodexModelOption => Boolean(model));
  if (models.length === 0 || models.length > MAX_VISIBLE_MODELS) {
    throw new CodexModelCatalogError('Codex model catalog has no bounded visible model set.');
  }
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new CodexModelCatalogError('Codex model catalog contains duplicate model identifiers.');
  }
  const canonicalModels = models.map((model) => ({
    id: model.id,
    label: model.label,
    defaultReasoningEffort: model.defaultReasoningEffort,
    reasoningEfforts: [...model.reasoningEfforts],
  }));
  const revision = crypto.createHash('sha256').update(JSON.stringify(canonicalModels), 'utf8').digest('hex');
  return Object.freeze({
    revision,
    observedAt,
    source: 'codex-debug-models',
    models: Object.freeze(models),
  });
}

/** Revalidate the canonical catalog after crossing a durable storage boundary. */
export function assertCoreCodexModelCatalog(value: unknown): CoreCodexModelCatalog {
  const catalog = recordOf(value);
  if (!catalog || catalog.source !== 'codex-debug-models' || !Array.isArray(catalog.models)) {
    throw new CodexModelCatalogError('Durable Codex model catalog has an invalid envelope.');
  }
  if (typeof catalog.observedAt !== 'string') {
    throw new CodexModelCatalogError('Durable Codex model catalog observation time is invalid.');
  }
  const rawModels = catalog.models.map((value, index) => {
    const model = recordOf(value);
    if (!model || !Array.isArray(model.reasoningEfforts)) {
      throw new CodexModelCatalogError(`Durable Codex model ${index} is invalid.`);
    }
    return {
      slug: model.id,
      display_name: model.label,
      visibility: 'list',
      default_reasoning_level: model.defaultReasoningEffort,
      supported_reasoning_levels: model.reasoningEfforts.map((effort) => ({ effort })),
    };
  });
  const normalized = parseCodexModelCatalogPayload(rawModels, catalog.observedAt);
  if (catalog.revision !== normalized.revision) {
    throw new CodexModelCatalogError('Durable Codex model catalog revision does not match its contents.');
  }
  return normalized;
}

/** Revalidate an untrusted UI/queue selection against one exact catalog revision. */
export function assertCoreCodexModelSelection(
  catalog: CoreCodexModelCatalog,
  value: CoreCodexModelSelection,
): CoreCodexModelSelection {
  if (!catalog || !CATALOG_REVISION.test(catalog.revision)) {
    throw new CodexModelCatalogError('trusted catalog revision is invalid.');
  }
  if (!value || value.catalogRevision !== catalog.revision) {
    throw new CodexModelCatalogError('Codex model catalog revision is stale.');
  }
  if (typeof value.model !== 'string' || !MODEL_ID.test(value.model)) {
    throw new CodexModelCatalogError('Codex model identifier is invalid.');
  }
  const model = catalog.models.find((candidate) => candidate.id === value.model);
  if (!model) throw new CodexModelCatalogError('Codex model is not present in the observed catalog.');
  const effort = reasoningEffort(value.reasoningEffort, `model ${value.model}`);
  if (!model.reasoningEfforts.includes(effort)) {
    throw new CodexModelCatalogError('Codex reasoning effort is not supported by the selected model.');
  }
  return Object.freeze({
    model: model.id,
    reasoningEffort: effort,
    catalogRevision: catalog.revision,
  });
}

/** Lexical defense used again at the final process argv boundary. */
export function assertSafeCodexModelSelection(value: CoreCodexModelSelection): CoreCodexModelSelection {
  if (!value || typeof value.model !== 'string' || !MODEL_ID.test(value.model)) {
    throw new CodexModelCatalogError('Codex model identifier is invalid.');
  }
  const effort = reasoningEffort(value.reasoningEffort, `model ${value.model}`);
  if (typeof value.catalogRevision !== 'string' || !CATALOG_REVISION.test(value.catalogRevision)) {
    throw new CodexModelCatalogError('Codex model catalog revision is invalid.');
  }
  return Object.freeze({ model: value.model, reasoningEffort: effort, catalogRevision: value.catalogRevision });
}

export async function loadCodexModelCatalog(options: Readonly<{
  executable: string;
  codexHome: string;
  timeoutMs?: number;
  observedAt?: () => string;
  execute?: (command: CodexModelCatalogCommand) => Promise<CodexModelCatalogCommandResult>;
}>): Promise<CoreCodexModelCatalog> {
  if (!path.isAbsolute(options.executable) || options.executable.includes('\0')) {
    throw new CodexModelCatalogError('Codex catalog executable must be an explicit absolute path.');
  }
  if (!path.isAbsolute(options.codexHome) || options.codexHome.includes('\0')) {
    throw new CodexModelCatalogError('Codex catalog home must be an explicit absolute path.');
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new CodexModelCatalogError('Codex catalog timeout must be between 1000 and 60000 milliseconds.');
  }
  const env: NodeJS.ProcessEnv = { CI: '1', CODEX_HOME: options.codexHome };
  for (const key of CATALOG_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const command = Object.freeze({
    executable: options.executable,
    args: Object.freeze(['debug', 'models']),
    env,
    timeoutMs,
  });
  const result = await (options.execute ?? executeCatalogCommand)(command);
  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new CodexModelCatalogError('Codex model catalog command returned invalid JSON.');
  }
  return parseCodexModelCatalogPayload(payload, (options.observedAt ?? (() => new Date().toISOString()))());
}

async function executeCatalogCommand(command: CodexModelCatalogCommand): Promise<CodexModelCatalogCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args], {
      env: command.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      operation();
    };
    const fail = (message: string): void => finish(() => {
      child.kill('SIGKILL');
      reject(new CodexModelCatalogError(message));
    });
    const timeout = setTimeout(() => fail('Codex model catalog command timed out.'), command.timeoutMs);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk);
      stdoutBytes += Buffer.byteLength(text, 'utf8');
      if (stdoutBytes > MAX_CATALOG_OUTPUT_BYTES) {
        fail('Codex model catalog output exceeded its bounded limit.');
        return;
      }
      stdout += text;
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBytes += Buffer.byteLength(String(chunk), 'utf8');
      if (stderrBytes > MAX_CATALOG_OUTPUT_BYTES) fail('Codex model catalog diagnostic exceeded its bounded limit.');
    });
    child.once('error', () => fail('Codex model catalog command could not start.'));
    child.once('close', (code, signal) => {
      if (code !== 0 || signal) {
        fail('Codex model catalog command did not complete successfully.');
        return;
      }
      finish(() => resolve({ stdout }));
    });
  });
}
