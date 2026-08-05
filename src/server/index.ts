import path from 'node:path';

import express from 'express';

import { createUserAuthMiddleware } from './user-auth.js';
import { ItemStore } from './item-store.js';

const port = Number(process.env.PORT ?? 3978);
const skipAuth = process.env.TEAMS_SKIP_AUTH === 'true';
const useTeamsSdk = !skipAuth && process.env.TEAMS_USE_SDK !== 'false';
const clientDist = path.resolve(process.cwd(), 'dist/client');
const itemStore = new ItemStore(
  process.env.ITEM_STORE_PATH ?? path.resolve(process.cwd(), 'data/items.json'),
);
const userAuthConfigured = Boolean(
  process.env.CLIENT_ID && process.env.TENANT_ID && process.env.APPLICATION_ID_URI,
);

if (process.env.NODE_ENV === 'production' && skipAuth) {
  throw new Error('TEAMS_SKIP_AUTH must not be enabled in production.');
}

await itemStore.initialize();

let http: any;
let teamsApp: any;

if (useTeamsSdk) {
  const teams = await import('@microsoft/teams.apps');
  http = new teams.ExpressAdapter();
  teamsApp = new teams.App({
    httpServerAdapter: http,
    applicationIdUri: process.env.APPLICATION_ID_URI,
  });
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
    storage: 'file-json',
    timestamp: new Date().toISOString(),
  });
});

http.use(
  '/api/items',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: teamsApp?.entraTokenValidator,
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

async function handleMessage(activity: any, send: (text: string) => Promise<void>): Promise<void> {
  const text = activity.text?.replace(/<at>.*?<\/at>/gi, '').trim() || '';
  const normalizedText = text.toLowerCase();

  if (normalizedText === 'status') {
    const openCount = itemStore.countOpen();
    await send(`현재 진행 중인 업무는 ${openCount}개입니다.`);
    return;
  }

  if (normalizedText === 'list') {
    const openItems = itemStore.list().filter((item) => item.status === 'open').slice(0, 8);
    await send(
      openItems.length === 0
        ? '진행 중인 업무가 없습니다.'
        : `진행 중인 업무:\n${openItems.map((item) => `- ${item.title}`).join('\n')}`,
    );
    return;
  }

  await send(
    normalizedText === 'help'
      ? '사용 가능한 명령: help, status, list'
      : `받은 메시지: ${text || '(내용 없음)'}`,
  );
}

// The Bot Framework normally receives this outbound activity from Teams.
// In local mode, return the generated response directly so the full message loop is testable.
if (teamsApp) {
  teamsApp.tab('home', clientDist);
  teamsApp.on('message', async ({ activity, send }: any) => {
    await handleMessage(activity, send);
  });
} else {
  http.post('/api/messages', async (request: any, response: any) => {
    if (!skipAuth) {
      response.status(401).json({ error: 'Bot authentication is not configured' });
      return;
    }

    const messages: string[] = [];
    await handleMessage(request.body, async (text) => {
      messages.push(text);
    });
    response.json({ messages });
  });

  http.get('/tabs/home', (_request: any, response: any) => {
    response.sendFile(path.join(clientDist, 'index.html'));
  });
  http.use('/tabs/home', express.static(clientDist));
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
