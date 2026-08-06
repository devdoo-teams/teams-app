import path from 'node:path';

import express from 'express';
import { CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotExpressHandler } from '@copilotkit/runtime/v2/express';

import { createUserAuthMiddleware } from './user-auth.js';
import { ItemStore } from './item-store.js';
import { AgentJobStore, type AgentJob } from './agent-job-store.js';
import { AgentService } from './agent-service.js';
import { CodexRunner } from './codex-runner.js';
import { GitService } from './git-service.js';
import { TeamsCodexAgent } from './copilot-agent.js';
import { formatWeatherMessage, getWeather } from './weather-service.js';

const port = Number(process.env.PORT ?? 3978);
const skipAuth = process.env.TEAMS_SKIP_AUTH === 'true';
const skipOutbound = process.env.TEAMS_SKIP_OUTBOUND === 'true';
const clientDist = path.resolve(process.cwd(), 'dist/client');
const itemStore = new ItemStore(
  process.env.ITEM_STORE_PATH ?? path.resolve(process.cwd(), 'data/items.json'),
);
const agentJobStore = new AgentJobStore(
  process.env.AGENT_JOB_STORE_PATH ?? path.resolve(process.cwd(), 'data/agent-jobs.json'),
);
const codexRunner = new CodexRunner();
const agentWorkspace = path.resolve(process.env.AGENT_WORKSPACE ?? process.cwd());
const gitService = new GitService(agentWorkspace);
const botClientId = process.env.BOT_CLIENT_ID ?? process.env.CLIENT_ID;
const botConfigured = Boolean(botClientId && process.env.CLIENT_SECRET && process.env.TENANT_ID);
const useTeamsSdk = process.env.TEAMS_USE_SDK !== 'false' && botConfigured;
const userAuthConfigured = Boolean(
  process.env.CLIENT_ID && process.env.TENANT_ID && process.env.APPLICATION_ID_URI,
);

if (process.env.NODE_ENV === 'production' && skipAuth) {
  throw new Error('TEAMS_SKIP_AUTH must not be enabled in production.');
}

await itemStore.initialize();

let http: any;
let teamsApp: any;
let userAuthValidator: any;
const localOutbox = new Map<string, string[]>();

if (useTeamsSdk) {
  const teams = await import('@microsoft/teams.apps');
  http = new teams.ExpressAdapter();
  teamsApp = new teams.App({
    httpServerAdapter: http,
    clientId: botClientId,
    clientSecret: process.env.CLIENT_SECRET,
    tenantId: process.env.TENANT_ID,
    applicationIdUri: process.env.APPLICATION_ID_URI,
    dangerouslyAllowUnauthenticatedRequests: skipAuth,
  });

  // A Teams tab SSO token is issued for the Entra app declared in
  // webApplicationInfo, which is intentionally separate from the Bot app ID.
  // Build a second public SDK App instance only to reuse its Entra validator;
  // it is never started and does not handle HTTP traffic.
  const userAuthApp = new teams.App({
    clientId: process.env.CLIENT_ID,
    tenantId: process.env.TENANT_ID,
    applicationIdUri: process.env.APPLICATION_ID_URI,
  });
  userAuthValidator = userAuthApp.entraTokenValidator;
} else {
  // Local mode keeps the browser and API fully runnable even when the host machine
  // has an incompatible optional auth dependency. Production Teams traffic uses the SDK branch above.
  http = express();
}

http.use(express.json());

http.get('/api/health', (_request: any, response: any) => {
  response.json({
    ok: true,
    service: 'teams-sdk-mvp',
    version: '0.1.0',
    environment: process.env.NODE_ENV ?? 'development',
    auth: skipAuth ? 'local-bypass' : 'teams-authenticated',
    userAuth: skipAuth ? 'local-bypass' : userAuthConfigured ? 'entra-sso' : 'not-configured',
    bot: teamsApp ? 'teams-sdk' : 'local-handler',
    outbound: teamsApp ? (skipOutbound ? 'disabled' : 'teams-sdk') : 'local-outbox',
    agent: process.env.CODEX_BIN ?? 'codex-cli',
    agentWorkspace,
    storage: 'file-json',
    copilotKit: 'enabled',
    copilotKitRuntime: '/api/copilotkit',
    genAI: process.env.COPILOTKIT_DETERMINISTIC_MODE === 'true'
      ? 'deterministic-test'
      : process.env.OPENAI_API_KEY?.trim()
        ? 'openai-configured'
        : 'not-configured',
    timestamp: new Date().toISOString(),
  });
});

