import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const [receiptPath, directory] = process.argv.slice(2);
assert.ok(receiptPath && directory && path.isAbsolute(receiptPath) && path.isAbsolute(directory),
  'Usage: work-output-pty-preview.ts /retained/native-receipt.json /private/preview-directory');
const root = fileURLToPath(new URL('../', import.meta.url));
const retained = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
assert.equal(retained.result, 'PASS'); assert.equal(retained.nativeSpawnCount, 1); assert.equal(retained.modelCalls, 0);
const snapshots = ['running-pending', 'reconnected', 'exited'].map(name => retained.snapshots.find((entry: { name: string }) => entry.name === name)?.native);
assert.ok(snapshots.every(snapshot => snapshot?.source === 'pty' && snapshot.outputMode === 'redacted-lines'));
// Discovery contains only identity, never snapshot bytes, scope claims or credentials.
const first = snapshots[0];
const jobs = [{ id: first.jobId, status: 'running', prompt: '합성 Core 기록 · PTY 가짜 완료와 독립적인 작업', mode: 'read-only', provider: 'codex',
  progress: ['Core에서 저장된 진행 기록'], result: 'CORE_SAVED_RESULT · 저장된 결과 유지', createdAt: '2026-10-14T00:00:00Z' },
  { id: 'task-no-pty-session', status: 'completed', prompt: '기존 PTY 세션이 없는 합성 작업', mode: 'read-only', provider: 'codex',
    progress: [], result: 'NO_SESSION_CORE_RESULT', createdAt: '2026-10-14T00:00:00Z' }];
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
const payload = JSON.stringify({ sourceCommit, nativeSourceCommit: retained.sourceCommit, jobs, snapshots });
assert.doesNotMatch(payload, /synthetic-private-value|synthetic-final|U1lOVEhFVElD/);
const result = await build({ absWorkingDir: root, entryPoints: [path.join(root, 'scripts/fixtures/work-output-pty-preview.tsx')],
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', minify: true, metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' } });
assert.ok(!Object.keys(result.metafile!.inputs).some(name => /src\/server\//u.test(name)));
const nonce = randomBytes(18).toString('base64');
const escaped = payload.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const style = await fs.readFile(path.join(root, 'src/client/work-output-monitor.css'), 'utf8');
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>업무 허브 첫 슬롯 · 격리 통합 시험</title><style>body{margin:0;background:#f7f8fc;color:#182033;font:15px/1.5 system-ui,sans-serif}button,select{font:inherit;min-height:36px}button{padding:6px 10px}code{overflow-wrap:anywhere}.panel-description{font-size:.9em}${style}</style></head>
<body><div id="root"></div><script type="application/json" id="captured-native" nonce="${nonce}">${escaped}</script>
<script nonce="${nonce}">${result.outputFiles[0]!.text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
await fs.writeFile(path.join(directory, 'index.html'), html, { mode: 0o600 });
const sourcePaths = ['src/client/WorkOutputMonitor.tsx', 'src/client/WorkOutputPtyObservation.tsx', 'src/client/work-output-pty.ts',
  'src/client/OrchestrationPanel.tsx', 'src/client/work-output-monitor.css', 'scripts/fixtures/work-output-pty-preview.tsx'];
const receipt = { generatedAt: new Date().toISOString(), file: path.join(directory, 'index.html'), sourceCommit,
  nativeReceiptPath: receiptPath, nativeReceiptSha256: createHash('sha256').update(await fs.readFile(receiptPath)).digest('hex'), nativeSourceCommit: retained.sourceCommit,
  htmlSha256: createHash('sha256').update(html).digest('hex'), sourceSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async name =>
    [name, createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex')]))),
  nativeSpawnsThisRun: 0, cliOrModelCalls: 0, publicTransport: false, liveBrowserNativeBridge: false };
await fs.writeFile(path.join(directory, 'fixture-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ file: receipt.file, sourceCommit, nativeSourceCommit: retained.sourceCommit, nativeSpawnsThisRun: 0 }));
