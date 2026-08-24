import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const NPM_CI_ARGS = Object.freeze([
  'ci',
  '--omit=dev',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
]);
const RUNTIME_CLOSURE_SCHEMA = 'teams-runtime-closure/v1';
const EMPTY_SHA256 = crypto.createHash('sha256').digest('hex');
const FILE_READ_CHUNK_BYTES = 64 * 1_024;
const MAX_PINNED_INPUT_BYTES = 16 * 1_024 * 1_024;
const MAX_PINNED_INPUT_TOTAL_BYTES = 32 * 1_024 * 1_024;

function requireAbsolutePath(value, name) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    throw new TypeError(`${name} must be an explicitly supplied absolute path`);
  }
  return path.resolve(value);
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isNativeAddonPath(canonicalPath) {
  return canonicalPath.toLowerCase().endsWith('.node');
}

function normalizeLimits(limits) {
  const normalized = {
    maxEntries: limits?.maxEntries,
    maxFileBytes: limits?.maxFileBytes,
    maxTotalBytes: limits?.maxTotalBytes,
    maxPathBytes: limits?.maxPathBytes,
  };
  for (const [name, value] of Object.entries(normalized)) {
    if (!Number.isSafeInteger(value) || value < 0 || (name !== 'maxTotalBytes' && value === 0)) {
      throw new TypeError(`limits.${name} must be a finite safe integer bound`);
    }
  }
  return normalized;
}

function normalizeApprovedNativeAddons(values) {
  if (!Array.isArray(values)) {
    throw new TypeError('approvedNativeAddons must be an array of canonical relative paths');
  }
  const normalized = values.map((value) => {
    if (typeof value !== 'string' || value.length === 0 || path.posix.isAbsolute(value)) {
      throw new TypeError('approvedNativeAddons entries must be canonical relative paths');
    }
    const canonical = path.posix.normalize(value.replaceAll('\\', '/'));
    if (
      canonical !== value
      || canonical === '..'
      || canonical.startsWith('../')
      || !isNativeAddonPath(canonical)
    ) {
      throw new TypeError(`Invalid approved native addon path: ${value}`);
    }
    return canonical;
  });
  normalized.sort(compareUtf8);
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('approvedNativeAddons must not contain duplicates');
  }
  return normalized;
}

function limitError(message) {
  const error = new Error(`RUNTIME_CLOSURE_LIMIT_EXCEEDED: ${message}`);
  error.code = 'RUNTIME_CLOSURE_LIMIT_EXCEEDED';
  return error;
}

function policyError(message, details = {}) {
  const error = new Error(`RUNTIME_CLOSURE_POLICY_VIOLATION: ${message}`);
  error.code = 'RUNTIME_CLOSURE_POLICY_VIOLATION';
  Object.assign(error, details);
  return error;
}

function attestationError(message) {
  const error = new Error(`RUNTIME_CLOSURE_ATTESTATION_INVALID: ${message}`);
  error.code = 'RUNTIME_CLOSURE_ATTESTATION_INVALID';
  return error;
}

function policyMismatchError(message) {
  const error = new Error(`RUNTIME_CLOSURE_POLICY_MISMATCH: ${message}`);
  error.code = 'RUNTIME_CLOSURE_POLICY_MISMATCH';
  return error;
}

function unstableClosureError(message, cause) {
  const error = new Error(`RUNTIME_CLOSURE_UNSTABLE: ${message}`, { cause });
  error.code = 'RUNTIME_CLOSURE_UNSTABLE';
  return error;
}