http.use(
  '/api/items',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
  }),
);

http.get('/api/items', (_request: any, response: any) => {
  response.json({ items: itemStore.list(), summary: itemStore.summary() });
});

http.get('/api/items/:id', (request: any, response: any) => {
  const id = Number(request.params.id);
  const item = itemStore.list().find((candidate) => candidate.id === id);

  if (!item) {
    response.status(404).json({ error: 'item not found' });
    return;
  }

  response.json({ item });
});

http.get('/api/weather', async (request: any, response: any) => {
  const latitude = Number(request.query?.latitude);
  const longitude = Number(request.query?.longitude);
  const demo = request.query?.mode === 'demo';

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    response.status(400).json({ error: 'latitude must be between -90 and 90' });
    return;
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    response.status(400).json({ error: 'longitude must be between -180 and 180' });
    return;
  }

  try {
    response.json(await getWeather(latitude, longitude, { demo }));
  } catch (error) {
    console.error('Weather lookup failed', error);
    response.status(502).json({ error: '날씨 정보를 가져오지 못했습니다.' });
  }
});

http.get('/privacy', (_request: any, response: any) => {
  response.type('html').send('<h1>Privacy</h1><p>Internal MVP privacy information.</p>');
});

http.get('/termsOfUse', (_request: any, response: any) => {
  response.type('html').send('<h1>Terms of Use</h1><p>Internal MVP terms of use.</p>');
});

http.post('/api/items', async (request: any, response: any) => {
  const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';

  if (!title) {
    response.status(400).json({ error: 'title is required' });
    return;
  }

  const item = await itemStore.add(title);
  response.status(201).json({ item });
});

http.put('/api/items/:id', async (request: any, response: any) => {
  const id = Number(request.params.id);
  const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';

  if (!title) {
    response.status(400).json({ error: 'title is required' });
    return;
  }

  const item = await itemStore.update(id, title);
  if (!item) {
    response.status(404).json({ error: 'item not found' });
    return;
  }

  response.json({ item });
});

http.patch('/api/items/:id', async (request: any, response: any) => {
  const id = Number(request.params.id);
  const item = await itemStore.toggle(id);

  if (!item) {
    response.status(404).json({ error: 'item not found' });
    return;
  }

  response.json({ item });
});

http.delete('/api/items/:id', async (request: any, response: any) => {
  const id = Number(request.params.id);
  const item = await itemStore.remove(id);

  if (!item) {
    response.status(404).json({ error: 'item not found' });
    return;
  }

  response.json({ item });
});

const notifyConversation = async (conversationId: string, text: string): Promise<void> => {
  if (teamsApp && !skipOutbound) {
    await teamsApp.send(conversationId, { type: 'message', text });
    return;
  }

  const messages = localOutbox.get(conversationId) ?? [];
  messages.push(text);
  localOutbox.set(conversationId, messages);
};

const agentService = new AgentService(
  agentJobStore,
  codexRunner,
  agentWorkspace,
  notifyConversation,
  gitService,
);
await agentService.initialize();

const copilotRuntime = new CopilotRuntime({
  agents: {
    default: new TeamsCodexAgent(itemStore, agentService),
  },
});

http.use(
  '/api/copilotkit',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
  }),
);
http.use(createCopilotExpressHandler({
  runtime: copilotRuntime,
  basePath: '/api/copilotkit',
  cors: false,
}));

http.use(
  '/api/agent-jobs',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
  }),
);
http.post('/api/agent-jobs/:id/approve', async (request: any, response: any) => {
  const job = await agentService.approve(request.params.id);
  if (!job) {
    response.status(404).json({ error: 'approval target not found' });
    return;
  }

  response.json({ job });
});
http.post('/api/agent-jobs/:id/cancel', async (request: any, response: any) => {
  const job = await agentService.cancel(request.params.id);
  if (!job) {
    response.status(404).json({ error: 'cancellation target not found' });
    return;
  }

  response.json({ job });
});

function formatAgentJob(job: AgentJob): string {
  const lines = [
    `작업 ID: ${job.id}`,
    `상태: ${job.status}`,
    `권한: ${job.mode}`,
  ];

  if (job.threadId) lines.push(`Codex thread: ${job.threadId}`);
  if (job.commitHash) lines.push(`Git commit: ${job.commitHash}`);
  if (job.commitMessage && !job.commitHash) lines.push(`Git: ${job.commitMessage}`);
  if (job.progress.length > 0) lines.push(`최근 진행: ${job.progress[job.progress.length - 1]}`);
  if (job.error) lines.push(`오류: ${job.error}`);
  if (job.result) lines.push(`결과:\n${job.result.slice(0, 5000)}`);
  return lines.join('\n');
}

