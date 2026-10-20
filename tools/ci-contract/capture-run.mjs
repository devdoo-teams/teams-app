import { captureRun } from './lib/runner-capture.mjs';
try {
  const [scopeId, script] = process.argv.slice(2); if (process.argv.length !== 4) throw new Error('ARGUMENTS');
  process.exitCode = (await captureRun(scopeId, script)).transportExitCode;
} catch {
  console.error('CI_RUNNER_CAPTURE_REJECTED'); process.exitCode = 2;
}
