import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepositoryPrPanel } from '../src/client/RepositoryPrPanel.js';
import { repositoryPrCard } from '../src/server/repository-pr-card.js';
import { createRepositoryPrFixture, repoFixtureOwner as owner, repoFixtureRecord as record } from './fixtures/repository-pr-fixture.js';

test('existing tab entry remains discoverable and native projection bounds/escapes PR text', async () => {
  assert.match(renderToStaticMarkup(<RepositoryPrPanel />), /저장소 PR 열기/);
  const f = await createRepositoryPrFixture();
  try {
    f.payload = { start: 0, isLastPage: true, values: [{ ...record(), title: '[피싱](https://evil.invalid) <script>' }] };
    const catalog = await f.service.catalog(owner); const snapshot = await f.service.query(owner, { repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision });
    const card = repositoryPrCard(snapshot); assert.equal(card.version, '1.6');
    const serialized = JSON.stringify(card); assert.doesNotMatch(serialized, /"url":"https:\/\/evil|Action.Execute|positive|destructive/);
    assert.ok(card.actions.length <= 3); assert.match(serialized, /조회 시점|PR v3/);
    assert.ok(card.body.every(row => row.type !== 'TextBlock' || row.wrap === true));
    assert.throws(() => repositoryPrCard({ ...snapshot, revision: 'f'.repeat(64) }), /revision mismatch/);
    f.payload = { start: 0, isLastPage: true, values: [{ ...record(), links: { self: [{ href: 'https://evil.invalid/forged' }] } }] };
    const unverified = await f.service.query(owner, { repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision });
    const noLink = repositoryPrCard(unverified); assert.equal(noLink.actions.length, 0); assert.match(JSON.stringify(noLink), /웹주소 미검증/);
  } finally { await f.close(); }
});
