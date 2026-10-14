import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { connectNodePtyReadProcess } from '../src/server/node-pty-read-process.js';
import { PtyReadSessionRegistry } from '../src/server/pty-read-session.js';
import { createPtyReadTestContext } from './fixtures/pty-read-test-context.js';
import { SyntheticPtyReadSource } from './fixtures/synthetic-pty-read-source.js';

// No HTTP listener or .env load. A new owned temporary directory is always used.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-pty-preview-'));
const root = fileURLToPath(new URL('../', import.meta.url));
const context = await createPtyReadTestContext();
const registry = new PtyReadSessionRegistry({ jobs: context.jobs });
try {
  const source = new SyntheticPtyReadSource();
  const identity = registry.register(context.scope, context.jobId, connectNodePtyReadProcess(source));
  source.emit('한글 합성 출력 😀 · 줄 바꿈과 재접속 확인\ntoken=synthetic-');
  source.emit('private-value\n\x1b]52;c;c2VjcmV0\x07\n');
  source.emit('<img src=x onerror="window.fixtureCompromised=true">\n</script><script>window.fixtureCompromised=true</script>\n');
  for (let index = 1; index <= 80; index++) source.emit(`이력-${String(index).padStart(3, '0')} 한글과 emoji 😀 · ${'긴 합성 작업 출력 '.repeat(5)}\n`);
  const first = registry.read(context.scope, identity);
  source.emit('복원-새줄-081 · 같은 세션에서 이어진 합성 출력\n');
  const second = registry.read(context.scope, identity);
  source.emit('최종 합성 출력 password=synthetic-final'); source.exit(7);
  const third = registry.read(context.scope, identity);
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10_000 }).trim();
  const worktree = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', timeout: 10_000 }).trim() ? 'dirty' : 'clean';
  const data = JSON.stringify({ sourceCommit, worktree, snapshots: [first, second, third] });
  assert.doesNotMatch(data, /synthetic-private-value|synthetic-final|c2VjcmV0|\u001b/);
  assert.match(data, /token=\[REDACTED\]/);
  const result = await build({ entryPoints: [path.join(root, 'scripts/fixtures/pty-output-view-preview.tsx')],
    absWorkingDir: root, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, sourcemap: false, minify: true, metafile: true });
  const bundle = result.outputFiles[0]!.text;
  assert.equal(Object.keys(result.metafile!.inputs).some(name => /src\/server\//.test(name)), false,
    'the browser bundle must contain no server/credential/process implementation');
  const nonce = randomBytes(18).toString('base64');
  const escapeScript = (value: string) => value.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>합성 PTY 출력 보기 · 격리 시험</title><style>body{margin:0;background:#f7f8fc;font-family:system-ui,sans-serif}button{font:inherit;min-height:36px;padding:6px 10px}button:focus-visible,pre:focus-visible{outline:3px solid #4355d9;outline-offset:2px}</style></head>
<body><div id="root"></div><script type="application/json" id="synthetic-fixture" nonce="${nonce}">${escapeScript(data)}</script>
<script nonce="${nonce}">${bundle.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  const file = path.join(directory, 'index.html');
  await fs.writeFile(file, html, { mode: 0o600 });
  const sourceSha256: Record<string, string> = {};
  for (const name of ['src/client/PtyOutputView.tsx', 'src/client/pty-output-reader.ts', 'src/shared/pty-read.ts',
    'src/server/pty-read-session.ts', 'src/server/pty-output-lines.ts', 'scripts/fixtures/pty-read-test-context.ts',
    'scripts/fixtures/synthetic-pty-read-source.ts', 'scripts/fixtures/pty-output-view-preview.tsx', 'scripts/pty-output-preview-fixture.ts']) {
    sourceSha256[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
  }
  const receipt = { generatedAt: new Date().toISOString(), sourceCommit, worktree, sourceSha256, fixture: 'synthetic-registry-masked-lines',
    file, url: new URL(`file://${file}`).href, htmlSha256: createHash('sha256').update(html).digest('hex'),
    snapshotsSha256: createHash('sha256').update(data).digest('hex'), browserInputs: Object.keys(result.metafile!.inputs),
    snapshotCount: 3, firstCursor: first.nextCursor, secondCursor: second.nextCursor, finalCursor: third.nextCursor,
    ptyProcessLaunches: 0, exposedCapabilities: ['read-synthetic-snapshot'], sourceTerminationRequests: source.kills,
    limits: ['No real PTY/job process in this preview; Git provenance and the browser runner use their own inspection processes', 'No HTTP listener, credentials, operating jobs or network connection',
      'Display resize only; no native PTY resize', 'Headless pixels and foreground/native Teams acceptance are separate'] };
  await fs.writeFile(path.join(directory, 'fixture-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ directory, file, receipt: path.join(directory, 'fixture-receipt.json'), sourceCommit }));
} finally { registry.dispose(); await context.cleanup(); }
