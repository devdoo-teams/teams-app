import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assessResult, canonical, contractDigest, notificationFor, renderNotification } from './contract.mjs';
export function writePacket(document, output, provenance = null) {
  const assessment = assessResult(document); const contract = contractDigest();
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const files = { 'ci-result.json': `${canonical(document)}\n`, 'notification.md': renderNotification(document) };
  if (provenance !== null) files['source-provenance.json'] = `${canonical(provenance)}\n`;
  files['evidence-index.json'] = `${canonical({
    schemaVersion: '1.1.0', contractDigest: contract, evidenceKind: document.evidenceKind,
    identity: document.identity, assessment, notification: notificationFor(document),
    files: Object.entries(files).map(([path, bytes]) => ({ path, sha256: digest(bytes) })),
    producerAuthenticity: 'UNVERIFIED', releaseAdmission: 'UNVERIFIED',
  })}\n`;
  // Render and validate before writing; require a fresh, owner-only directory.
  mkdirSync(output, { mode: 0o700 });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, 'SHA256SUMS'), `${Object.keys(files).sort().map((name) => `${digest(files[name])}  ${name}`).join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  return { status: 'REPORT_WRITTEN', contractDigest: contract, apiConclusion: assessment.apiConclusion, evidenceGate: assessment.evidenceGate, releaseAdmission: 'UNVERIFIED' };
}
