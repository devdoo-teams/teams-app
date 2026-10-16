import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { RepositoryPrPanel } from '../src/client/RepositoryPrPanel.js';
import { apiFetch, markTeamsHostReady, resetAuthStateForTest, setAuthRequired, setAuthTokenProviderForTest } from '../src/client/auth.js';
import { RepositoryPrService } from '../src/server/repository-pr.js';
import { BitbucketDcReadAdapter } from '../src/server/bitbucket-dc-read.js';
import { repoFixtureRecord as record, repoFixtureBaseUrl } from './fixtures/repository-pr-fixture.js';
import { findTestElement, findTestElements, flushReact, withTestDom } from './fixtures/react-test-dom.js';
import type { RepositoryPrincipal } from '../src/shared/repository-pr.js';

const alice = { tenantId: 'synthetic-tenant', requesterId: 'A' };
const bob = { tenantId: 'synthetic-tenant', requesterId: 'B' };
const otherTenant = { tenantId: 'other-synthetic-tenant', requesterId: 'A' };
const title = (scope: RepositoryPrincipal) => `${scope.tenantId}/${scope.requesterId} only synthetic PR`;

async function withPanel(run: (h: Awaited<ReturnType<typeof mountPanel>>) => Promise<void>) {
  await withTestDom(async document => {
    const h = await mountPanel(document);
    try { await run(h); } finally { await h.close(); }
  });
}
async function mountPanel(document: Parameters<Parameters<typeof withTestDom>[0]>[0]) {
  const { createRoot } = await import('react-dom/client');
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  let principal = alice, loggedOut = false, failPage = false;
  let hold: 'catalog' | 'query' | undefined;
  let holdBody = false, holdAuthentication = false;
  const held: Array<{ path: string; scope: RepositoryPrincipal; release(status?: number): void }> = [];
  const heldTokens: Array<(fail?: boolean) => void> = [];
  const requests: Array<{ path: string; scope: RepositoryPrincipal; body?: Record<string, unknown> }> = [];
  const tokenScopes = new Map<string, RepositoryPrincipal>();
  const adapter = new BitbucketDcReadAdapter({ request: async (grant, url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://dc.fixture.test');
    const start = Number(parsed.searchParams.get('start') ?? 0);
    if (failPage && start > 0) return new Response('{}', { status: 503 });
    return Response.json(parsed.pathname.endsWith('/pull-requests')
      ? { start, isLastPage: start > 0, ...(start === 0 ? { nextPageStart: 20 } : {}),
        values: [{ ...record('alpha', 1 + start), title: title(grant) }] }
      : { id: 11, slug: 'alpha', project: { key: 'TEST' } });
  } });
  const service = new RepositoryPrService({ mode: 'fixture', repositories: [{ id: 'alpha', label: 'Synthetic alpha',
    provider: 'bitbucket-dc', baseUrl: repoFixtureBaseUrl, projectKey: 'TEST', slug: 'alpha', remoteId: 11, adapter }],
    authorize: async (scope, repo) => ({ ...scope, repositoryId: repo.id, revision: 'acl-1', user: { id: 7, name: 'fixture-owner' } }) });
  globalThis.fetch = async (input, init = {}) => {
    const scope = tokenScopes.get(new Headers(init.headers).get('authorization') ?? '');
    assert.ok(scope, 'actual apiFetch must supply this operation\'s synthetic Teams identity');
    const path = String(input);
    assert.ok(['/probe-current-account', '/api/repository-pr/catalog', '/api/repository-pr/query'].includes(path));
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, scope, body });
    let response: Response;
    try {
      response = Response.json(path === '/probe-current-account' ? scope : path.endsWith('/catalog')
        ? await service.catalog(scope) : await service.query(scope, body));
    } catch (error) { response = new Response('{}', { status: (error as { status?: number }).status ?? 502 }); }
    if (holdBody && path.endsWith('/query')) {
      holdBody = false;
      const body = await response.clone().json();
      response.json = () => new Promise((resolve, reject) => held.push({ path, scope,
        release: status => status ? reject(new Error('synthetic delayed body failure')) : resolve(body) }));
    }
    if (hold && path.endsWith(`/${hold}`)) {
      hold = undefined;
      return new Promise<Response>(resolve => held.push({ path, scope,
        release: status => resolve(status ? new Response('{}', { status }) : response) }));
    }
    return response;
  };
  console.warn = (...args) => { assert.deepEqual(args, ['Teams SSO token request failed']); };
  resetAuthStateForTest(); markTeamsHostReady(); setAuthRequired(true);
  setAuthTokenProviderForTest(async () => {
    if (loggedOut) throw new Error('synthetic logout');
    const token = `synthetic:${principal.tenantId}:${principal.requesterId}`;
    tokenScopes.set(`Bearer ${token}`, { ...principal });
    if (holdAuthentication) {
      holdAuthentication = false;
      return new Promise<string>((resolve, reject) => heldTokens.push(fail => fail
        ? reject(new Error('synthetic previous account auth failure')) : resolve(token)));
    }
    return token;
  });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<RepositoryPrPanel />); });
  const click = async (name: string) => {
    const button = findTestElement(container, e => e.tagName === 'BUTTON' && e.textContent === name);
    assert.equal(button.disabled, false, `${name} must be enabled`);
    await act(async () => { button.dispatchEvent(new Event('click', { bubbles: true })); }); await flushReact();
  };
  const select = async () => {
    const checkbox = findTestElement(container, e => e.tagName === 'INPUT' && e.type === 'checkbox');
    await act(async () => { Object.assign(checkbox, { checked: true }); checkbox.dispatchEvent(new Event('click', { bubbles: true })); });
    await flushReact();
  };
  return {
    container, held, heldTokens, requests, click, select,
    text: () => container.textContent,
    buttons: (name: string) => findTestElements(container, e => e.tagName === 'BUTTON' && e.textContent === name),
    async open() { await click('저장소 PR 열기'); await select(); },
    async reload() { await click('저장소 목록 다시 읽기'); await select(); },
    holdNext(value: 'catalog' | 'query') { hold = value; },
    holdNextBody() { holdBody = true; },
    holdNextAuthentication() { holdAuthentication = true; },
    failNextPage(value: boolean) { failPage = value; },
    async authenticate(next?: RepositoryPrincipal) {
      if (next) principal = next; else loggedOut = true;
      await act(async () => {
        if (next) assert.deepEqual(await (await apiFetch('/probe-current-account')).json(), next);
        else await assert.rejects(apiFetch('/probe-current-account'), { kind: 'auth-expired' });
      }); await flushReact();
    },
    async release(index: number, status?: number) { await act(async () => { held[index].release(status); }); await flushReact(); },
    async releaseToken(index: number, fail?: boolean) { await act(async () => { heldTokens[index](fail); }); await flushReact(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previousFetch; console.warn = previousWarn; resetAuthStateForTest(); },
  };
}

