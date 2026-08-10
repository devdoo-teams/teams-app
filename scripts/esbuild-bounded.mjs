import { stop } from 'esbuild';

const SERVICE_STOPPED = /service (?:was stopped|is no longer running)/i;

export async function buildWithBoundedRetry(build, options, label) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await build(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!SERVICE_STOPPED.test(message) || attempt === 2) throw error;

      console.warn(`esbuild service stopped while building ${label}; retrying once`);
      await stop();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`unreachable esbuild retry state for ${label}`);
}