function specialFileType(metadata) {
  if (metadata.isFIFO()) return 'fifo';
  if (metadata.isSocket()) return 'socket';
  if (metadata.isBlockDevice()) return 'block-device';
  if (metadata.isCharacterDevice()) return 'character-device';
  return 'unknown';
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameDirectoryObjectIdentity(left, right) {
  // Populating the empty staging directory necessarily changes its mtime and
  // ctime. Before taking the final immutable snapshot, only its object
  // identity and mode can be compared without rejecting the staging copy
  // itself.
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode;
}

function canonicalMetadata(metadata, type) {
  if (
    typeof metadata.mode !== 'bigint'
    || typeof metadata.mtimeNs !== 'bigint'
    || typeof metadata.ctimeNs !== 'bigint'
    || typeof metadata.dev !== 'bigint'
    || typeof metadata.ino !== 'bigint'
  ) {
    throw unstableClosureError(`filesystem metadata is not bigint-capable for ${type}`);
  }
  // A closure is an attestation of one installed runtime tree, rather than a
  // reproducible package archive. Node exposes these values as BigInts; encode
  // them as canonical base-10 strings so JSON is deterministic across hosts
  // without truncating nanoseconds or identity. We intentionally normalize
  // away atime, birthtime, ownership, blocks, and link count: npm ci does not
  // promise those incidental values for a fresh staging tree. nlink remains a
  // live TOCTOU/policy observation for native-addon alias rejection.
  return {
    type,
    mode: Number(metadata.mode & 0o7777n),
    mtimeNs: metadata.mtimeNs.toString(10),
    ctimeNs: metadata.ctimeNs.toString(10),
    dev: metadata.dev.toString(10),
    ino: metadata.ino.toString(10),
  };
}

function entryIdentity({ path: relativePath, type, bytes, contentSha256, metadata }) {
  return sha256(JSON.stringify([relativePath, type, bytes, contentSha256, metadata]));
}

async function lstatOrUnstable(absolutePath, canonicalPath, action) {
  try {
    return await fs.lstat(absolutePath, { bigint: true });
  } catch (error) {
    throw unstableClosureError(`${action}: ${canonicalPath}`, error);
  }
}

async function requireRealDirectory(directoryPath, label) {
  const before = await lstatOrUnstable(directoryPath, directoryPath, `${label} could not be identified`);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${directoryPath}`);
  }

  let realPath;
  try {
    realPath = await fs.realpath(directoryPath);
  } catch (error) {
    throw unstableClosureError(`${label} could not be resolved: ${directoryPath}`, error);
  }
  const after = await lstatOrUnstable(directoryPath, directoryPath, `${label} changed while resolving`);
  const resolvedMetadata = await lstatOrUnstable(realPath, realPath, `${label} resolved path disappeared`);
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || !resolvedMetadata.isDirectory()
    || !sameFileIdentity(before, after)
    || !sameFileIdentity(before, resolvedMetadata)
  ) {
    throw unstableClosureError(`${label} changed or was replaced while resolving: ${directoryPath}`);
  }
  return { realPath, identity: after };
}

async function readDirectoryNamesBounded(absolutePath, remainingEntries, canonicalPath) {
  let directory;
  try {
    directory = await fs.opendir(absolutePath);
  } catch (error) {
    throw unstableClosureError(`directory could not be opened for enumeration: ${canonicalPath}`, error);
  }

  const names = [];
  try {
    for await (const entry of directory) {
      names.push(entry.name);
      if (names.length > remainingEntries) {
        throw limitError(`entry count exceeds maxEntries below ${canonicalPath}`);
      }
    }
  } catch (error) {
    if (error?.code === 'RUNTIME_CLOSURE_LIMIT_EXCEEDED') throw error;
    throw unstableClosureError(`directory enumeration failed: ${canonicalPath}`, error);
  } finally {
    await directory.close().catch((error) => {
      if (error?.code !== 'ERR_DIR_CLOSED') throw error;
    });
  }
  names.sort(compareUtf8);
  return names;
}

async function snapshotDirectory({
  absolutePath,
  expectedIdentity,
  remainingEntries,
  canonicalPath,
}) {
  const before = await lstatOrUnstable(
    absolutePath,
    canonicalPath,
    'directory could not be identified before enumeration',
  );
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw unstableClosureError(`directory was replaced before enumeration: ${canonicalPath}`);
  }
  if (expectedIdentity && !sameFileIdentity(expectedIdentity, before)) {
    throw unstableClosureError(`directory changed before enumeration: ${canonicalPath}`);
  }

  const names = await readDirectoryNamesBounded(absolutePath, remainingEntries, canonicalPath);
  const after = await lstatOrUnstable(
    absolutePath,
    canonicalPath,
    'directory disappeared after enumeration',
  );
  if (!after.isDirectory() || after.isSymbolicLink() || !sameFileIdentity(before, after)) {
    throw unstableClosureError(`directory changed or was replaced during enumeration: ${canonicalPath}`);
  }
  return { names, identity: after };
}

function sameNames(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

async function verifyDirectorySnapshot({
  absolutePath,
  expectedIdentity,
  expectedNames,
  maxEntries,
  canonicalPath,
}) {
  const finalSnapshot = await snapshotDirectory({
    absolutePath,
    expectedIdentity,
    remainingEntries: maxEntries,
    canonicalPath,
  });
  if (
    !sameFileIdentity(expectedIdentity, finalSnapshot.identity)
    || !sameNames(expectedNames, finalSnapshot.names)
  ) {
    throw unstableClosureError(`directory changed during traversal: ${canonicalPath}`);
  }
  return finalSnapshot;
}

async function assertDirectoryPathStillStable(absolutePath, expectedIdentity, canonicalPath) {
  const current = await lstatOrUnstable(
    absolutePath,
    canonicalPath,
    'directory disappeared after traversal',
  );
  if (
    current.isSymbolicLink()
    || !current.isDirectory()
    || !sameFileIdentity(expectedIdentity, current)
  ) {
    throw unstableClosureError(`directory changed or was replaced during traversal: ${canonicalPath}`);
  }
}

function nextReadLength(bufferBytes, maximumBytes, consumedBytes) {
  const remaining = maximumBytes - consumedBytes;
  return remaining >= bufferBytes ? bufferBytes : remaining + 1;
}

async function hashRegularFileBounded({
  absolutePath,
  canonicalPath,
  expectedIdentity,
  maxFileBytes,
  maxTotalBytes,
  totalBytes,
}) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw policyError('O_NOFOLLOW is required to hash runtime files safely');
  }

  let handle;
  try {
    handle = await fs.open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    throw unstableClosureError(`could not open regular file without following links: ${canonicalPath}`, error);
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw unstableClosureError(`entry stopped being a regular file before hashing: ${canonicalPath}`);
    }
    if (expectedIdentity && !sameFileIdentity(expectedIdentity, before)) {
      throw unstableClosureError(`regular file was replaced before hashing: ${canonicalPath}`);
    }
    if (before.size > BigInt(maxFileBytes)) {
      throw limitError(`file exceeds maxFileBytes: ${canonicalPath}`);
    }
    if (BigInt(totalBytes) + before.size > BigInt(maxTotalBytes)) {
      throw limitError(`closure exceeds maxTotalBytes at ${canonicalPath}`);
    }

    const contentHash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(FILE_READ_CHUNK_BYTES);
    let bytes = 0;
    let position = 0;
    while (true) {
      const nextReadBytes = Math.min(
        buffer.byteLength,
        nextReadLength(buffer.byteLength, maxFileBytes, bytes),
        nextReadLength(buffer.byteLength, maxTotalBytes - totalBytes, bytes),
      );
      const { bytesRead } = await handle.read(buffer, 0, nextReadBytes, position);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      position += bytesRead;
      if (bytes > maxFileBytes) {
        throw limitError(`file exceeds maxFileBytes while reading: ${canonicalPath}`);
      }
      if (totalBytes + bytes > maxTotalBytes) {
        throw limitError(`closure exceeds maxTotalBytes while reading: ${canonicalPath}`);
      }
      contentHash.update(buffer.subarray(0, bytesRead));
    }

    const after = await handle.stat({ bigint: true });
    if (!sameFileIdentity(before, after) || BigInt(bytes) !== before.size) {
      throw unstableClosureError(`regular file changed while hashing: ${canonicalPath}`);
    }
    return {
      bytes,
      contentSha256: contentHash.digest('hex'),
      identity: after,
    };
  } finally {
    await handle.close();
  }
}

async function readHandleDigestBounded(handle, maximumBytes, label) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(FILE_READ_CHUNK_BYTES);
  let bytes = 0;
  let position = 0;
  while (true) {
    const nextReadBytes = Math.min(
      buffer.byteLength,
      nextReadLength(buffer.byteLength, maximumBytes, bytes),
    );
    const { bytesRead } = await handle.read(buffer, 0, nextReadBytes, position);
    if (bytesRead === 0) break;
    bytes += bytesRead;
    position += bytesRead;
    if (bytes > maximumBytes) {
      throw limitError(`${label} exceeds ${maximumBytes} bytes`);
    }
    hash.update(buffer.subarray(0, bytesRead));
  }
  return { bytes, contentSha256: hash.digest('hex') };
}

async function copyHandleBounded(sourceHandle, destinationHandle, source, destination) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(FILE_READ_CHUNK_BYTES);
  let bytes = 0;
  let sourcePosition = 0;
  let destinationPosition = 0;
  while (true) {
    const nextReadBytes = Math.min(
      buffer.byteLength,
      nextReadLength(buffer.byteLength, MAX_PINNED_INPUT_BYTES, bytes),
    );
    const { bytesRead } = await sourceHandle.read(buffer, 0, nextReadBytes, sourcePosition);
    if (bytesRead === 0) break;
    bytes += bytesRead;
    sourcePosition += bytesRead;
    if (bytes > MAX_PINNED_INPUT_BYTES) {
      throw limitError(`pinned runtime input exceeds ${MAX_PINNED_INPUT_BYTES} bytes: ${source}`);
    }
    hash.update(buffer.subarray(0, bytesRead));

    let written = 0;
    while (written < bytesRead) {
      const { bytesWritten } = await destinationHandle.write(
        buffer,
        written,
        bytesRead - written,
        destinationPosition + written,
      );
      if (bytesWritten === 0) {
        throw unstableClosureError(`staging input destination stopped accepting bytes: ${destination}`);
      }
      written += bytesWritten;
    }
    destinationPosition += bytesRead;
  }
  return { bytes, contentSha256: hash.digest('hex') };
}

async function stagePinnedInput({
  source,
  destination,
  relativePath,
  sourceRealRoot,
  stagingRealRoot,
}) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw policyError('O_NOFOLLOW is required to stage pinned runtime inputs safely');
  }

  let sourceHandle;
  let destinationHandle;
  let destinationReadHandle;
  try {
    const sourcePathBefore = await lstatOrUnstable(source, relativePath, 'staging input disappeared');
    if (!sourcePathBefore.isFile() || sourcePathBefore.isSymbolicLink()) {
      throw unstableClosureError(`staging input is not a regular file: ${source}`);
    }

    sourceHandle = await fs.open(source, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const sourceBefore = await sourceHandle.stat({ bigint: true });
    const sourcePathAfterOpen = await lstatOrUnstable(source, relativePath, 'staging input changed while opening');
    const sourceRealPath = await fs.realpath(source);
    const sourcePathAfterResolution = await lstatOrUnstable(
      source,
      relativePath,
      'staging input changed while resolving',
    );
    if (
      !sourceBefore.isFile()
      || !sameFileIdentity(sourcePathBefore, sourceBefore)
      || !sameFileIdentity(sourcePathBefore, sourcePathAfterOpen)
      || !sameFileIdentity(sourcePathBefore, sourcePathAfterResolution)
      || !isPathInside(sourceRealRoot, sourceRealPath)
    ) {
      throw unstableClosureError(`staging input is not one stable owned regular file: ${source}`);
    }
    if (sourceBefore.size > BigInt(MAX_PINNED_INPUT_BYTES)) {
      throw limitError(`pinned runtime input exceeds ${MAX_PINNED_INPUT_BYTES} bytes: ${source}`);
    }

    const destinationParentRealPath = await fs.realpath(path.dirname(destination));
    if (!isPathInside(stagingRealRoot, destinationParentRealPath)) {
      throw unstableClosureError(`runtime dependency destination escapes stagingRoot: ${destination}`);
    }
    destinationHandle = await fs.open(
      destination,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    const destinationOpened = await destinationHandle.stat({ bigint: true });
    const destinationPathOpened = await lstatOrUnstable(
      destination,
      relativePath,
      'staging destination disappeared after opening',
    );
    if (
      !destinationOpened.isFile()
      || !destinationPathOpened.isFile()
      || !sameFileIdentity(destinationOpened, destinationPathOpened)
    ) {
      throw unstableClosureError(`staging input destination is not one regular file: ${destination}`);
    }

    const copied = await copyHandleBounded(sourceHandle, destinationHandle, source, destination);
    await destinationHandle.sync();

    const sourceAfterCopy = await sourceHandle.stat({ bigint: true });
    const sourcePathAfterCopy = await lstatOrUnstable(source, relativePath, 'staging input changed while copying');
    const sourceAfterCopyDigest = await readHandleDigestBounded(
      sourceHandle,
      MAX_PINNED_INPUT_BYTES,
      `pinned runtime input ${source}`,
    );
    const sourceAfterDigest = await sourceHandle.stat({ bigint: true });
    const sourcePathAfterDigest = await lstatOrUnstable(source, relativePath, 'staging input changed while hashing');
    const sourceRealPathAfterDigest = await fs.realpath(source);
    if (
      !sameFileIdentity(sourceBefore, sourceAfterCopy)
      || !sameFileIdentity(sourceBefore, sourceAfterDigest)
      || !sameFileIdentity(sourceBefore, sourcePathAfterCopy)
      || !sameFileIdentity(sourceBefore, sourcePathAfterDigest)
      || sourceRealPathAfterDigest !== sourceRealPath
      || copied.bytes !== sourceAfterCopyDigest.bytes
      || copied.contentSha256 !== sourceAfterCopyDigest.contentSha256
      || BigInt(copied.bytes) !== sourceBefore.size
    ) {
      throw unstableClosureError(`staging input source changed or bytes diverged: ${source}`);
    }

    const destinationBeforeRead = await destinationHandle.stat({ bigint: true });
    if (!destinationBeforeRead.isFile() || destinationBeforeRead.size !== BigInt(copied.bytes)) {
      throw unstableClosureError(`staging input destination has unexpected identity or bytes: ${destination}`);
    }
    await destinationHandle.close();
    destinationHandle = undefined;

    const destinationPathBeforeRead = await lstatOrUnstable(
      destination,
      relativePath,
      'staging destination changed before verification',
    );
    destinationReadHandle = await fs.open(destination, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const destinationOpenedForRead = await destinationReadHandle.stat({ bigint: true });
    const destinationDigest = await readHandleDigestBounded(
      destinationReadHandle,
      MAX_PINNED_INPUT_BYTES,
      `staging destination ${destination}`,
    );
    const destinationAfterRead = await destinationReadHandle.stat({ bigint: true });
    const destinationPathAfterRead = await lstatOrUnstable(
      destination,
      relativePath,
      'staging destination changed while verifying',
    );
    if (
      !sameFileIdentity(destinationBeforeRead, destinationPathBeforeRead)
      || !sameFileIdentity(destinationBeforeRead, destinationOpenedForRead)
      || !sameFileIdentity(destinationBeforeRead, destinationAfterRead)
      || !sameFileIdentity(destinationBeforeRead, destinationPathAfterRead)
      || destinationDigest.bytes !== copied.bytes
      || destinationDigest.contentSha256 !== copied.contentSha256
    ) {
      throw unstableClosureError(`staging input destination bytes or hash changed: ${destination}`);
    }

    return {
      relativePath,
      destination,
      destinationIdentity: destinationAfterRead,
      attestation: {
        path: relativePath,
        bytes: copied.bytes,
        contentSha256: copied.contentSha256,
      },
    };
  } catch (error) {
    if (
      error?.code === 'RUNTIME_CLOSURE_UNSTABLE'
      || error?.code === 'RUNTIME_CLOSURE_LIMIT_EXCEEDED'
      || error?.code === 'RUNTIME_CLOSURE_POLICY_VIOLATION'
    ) {
      throw error;
    }
    throw unstableClosureError(`could not stage pinned runtime input: ${source}`, error);
  } finally {
    await destinationReadHandle?.close().catch(() => {});
    await destinationHandle?.close().catch(() => {});
    await sourceHandle?.close().catch(() => {});
  }
}

async function assertExactStagingNames(stagingRoot, expectedNames) {
  let actualNames;
  try {
    actualNames = await fs.readdir(stagingRoot);
  } catch (error) {
    throw unstableClosureError(`stagingRoot could not be enumerated: ${stagingRoot}`, error);
  }
  actualNames.sort(compareUtf8);
  if (!sameNames(actualNames, expectedNames)) {
    throw unstableClosureError(`stagingRoot changed before npm ci: ${stagingRoot}`);
  }
}

async function verifyStagedInput(stagedInput) {
  const {
    destination,
    destinationIdentity,
    attestation,
  } = stagedInput;
  let handle;
  try {
    const pathBefore = await lstatOrUnstable(
      destination,
      attestation.path,
      'staging destination disappeared before npm ci',
    );
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || !sameFileIdentity(destinationIdentity, pathBefore)) {
      throw unstableClosureError(`staging destination changed before npm ci: ${destination}`);
    }
    handle = await fs.open(destination, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFileIdentity(destinationIdentity, before)) {
      throw unstableClosureError(`staging destination changed while opening before npm ci: ${destination}`);
    }
    const digest = await readHandleDigestBounded(
      handle,
      MAX_PINNED_INPUT_BYTES,
      `staging destination ${destination}`,
    );
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstatOrUnstable(
      destination,
      attestation.path,
      'staging destination changed while hashing before npm ci',
    );
    if (
      !sameFileIdentity(destinationIdentity, after)
      || !sameFileIdentity(destinationIdentity, pathAfter)
      || digest.bytes !== attestation.bytes
      || digest.contentSha256 !== attestation.contentSha256
    ) {
      throw unstableClosureError(`staging destination bytes or identity changed before npm ci: ${destination}`);
    }
  } catch (error) {
    if (error?.code === 'RUNTIME_CLOSURE_UNSTABLE' || error?.code === 'RUNTIME_CLOSURE_LIMIT_EXCEEDED') {
      throw error;
    }
    throw unstableClosureError(`could not verify staging destination before npm ci: ${destination}`, error);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function verifyPinnedStagingBeforeNpmCi({
  stagingRoot,
  stagingRealRoot,
  stagingIdentity,
  stagedInputs,
}) {
  const expectedNames = stagedInputs.map((input) => input.relativePath).sort(compareUtf8);
  const before = await requireRealDirectory(stagingRoot, 'stagingRoot');
  if (before.realPath !== stagingRealRoot || !sameFileIdentity(stagingIdentity, before.identity)) {
    throw unstableClosureError(`stagingRoot changed before npm ci: ${stagingRoot}`);
  }
  await assertExactStagingNames(stagingRoot, expectedNames);
  for (const stagedInput of stagedInputs) {
    await verifyStagedInput(stagedInput);
  }
  const finalSnapshot = await snapshotDirectory({
    absolutePath: stagingRoot,
    expectedIdentity: stagingIdentity,
    // Inspect one more entry than the pinned pair so a newly added file is a
    // deterministic unstable-state failure rather than an unbounded scan.
    remainingEntries: expectedNames.length + 1,
    canonicalPath: 'stagingRoot',
  });
  if (
    !sameFileIdentity(stagingIdentity, finalSnapshot.identity)
    || !sameNames(expectedNames, finalSnapshot.names)
  ) {
    throw unstableClosureError(`stagingRoot changed while verifying npm ci inputs: ${stagingRoot}`);
  }
}

function manifestPayload({ limits, approvedNativeAddons, entries, totals }) {
  return {
    schema: RUNTIME_CLOSURE_SCHEMA,
    algorithm: 'sha256',
    limits,
    approvedNativeAddons,
    entries,
    totals,
  };
}

function assertCanonicalMetadata(metadata, entryType, entryPath) {
  const metadataKeys = ['type', 'mode', 'mtimeNs', 'ctimeNs', 'dev', 'ino'];
  if (
    !metadata
    || typeof metadata !== 'object'
    || Array.isArray(metadata)
    || JSON.stringify(Object.keys(metadata)) !== JSON.stringify(metadataKeys)
  ) {
    throw new Error(`entry metadata is not canonical: ${entryPath}`);
  }
  if (metadata.type !== entryType) {
    throw new Error(`entry metadata type does not match entry type: ${entryPath}`);
  }
  if (!Number.isSafeInteger(metadata.mode) || metadata.mode < 0 || metadata.mode > 0o7777) {
    throw new Error(`entry mode is invalid: ${entryPath}`);
  }
  for (const field of ['mtimeNs', 'ctimeNs']) {
    if (typeof metadata[field] !== 'string' || !/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(metadata[field])) {
      throw new Error(`entry ${field} is invalid: ${entryPath}`);
    }
  }
  for (const field of ['dev', 'ino']) {
    if (typeof metadata[field] !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(metadata[field])) {
      throw new Error(`entry ${field} is invalid: ${entryPath}`);
    }
  }
}

function assertExpectedManifest(expected) {
  try {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
      throw new Error('expected manifest must be an object');
    }
    const expectedKeys = ['schema', 'algorithm', 'limits', 'approvedNativeAddons', 'entries', 'totals', 'sha256'];
    if (JSON.stringify(Object.keys(expected)) !== JSON.stringify(expectedKeys)) {
      throw new Error('manifest fields are not exact and canonical');
    }
    if (expected.schema !== RUNTIME_CLOSURE_SCHEMA || expected.algorithm !== 'sha256') {
      throw new Error('unsupported manifest schema or algorithm');
    }

    const limits = normalizeLimits(expected.limits);
    const approvedNativeAddons = normalizeApprovedNativeAddons(expected.approvedNativeAddons);
    if (JSON.stringify(approvedNativeAddons) !== JSON.stringify(expected.approvedNativeAddons)) {
      throw new Error('approvedNativeAddons are not canonical and sorted');
    }
    if (!Array.isArray(expected.entries) || expected.entries.length > limits.maxEntries) {
      throw new Error('entries must be a bounded array');
    }

    const approvedNativeAddonSet = new Set(approvedNativeAddons);
    const seen = new Set();
    let previousPath;
    let totalBytes = 0;
    let files = 0;
    let directories = 0;
    let symlinks = 0;
    for (const entry of expected.entries) {
      const entryKeys = ['path', 'type', 'bytes', 'contentSha256', 'metadata', 'sha256'];
      if (
        !entry
        || typeof entry !== 'object'
        || Array.isArray(entry)
        || JSON.stringify(Object.keys(entry)) !== JSON.stringify(entryKeys)
      ) {
        throw new Error('entry fields are not exact and canonical');
      }
      if (
        typeof entry.path !== 'string'
        || entry.path.length === 0
        || path.posix.isAbsolute(entry.path)
        || path.posix.normalize(entry.path) !== entry.path
        || entry.path.includes('\\')
        || Buffer.byteLength(entry.path, 'utf8') > limits.maxPathBytes
      ) {
        throw new Error(`entry path is not canonical: ${entry.path}`);
      }
      if (seen.has(entry.path) || (previousPath !== undefined && compareUtf8(previousPath, entry.path) >= 0)) {
        throw new Error(`entries are duplicated or unsorted at: ${entry.path}`);
      }
      seen.add(entry.path);
      previousPath = entry.path;
      if (!['file', 'directory', 'symlink'].includes(entry.type)) {
        throw new Error(`entry type is unsupported: ${entry.path}`);
      }
      if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > limits.maxFileBytes) {
        throw new Error(`entry bytes are invalid: ${entry.path}`);
      }
      if (!/^[0-9a-f]{64}$/.test(entry.contentSha256) || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
        throw new Error(`entry hash is invalid: ${entry.path}`);
      }
      assertCanonicalMetadata(entry.metadata, entry.type, entry.path);
      if (entry.type === 'directory' && (entry.bytes !== 0 || entry.contentSha256 !== EMPTY_SHA256)) {
        throw new Error(`directory content is invalid: ${entry.path}`);
      }
      if (isNativeAddonPath(entry.path) && (!approvedNativeAddonSet.has(entry.path) || entry.type !== 'file')) {
        throw new Error(`native addon manifest entry is not an approved regular file: ${entry.path}`);
      }
      if (entry.sha256 !== entryIdentity(entry)) {
        throw new Error(`entry identity does not match content and metadata: ${entry.path}`);
      }
      totalBytes += entry.bytes;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
        throw new Error(`manifest total bytes exceed bounds at: ${entry.path}`);
      }
      if (entry.type === 'file') files += 1;
      if (entry.type === 'directory') directories += 1;
      if (entry.type === 'symlink') symlinks += 1;
    }

    const totals = {
      entries: expected.entries.length,
      files,
      directories,
      symlinks,
      bytes: totalBytes,
    };
    if (JSON.stringify(totals) !== JSON.stringify(expected.totals)) {
      throw new Error('manifest totals do not match entries');
    }
    const payload = manifestPayload({
      limits,
      approvedNativeAddons,
      entries: expected.entries,
      totals,
    });
    if (expected.sha256 !== sha256(JSON.stringify(payload))) {
      throw new Error('manifest aggregate SHA-256 does not match its payload');
    }
    return { limits, approvedNativeAddons };
  } catch (error) {
    if (error?.code === 'RUNTIME_CLOSURE_ATTESTATION_INVALID') throw error;
    throw attestationError(error instanceof Error ? error.message : String(error));
  }
}

async function readStableSymlinkSnapshot(
  absolutePath,
  canonicalPath,
  afterReadlink,
  afterTargetObserved,
) {
  const beforeLink = await lstatOrUnstable(
    absolutePath,
    canonicalPath,
    'symbolic link disappeared before observation',
  );
  if (!beforeLink.isSymbolicLink()) {
    throw unstableClosureError(`symbolic link was replaced before observation: ${canonicalPath}`);
  }

  let linkTarget;
  let targetRealPath;
  try {
    linkTarget = await fs.readlink(absolutePath);
    await afterReadlink?.({ absolutePath, canonicalPath, linkTarget });
    const linkAfterReadlink = await fs.lstat(absolutePath, { bigint: true });
    if (!linkAfterReadlink.isSymbolicLink() || !sameFileIdentity(beforeLink, linkAfterReadlink)) {
      throw unstableClosureError(`symbolic link changed after readlink: ${canonicalPath}`);
    }
    targetRealPath = await fs.realpath(absolutePath);
  } catch (error) {
    if (error?.code === 'RUNTIME_CLOSURE_UNSTABLE') throw error;
    throw unstableClosureError(`symbolic link changed while being resolved: ${canonicalPath}`, error);
  }
  const linkAfterRealpath = await lstatOrUnstable(
    absolutePath,
    canonicalPath,
    'symbolic link disappeared after realpath',
  );
  if (!linkAfterRealpath.isSymbolicLink() || !sameFileIdentity(beforeLink, linkAfterRealpath)) {
    throw unstableClosureError(`symbolic link changed while resolving its target: ${canonicalPath}`);
  }
  const targetBefore = await lstatOrUnstable(
    targetRealPath,
    canonicalPath,
    'symbolic link target disappeared while being observed',
  );
  const targetAfter = await lstatOrUnstable(
    targetRealPath,
    canonicalPath,
    'symbolic link target changed while being observed',
  );
  await afterTargetObserved?.({
    absolutePath,
    canonicalPath,
    linkTarget,
    targetRealPath,
  });
  let linkTargetAfter;
  let targetRealPathAfter;
  try {
    linkTargetAfter = await fs.readlink(absolutePath);
    targetRealPathAfter = await fs.realpath(absolutePath);
  } catch (error) {
    throw unstableClosureError(`symbolic link changed during final revalidation: ${canonicalPath}`, error);
  }
  const afterLink = await lstatOrUnstable(
    absolutePath,
    canonicalPath,
    'symbolic link disappeared after observation',
  );
  const targetFinal = await lstatOrUnstable(
    targetRealPathAfter,
    canonicalPath,
    'symbolic link target disappeared after final revalidation',
  );
  if (
    !afterLink.isSymbolicLink()
    || !sameFileIdentity(beforeLink, afterLink)
    || !sameFileIdentity(targetBefore, targetAfter)
    || !sameFileIdentity(targetBefore, targetFinal)
    || linkTargetAfter !== linkTarget
    || targetRealPathAfter !== targetRealPath
  ) {
    throw unstableClosureError(`symbolic link or target changed while being observed: ${canonicalPath}`);
  }
  return {
    linkIdentity: afterLink,
    linkTarget,
    targetRealPath,
    targetIdentity: targetAfter,
  };
}

function sameSymlinkSnapshot(left, right) {
  return sameFileIdentity(left.linkIdentity, right.linkIdentity)
    && left.linkTarget === right.linkTarget
    && left.targetRealPath === right.targetRealPath
    && sameFileIdentity(left.targetIdentity, right.targetIdentity);
}

async function observeStableSymlink(absolutePath, canonicalPath, testHooks) {
  const before = await readStableSymlinkSnapshot(
    absolutePath,
    canonicalPath,
    testHooks?.afterSymlinkReadlink,
    testHooks?.afterSymlinkTargetObserved,
  );
  const after = await readStableSymlinkSnapshot(absolutePath, canonicalPath);
  if (!sameSymlinkSnapshot(before, after)) {
    throw unstableClosureError(`symbolic link changed or was replaced while being observed: ${canonicalPath}`);
  }
  return after;
}

export async function createRuntimeDependencyStagingPlan({
  pinnedSourceRoot,
  stagingRoot,
} = {}) {
  const sourceRoot = requireAbsolutePath(pinnedSourceRoot, 'pinnedSourceRoot');
  const destinationRoot = requireAbsolutePath(stagingRoot, 'stagingRoot');
  return {
    command: {
      executable: 'npm',
      args: [...NPM_CI_ARGS],
      cwd: destinationRoot,
    },
    inputs: ['package.json', 'package-lock.json'].map((relativePath) => ({
      source: path.join(sourceRoot, relativePath),
      destination: path.join(destinationRoot, relativePath),
    })),
  };
}

export async function prepareRuntimeDependencyStaging({
  pinnedSourceRoot,
  stagingRoot,
  runCommandSync = execFileSync,
  testHooks,
} = {}) {
  const plan = await createRuntimeDependencyStagingPlan({ pinnedSourceRoot, stagingRoot });
  const sourceRoot = requireAbsolutePath(pinnedSourceRoot, 'pinnedSourceRoot');
  const sourceInfo = await requireRealDirectory(sourceRoot, 'pinnedSourceRoot');

  try {
    await fs.mkdir(plan.command.cwd, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    await requireRealDirectory(plan.command.cwd, 'stagingRoot');
    const existing = await fs.readdir(plan.command.cwd);
    if (existing.length > 0) {
      throw new Error(`stagingRoot must be empty: ${plan.command.cwd}`);
    }
  }
  const stagingInfo = await requireRealDirectory(plan.command.cwd, 'stagingRoot');

  const stagedInputs = [];
  for (const input of plan.inputs) {
    stagedInputs.push(await stagePinnedInput({
      ...input,
      relativePath: path.basename(input.source),
      sourceRealRoot: sourceInfo.realPath,
      stagingRealRoot: stagingInfo.realPath,
    }));
  }
  const totalInputBytes = stagedInputs.reduce((sum, input) => sum + input.attestation.bytes, 0);
  if (!Number.isSafeInteger(totalInputBytes) || totalInputBytes > MAX_PINNED_INPUT_TOTAL_BYTES) {
    throw limitError(`pinned runtime inputs exceed ${MAX_PINNED_INPUT_TOTAL_BYTES} total bytes`);
  }
  await testHooks?.afterInputsStaged?.({
    pinnedSourceRoot: sourceRoot,
    stagingRoot: plan.command.cwd,
    inputAttestations: stagedInputs
      .map((input) => ({ ...input.attestation }))
      .sort((left, right) => compareUtf8(left.path, right.path)),
  });
  const stagingReady = await requireRealDirectory(plan.command.cwd, 'stagingRoot');
  if (
    stagingReady.realPath !== stagingInfo.realPath
    || !sameDirectoryObjectIdentity(stagingReady.identity, stagingInfo.identity)
  ) {
    throw unstableClosureError(`stagingRoot changed while receiving pinned inputs: ${plan.command.cwd}`);
  }
  // Check the source before taking the final staging-root snapshot. This keeps
  // the no-follow, byte-verified staging root as the last filesystem operation
  // immediately before the synchronous npm ci invocation.
  const sourceReady = await requireRealDirectory(sourceRoot, 'pinnedSourceRoot');
  if (sourceReady.realPath !== sourceInfo.realPath || !sameFileIdentity(sourceReady.identity, sourceInfo.identity)) {
    throw unstableClosureError(`pinnedSourceRoot canonical root changed before npm ci: ${sourceRoot}`);
  }
  await testHooks?.beforeNpmCi?.({
    pinnedSourceRoot: sourceRoot,
    stagingRoot: plan.command.cwd,
    inputAttestations: stagedInputs
      .map((input) => ({ ...input.attestation }))
      .sort((left, right) => compareUtf8(left.path, right.path)),
  });
  await verifyPinnedStagingBeforeNpmCi({
    stagingRoot: plan.command.cwd,
    stagingRealRoot: stagingInfo.realPath,
    stagingIdentity: stagingReady.identity,
    stagedInputs,
  });

  runCommandSync(plan.command.executable, [...plan.command.args], {
    cwd: plan.command.cwd,
    stdio: 'inherit',
  });

  const nodeModulesRoot = path.join(plan.command.cwd, 'node_modules');
  const nodeModulesInfo = await requireRealDirectory(nodeModulesRoot, 'runtime node_modules');
  if (!isPathInside(stagingInfo.realPath, nodeModulesInfo.realPath)) {
    throw new Error(`runtime node_modules escapes stagingRoot: ${nodeModulesRoot}`);
  }
  const inputAttestations = stagedInputs
    .map((input) => input.attestation)
    .sort((left, right) => compareUtf8(left.path, right.path));
  return {
    ...plan,
    nodeModulesRoot,
    inputAttestations,
  };
}

export async function captureRuntimeClosure({
  root,
  limits,
  approvedNativeAddons = [],
  testHooks,
} = {}) {
  const resolvedRoot = requireAbsolutePath(root, 'root');
  const rootInfo = await requireRealDirectory(resolvedRoot, 'runtime closure root');
  const rootRealPath = rootInfo.realPath;
  const normalizedLimits = normalizeLimits(limits);
  const normalizedNativeAddons = normalizeApprovedNativeAddons(approvedNativeAddons);
  const approvedNativeAddonSet = new Set(normalizedNativeAddons);
  const entries = [];
  let totalBytes = 0;

  async function addEntry(absolutePath, relativePath) {
    const canonicalPath = canonicalRelativePath(relativePath);
    if (Buffer.byteLength(canonicalPath, 'utf8') > normalizedLimits.maxPathBytes) {
      throw limitError(`path exceeds maxPathBytes: ${canonicalPath}`);
    }
    if (entries.length + 1 > normalizedLimits.maxEntries) {
      throw limitError(`entry count exceeds maxEntries at ${canonicalPath}`);
    }

    const metadata = await lstatOrUnstable(absolutePath, canonicalPath, 'entry disappeared before capture');
    const nativeAddon = isNativeAddonPath(canonicalPath);
    if (nativeAddon && !approvedNativeAddonSet.has(canonicalPath)) {
      throw policyError(`unapproved native addon: ${canonicalPath}`);
    }
    if (nativeAddon && !metadata.isFile()) {
      throw policyError(`approved native addon must be a regular file, not a symlink or special entry: ${canonicalPath}`);
    }
    if (nativeAddon && metadata.nlink !== 1n) {
      throw policyError(`approved native addon must not have a hard link alias: ${canonicalPath}`);
    }

    if (metadata.isDirectory()) {
      const directoryInfo = await requireRealDirectory(absolutePath, `runtime directory ${canonicalPath}`);
      if (!sameFileIdentity(metadata, directoryInfo.identity)) {
        throw unstableClosureError(`directory changed while resolving: ${canonicalPath}`);
      }
      if (!isPathInside(rootRealPath, directoryInfo.realPath)) {
        throw policyError(`directory escapes the owned closure: ${canonicalPath}`);
      }
      const directoryListing = await snapshotDirectory({
        absolutePath: directoryInfo.realPath,
        expectedIdentity: directoryInfo.identity,
        remainingEntries: normalizedLimits.maxEntries - entries.length - 1,
        canonicalPath,
      });
      const entry = {
        path: canonicalPath,
        type: 'directory',
        bytes: 0,
        contentSha256: EMPTY_SHA256,
        metadata: canonicalMetadata(directoryListing.identity, 'directory'),
      };
      entries.push({ ...entry, sha256: entryIdentity(entry) });
      await testHooks?.afterDirectoryInitialEnumeration?.({
        absolutePath: directoryInfo.realPath,
        canonicalPath,
        names: [...directoryListing.names],
      });
      for (const childName of directoryListing.names) {
        await addEntry(path.join(directoryInfo.realPath, childName), path.join(relativePath, childName));
      }
      await verifyDirectorySnapshot({
        absolutePath: directoryInfo.realPath,
        expectedIdentity: directoryListing.identity,
        expectedNames: directoryListing.names,
        maxEntries: normalizedLimits.maxEntries,
        canonicalPath,
      });
      await assertDirectoryPathStillStable(absolutePath, directoryInfo.identity, canonicalPath);
      return;
    }

    if (metadata.isFile()) {
      const content = await hashRegularFileBounded({
        absolutePath,
        canonicalPath,
        expectedIdentity: metadata,
        maxFileBytes: normalizedLimits.maxFileBytes,
        maxTotalBytes: normalizedLimits.maxTotalBytes,
        totalBytes,
      });
      const currentPathMetadata = await lstatOrUnstable(
        absolutePath,
        canonicalPath,
        'regular file disappeared after hashing',
      );
      if (!currentPathMetadata.isFile() || !sameFileIdentity(content.identity, currentPathMetadata)) {
        throw unstableClosureError(`regular file path changed after hashing: ${canonicalPath}`);
      }
      totalBytes += content.bytes;
      const entry = {
        path: canonicalPath,
        type: 'file',
        bytes: content.bytes,
        contentSha256: content.contentSha256,
        metadata: canonicalMetadata(content.identity, 'file'),
      };
      entries.push({ ...entry, sha256: entryIdentity(entry) });
      return;
    }

    if (metadata.isSymbolicLink()) {
      const observed = await observeStableSymlink(absolutePath, canonicalPath, testHooks);
      if (!sameFileIdentity(metadata, observed.linkIdentity)) {
        throw unstableClosureError(`symbolic link changed before stable observation: ${canonicalPath}`);
      }
      if (!isPathInside(rootRealPath, observed.targetRealPath)) {
        throw policyError(`external symbolic link is not owned by the closure: ${canonicalPath}`);
      }
      const targetCanonicalPath = canonicalRelativePath(path.relative(rootRealPath, observed.targetRealPath));
      const aliasesNativeAddon = isNativeAddonPath(targetCanonicalPath)
        || (
          observed.targetIdentity.isDirectory()
          && normalizedNativeAddons.some((addonPath) => (
            targetCanonicalPath === '' || addonPath.startsWith(`${targetCanonicalPath}/`)
          ))
        );
      if (aliasesNativeAddon) {
        throw policyError(`native addon symbolic link aliases are not permitted: ${canonicalPath}`);
      }
      if (!observed.targetIdentity.isFile() && !observed.targetIdentity.isDirectory()) {
        throw policyError(`symbolic link targets an unsupported file type: ${canonicalPath}`);
      }
      const content = Buffer.from(observed.linkTarget, 'utf8');
      if (content.byteLength > normalizedLimits.maxFileBytes) {
        throw limitError(`symbolic link exceeds maxFileBytes: ${canonicalPath}`);
      }
      if (totalBytes + content.byteLength > normalizedLimits.maxTotalBytes) {
        throw limitError(`closure exceeds maxTotalBytes at ${canonicalPath}`);
      }
      totalBytes += content.byteLength;
      const entry = {
        path: canonicalPath,
        type: 'symlink',
        bytes: content.byteLength,
        contentSha256: sha256(content),
        metadata: canonicalMetadata(observed.linkIdentity, 'symlink'),
      };
      entries.push({ ...entry, sha256: entryIdentity(entry) });
      return;
    }

    const entryType = specialFileType(metadata);
    throw policyError(`special file ${canonicalPath} has unsupported type ${entryType}`, { entryType });
  }

  const rootListing = await snapshotDirectory({
    absolutePath: rootRealPath,
    expectedIdentity: rootInfo.identity,
    remainingEntries: normalizedLimits.maxEntries,
    canonicalPath: '.',
  });
  await testHooks?.afterDirectoryInitialEnumeration?.({
    absolutePath: rootRealPath,
    canonicalPath: '.',
    names: [...rootListing.names],
  });
  for (const childName of rootListing.names) {
    await addEntry(path.join(rootRealPath, childName), childName);
  }
  await verifyDirectorySnapshot({
    absolutePath: rootRealPath,
    expectedIdentity: rootListing.identity,
    expectedNames: rootListing.names,
    maxEntries: normalizedLimits.maxEntries,
    canonicalPath: '.',
  });
  await assertDirectoryPathStillStable(resolvedRoot, rootInfo.identity, '.');

  entries.sort((left, right) => compareUtf8(left.path, right.path));
  const totals = {
    entries: entries.length,
    files: entries.filter((entry) => entry.type === 'file').length,
    directories: entries.filter((entry) => entry.type === 'directory').length,
    symlinks: entries.filter((entry) => entry.type === 'symlink').length,
    bytes: totalBytes,
  };
  const manifest = manifestPayload({
    limits: normalizedLimits,
    approvedNativeAddons: normalizedNativeAddons,
    entries,
    totals,
  });
  return {
    ...manifest,
    sha256: sha256(JSON.stringify(manifest)),
  };
}

export async function verifyRuntimeClosure({
  root,
  expected,
  limits,
  approvedNativeAddons = [],
} = {}) {
  const expectedPolicy = assertExpectedManifest(expected);
  const verificationLimits = normalizeLimits(limits);
  const verificationNativeAddons = normalizeApprovedNativeAddons(approvedNativeAddons);
  if (JSON.stringify(verificationLimits) !== JSON.stringify(expectedPolicy.limits)) {
    throw policyMismatchError('verification limits must exactly match the attested limits');
  }
  if (JSON.stringify(verificationNativeAddons) !== JSON.stringify(expectedPolicy.approvedNativeAddons)) {
    throw policyMismatchError('verification native addon allowlist must exactly match the attested allowlist');
  }

  const actual = await captureRuntimeClosure({
    root,
    limits: verificationLimits,
    approvedNativeAddons: verificationNativeAddons,
  });
  if (actual.sha256 === expected.sha256 && JSON.stringify(actual) === JSON.stringify(expected)) {
    return actual;
  }

  const expectedByPath = new Map(expected.entries.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actual.entries.map((entry) => [entry.path, entry]));
  const additions = actual.entries
    .filter((entry) => !expectedByPath.has(entry.path))
    .map((entry) => entry.path);
  const deletions = expected.entries
    .filter((entry) => !actualByPath.has(entry.path))
    .map((entry) => entry.path);
  const changes = actual.entries
    .filter((entry) => {
      const expectedEntry = expectedByPath.get(entry.path);
      return expectedEntry && JSON.stringify(expectedEntry) !== JSON.stringify(entry);
    })
    .map((entry) => entry.path);
  const error = new Error(
    `RUNTIME_CLOSURE_MISMATCH: additions=${additions.length}, deletions=${deletions.length}, changes=${changes.length}`,
  );
  error.code = 'RUNTIME_CLOSURE_MISMATCH';
  error.additions = additions;
  error.deletions = deletions;
  error.changes = changes;
  error.expectedSha256 = expected.sha256;
  error.actualSha256 = actual.sha256;
  throw error;
}