for (const next of [bob, otherTenant]) for (const status of [undefined, 500]) {
  test(`account/tenant change invalidates an abort-ignoring late response body ${status ?? 'success'} for ${next.requesterId}`, async () => {
    await withPanel(async h => {
      await h.open(); h.holdNextBody(); await h.click('PR 조회 / 새로고침'); assert.equal(h.held.length, 1);
      await h.authenticate(next); await h.reload(); await h.click('PR 조회 / 새로고침');
      await h.release(0, status);
      assert.ok(h.text().includes(title(next)), 'a late body must neither overwrite nor erase the current owner\'s result');
      assert.equal(findTestElements(h.container, e => e.tagName === 'H4' && e.textContent === `#1 ${title(alice)}`).length, 0);
      assert.doesNotMatch(h.text(), /조회에 실패/);
    });
  });
}

for (const fail of [false, true]) {
  test(`previous account's delayed token ${fail ? 'failure' : 'success'} cannot invalidate a new account`, async () => {
    await withPanel(async h => {
      await h.open(); h.holdNextAuthentication(); await h.click('PR 조회 / 새로고침'); assert.equal(h.heldTokens.length, 1);
      await h.authenticate(bob); await h.reload(); await h.click('PR 조회 / 새로고침');
      await h.releaseToken(0, fail); assert.ok(h.text().includes(title(bob)));
      assert.equal(h.requests.filter(r => r.path.endsWith('/query') && r.scope.requesterId === 'A').length, 0);
    });
  });
}

