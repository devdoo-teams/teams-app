import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentJobStore } from '../../src/server/agent-job-store.js';
import { CoreOrchestrationService, createServerDerivedCoreScope } from '../../src/server/core-orchestration-service.js';

/** Synthetic data, real existing Core ownership/identity checks; no CLI or server. */
export async function createPtyReadTestContext() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-pty-jobs-'));
  const store = new AgentJobStore(path.join(directory, 'jobs.json'));
  await store.initialize();
  const scope = createServerDerivedCoreScope({ tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner', conversationId: 'synthetic-chat' });
  const job = await store.create({ scope, prompt: 'Synthetic PTY contract fixture', mode: 'read-only', provider: 'codex' });
  await store.update(job.id, scope, { status: 'running' });
  const unavailable = async (): Promise<never> => { throw new Error('Fixture must not execute or mutate a job.'); };
  const jobs = new CoreOrchestrationService({
    jobStore: store,
    agentService: {
      get: store.get.bind(store),
      getForPrincipal: store.getForPrincipal.bind(store),
      list: store.list.bind(store),
      submit: unavailable, continue: unavailable, cancelStrict: unavailable, approve: unavailable, retry: unavailable,
    },
  });
  return { directory, store, jobs, scope, jobId: job.id, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}
