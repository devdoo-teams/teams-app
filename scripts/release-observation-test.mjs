import assert from 'node:assert/strict';
import { validateBrowserAttestation } from './release-update.mjs';
import * as release from './release-update.mjs';

const state = { runId: 'fixture', version: '1.0.104', package: { sha256: 'a'.repeat(64), manifest: { appId: 'app' } } };
const installed = {
  runId: 'fixture', surface: 'installed', appId: 'app', version: '1.0.104',
  packageSha256: 'a'.repeat(64), observedAt: '2026-10-06T12:00:00Z',
  titleBefore: 'About', titleAfter: 'About', observedAction: 'read About', observedResult: '1.0.103',
  tabId: 'p6', urlBefore: 'https://teams.cloud.microsoft/', urlAfter: 'https://teams.cloud.microsoft/',
  installedVersion: '1.0.103',
};
assert.throws(() => validateBrowserAttestation(installed, state, 'installed', new Date('2026-10-06T13:00:00Z')), /installed version/);
console.log('PASS: catalog version cannot substitute for personal installed version');
assert.equal(typeof release.validateReleaseObservations, 'function', 'release must validate independent observed boundaries');
const identity = { tenantId: 'tenant', catalogId: 'catalog', appId: 'app', version: '1.0.104', sourceCommit: 'b'.repeat(40), packageSha256: 'a'.repeat(64), serverBundleSha256: 'c'.repeat(64), publicOrigin: 'https://example.devtunnels.ms', assetSha256: 'd'.repeat(64) };
const observation = (source) => ({ source, observedAt: '2026-10-06T12:00:00Z', identity: { ...identity }, result: 'PASS' });
const evidence = {
  portal: observation('admin-center-ui'),
  personalInstall: { ...observation('teams-about-ui'), installedVersion: '1.0.104' },
  runtime: { ...observation('live-health'), expiresAt: '2026-10-06T13:15:00Z', health: { auth: 'teams-authenticated', bot: 'teams-sdk', outbound: 'teams-sdk', version: identity.version, sourceCommit: identity.sourceCommit, serverBundleSha256: identity.serverBundleSha256 } },
  desktop: { ...observation('native-teams'), applicationId: 'com.microsoft.teams2', rows: ['delegate-message', 'dialog', 'personal-job', 'detail-deep-link'].map(id => ({ id, result: 'PASS', screenshotBefore: 'before.png', screenshotAfter: 'after.png', accessibilityEvidence: 'ax.txt', runtimeEvidence: 'runtime.json' })) },
};
const now = new Date('2026-10-06T13:00:00Z');
assert.equal(release.validateReleaseObservations(evidence, identity, now), true);
for (const mutate of [
  e => { e.personalInstall.installedVersion = '1.0.103'; },
  e => { e.personalInstall.source = 'indexeddb-cache'; },
  e => { delete e.runtime; },
  e => { e.portal.identity.tenantId = 'other'; },
  e => { e.desktop.identity.sourceCommit = 'f'.repeat(40); },
  e => { e.desktop.rows = []; },
  e => { e.runtime.expiresAt = '2026-10-06T12:30:00Z'; },
  e => { e.portal.source = 'fixture'; },
  e => { e.runtime.health.sourceCommit = 'f'.repeat(40); },
  e => { e.runtime.health.version = '1.0.103'; },
]) {
  const changed = structuredClone(evidence); mutate(changed);
  assert.throws(() => release.validateReleaseObservations(changed, identity, now));
}
assert.equal(typeof release.canContinueTunnelNotice, 'function');
const notice = { kind: 'service-html', origin: identity.publicOrigin, text: 'You are about to connect to a dev tunnel. Continue only if you trust the sender.' };
assert.equal(release.canContinueTunnelNotice(notice, identity.publicOrigin, () => true), true);
assert.equal(release.canContinueTunnelNotice(notice, identity.publicOrigin), false);
assert.equal(release.canContinueTunnelNotice({ ...notice, kind: 'browser-tls' }, identity.publicOrigin, () => true), false);
assert.equal(release.canContinueTunnelNotice({ ...notice, text: 'Unknown warning' }, identity.publicOrigin, () => true), false);
assert.equal(release.canContinueTunnelNotice({ ...notice, origin: 'https://other.example' }, identity.publicOrigin, () => true), false);
console.log('PASS: distinct current boundaries, desktop flow and current notice authorization');
