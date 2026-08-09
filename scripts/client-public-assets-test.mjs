import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'dist', 'client');
const indexPath = path.join(clientDir, 'index.html');
const indexHtml = await fs.readFile(indexPath, 'utf8');

const csp = indexHtml.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/>/i)?.[1];
assert.ok(csp, 'the public client document declares a CSP meta policy');
assert.match(csp, /default-src 'self'/, 'CSP keeps the default resource origin-bound');
assert.match(csp, /script-src 'self'/, 'CSP allows only bundled scripts');
assert.match(csp, /connect-src 'self' https:\/\/res\.cdn\.office\.net/, 'CSP allows the TeamsJS valid-origin lookup');
assert.match(csp, /object-src 'none'/, 'CSP disables plugin content');

const scriptSource = indexHtml.match(/<script\s+type="module"\s+src="([^"]+)"\s*><\/script>/i)?.[1];
assert.ok(scriptSource, 'the public client document declares one module entry point');
assert.match(scriptSource, /^\.\/assets\/main\.js\?v=[a-f0-9]{12}$/, 'the module entry point is a relative hashed asset URL');
assert.doesNotMatch(scriptSource, /^\//, 'the public module entry point is not root-relative');

const stylesheetSource = indexHtml.match(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/>/i)?.[1];
assert.equal(stylesheetSource, './assets/main.css', 'the public stylesheet uses a relative asset URL');

const contentTypeFor = (filePath) => filePath.endsWith('.html')
  ? 'text/html; charset=utf-8'
  : filePath.endsWith('.css')
    ? 'text/css; charset=utf-8'
    : 'text/javascript; charset=utf-8';

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const relativePath = requestUrl.pathname === '/tabs/home/'
    ? 'index.html'
    : requestUrl.pathname.replace(/^\/tabs\/home\//, '');
  const filePath = path.resolve(clientDir, relativePath);
  if (!filePath.startsWith(`${clientDir}${path.sep}`) && filePath !== indexPath) {
    response.writeHead(404).end();
    return;
  }

  try {
    const bytes = await fs.readFile(filePath);
    response.writeHead(200, { 'content-type': contentTypeFor(filePath) });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object', 'the asset fixture server bound to a local port');
const origin = `http://127.0.0.1:${address.port}`;

try {
  const documentResponse = await fetch(`${origin}/tabs/home/`);
  assert.equal(documentResponse.status, 200, 'the public tab route returns the client document');
  assert.match(documentResponse.headers.get('content-type') ?? '', /text\/html/i);
  assert.equal(new URL(documentResponse.url).pathname, '/tabs/home/', 'the public tab route does not redirect');

  const publicScriptUrl = new URL(scriptSource, documentResponse.url);
  assert.equal(publicScriptUrl.pathname, '/tabs/home/assets/main.js', 'the module resolves under the public tab prefix');
  const scriptResponse = await fetch(publicScriptUrl);
  assert.equal(scriptResponse.status, 200, 'the public tab module asset returns HTTP 200');
  assert.match(scriptResponse.headers.get('content-type') ?? '', /javascript/i);
  assert.ok((await scriptResponse.arrayBuffer()).byteLength > 0, 'the public tab module asset is non-empty');

  const stylesheetResponse = await fetch(new URL(stylesheetSource, documentResponse.url));
  assert.equal(stylesheetResponse.status, 200, 'the public tab stylesheet returns HTTP 200');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log('Public client document and asset loading tests passed without browser automation.');
