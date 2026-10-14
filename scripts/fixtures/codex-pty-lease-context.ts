import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CodexPermissionProfileIsolationProvider } from '../../src/server/codex-permission-profile-isolation-provider.js';
import type { AgentIsolationPtyLaunchCapability, AgentIsolationSubject } from '../../src/server/agent-execution-policy.js';
import { buildCodexExecArguments } from '../../src/server/codex-runner.js';

/** The permission preflight/signature and auth are synthetic. This tests the
 * real provider's grammar/snapshot/lease gates, never a live Codex login. */
export async function createCodexPtyLeaseContext(subject: AgentIsolationSubject, pty?: AgentIsolationPtyLaunchCapability, body = 'process.exit(0);') {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-pty-')));
  const source = path.join(directory, 'source');
  const workspace = path.join(directory, 'projection');
  const home = path.join(workspace, '.isolated-home');
  const codexHome = path.join(directory, 'synthetic-service-home');
  const executable = path.join(directory, 'synthetic-codex.mjs');
  for (const target of [source, path.join(home, '.codex'), codexHome]) await fs.mkdir(target, { recursive: true, mode: 0o700 });
  const auth = path.join(codexHome, 'auth.json');
  await fs.writeFile(auth, '{"fixture":"not-a-credential"}\n', { mode: 0o600 });
  await fs.writeFile(executable, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  const executableSha256 = crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex');
  let pipeLaunches = 0;
  const provider = new CodexPermissionProfileIsolationProvider({
    codexExecutable: executable, codexExecutableSha256: executableSha256, codexHome, platform: 'darwin',
    preflight: async () => undefined, executableTrustVerifier: () => undefined,
    spawn: () => { pipeLaunches++; throw new Error('Synthetic PTY tests forbid pipe fallback.'); },
    ...(pty ? { pty } : {}),
  });
  const acquireInput = { subject, sourceWorkspace: source, workspace, protectedRoots: [source, os.homedir()],
    environmentOverrides: { HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex') }, prompt: 'synthetic projected-workspace fixture' };
  return { directory, source, workspace, home, codexHome, executable, executableSha256, auth, provider, acquireInput,
    args: (prompt = 'synthetic read-only task') => buildCodexExecArguments({ prefixArgs: [], mode: 'read-only', workspace, enrichedPrompt: prompt }),
    pipeLaunches: () => pipeLaunches,
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  };
}
