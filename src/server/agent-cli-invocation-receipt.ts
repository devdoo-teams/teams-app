import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CoreCliInvocationReceipt, CoreCodexReasoningEffort } from '../shared/core-orchestration.js';

const execFileAsync = promisify(execFile);
const versionPattern = /^codex-cli \d{1,4}\.\d{1,4}\.\d{1,4}(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,63})?$/u;
const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export function readCliInvocationReceipt(value: unknown): CoreCliInvocationReceipt | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CLI invocation receipt is invalid');
  const receipt = value as Record<string, unknown>;
  if (Object.keys(receipt).some(key => !['source', 'observedAt', 'modelArgument', 'reasoningEffortArgument', 'cliVersionStatus', 'cliVersion'].includes(key))
    || receipt.source !== 'worker-cli-invocation'
    || typeof receipt.observedAt !== 'string' || !Number.isFinite(Date.parse(receipt.observedAt))
    || new Date(receipt.observedAt).toISOString() !== receipt.observedAt
    || typeof receipt.modelArgument !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(receipt.modelArgument)
    || typeof receipt.reasoningEffortArgument !== 'string' || !efforts.includes(receipt.reasoningEffortArgument)
    || typeof receipt.cliVersionStatus !== 'string' || !['observed', 'unavailable'].includes(receipt.cliVersionStatus)
    || (receipt.cliVersionStatus === 'observed' ? typeof receipt.cliVersion !== 'string' || !versionPattern.test(receipt.cliVersion) : receipt.cliVersion !== undefined)) {
    throw new Error('CLI invocation receipt is invalid');
  }
  return { ...receipt } as CoreCliInvocationReceipt;
}

export function sameCliInvocationReceipt(a: CoreCliInvocationReceipt, b: CoreCliInvocationReceipt | undefined): boolean {
  return b !== undefined && a.source === b.source && a.observedAt === b.observedAt
    && a.modelArgument === b.modelArgument && a.reasoningEffortArgument === b.reasoningEffortArgument
    && a.cliVersionStatus === b.cliVersionStatus && a.cliVersion === b.cliVersion;
}

/** Extract only the final model/effort switches before the prompt delimiter. */
export function cliInvocationReceiptFromArguments(args: readonly string[], cliVersion: string | undefined): CoreCliInvocationReceipt {
  const delimiter = args.indexOf('--');
  if (delimiter < 0) throw new Error('CLI invocation arguments are invalid');
  const control = args.slice(0, delimiter);
  const models: string[] = [];
  const reasoning: string[] = [];
  for (let index = 0; index < control.length; index += 1) {
    const argument = control[index];
    if (argument === '--model' || argument === '-m') models.push(control[++index] ?? '');
    else if (argument.startsWith('--model=')) models.push(argument.slice('--model='.length));
    else if (argument === '--config' || argument === '-c') {
      const config = control[++index] ?? '';
      if (config.startsWith('model_reasoning_effort=')) reasoning.push(config.slice('model_reasoning_effort='.length).replace(/^"(.*)"$/u, '$1'));
    }
  }
  if (models.length !== 1 || reasoning.length !== 1) throw new Error('CLI invocation arguments are invalid');
  return readCliInvocationReceipt({ source: 'worker-cli-invocation', observedAt: new Date().toISOString(),
    modelArgument: models[0], reasoningEffortArgument: reasoning[0] as CoreCodexReasoningEffort,
    cliVersionStatus: cliVersion === undefined ? 'unavailable' : 'observed', ...(cliVersion === undefined ? {} : { cliVersion }),
  })!;
}

/** Harmless bounded probe of the same executable/environment; retain no diagnostics. */
export async function observeCodexCliVersion(command: string, prefixArgs: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal }): Promise<string | undefined> {
  try {
    const result = await execFileAsync(command, [...prefixArgs, '--version'], { ...options, timeout: 5_000, maxBuffer: 4_096, encoding: 'utf8', windowsHide: true });
    const version = result.stdout.trim();
    return versionPattern.test(version) ? version : undefined;
  } catch {
    if (options.signal.aborted) throw new Error('Codex 작업이 취소되었습니다.');
    return undefined;
  }
}
