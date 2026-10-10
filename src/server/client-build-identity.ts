import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseClientBuildStamp, type ClientBuildIdentity } from '../shared/independent-release-identity.js';

export function readClientBuildIdentity(root: string, expected: { version: string; sourceCommit: string }): ClientBuildIdentity | undefined {
  try {
    const metadata = JSON.parse(readFileSync(path.join(root, 'client/build-identity.json'), 'utf8'));
    const stamp = parseClientBuildStamp(metadata);
    if (!stamp || stamp.version !== expected.version || stamp.sourceCommit !== expected.sourceCommit
      || typeof metadata.clientBundleSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(metadata.clientBundleSha256)) return undefined;
    const fingerprint = createHash('sha256').update(JSON.stringify({ schemaVersion: 1,
      version: stamp.version, sourceCommit: stamp.sourceCommit, mode: stamp.mode })).digest('hex');
    const actual = createHash('sha256').update(readFileSync(path.join(root, 'client/assets/main.js'))).digest('hex');
    if (stamp.buildFingerprint !== fingerprint || actual !== metadata.clientBundleSha256) return undefined;
    return { ...stamp, clientBundleSha256: actual };
  } catch { return undefined; }
}
