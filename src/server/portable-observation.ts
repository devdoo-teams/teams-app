import { z } from 'zod';
import { assertCoreCodexModelCatalog, selectTeamsCodexModel } from './codex-model-catalog.js';
import { PullWorkerError } from './pull-worker.js';
import type { CoreCodexModelCatalog, CoreProviderFact } from '../shared/core-orchestration.js';

export const PORTABLE_OBSERVATION_MAX_AGE_MS = 30_000;
const readiness = z.object({
  configured: z.enum(['configured', 'not-configured', 'unknown']),
  executable: z.enum(['present', 'absent', 'unknown']),
  authentication: z.enum(['authenticated', 'not-authenticated', 'unknown']),
  entitlement: z.enum(['allowed', 'blocked', 'unknown']),
  probe: z.enum(['passed', 'not-run', 'failed', 'unknown']),
  reason: z.enum(['verified', 'missing', 'auth-required', 'policy-blocked', 'execution-failed', 'unknown']),
}).strict();
const envelope = z.object({ sourceCommit: z.string().regex(/^[0-9a-f]{40}$/u), catalog: z.unknown().optional(),
  providerFact: z.object({ provider: z.literal('codex'), availability: z.enum(['available', 'unavailable', 'unknown']),
    capabilities: z.array(z.enum(['submit', 'cancel', 'retry', 'approve', 'input'])).max(5),
    observedAt: z.string().datetime(), source: z.enum(['runtime-probe', 'runtime-observation']), readiness,
  }).strict(),
}).strict();
export type PortableWorkerObservation = Readonly<{
  sourceCommit: string; catalog?: CoreCodexModelCatalog; providerFact: CoreProviderFact;
}>;
/** A worker reports its existing measurements. This is no physical-device attestation. */
export function validatePortableObservation(value: unknown, sourceCommit: string, now: number): PortableWorkerObservation {
  const input = envelope.parse(value);
  const observedAt = Date.parse(input.providerFact.observedAt);
  if (input.sourceCommit !== sourceCommit || observedAt > now + 5000 || now - observedAt > PORTABLE_OBSERVATION_MAX_AGE_MS) {
    throw new PullWorkerError('invalid', 'fresh matching worker observation required');
  }
  const catalog = input.catalog === undefined ? undefined : assertCoreCodexModelCatalog(input.catalog);
  const r = input.providerFact.readiness;
  if (input.providerFact.availability === 'available') {
    if (!catalog || r.configured !== 'configured' || r.executable !== 'present' || r.authentication !== 'authenticated'
      || r.entitlement !== 'allowed' || r.probe !== 'passed' || r.reason !== 'verified'
      || !input.providerFact.capabilities.includes('submit') || !input.providerFact.capabilities.includes('cancel')) {
      throw new PullWorkerError('invalid', 'measured read-only execution required');
    }
    selectTeamsCodexModel(catalog);
  }
  return Object.freeze({ sourceCommit, ...(catalog ? { catalog } : {}), providerFact: Object.freeze({
    ...input.providerFact, source: 'runtime-observation' as const,
    // This slice cannot remotely approve, resume input or continue/retry an old session.
    capabilities: Object.freeze(input.providerFact.availability === 'available' ? ['submit', 'cancel'] : []),
  }) });
}
