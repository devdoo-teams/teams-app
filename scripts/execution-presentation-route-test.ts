import assert from 'node:assert/strict';
import { mountExecutionPresentationRoutes } from '../src/server/execution-presentation-route.js';
import { ExecutionPresentationStore } from '../src/server/execution-presentation-store.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const routes = new Map<string, Function[]>();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'presentation-route-'));
const store = new ExecutionPresentationStore(path.join(root, 'preferences.json'));
const setSelection = store.setSelection.bind(store);
store.setSelection = async (...args) => { writes++; await setSelection(...args); };
let writes = 0;
let rich = false;
mountExecutionPresentationRoutes({
  get: (p: string, ...h: Function[]) => routes.set(`GET ${p}`, h),
  post: (p: string, ...h: Function[]) => routes.set(`POST ${p}`, h),
} as any, {
  authenticate: (_q, _s, next) => next(),
  store,
  resolveScope: (_q, s) => s.locals.owner,
  richEnabled: () => rich,
});
async function call(method: string, body: any, owner?: any) {
  const handlers = routes.get(`${method} /api/execution-presentation`);
  assert.ok(handlers, 'authenticated display preference route must be mounted');
  const r: any = { locals: { owner }, statusCode: 200, status(n: number) { this.statusCode = n; return this; },
    json(v: any) { this.body = v; return this; }, set() { return this; } };
  await handlers.at(-1)!({ body }, r);
  return r;
}
const alice = { tenantId: 'tenant', requesterId: 'alice' };
const bob = { tenantId: 'tenant', requesterId: 'bob' };
assert.equal((await call('GET', {}, undefined)).statusCode, 401);
assert.equal((await call('GET', {}, alice)).body.mode, 'summary');
assert.equal((await call('POST', { mode: 'text', requesterId: 'bob' }, alice)).statusCode, 400);
assert.equal((await call('POST', { mode: 'rich' }, alice)).statusCode, 503);
assert.equal(writes, 0);
assert.equal((await call('POST', { mode: 'text' }, alice)).body.mode, 'text');
assert.equal((await call('GET', {}, bob)).body.mode, 'summary');
rich = true;
assert.equal((await call('POST', { mode: 'rich' }, alice)).body.mode, 'rich');
assert.deepEqual((await call('GET', {}, alice)).body.availableModes, ['text', 'summary', 'rich']);
assert.equal((await call('POST', {mode:'rich',details:[],richSurface:'dialog'}, alice)).statusCode,200);
assert.deepEqual((await call('GET', {}, alice)).body.details,[]);
assert.equal((await call('GET', {}, alice)).body.richSurface,'dialog');
assert.deepEqual((await call('GET', {}, bob)).body.details,['tool','steps','diagnostics']);
assert.equal((await call('POST', {mode:'rich',details:['tool','tool']},alice)).statusCode,400);
await fs.rm(root,{recursive:true,force:true});
console.log('Execution presentation authenticated owner routes: PASS');
