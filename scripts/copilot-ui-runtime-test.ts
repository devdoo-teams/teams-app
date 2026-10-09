import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { HttpAgent } from '@ag-ui/client';
import { EventType } from '@ag-ui/core';

process.env.COPILOTKIT_TELEMETRY_DISABLED = 'true';
const { createCopilotUiHandler } = await import('../src/server/copilot-ui-runtime.js');
const job: any = { id: 'task-sdk-owner', provider: 'codex', status: 'completed', mode: 'read-only',
  prompt: 'synthetic sum', result: '42', progress: [], model: 'gpt-6-luna', reasoningEffort: 'xhigh',
  tools: [], executionEnvironment: 'local-macos' };
let reads = 0;
const http = express();
http.use(express.json());
http.get('/api/copilot-ui/info', createCopilotUiHandler({ getJob: async () => { throw new Error('INFO_MUST_NOT_READ_A_JOB'); } }));
http.post('/api/copilot-ui/agent/execution-projection/run', (q, s, next) => {
  if (q.headers['x-fixture-owner'] !== 'alice') { s.sendStatus(401); return; }
  return createCopilotUiHandler({ getJob: async id => { reads++; return id === job.id ? job : undefined; } })(q, s, next);
});
http.use('/api/copilot-ui', (_q, s) => { s.sendStatus(404); });
const server = http.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
try {
  const info = await fetch(`${origin}/api/copilot-ui/info`).then(r => r.json()) as any;
  assert.equal(info.mode, 'sse');
  assert.ok(info.agents['execution-projection']);
  assert.equal(info.telemetryDisabled, true);
  assert.equal(info.a2uiEnabled, false);
  assert.equal(info.openGenerativeUIEnabled, false);
  assert.equal(info.threadEndpoints.list, false);
  assert.equal(info.threadEndpoints.inspect, false);
  assert.equal(info.threadEndpoints.mutations, false);
  assert.equal(reads, 0);
  assert.equal((await fetch(`${origin}/api/copilot-ui/agent/execution-projection/run`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(`${origin}/api/copilot-ui/agent/execution-projection/stop`, { method: 'POST' })).status, 404);
  const agent = new HttpAgent({ url: `${origin}/api/copilot-ui/agent/execution-projection/run`,
    headers: { 'x-fixture-owner': 'alice' } });
  const events: any[] = [];
  await agent.runAgent({ forwardedProps: { jobId: job.id }, tools: [], context: [] }, {
    onEvent: ({ event }: any) => { events.push(event); },
  });
  assert.ok(events.some(event => event.type === EventType.RUN_FINISHED));
  const args = events.find(event => event.type === EventType.TOOL_CALL_ARGS);
  assert.equal(JSON.parse(args.delta).presentation.jobId, job.id);
  assert.equal(JSON.parse(args.delta).presentation.result, '42');
  assert.equal(JSON.parse(args.delta).presentation.observedPlatform, undefined);
  assert.equal(reads, 1);
  console.log('Real CopilotKit OSS runtime + AG-UI authenticated read-only projection: PASS');
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