async function handleMessage(activity: any, send: (text: string) => Promise<void>): Promise<void> {
  const text = activity.text?.replace(/<at>.*?<\/at>/gi, '').trim() || '';
  const normalizedText = text.toLowerCase();
  const conversationId = activity.conversation?.id ?? 'unknown-conversation';
  const requesterId = activity.from?.id ?? 'unknown-user';

  if (normalizedText === 'help') {
    await send(
      '사용 가능한 명령: help, weather [위도 경도], status, list, run <작업>, continue <작업 ID> <추가 요청>, write <작업>, approve <작업 ID>, commit <작업 ID> [메시지], cancel <작업 ID>',
    );
    return;
  }

  const weatherMatch = text.match(/^(?:weather|날씨)(?:\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?))?$/i);
  if (weatherMatch) {
    const isExplicitLocation = Boolean(weatherMatch[1] && weatherMatch[2]);

    if (!isExplicitLocation) {
      await send('Bot 대화에는 현재 기기 위치가 자동으로 전달되지 않습니다. Teams 탭에서 “내 위치 사용”을 누르거나, weather 37.5665 126.978처럼 좌표를 함께 입력하세요.');
      return;
    }

    const latitude = Number(weatherMatch[1]);
    const longitude = Number(weatherMatch[2]);

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      await send('위도는 -90~90, 경도는 -180~180 범위로 입력하세요. 예: weather 37.5665 126.978');
      return;
    }

    try {
      const weather = await getWeather(latitude, longitude);
      await send(formatWeatherMessage(weather));
    } catch {
      await send('날씨 정보를 가져오지 못했습니다. 잠시 후 다시 시도하세요.');
    }
    return;
  }

  if (normalizedText === 'status' || normalizedText.startsWith('status ')) {
    const jobId = text.split(/\s+/)[1];
    if (jobId) {
      const job = agentService.get(jobId);
      await send(job ? formatAgentJob(job) : `작업 ${jobId}을 찾을 수 없습니다.`);
      return;
    }

    const openCount = itemStore.countOpen();
    await send(`현재 진행 중인 업무는 ${openCount}개이며, 에이전트 활성 작업은 ${agentService.countActive()}개입니다.`);
    return;
  }

  if (normalizedText === 'list') {
    const openItems = itemStore.list().filter((item) => item.status === 'open').slice(0, 8);
    const jobs = agentService.list(5);
    const itemText = openItems.length === 0
      ? '진행 중인 업무가 없습니다.'
      : `진행 중인 업무:\n${openItems.map((item) => `- ${item.title}`).join('\n')}`;
    const jobText = jobs.length === 0
      ? '에이전트 작업이 없습니다.'
      : `최근 에이전트 작업:\n${jobs.map((job) => `- ${job.id}: ${job.status}`).join('\n')}`;
    await send(`${itemText}\n\n${jobText}`);
    return;
  }

  const commandMatch = text.match(/^(run|write)\s+([\s\S]+)$/i);
  if (commandMatch) {
    const mode = commandMatch[1].toLowerCase() === 'write' ? 'workspace-write' : 'read-only';
    const job = await agentService.submit({
      prompt: commandMatch[2].trim(),
      mode,
      conversationId,
      requesterId,
    });

    if (mode === 'workspace-write') {
      await send(`쓰기 작업 ${job.id}이 승인 대기 중입니다.\napprove ${job.id} 또는 cancel ${job.id}`);
    } else {
      await send(`읽기 전용 Codex 작업 ${job.id}을 시작했습니다.\nstatus ${job.id}로 진행 상태를 확인할 수 있습니다.`);
    }
    return;
  }

  const approveMatch = text.match(/^approve\s+(task-[\w-]+)$/i);
  if (approveMatch) {
    const job = await agentService.approve(approveMatch[1]);
    await send(job ? `작업 ${job.id} 승인을 처리했습니다.\nstatus ${job.id}` : '승인할 작업을 찾을 수 없습니다.');
    return;
  }

  const continueMatch = text.match(/^continue\s+(task-[\w-]+)\s+([\s\S]+)$/i);
  if (continueMatch) {
    const job = await agentService.continue(continueMatch[1], continueMatch[2].trim());
    await send(
      job
        ? `작업 ${job.id}이 이전 Codex thread에서 이어집니다.\nstatus ${job.id}`
        : '재개할 Codex thread가 있는 작업을 찾을 수 없습니다.',
    );
    return;
  }

  const commitMatch = text.match(/^commit\s+(task-[\w-]+)(?:\s+([\s\S]+))?$/i);
  if (commitMatch) {
    const commitMessage = commitMatch[2]?.trim() || `feat: apply Teams task ${commitMatch[1]}`;
    const job = await agentService.commit(commitMatch[1], commitMessage);
    if (!job) {
      await send('커밋할 작업을 찾을 수 없습니다.');
    } else if (job.status !== 'completed') {
      await send(`작업 ${job.id}은 아직 커밋할 수 없습니다. 현재 상태: ${job.status}`);
    } else {
      await send(job.commitMessage || '커밋할 변경이 없습니다.');
    }
    return;
  }

  const cancelMatch = text.match(/^cancel\s+(task-[\w-]+)$/i);
  if (cancelMatch) {
    const job = await agentService.cancel(cancelMatch[1]);
    await send(job ? `작업 ${job.id} 취소를 처리했습니다.\n상태: ${job.status}` : '취소할 작업을 찾을 수 없습니다.');
    return;
  }

  if (text) {
    const previous = agentService.latestCompletedForConversation(conversationId);
    if (previous) {
      const continued = await agentService.continue(previous.id, text);
      if (continued) {
        await send(`이전 Codex 대화를 이어서 작업 ${continued.id}을 시작했습니다.\nstatus ${continued.id}`);
        return;
      }
    }

    const job = await agentService.submit({
      prompt: text,
      mode: 'read-only',
      conversationId,
      requesterId,
    });
    await send(`자연어 작업 ${job.id}을 읽기 전용으로 시작했습니다.\nstatus ${job.id}`);
    return;
  }

  await send('내용이 없습니다. help를 입력해 사용 가능한 명령을 확인하세요.');
}

