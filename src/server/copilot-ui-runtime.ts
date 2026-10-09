import { CopilotRuntime, AgentRunner, type AgentRunnerRunRequest } from '@copilotkit/runtime/v2';
import { throwError } from 'rxjs';
import { createCopilotExpressHandler } from '@copilotkit/runtime/v2/express';
import { CopilotJobProjectionAgent } from './copilot-job-projection-agent.js';
import { EXECUTION_PRESENTATION_AGENT_ID } from '../shared/execution-presentation.js';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';

/** No SDK thread persistence, reconnect, or stop capability is exposed. */
class ReadOnlyProjectionRunner extends AgentRunner {
  run(request: AgentRunnerRunRequest) { return request.agent.run(request.input); }
  connect() { return throwError(() => new Error('READONLY_PROJECTION_CONNECT_UNSUPPORTED')); }
  async isRunning() { return false; }
  async stop() { return false; }
}

/** Each HTTP request receives an owner-pinned read port, never an execution port. */
export function createCopilotUiHandler(options: {
  getJob: (jobId: string) => CoreOrchestrationJob | undefined | Promise<CoreOrchestrationJob | undefined>;
}) {
  if (process.env.COPILOTKIT_TELEMETRY_DISABLED !== 'true') {
    throw new Error('COPILOT_UI_TELEMETRY_MUST_BE_DISABLED');
  }
  const runtime = new CopilotRuntime({
    runner: new ReadOnlyProjectionRunner(),
    agents: () => ({ [EXECUTION_PRESENTATION_AGENT_ID]: new CopilotJobProjectionAgent(options) }),
    exposeMemoryRoutes: false,
  });
  return createCopilotExpressHandler({
    runtime, basePath: '/api/copilot-ui', cors: false, activateChannels: false,
  });
}
