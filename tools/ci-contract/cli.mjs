import { constants, openSync, fstatSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { assessResult, canonical, contractDigest, notificationFor, renderNotification, validateResult } from './lib/contract.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
function options(argv) {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--output-dir' || !argv[1] || !argv[3]) throw new Error('ARGUMENTS');
  return { input: resolve(argv[1]), output: resolve(argv[3]) };
}
function readDocument(path) {
  if (constants.O_NOFOLLOW === undefined || constants.O_NONBLOCK === undefined) throw new Error('UNSUPPORTED_PLATFORM');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('INPUT_BOUNDARY');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, length);
      if (count === 0) break; length += count;
    }
    if (length > MAX_BYTES) throw new Error('INPUT_BOUNDARY');
    const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    if (!validateResult(document).valid) throw new Error('INVALID_CI_RESULT');
    return document;
  } finally { closeSync(fd); }
}
try {
  const paths = options(process.argv.slice(2)); const document = readDocument(paths.input);
  const assessment = assessResult(document); const contract = contractDigest();
  const result = `${canonical(document)}\n`; const report = renderNotification(document);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const index = `${canonical({
    schemaVersion: '1.0.0', contractDigest: contract, evidenceKind: document.evidenceKind,
    identity: document.identity, assessment, notification: notificationFor(document),
    files: [{ path: 'ci-result.json', sha256: digest(result) }, { path: 'notification.md', sha256: digest(report) }],
    producerAuthenticity: 'UNVERIFIED', releaseAdmission: 'UNVERIFIED',
  })}\n`;
  const files = { 'ci-result.json': result, 'notification.md': report, 'evidence-index.json': index };
  // Validate and render everything before the first write. Never reuse/overwrite a destination.
  mkdirSync(paths.output, { mode: 0o700 });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(paths.output, name), content, { flag: 'wx', mode: 0o600 });
  const sums = `${Object.keys(files).sort().map((name) => `${digest(files[name])}  ${name}`).join('\n')}\n`;
  writeFileSync(join(paths.output, 'SHA256SUMS'), sums, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'REPORT_WRITTEN', contractDigest: contract,
    apiConclusion: assessment.apiConclusion, evidenceGate: assessment.evidenceGate, releaseAdmission: 'UNVERIFIED' }));
} catch {
  // Input may be hostile or contain private values; emit a fixed diagnostic.
  console.error('CI_CONTRACT_INPUT_OR_OUTPUT_REJECTED'); process.exitCode = 2;
}