test('logout clears an already visible snapshot without requiring another panel action', async () => {
  await withPanel(async h => {
    await h.open(); await h.click('PR 조회 / 새로고침'); assert.ok(h.text().includes(title(alice)));
    await h.authenticate(); assert.doesNotMatch(h.text(), /only synthetic PR/);
    assert.equal(findTestElements(h.container, e => e.tagName === 'INPUT').length, 0);
  });
});

test('a new operation with the same credential preserves the current private view', async () => {
  await withPanel(async h => {
    await h.open(); await h.click('PR 조회 / 새로고침'); await h.authenticate(alice);
    assert.ok(h.text().includes(title(alice))); assert.equal(h.buttons('PR 조회 / 새로고침')[0].disabled, false);
  });
});

for (const next of [bob, otherTenant]) {
  test(`actual React/apiFetch clears visible PRs on ${next.requesterId === 'B' ? 'account' : 'tenant'} change`, async () => {
    await withPanel(async h => {
      await h.open(); await h.click('PR 조회 / 새로고침'); assert.match(h.text(), /synthetic-tenant\/A only synthetic PR/);
      await h.authenticate(next);
      assert.doesNotMatch(h.text(), /synthetic-tenant\/A only synthetic PR/);
      assert.equal(findTestElements(h.container, e => e.tagName === 'INPUT').length, 0, 'previous owner\'s catalog and selection must be removed');
      await h.reload(); await h.click('PR 조회 / 새로고침'); assert.ok(h.text().includes(title(next)));
    });
  });
  for (const status of [undefined, 500, 401]) {
    test(`actual React/apiFetch rejects old ${status ?? 'successful'} PR response after ${next.tenantId}/${next.requesterId} authenticates`, async () => {
      await withPanel(async h => {
        await h.open(); h.holdNext('query'); await h.click('PR 조회 / 새로고침'); assert.equal(h.held.length, 1);
        await h.authenticate(next); await h.release(0, status);
        assert.equal(findTestElements(h.container, e => e.tagName === 'H4').length, 0,
          'late previous-owner success must not publish before a catalog reload');
        assert.doesNotMatch(h.text(), /조회에 실패|인증이 만료/);
        assert.equal(findTestElements(h.container, e => e.tagName === 'INPUT').length, 0);
        await h.reload(); await h.click('PR 조회 / 새로고침'); assert.ok(h.text().includes(title(next)));
      });
    });
  }
}

test('actual React/apiFetch invalidates a delayed catalog on account change', async () => {
  await withPanel(async h => {
    h.holdNext('catalog'); await h.click('저장소 PR 열기'); assert.equal(h.held.length, 1);
    await h.authenticate(bob); await h.reload(); await h.click('PR 조회 / 새로고침');
    await h.release(0); assert.ok(h.text().includes(title(bob)));
    const query = h.requests.filter(r => r.path.endsWith('/query')).at(-1)!;
    assert.equal(query.scope.requesterId, 'B');
  });
});

for (const status of [undefined, 500]) {
  test(`logout clears visible results and rejects old ${status ?? 'successful'} pending reads`, async () => {
    await withPanel(async h => {
      await h.open(); await h.click('PR 조회 / 새로고침'); assert.ok(h.text().includes(title(alice)));
      h.holdNext('query'); await h.click('PR 조회 / 새로고침'); assert.equal(h.held.length, 1);
      await h.authenticate(); await h.release(0, status);
      assert.doesNotMatch(h.text(), /only synthetic PR/);
      assert.equal(findTestElements(h.container, e => e.tagName === 'INPUT').length, 0);
      assert.equal(h.buttons('PR 조회 / 새로고침')[0].disabled, true);
    });
  });
}

test('page failure leaves an enabled first-page action outside the removed result', async () => {
  await withPanel(async h => {
    await h.open(); await h.click('PR 조회 / 새로고침'); h.failNextPage(true);
    await h.click('Synthetic alpha 다음 페이지'); assert.match(h.text(), /조회에 실패/);
    assert.equal(h.buttons('처음 페이지').length, 1, 'page error must preserve recovery without requiring result markup');
    h.failNextPage(false); await h.click('처음 페이지'); assert.ok(h.text().includes(title(alice)));
    assert.deepEqual(h.requests.filter(r => r.path.endsWith('/query')).at(-1)!.body?.starts, {});
  });
});