async function handleInstall(activity: any, send: (text: string) => Promise<void>): Promise<void> {
  const conversationType = activity.conversation?.conversationType;
  const scopeHint = conversationType === 'channel' || conversationType === 'groupChat'
    ? '이 대화'
    : '개인 공간';

  await send(
    `업무 허브가 ${scopeHint}에 추가되었습니다. 탭에서 업무와 현재 위치 날씨를 확인하고, help·날씨·status·list 명령으로 기능을 사용할 수 있습니다.`,
  );
}

// The Bot Framework normally receives this outbound activity from Teams.
// In local mode, return the generated response directly so the full message loop is testable.
if (teamsApp) {
  teamsApp.tab('home', clientDist);
  teamsApp.on('install.add', async ({ activity, send }: any) => {
    const runtimeSend = process.env.TEAMS_SKIP_OUTBOUND === 'true' ? async () => {} : send;
    await handleInstall(activity, runtimeSend);
  });
  teamsApp.on('message', async ({ activity, send }: any) => {
    const runtimeSend = process.env.TEAMS_SKIP_OUTBOUND === 'true' ? async () => {} : send;
    await handleMessage(activity, runtimeSend);
  });
} else {
  http.post('/api/messages', async (request: any, response: any) => {
    if (!skipAuth) {
      response.status(401).json({ error: 'Bot authentication is not configured' });
      return;
    }

    const messages: string[] = [];
    const send = async (text: string) => {
      messages.push(text);
    };

    if (request.body?.type === 'installationUpdate' && request.body?.action === 'add') {
      await handleInstall(request.body, send);
    } else {
      await handleMessage(request.body, send);
    }

    response.json({ messages });
  });

  http.get('/tabs/home', (_request: any, response: any) => {
    response.sendFile(path.join(clientDist, 'index.html'));
  });
  http.use('/tabs/home', express.static(clientDist));
}

if (skipAuth) {
  http.get('/api/debug/agent-jobs', (_request: any, response: any) => {
    response.json({ jobs: agentService.list(50) });
  });

  http.get('/api/debug/agent-outbox/:conversationId', (request: any, response: any) => {
    const conversationId = request.params.conversationId;
    const messages = localOutbox.get(conversationId) ?? [];
    localOutbox.delete(conversationId);
    response.json({ conversationId, messages });
  });
}

if (skipAuth) {
  http.post('/v3/conversations/:conversationId/activities', (_request: any, response: any) => {
    response.status(201).json({ id: 'local-outbound-activity' });
  });
}

if (teamsApp) {
  await teamsApp.start(port);
} else {
  await new Promise<void>((resolve) => {
    http.listen(port, () => resolve());
  });
}

console.log(`Tab URL: http://localhost:${port}/tabs/home`);
console.log(`Teams messages: http://localhost:${port}/api/messages`);
