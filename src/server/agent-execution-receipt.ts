import type { CoreExecutionReceipt } from '../shared/core-orchestration.js';

/** Accept observed facts only. This is never constructed from requested model options. */
export function readExecutionReceipt(value: unknown): CoreExecutionReceipt | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('execution receipt is invalid');
  const receipt = value as Record<string, unknown>;
  const keys = ['source', 'observedAt', 'platform', 'model', 'reasoningEffort'];
  if (Object.keys(receipt).some(key => !keys.includes(key))
    || receipt.source !== 'worker-observation'
    || typeof receipt.observedAt !== 'string'
    || !Number.isFinite(Date.parse(receipt.observedAt))
    || new Date(receipt.observedAt).toISOString() !== receipt.observedAt
    || (receipt.platform !== undefined && (typeof receipt.platform !== 'string' || !['darwin', 'linux', 'win32'].includes(receipt.platform)))
    || (receipt.model !== undefined && (typeof receipt.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(receipt.model)))
    || (receipt.reasoningEffort !== undefined && (typeof receipt.reasoningEffort !== 'string' || !['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(receipt.reasoningEffort)))
    || (receipt.platform === undefined && receipt.model === undefined && receipt.reasoningEffort === undefined)) {
    throw new Error('execution receipt is invalid');
  }
  return { ...receipt } as CoreExecutionReceipt;
}

export function sameExecutionReceipt(a: CoreExecutionReceipt, b: CoreExecutionReceipt | undefined): boolean {
  return b !== undefined && a.source === b.source && a.observedAt === b.observedAt
    && a.platform === b.platform && a.model === b.model && a.reasoningEffort === b.reasoningEffort;
}
