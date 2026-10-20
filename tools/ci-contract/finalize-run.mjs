import { finalizeRunner, retainFinalizationFailure } from './lib/runner-finalize.mjs';
try {
  if (process.argv.length !== 2) throw new Error('ARGUMENTS');
  const value = finalizeRunner();
  console.log(JSON.stringify({ status: 'RUNNER_OBSERVATION_WRITTEN', integrity: value.integrity, producerCaptureAvailable: value.producerCaptureAvailable, issues: value.issues }));
  process.exitCode = value.integrity === 'PASS' && value.producerCaptureAvailable ? 0 : 1;
} catch {
  try { retainFinalizationFailure(); } catch { /* Never turn missing failure evidence into success. */ }
  console.error('CI_RUNNER_FINALIZE_REJECTED'); process.exitCode = 2;
}
