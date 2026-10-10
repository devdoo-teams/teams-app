import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createClientBuildStamp, finalizeClientBuildIdentity } from './client-build-identity.mjs';

const teams = `export const app = { initialize: async () => undefined, getContext: async () => ({page:{}}), isInitialized: () => true }; export const authentication = {getAuthToken: async () => 'synthetic-token'};`;
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === '@microsoft/teams-js'
    ? { format: 'module', shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(teams)}` }
    : next(specifier, context);
} });
try {
  const app = await import('../src/client/App.js');
  assert.equal(typeof app.ClientBuildIdentityPanel, 'function', 'the UI must expose its compiled client stamp independently of health');
  const stamp = createClientBuildStamp({ version: '1.0.138', sourceCommit: 'a'.repeat(40), mode: 'core' });
  const metadata = finalizeClientBuildIdentity(stamp, Buffer.from('synthetic bundle'));
  const render = (health?: unknown, loaded = stamp) => renderToStaticMarkup(React.createElement(app.ClientBuildIdentityPanel, { stamp: loaded, health }));
  const initial = render();
  assert.match(initial, /1\.0\.138/u, 'client identity exists before health returns');
  assert.match(initial, new RegExp(stamp.buildFingerprint));
  assert.match(initial, /data-client-runtime-identity="UNVERIFIED"/u);
  const stale = render({ version: '1.0.132', sourceCommit: stamp.sourceCommit, clientBuildIdentity: metadata });
  assert.match(stale, /1\.0\.138/u);
  assert.match(stale, /data-client-runtime-identity="FAIL"/u, 'old server identity is visible without changing client identity');
  const verified = render({ version: '1.0.138', sourceCommit: stamp.sourceCommit, clientBuildIdentity: metadata });
  assert.match(verified, /data-client-runtime-identity="PASS"/u);
  const absent = renderToStaticMarkup(React.createElement(app.ClientBuildIdentityPanel, {
    stamp: undefined, health: { version: '1.0.138', sourceCommit: stamp.sourceCommit, clientBuildIdentity: metadata },
  }));
  assert.match(absent, /data-client-runtime-identity="UNVERIFIED"/u, 'server values cannot fill a missing compiled stamp');
  assert.doesNotMatch(absent, /data-client-build-version="1\.0\.138"/u);
} finally { hooks.deregister(); }
console.log('PASS: displayed compiled client fingerprint is independent from health and preserves missing/mismatch boundaries.');
