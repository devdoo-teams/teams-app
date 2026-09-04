import { AgentExecutionUnavailableError } from '../server/agent-execution-policy.js';
import { CodexRunner } from '../server/codex-runner.js';
import {
  AGENT_DISPATCH_WORKSPACE_REFERENCE,
  type AgentDispatchTask,
} from '../server/queue/agent-dispatch-queue.js';
import type { WorkerExecutionPort } from './index.js';

type WorkerRunner = Pick<CodexRunner, 'run' | 'cancel'>;

export function createWorkerExecutor(options: {
  env: Record<string, string | undefined>;
  runner?: WorkerRunner;
}): WorkerExecutionPort {
  const workspace = requiredEnvironment(options.env, 'TEAMS_WORKER_WORKSPACE');
  const agentCodexHome = requiredEnvironment(options.env, 'AGENT_CODEX_HOME');
  requireAbsolute(workspace, 'TEAMS_WORKER_WORKSPACE');
  requireAbsolute(agentCodexHome, 'AGENT_CODEX_HOME');
  const runner = options.runner ?? new CodexRunner({
    command: { executable: requiredEnvironment(options.env, 'CODEX_BIN') },
  });

  return Object.freeze({
    async start(task: AgentDispatchTask, context: Parameters<WorkerExecutionPort['start']>[1]) {
      if (task.provider !== 'codex') throw new Error(`Unsupported Azure worker provider: ${task.provider}`);
      if (task.execution.workspaceReference !== AGENT_DISPATCH_WORKSPACE_REFERENCE) {
        throw new Error(`Unsupported Azure worker workspace reference: ${task.execution.workspaceReference}`);
      }
      if (task.execution.mode === 'read-only') {
        throw new AgentExecutionUnavailableError(
          'trusted-isolation-required',
          'Linux read-only isolation is unavailable; the worker refused to spawn a child with workspace-write authority.',
        );
      }

      const abort = new AbortController();
      const propagateAbort = () => abort.abort(context.signal.reason);
      context.signal.addEventListener('abort', propagateAbort, { once: true });
      if (context.signal.aborted) propagateAbort();
      const result = runner.run({
        jobId: task.taskId,
        prompt: task.prompt,
        workspace,
        mode: task.execution.mode,
        environmentOverrides: { CODEX_HOME: agentCodexHome },
        signal: abort.signal,
        subject: {
          tenantId: task.tenantId,
          requesterId: task.requesterId,
          conversationId: task.conversationId,
          jobId: task.taskId,
        },
        onEvent: async (event) => {
          if (event.type) await context.checkpoint(event.type);
        },
      }).then((outcome) => {
        if (!outcome.threadId) throw new Error('Codex worker completed without a provider execution ID.');
        return { result: outcome.finalMessage, providerExecutionId: outcome.threadId };
      }).finally(() => context.signal.removeEventListener('abort', propagateAbort));
      return {
        result,
        terminateProcessTree: async () => { abort.abort('worker cancellation'); runner.cancel(task.taskId); },
        cleanupProcessTree: async () => { context.signal.removeEventListener('abort', propagateAbort); },
      };
    },
  });
}

function requiredEnvironment(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production worker configuration`);
  return value;
}

function requireAbsolute(value: string, name: string): void {
  if (!value.startsWith('/') || value.includes('\0')) throw new Error(`${name} must be an absolute path`);
}
