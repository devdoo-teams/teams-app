/** Finite loopback-only synthetic UI fixture. Not a deployment or live DC configuration. */
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { z } from 'zod';
import { mountRepositoryPrRoutes } from '../src/server/repository-pr-route.js';
import { createUserAuthMiddleware } from '../src/server/user-auth.js';
import { RepositoryPrService } from '../src/server/repository-pr.js';
import { createRepositoryPrFixture, repoFixtureOwner as owner } from './fixtures/repository-pr-fixture.js';

const root = process.cwd(); const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const lifetime = Number(arg('lifetime-ms') ?? 900000);
if (!Number.isSafeInteger(lifetime) || lifetime < 30000 || lifetime > 1800000) throw new Error('Invalid finite fixture lifetime');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'repository-pr-preview-'));
const f = await createRepositoryPrFixture(6, 6000);
const app = express(); let foreign = false, unconfigured = false;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const trackedDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim());
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {RepositoryPrPanel} from './src/client/RepositoryPrPanel'; import {createRepositoryPrClient} from './src/client/repository-pr-client';
import './src/client/styles.css';
const client=createRepositoryPrClient((url,init)=>fetch(url,{...init,headers:{...init?.headers,Authorization:'Bearer synthetic-preview'}}));
createRoot(document.getElementById('root')).render(<main className="shell agent-hub-shell"><h1>업무 허브 · 합성 시험</h1><p>운영 연결 미완료 · ${version} · ${sourceCommit.slice(0, 7)}</p><RepositoryPrPanel client={client}/></main>);`,
  loader: 'tsx', resolveDir: root, sourcefile: 'repository-pr-preview.tsx' }, bundle: true, format: 'esm', platform: 'browser',
  outdir: output, entryNames: 'fixture', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
app.use('/__fixture', express.json({ limit: '4kb' }));
const controlSchema = z.object({ status: z.union([z.literal(200), z.literal(302), z.literal(403), z.literal(500)]).optional(),
  delay: z.number().int().min(0).max(1000).optional(), paging: z.boolean().optional(), empty: z.boolean().optional(),
  foreign: z.boolean().optional(), unconfigured: z.boolean().optional() }).strict();
app.post('/__fixture/control', (request, response) => {
  const parsed = controlSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: 'invalid synthetic control' }); return; }
  const value = parsed.data;
  f.status = Number(value.status ?? 200); f.delay = Number(value.delay ?? 0); f.paging = value.paging === true;
  f.payload = value.empty ? { start: 0, isLastPage: true, values: [] } : undefined;
  foreign = value.foreign === true; unconfigured = value.unconfigured === true;
  response.json({ synthetic: true });
});
const empty = new RepositoryPrService({ repositories: [], authorize: async () => undefined });
mountRepositoryPrRoutes(app, { service: {
  catalog: (...args) => (unconfigured ? empty : f.service).catalog(...args),
  query: (...args) => (unconfigured ? empty : f.service).query(...args),
}, authenticate: createUserAuthMiddleware({ allowUnauthenticated: false, acceptedAudiences: ['synthetic-preview'],
  configuredTenantId: owner.tenantId, logger: { warn() {} }, validator: { async validateAccessToken(value) {
    return value === 'synthetic-preview' ? { tid: owner.tenantId, oid: foreign ? 'fixture-other' : owner.requesterId,
      aud: 'synthetic-preview', scp: 'access_as_user' } : null;
  } } }), resolvePrincipal: (_q, r) => r.locals.user ? { tenantId: r.locals.user.tid, requesterId: r.locals.user.requesterId } : undefined });
app.get('/__fixture/evidence', (_q, r) => r.json({ sourceCommit, trackedDirty, version, requests: f.requests }));
app.get('/', (_q, response) => response.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'")
  .send('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>업무 허브 저장소 PR · 합성 시험</title><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'));
app.use(express.static(output));
const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const startedAt = new Date().toISOString(); const port = (server.address() as { port: number }).port;
const metadata = { synthetic: true, sourceCommit, trackedDirty, version, pid: process.pid, url: `http://127.0.0.1:${port}/`,
  startedAt, expiresAt: new Date(Date.now() + lifetime).toISOString() };
if (arg('evidence')) await fs.writeFile(arg('evidence')!, JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata));
let stopped = false;
async function stop() {
  if (stopped) return; stopped = true; clearTimeout(expiry); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); await f.close(); await fs.rm(output, { recursive: true, force: true });
  console.log(JSON.stringify({ stoppedAt: new Date().toISOString(), pid: process.pid, synthetic: true }));
}
const expiry = setTimeout(() => void stop(), lifetime);
process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop());
