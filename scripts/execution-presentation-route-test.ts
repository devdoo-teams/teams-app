import assert from 'node:assert/strict';
import { mountExecutionPresentationRoutes } from '../src/server/execution-presentation-route.js';

const routes = new Map<string, Function[]>();
const selections = new Map<string, string>();
let writes = 0;
let rich = false;
mountExecutionPresentationRoutes({
  get: (p: string, ...h: Function[]) => routes.set(`GET ${p}`, h),
  post: (p: string, ...h: Function[]) => routes.set(`POST ${p}`, h),
} as any, {
  authenticate: (_q, _s, next) => next(),
  store: {
    get: async (s: any) => selections.get(`${s.tenantId}:${s.requesterId}`) ?? 'summary',
    set: async (s: any, m: string) => { writes++; selections.set(`${s.tenantId}:${s.requesterId}`, m); },
  } as any,
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
console.log('Execution presentation authenticated owner routes: PASS');
