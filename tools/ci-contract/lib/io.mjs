import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
function openRegular(path, maxBytes) {
  if (constants.O_NOFOLLOW === undefined || constants.O_NONBLOCK === undefined) throw new Error('UNSUPPORTED_PLATFORM');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('INPUT_BOUNDARY');
    return { fd, stat };
  } catch (error) { closeSync(fd); throw error; }
}
function unchanged(fd, before, bytes) {
  const after = fstatSync(fd);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes !== before.size) throw new Error('SOURCE_CHANGED_DURING_READ');
}
export function readJsonFile(path, maxBytes = MAX_JSON_BYTES) {
  const { fd, stat } = openRegular(path, maxBytes);
  try {
    const buffer = Buffer.alloc(maxBytes + 1); let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length);
      if (count === 0) break; length += count;
    }
    if (length > maxBytes) throw new Error('INPUT_BOUNDARY');
    unchanged(fd, stat, length);
    const bytes = buffer.subarray(0, length);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return { value, bytes: length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { closeSync(fd); }
}
export function hashRegularFile(path, maxBytes = 64 * 1024 * 1024) {
  const { fd, stat } = openRegular(path, maxBytes);
  try {
    const hash = createHash('sha256'); const buffer = Buffer.alloc(65536); let length = 0;
    while (true) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes + 1 - length), length);
      if (count === 0) break; length += count;
      if (length > maxBytes) throw new Error('INPUT_BOUNDARY'); hash.update(buffer.subarray(0, count));
    }
    unchanged(fd, stat, length); return { bytes: length, sha256: hash.digest('hex') };
  } finally { closeSync(fd); }
}
