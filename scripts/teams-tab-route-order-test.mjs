import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/server/index.ts'), 'utf8');

const explicitRoute = source.indexOf("http.get('/tabs/home'");
const sdkTabRegistration = source.indexOf("teamsApp.tab('home'");
const staticRoute = source.indexOf("http.use('/tabs/home', express.static(clientDist))");

assert.notEqual(explicitRoute, -1, 'the server must register an explicit personal-tab route');
assert.notEqual(sdkTabRegistration, -1, 'the Teams SDK tab registration must remain present');
assert.ok(
  explicitRoute < sdkTabRegistration,
  'the explicit /tabs/home route must be registered before ExpressAdapter.tab() so it owns the 308 redirect',
);
assert.notEqual(staticRoute, -1, 'the canonical trailing-slash static tab route must remain present');
assert.ok(
  sdkTabRegistration < staticRoute,
  'the SDK tab registration must remain before the canonical static route',
);
assert.equal(
  source.match(/http\.get\('\/tabs\/home'/g)?.length,
  1,
  'the no-slash route must have one authoritative registration',
);

console.log('Teams tab route order: PASS');
