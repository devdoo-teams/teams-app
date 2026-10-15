import { readFile, stat } from 'node:fs/promises';

import { checkExposurePlan, createExposurePlan, parseExposureConfig } from './local-exposure.mjs';

const help = `Usage: node scripts/local-exposure-cli.mjs <plan|check> [--config profile.json]

plan   Validate a profile and print a server/tunnel plan. No command is executed.
check  Read selected CLI versions and loopback /api/health (2s per probe).

Default: existing 127.0.0.1:3978 server + existing DevTunnel; no restart or reconfiguration.
No apply/start/login/install, public-app probe, token input or registration mutation is supported.
Installed CLI version probes may consult their normal metadata service/cache.
See docs/local-server-options.md for profiles, limits and external approval requirements.
`;

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(help);
  } else {
    const mode = args[0];
    if (!['plan', 'check'].includes(mode) || ![1, 3].includes(args.length)
      || (args.length === 3 && (args[1] !== '--config' || !args[2] || args[2].startsWith('-')))) {
      throw new Error('Unsupported arguments. Use --help for plan/check with an optional JSON config path.');
    }
    let config = { schema: 1 };
    if (args.length === 3) {
      const info = await stat(args[2]);
      if (!info.isFile() || info.size > 65536) throw new Error('Configuration must be a regular JSON file of at most 64 KiB.');
      config = parseExposureConfig(await readFile(args[2], 'utf8'));
    }
    const plan = createExposurePlan(config);
    const result = mode === 'plan' ? plan : await checkExposurePlan(plan);
    console.log(JSON.stringify(result, null, 2));
    if (mode === 'check' && result.status === 'blocked') process.exitCode = 2;
  }
} catch (error) {
  const safeMessage = error?.code ? 'Configuration could not be read.' : error.message;
  console.error(JSON.stringify({ status: 'invalid-configuration', error: safeMessage }));
  process.exitCode = 1;
}
