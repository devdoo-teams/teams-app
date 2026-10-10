import crypto from 'node:crypto';
import { parseClientBuildStamp } from '../src/shared/independent-release-identity.js';

/** A compile stamp binds source/version/mode; the final byte digest is separate
 * because embedding the final digest in its own bundle is self-referential. */
export function createClientBuildStamp({ version, sourceCommit, mode }) {
  const identity = { schemaVersion: 1, version, sourceCommit, mode };
  const buildFingerprint = crypto.createHash('sha256').update(JSON.stringify(identity), 'utf8').digest('hex');
  const stamp = parseClientBuildStamp({ ...identity, buildFingerprint });
  if (!stamp) throw new Error('INVALID_CLIENT_BUILD_IDENTITY');
  return stamp;
}

export function finalizeClientBuildIdentity(stamp, clientBundle) {
  const valid = parseClientBuildStamp(stamp);
  if (!valid || !Buffer.isBuffer(clientBundle)) throw new Error('INVALID_CLIENT_BUILD_IDENTITY');
  return Object.freeze({ ...valid, clientBundleSha256: crypto.createHash('sha256').update(clientBundle).digest('hex') });
}
