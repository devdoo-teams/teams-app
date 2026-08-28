import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import {
  createPreflightCommands,
  packageGateTimeoutMs,
  parseDotEnv,
  resolvePublicUrl,
  runWithTimeout,
} from './release-gate.mjs';
import {
  assertCleanTrackedWorktreeForFileProvider,
  isFullCommitOid,
  resolvePinnedCommitOid,
} from './fileprovider-git-clean.mjs';
import { validateMatrix } from './teams-ui-matrix-validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surfaces = ['portal', 'installed', 'desktop', 'mobile'];
const evidenceScopes = new Set(['full', ...surfaces]);
const phaseOrder = ['machine', 'package', 'public', ...surfaces];
const terminalReleaseStates = new Set(['COMPLETE', 'SUPERSEDED']);
const MAX_RASTER_BYTES = 20 * 1024 * 1024;
const MAX_RASTER_DIMENSION = 16_384;
const MAX_RASTER_PIXELS = 50_000_000;
const MAX_RASTER_DECODED_BYTES = 128 * 1024 * 1024;
const MAX_SUPPORTING_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAX_MATRIX_ROWS = 512;
const MAX_MATRIX_ARTIFACTS = MAX_MATRIX_ROWS * 5;
const MAX_TOP_LEVEL_ARTIFACT_PATHS = 64;
const MAX_MATRIX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_MATRIX_AGGREGATE_BYTES = 64 * 1024 * 1024;
const PUBLIC_ROUTE_PROBE_TIMEOUT_MS = 10_000;
const RELEASE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

const FULL_RELEASE_LOOP_EVIDENCE_FIELDS = [
  'surface',
  'observedAt',
  'commit',
  'version',
  'packageSha256',
  'summary',
  'screenshotBeforePath',
  'screenshotAfterPath',
  'accessibilityPath',
  'runtimeLogPath',
  'coverage',
];

function isEvidenceObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasEvidenceField(value, field) {
  if (field === 'coverage') return isEvidenceObject(value[field]);
  return typeof value[field] === 'string' && value[field].trim() !== '';
}

/**
 * Browser evidence has two independent contracts: the parent browser
 * observation and release-loop's artifact-backed evidence. Keep the
 * contracts separate in one JSON document so the update driver can validate
 * the former while this process validates the latter. The historical merged
 * top-level shape remains accepted for existing evidence files.
 */
export function splitBrowserEvidenceInput(input, { requireFullEvidence = false } = {}) {
  if (!isEvidenceObject(input)) throw new Error('browser evidence input must be a JSON object');
  const hasAttestation = Object.prototype.hasOwnProperty.call(input, 'attestation');
  const hasEvidence = Object.prototype.hasOwnProperty.call(input, 'evidence');
  if (hasAttestation || hasEvidence) {
    if (!hasAttestation || !hasEvidence || !isEvidenceObject(input.attestation) || !isEvidenceObject(input.evidence)) {
      throw new Error('browser evidence envelope requires both attestation and evidence objects');
    }
    const bundle = { format: 'envelope', attestation: input.attestation, evidence: input.evidence };
    if (requireFullEvidence) assertFullReleaseLoopEvidenceShape(bundle.evidence);
    return bundle;
  }
  if (requireFullEvidence) assertFullReleaseLoopEvidenceShape(input);
  return { format: 'merged', attestation: input, evidence: input };
}

function assertFullReleaseLoopEvidenceShape(evidence) {
  const missing = FULL_RELEASE_LOOP_EVIDENCE_FIELDS.filter((field) => !hasEvidenceField(evidence, field));
  if (missing.length > 0) {
    throw new Error(
      `browser evidence requires full release-loop evidence; missing: ${missing.join(', ')}`,
    );
  }
}

function hashBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('artifact must be binary data');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function integrityError(message, releasePhase) {
  const error = new Error(message);
  error.code = 'ELOOPINTEGRITY';
  error.releasePhase = releasePhase;
  return error;
}

function dimensions(width, height) {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || width > MAX_RASTER_DIMENSION
    || height > MAX_RASTER_DIMENSION
    || width * height > MAX_RASTER_PIXELS
  ) return null;
  return { width, height };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngPasses(width, height, interlace) {
  if (interlace === 0) return [{ width, height }];
  const starts = [[0, 0], [4, 0], [0, 4], [2, 0], [0, 2], [1, 0], [0, 1]];
  const steps = [[8, 8], [8, 8], [4, 8], [4, 4], [2, 4], [2, 2], [1, 2]];
  return starts.map(([startX, startY], index) => ({
    width: width <= startX ? 0 : Math.ceil((width - startX) / steps[index][0]),
    height: height <= startY ? 0 : Math.ceil((height - startY) / steps[index][1]),
  }));
}

function pngDimensions(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) return null;
  if (bytes.length < 8 + 12 + 13 + 12) throw new Error('evidence PNG is truncated');

  let offset = 8;
  let header;
  let paletteSeen = false;
  let imageDataStarted = false;
  let imageDataEnded = false;
  let endSeen = false;
  const compressed = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('evidence PNG has a truncated chunk header');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('evidence PNG has an invalid chunk type');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) throw new Error(`evidence PNG ${type} chunk is truncated or oversized`);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
    if (expectedCrc !== actualCrc) throw new Error(`evidence PNG ${type} chunk CRC is invalid`);
    const data = bytes.subarray(dataStart, dataEnd);

    if (!header && type !== 'IHDR') throw new Error('evidence PNG must begin with IHDR');
    if (type === 'IHDR') {
      if (header || offset !== 8 || length !== 13) throw new Error('evidence PNG has an invalid IHDR');
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const allowedDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (!dimensions(width, height)) throw new Error('evidence PNG dimensions exceed safety limits');
      if (!allowedDepths[colorType]?.includes(bitDepth)) throw new Error('evidence PNG has an unsupported color type or bit depth');
      if (data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(data[12])) {
        throw new Error('evidence PNG uses unsupported compression, filtering, or interlace');
      }
      header = { width, height, bitDepth, colorType, interlace: data[12] };
    } else if (type === 'PLTE') {
      if (imageDataStarted || length === 0 || length % 3 !== 0 || length > 768) throw new Error('evidence PNG has an invalid PLTE chunk');
      paletteSeen = true;
    } else if (type === 'IDAT') {
      if (imageDataEnded || length === 0) throw new Error('evidence PNG has invalid or non-contiguous image data');
      imageDataStarted = true;
      compressed.push(data);
    } else if (type === 'IEND') {
      if (!imageDataStarted || length !== 0) throw new Error('evidence PNG has an invalid IEND');
      endSeen = true;
      offset = chunkEnd;
      if (offset !== bytes.length) throw new Error('evidence PNG has trailing data after IEND');
      break;
    } else {
      if (imageDataStarted) imageDataEnded = true;
      if (type[0] === type[0].toUpperCase()) throw new Error(`evidence PNG contains unsupported critical chunk ${type}`);
    }
    offset = chunkEnd;
  }
  if (!header || !imageDataStarted || !endSeen) throw new Error('evidence PNG is incomplete');
  if (header.colorType === 3 && !paletteSeen) throw new Error('indexed evidence PNG is missing a palette');
  if ([0, 4].includes(header.colorType) && paletteSeen) throw new Error('grayscale evidence PNG cannot contain a palette');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const bitsPerPixel = channels * header.bitDepth;
  const passes = pngPasses(header.width, header.height, header.interlace);
  let decodedLength = 0;
  for (const pass of passes) {
    if (pass.width === 0 || pass.height === 0) continue;
    decodedLength += pass.height * (1 + Math.ceil((pass.width * bitsPerPixel) / 8));
  }
  if (decodedLength > MAX_RASTER_DECODED_BYTES) throw new Error('evidence PNG decoded data exceeds safety limits');
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: decodedLength + 1 });
  } catch {
    throw new Error('evidence PNG image data cannot be decoded');
  }
  if (decoded.length !== decodedLength) throw new Error('evidence PNG decoded image length is invalid');
  let rowOffset = 0;
  for (const pass of passes) {
    if (pass.width === 0 || pass.height === 0) continue;
    const rowLength = Math.ceil((pass.width * bitsPerPixel) / 8);
    for (let row = 0; row < pass.height; row += 1) {
      if (decoded[rowOffset] > 4) throw new Error('evidence PNG uses an invalid row filter');
      rowOffset += 1 + rowLength;
    }
  }
  return { width: header.width, height: header.height };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let frame;
  let quantizationTableSeen = false;
  let huffmanTableSeen = false;
  let scanSeen = false;
  let endSeen = false;
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('evidence JPEG has data outside an entropy-coded scan');
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw new Error('evidence JPEG is truncated before EOI');
    const marker = bytes[offset++];
    if (marker === 0x00) throw new Error('evidence JPEG contains a stuffed byte outside scan data');
    if (marker === 0xd9) {
      endSeen = true;
      if (offset !== bytes.length) throw new Error('evidence JPEG has trailing data after EOI');
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      throw new Error('evidence JPEG contains an invalid standalone marker');
    }
    if (offset + 2 > bytes.length) throw new Error('evidence JPEG has a truncated segment length');
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw new Error('evidence JPEG has a truncated or invalid segment');
    const dataStart = offset + 2;
    const dataEnd = offset + segmentLength;
    if (frameMarkers.has(marker)) {
      if (frame || segmentLength < 11) throw new Error('evidence JPEG has an invalid frame header');
      const height = bytes.readUInt16BE(dataStart + 1);
      const width = bytes.readUInt16BE(dataStart + 3);
      const componentCount = bytes[dataStart + 5];
      if (segmentLength !== 8 + componentCount * 3 || !dimensions(width, height)) {
        throw new Error('evidence JPEG frame dimensions or components are invalid');
      }
      const componentIds = new Set();
      for (let index = 0; index < componentCount; index += 1) {
        const componentOffset = dataStart + 6 + index * 3;
        const id = bytes[componentOffset];
        const sampling = bytes[componentOffset + 1];
        if (componentIds.has(id) || (sampling >> 4) === 0 || (sampling & 0x0f) === 0 || bytes[componentOffset + 2] > 3) {
          throw new Error('evidence JPEG frame components are invalid');
        }
        componentIds.add(id);
      }
      frame = { width, height, componentIds };
    } else if (marker === 0xdb) {
      let tableOffset = dataStart;
      while (tableOffset < dataEnd) {
        const precision = bytes[tableOffset] >> 4;
        const tableLength = 1 + (precision === 0 ? 64 : precision === 1 ? 128 : 0);
        if (tableLength === 1 || tableOffset + tableLength > dataEnd) throw new Error('evidence JPEG quantization table is invalid');
        tableOffset += tableLength;
      }
      if (tableOffset !== dataEnd) throw new Error('evidence JPEG quantization table is truncated');
      quantizationTableSeen = true;
    } else if (marker === 0xc4) {
      let tableOffset = dataStart;
      while (tableOffset < dataEnd) {
        if (tableOffset + 17 > dataEnd) throw new Error('evidence JPEG Huffman table is truncated');
        const symbolCount = bytes.subarray(tableOffset + 1, tableOffset + 17).reduce((sum, count) => sum + count, 0);
        if (symbolCount === 0 || symbolCount > 256 || tableOffset + 17 + symbolCount > dataEnd) {
          throw new Error('evidence JPEG Huffman table is invalid');
        }
        tableOffset += 17 + symbolCount;
      }
      huffmanTableSeen = true;
    } else if (marker === 0xda) {
      if (!frame || !quantizationTableSeen || !huffmanTableSeen) throw new Error('evidence JPEG scan is missing frame or coding tables');
      const componentCount = bytes[dataStart];
      if (componentCount === 0 || segmentLength !== 6 + componentCount * 2) throw new Error('evidence JPEG scan header is invalid');
      const scanComponents = new Set();
      for (let index = 0; index < componentCount; index += 1) {
        const componentOffset = dataStart + 1 + index * 2;
        const id = bytes[componentOffset];
        const tables = bytes[componentOffset + 1];
        if (!frame.componentIds.has(id) || scanComponents.has(id) || (tables >> 4) > 3 || (tables & 0x0f) > 3) {
          throw new Error('evidence JPEG scan components are invalid');
        }
        scanComponents.add(id);
      }
      scanSeen = true;
      offset = dataEnd;
      let entropyBytes = 0;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          entropyBytes += 1;
          offset += 1;
          continue;
        }
        const markerStart = offset;
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) throw new Error('evidence JPEG scan is truncated before EOI');
        const scanMarker = bytes[offset];
        if (scanMarker === 0x00) {
          entropyBytes += 1;
          offset += 1;
          continue;
        }
        if (scanMarker >= 0xd0 && scanMarker <= 0xd7) {
          offset += 1;
          continue;
        }
        if (entropyBytes === 0) throw new Error('evidence JPEG scan has no entropy-coded data');
        offset = markerStart;
        break;
      }
      continue;
    }
    offset = dataEnd;
  }
  if (!frame || !scanSeen || !endSeen) throw new Error('evidence JPEG is incomplete or missing EOI');
  return { width: frame.width, height: frame.height };
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('evidence WebP RIFF length is truncated or invalid');
  let offset = 12;
  let canvas;
  let image;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('evidence WebP has a truncated chunk header');
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const paddedEnd = dataEnd + (length % 2);
    if (paddedEnd > bytes.length) throw new Error(`evidence WebP ${type} chunk is truncated or oversized`);
    if (length % 2 && bytes[dataEnd] !== 0) throw new Error(`evidence WebP ${type} chunk padding is invalid`);

    if (type === 'VP8X') {
      if (canvas || image || length !== 10) throw new Error('evidence WebP has an invalid VP8X canvas chunk');
      const flags = bytes[dataStart];
      if (flags & 0xc1 || bytes[dataStart + 1] !== 0 || bytes[dataStart + 2] !== 0 || bytes[dataStart + 3] !== 0) {
        throw new Error('evidence WebP VP8X reserved bits are invalid');
      }
      if (flags & 0x02) throw new Error('animated WebP is not accepted as static release evidence');
      canvas = dimensions(
        1 + readUInt24LE(bytes, dataStart + 4),
        1 + readUInt24LE(bytes, dataStart + 7),
      );
      if (!canvas) throw new Error('evidence WebP dimensions exceed safety limits');
    } else if (type === 'VP8 ') {
      if (image || length < 10) throw new Error('evidence WebP has an invalid or duplicate VP8 image chunk');
      const frameTag = readUInt24LE(bytes, dataStart);
      if (
        frameTag & 1
        || bytes[dataStart + 3] !== 0x9d
        || bytes[dataStart + 4] !== 0x01
        || bytes[dataStart + 5] !== 0x2a
        || 10 + (frameTag >>> 5) > length
      ) throw new Error('evidence WebP VP8 frame header is invalid or truncated');
      image = dimensions(bytes.readUInt16LE(dataStart + 6) & 0x3fff, bytes.readUInt16LE(dataStart + 8) & 0x3fff);
      if (!image) throw new Error('evidence WebP dimensions exceed safety limits');
    } else if (type === 'VP8L') {
      if (image || length < 5 || bytes[dataStart] !== 0x2f) throw new Error('evidence WebP has an invalid or duplicate VP8L image chunk');
      const width = 1 + (bytes[dataStart + 1] | ((bytes[dataStart + 2] & 0x3f) << 8));
      const height = 1 + ((bytes[dataStart + 2] >> 6) | (bytes[dataStart + 3] << 2) | ((bytes[dataStart + 4] & 0x0f) << 10));
      if ((bytes[dataStart + 4] >> 5) !== 0) throw new Error('evidence WebP VP8L version bits are invalid');
      image = dimensions(width, height);
      if (!image) throw new Error('evidence WebP dimensions exceed safety limits');
    }
    offset = paddedEnd;
  }
  if (offset !== bytes.length || !image) throw new Error('evidence WebP is incomplete or missing image data');
  if (canvas && (canvas.width !== image.width || canvas.height !== image.height)) {
    throw new Error('evidence WebP canvas and image dimensions do not match');
  }
  return canvas ?? image;
}

export function rasterDimensions(bytes) {
  const source = bytes instanceof Uint8Array ? Buffer.from(bytes) : null;
  if (!source) throw new Error('evidence artifact must be binary data');
  if (source.length > MAX_RASTER_BYTES) throw new Error('evidence raster file size exceeds the 20 MiB safety limit');
  const result = pngDimensions(source) ?? jpegDimensions(source) ?? webpDimensions(source);
  if (!result) throw new Error('evidence artifact must be a valid PNG, JPEG, or WebP raster image with dimensions');
  return result;
}

function inspectArtifact(bytes) {
  const { width, height } = rasterDimensions(bytes);
  return { sha256: hashBytes(bytes), bytes: bytes.length, width, height };
}

function inspectSupportingArtifact(bytes, label) {
  const source = bytes instanceof Uint8Array ? Buffer.from(bytes) : null;
  if (!source) throw new Error(`${label} artifact must be binary data`);
  if (source.length === 0 || source.length > MAX_SUPPORTING_ARTIFACT_BYTES) {
    throw new Error(`${label} artifact size is empty or exceeds the 4 MiB safety limit`);
  }
  const text = source.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(source) !== 0) {
    throw new Error(`${label} artifact must be valid UTF-8 text`);
  }
  if (/(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|(?:client[_ -]?secret|password|api[_ -]?key)\s*[:=]\s*\S+)/i.test(text)) {
    throw new Error(`${label} artifact contains secret or credential-like text`);
  }
  return { sha256: hashBytes(source), bytes: source.length };
}

function absoluteEvidencePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} path must be absolute`);
  }
  return path.normalize(value);
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function artifactIdentityKey(artifact) {
  const inodeKey = Number.isSafeInteger(artifact.device) && Number.isSafeInteger(artifact.inode)
    ? `${artifact.device}:${artifact.inode}`
    : null;
  return {
    realPath: artifact.realPath,
    inodeKey,
    contentKey: /^[a-f0-9]{64}$/.test(artifact.sha256 ?? '') && Number.isSafeInteger(artifact.bytes)
      ? `${artifact.sha256}:${artifact.bytes}`
      : null,
  };
}

function identityEntries(artifact) {
  return Object.entries(artifactIdentityKey(artifact));
}

function pathIdentityIndex(source = null) {
  return {
    realPath: new Map(source?.realPath ?? []),
    inodeKey: new Map(source?.inodeKey ?? []),
  };
}

function assertPathIdentityNotReused(seen, artifact, label) {
  for (const [kind, key] of identityEntries(artifact)) {
    if (kind === 'contentKey' || !key) continue;
    const previous = seen[kind].get(key);
    if (previous) throw new Error(`${label} reuses evidence from ${previous}: ${key}`);
  }
}

function rememberPathIdentity(seen, artifact, label) {
  for (const [kind, key] of identityEntries(artifact)) {
    if (kind === 'contentKey' || !key) continue;
    seen[kind].set(key, label);
  }
}

function preflightArtifactPath(
  candidate,
  label,
  kind,
  {
    allowedRoot,
    fileExists = (value) => fsSync.existsSync(value),
    statArtifact = (value) => fsSync.statSync(value),
    realpathArtifact = (value) => fsSync.realpathSync(value),
  } = {},
) {
  const normalizedPath = absoluteEvidencePath(candidate, label);
  if (!fileExists(normalizedPath)) throw new Error(`${label} artifact does not exist: ${normalizedPath}`);

  let realPath;
  let stats;
  try {
    realPath = path.normalize(realpathArtifact(normalizedPath));
    stats = statArtifact(normalizedPath);
  } catch (error) {
    throw new Error(`${label} artifact preflight failed: ${error?.message ?? normalizedPath}`);
  }
  if (allowedRoot && !isPathInside(allowedRoot, realPath)) {
    throw new Error(`${label} symlink or canonical path escapes the allowed evidence root: ${realPath}`);
  }
  if (typeof stats?.isFile === 'function' && !stats.isFile()) {
    throw new Error(`${label} artifact must be a regular file`);
  }
  const maxBytes = kind === 'visual' ? MAX_MATRIX_ARTIFACT_BYTES : MAX_SUPPORTING_ARTIFACT_BYTES;
  if (!Number.isSafeInteger(stats?.size) || stats.size <= 0 || stats.size > maxBytes) {
    throw new Error(`${label} artifact file size exceeds the ${kind === 'visual' ? '20 MiB' : '4 MiB'} preflight limit`);
  }
  return {
    path: normalizedPath,
    realPath,
    bytes: stats.size,
    device: Number.isSafeInteger(stats.dev) ? stats.dev : null,
    inode: Number.isSafeInteger(stats.ino) ? stats.ino : null,
  };
}

function assertArtifactNotReused(seen, artifact, label) {
  for (const [kind, key] of identityEntries(artifact)) {
    if (!key) continue;
    const previous = seen[kind].get(key);
    if (previous) {
      throw new Error(`${label} reuses evidence from ${previous}: ${key}`);
    }
    seen[kind].set(key, label);
  }
}

function createArtifactIdentityIndex(artifacts = []) {
  const seen = { realPath: new Map(), inodeKey: new Map(), contentKey: new Map() };
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact.sha256 !== 'string' || !Number.isSafeInteger(artifact.bytes)) continue;
    const label = `${artifact.evidenceSurface ?? 'release'} ${artifact.rowId ?? artifact.role ?? 'artifact'}`;
    for (const [kind, key] of identityEntries(artifact)) if (key) seen[kind].set(key, label);
  }
  return seen;
}

function readBoundedArtifact(candidate, expectedBytes, maxBytes, label, readArtifact) {
  const bytes = readArtifact(candidate);
  if (!(bytes instanceof Uint8Array)) throw new Error(`${label} artifact must be binary data`);
  if (!Number.isSafeInteger(bytes.length) || bytes.length > maxBytes) {
    throw new Error(`${label} artifact exceeds its bounded ${maxBytes} byte read limit`);
  }
  if (bytes.length !== expectedBytes) {
    throw new Error(`${label} artifact size changed after preflight: ${candidate}`);
  }
  return bytes;
}

function allEvidenceArtifacts(evidence) {
  return [
    ...(Array.isArray(evidence?.artifacts) ? evidence.artifacts : []),
    ...(Array.isArray(evidence?.supportingArtifacts) ? evidence.supportingArtifacts : []),
    ...(Array.isArray(evidence?.matrixArtifacts) ? evidence.matrixArtifacts : []),
  ];
}

function parseCoverageMatrix(bytes, label = 'coverage matrix') {
  const source = bytes instanceof Uint8Array ? Buffer.from(bytes) : null;
  if (!source) throw new Error(`${label} must be binary data`);
  const text = source.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(source) !== 0) {
    throw new Error(`${label} must be valid UTF-8 text`);
  }
  const fenced = text.match(/<!--\s*TEAMS_UI_MATRIX_JSON_START\s*-->\s*```json\s*([\s\S]*?)\s*```/i);
  const jsonText = (fenced?.[1] ?? text).trim();
  let matrix;
  try {
    matrix = JSON.parse(jsonText);
  } catch {
    throw new Error(`${label} must contain a valid JSON matrix`);
  }
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    throw new Error(`${label} must be a JSON object`);
  }
  if (!Array.isArray(matrix.rows) || matrix.rows.length === 0) {
    throw new Error(`${label} must contain a non-empty rows array`);
  }
  if (matrix.rows.length > MAX_MATRIX_ROWS) {
    throw new Error(`${label} row count exceeds the ${MAX_MATRIX_ROWS} row limit`);
  }
  if (!matrix.coverage || matrix.coverage.count !== matrix.rows.length) {
    throw new Error(`${label} coverage count does not match rows`);
  }
  const rowIds = new Set();
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, 'N/A': 0, UNVERIFIED: 0 };
  for (const row of matrix.rows) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || row.id.trim() === '') {
      throw new Error(`${label} contains a row without a stable id`);
    }
    if (rowIds.has(row.id)) throw new Error(`${label} contains duplicate row id ${row.id}`);
    rowIds.add(row.id);
    const status = row.result?.status;
    if (!Object.hasOwn(counts, status)) throw new Error(`${label} contains an unsupported row status`);
    counts[status] += 1;
  }
  return { source, matrix, counts };
}

function inspectCoverageMatrix(
  bytes,
  coverage,
  identity,
  {
    fileExists = (candidate) => fsSync.existsSync(candidate),
    readArtifact = (candidate) => fsSync.readFileSync(candidate),
    statArtifact = (candidate) => fsSync.statSync(candidate),
    realpathArtifact = (candidate) => fsSync.realpathSync(candidate),
    identityIndex = createArtifactIdentityIndex(),
  } = {},
) {
  const parsed = parseCoverageMatrix(bytes);
  const { matrix, counts, source } = parsed;
  if (hashBytes(source) !== coverage.matrixSha256) {
    throw new Error('coverage matrix SHA-256 does not match the supplied evidence');
  }
  const releaseIdentity = matrix.releaseIdentity;
  if (
    !releaseIdentity
    || releaseIdentity.appVersion !== identity.version
    || !isFullCommitOid(releaseIdentity.sourceCommit)
    || releaseIdentity.packageSha256 !== identity.packageSha256
  ) {
    throw new Error('coverage matrix release identity does not match the release package evidence');
  }
  if (releaseIdentity.sourceCommit !== identity.commit) {
    throw new Error('coverage matrix release identity sourceCommit does not match the release run commit');
  }
  // The evidence contract owns the scope. A matrix may repeat that value for
  // integrity, but it must never silently narrow an omitted evidence scope and
  // then be normalized as full coverage (especially for the mobile gate).
  const scope = coverage.scope ?? 'full';
  if (!evidenceScopes.has(scope)) throw new Error(`coverage matrix evidence scope is invalid: ${scope}`);
  if (matrix.evidenceScope && matrix.evidenceScope !== scope) {
    throw new Error('coverage matrix evidence scope does not match the supplied coverage');
  }
  for (const row of matrix.rows) {
    if (!surfaces.includes(row.evidenceSurface)) {
      throw new Error(`coverage matrix row ${row.id} must declare a valid evidence surface`);
    }
    if (scope !== 'full' && row.evidenceSurface !== scope) {
      throw new Error(
        `coverage matrix row ${row.id} evidence surface ${row.evidenceSurface} does not match scope ${scope}`,
      );
    }
  }
  const validation = validateMatrix(matrix, {
    requirePass: true,
    evidenceBaseDir: path.dirname(path.resolve(coverage.matrixPath)),
    evidenceScope: scope,
  });
  if (!validation.ok) {
    throw new Error(`coverage matrix row validation failed: ${validation.errors.join('; ')}`);
  }
  const artifacts = inspectMatrixEvidenceArtifacts(matrix, coverage, {
    fileExists,
    readArtifact,
    statArtifact,
    realpathArtifact,
    identityIndex,
  });
  const expected = {
    totalRows: matrix.rows.length,
    passedRows: counts.PASS,
    blockedRows: counts.BLOCKED,
    unverifiedRows: counts.UNVERIFIED,
    notApplicableRows: counts['N/A'],
  };
  for (const [key, value] of Object.entries(expected)) {
    if (coverage[key] !== value) throw new Error(`coverage matrix ${key} does not match row results`);
  }
  return { sha256: hashBytes(source), bytes: source.length, artifacts, ...expected };
}

function inspectMatrixEvidenceArtifacts(
  matrix,
  coverage,
  {
    fileExists = (candidate) => fsSync.existsSync(candidate),
    readArtifact = (candidate) => fsSync.readFileSync(candidate),
    statArtifact = (candidate) => fsSync.statSync(candidate),
    realpathArtifact = (candidate) => fsSync.realpathSync(candidate),
    identityIndex = createArtifactIdentityIndex(),
  } = {},
) {
  const evidenceBaseDir = path.normalize(realpathArtifact(path.dirname(path.resolve(coverage.matrixPath))));
  const descriptors = [];
  const add = (row, role, evidence, kind) => {
    if (typeof evidence?.path !== 'string' || evidence.path.trim() === '') return;
    const evidencePath = path.normalize(
      path.isAbsolute(evidence.path) ? evidence.path : path.resolve(evidenceBaseDir, evidence.path),
    );
    if (!/^[a-f0-9]{64}$/.test(evidence.sha256 ?? '')) {
      throw new Error(`coverage matrix row ${row.id} ${role} artifact requires a SHA-256`);
    }
    if (!Number.isSafeInteger(evidence.bytes) || evidence.bytes <= 0) {
      throw new Error(`coverage matrix row ${row.id} ${role} artifact requires a positive byte count`);
    }
    descriptors.push({ row, role, evidence, kind, evidencePath });
  };

  for (const row of matrix.rows) {
    add(row, 'screenshotBefore', row.screenshotBefore, 'visual');
    add(row, 'screenshotAfter', row.screenshotAfter, 'visual');
    add(row, 'runtimeEvidence', row.runtimeEvidence, 'supporting');
    if (row.accessibilityEvidence?.before || row.accessibilityEvidence?.after) {
      add(row, 'accessibilityEvidence.before', row.accessibilityEvidence.before, 'supporting');
      add(row, 'accessibilityEvidence.after', row.accessibilityEvidence.after, 'supporting');
    } else {
      add(row, 'accessibilityEvidence', row.accessibilityEvidence, 'supporting');
    }
  }

  if (descriptors.length > MAX_MATRIX_ARTIFACTS) {
    throw new Error(`coverage matrix artifact count exceeds the ${MAX_MATRIX_ARTIFACTS} artifact limit`);
  }

  const pathSeen = pathIdentityIndex(identityIndex);
  let aggregateBytes = 0;
  const preflight = descriptors.map(({ row, role, evidence, kind, evidencePath }) => {
    const label = `coverage matrix row ${row.id} ${role}`;
    const artifact = {
      ...preflightArtifactPath(evidencePath, label, kind, {
        allowedRoot: evidenceBaseDir,
        fileExists,
        statArtifact,
        realpathArtifact,
      }),
      rowId: row.id,
      role,
      kind,
      evidenceSurface: row.evidenceSurface,
      sha256: evidence.sha256,
    };
    if (artifact.bytes !== evidence.bytes) {
      throw new Error(`${label} artifact byte count does not match its preflight size`);
    }
    assertPathIdentityNotReused(pathSeen, artifact, label);
    rememberPathIdentity(pathSeen, artifact, label);
    aggregateBytes += artifact.bytes;
    return artifact;
  });
  if (aggregateBytes > MAX_MATRIX_AGGREGATE_BYTES) {
    throw new Error('coverage matrix aggregate artifact byte budget exceeds 64 MiB');
  }

  return preflight.map((artifact) => {
    const label = `coverage matrix row ${artifact.rowId} ${artifact.role}`;
    const actualBytes = readBoundedArtifact(
      artifact.path,
      artifact.bytes,
      artifact.kind === 'visual' ? MAX_MATRIX_ARTIFACT_BYTES : MAX_SUPPORTING_ARTIFACT_BYTES,
      label,
      readArtifact,
    );
    const actual = artifact.kind === 'visual'
      ? inspectArtifact(actualBytes)
      : inspectSupportingArtifact(actualBytes, label);
    if (actual.sha256 !== artifact.sha256) {
      throw new Error(`${label} artifact SHA-256 does not match its content`);
    }
    if (actual.bytes !== artifact.bytes) {
      throw new Error(`${label} artifact byte count does not match its content`);
    }
    assertArtifactNotReused(identityIndex, { ...artifact, ...actual }, label);
    return {
      ...artifact,
      ...(artifact.kind === 'visual' ? { width: actual.width, height: actual.height } : {}),
    };
  });
}

function hasFullEvidenceCoverage(evidence) {
  const coverage = evidence?.coverage;
  return Boolean(
    coverage
    && (coverage.scope ?? 'full') === 'full'
    && coverage.commit === evidence.commit
    && coverage.version === evidence.version
    && typeof coverage.matrixPath === 'string'
    && /^[a-f0-9]{64}$/.test(coverage.matrixSha256 ?? '')
    && Number.isInteger(coverage.totalRows)
    && coverage.totalRows > 0
    && Number.isInteger(coverage.passedRows)
    && Number.isInteger(coverage.notApplicableRows)
    && coverage.passedRows + coverage.notApplicableRows === coverage.totalRows
    && coverage.blockedRows === 0
    && coverage.unverifiedRows === 0,
  );
}

function hasSurfaceEvidenceCoverage(evidence, surface) {
  const coverage = evidence?.coverage;
  const scope = coverage?.scope ?? 'full';
  return Boolean(
    coverage
    && (scope === 'full' || scope === surface)
    && Number.isInteger(coverage.totalRows)
    && coverage.totalRows > 0
    && Number.isInteger(coverage.passedRows)
    && Number.isInteger(coverage.notApplicableRows)
    && coverage.passedRows + coverage.notApplicableRows === coverage.totalRows
    && coverage.blockedRows === 0
    && coverage.unverifiedRows === 0,
  );
}

function hasSurfaceEvidence(state, surface) {
  const evidence = state.evidence?.[surface];
  if (!evidence) return false;
  if (evidence.surface !== surface || evidence.commit !== state.commit || evidence.version !== state.version) return false;
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length < 2) return false;
  if (!Array.isArray(evidence.supportingArtifacts) || evidence.supportingArtifacts.length < 2) return false;
  if (!Array.isArray(evidence.matrixArtifacts) || evidence.matrixArtifacts.length === 0) return false;
  if (!evidence.screenshotBeforePath || !evidence.screenshotAfterPath) return false;
  if (!hasSurfaceEvidenceCoverage(evidence, surface)) return false;
  if (state.package?.sha256 && evidence.packageSha256 !== state.package.sha256) return false;
  // The portal's published version and the installed conversation's response
  // are different facts. Do not let a chat round-trip stand in for the
  // installed app-info version check.
  if (surface === 'installed' && evidence.installedVersion !== state.version) return false;
  if (surface === 'mobile' && evidence.userConfirmed !== true) return false;
  if (surface === 'mobile' && !hasFullEvidenceCoverage(evidence)) return false;
  return true;
}

const surfacePrerequisites = {
  portal: (state) => hasCurrentPublicReady(state),
  installed: (state) => hasSurfaceEvidence(state, 'portal'),
  desktop: (state) => hasSurfaceEvidence(state, 'installed'),
  mobile: (state) => hasSurfaceEvidence(state, 'desktop'),
};

export const RELEASE_SURFACES = [...surfaces];

function phaseFieldName(phase) {
  return phase === 'machine' ? 'machine' : phase;
}

export function resetAfterPhaseFailure(state, phase, error, now = new Date()) {
  const field = phaseFieldName(phase);
  const start = phaseOrder.indexOf(field);
  if (start < 0) throw new Error(`unknown release phase: ${phase}`);
  const next = {
    ...state,
    evidence: { ...state.evidence },
    updatedAt: now.toISOString(),
  };
  for (const current of phaseOrder.slice(start)) {
    if (surfaces.includes(current)) next.evidence[current] = null;
    else next[current] = null;
  }
  next.status = deriveStatus(next);
  next.lastFailure = {
    phase: field,
    code: error?.code ?? 'ELOOPPHASE',
    message: String(error?.message ?? 'release phase failed')
      .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/(client[_ -]?secret|password|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]'),
  };
  return next;
}

export function applyPhaseSuccess(state, phase, summary, now = new Date()) {
  const field = phaseFieldName(phase);
  const start = phaseOrder.indexOf(field);
  if (!['machine', 'package', 'public'].includes(field) || start < 0) {
    throw new Error(`unknown machine release phase: ${phase}`);
  }
  const next = {
    ...state,
    [field]: summary,
    evidence: { ...state.evidence },
    updatedAt: now.toISOString(),
    lastFailure: null,
  };
  for (const downstream of phaseOrder.slice(start + 1)) {
    if (surfaces.includes(downstream)) next.evidence[downstream] = null;
    else next[downstream] = null;
  }
  next.status = deriveStatus(next);
  return next;
}

export function createInitialState({
  runId,
  commit,
  shortCommit,
  version,
  startedAt,
  untrackedAtStart = [],
  untrackedAtStartBaseline = [],
  sourceIoMode = 'normal',
}) {
  for (const [name, value] of Object.entries({ runId, commit, shortCommit, version, startedAt })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`release loop requires ${name}`);
    }
  }
  if (!Array.isArray(untrackedAtStart)) throw new Error('release loop requires untrackedAtStart to be an array');
  if (!Array.isArray(untrackedAtStartBaseline)) {
    throw new Error('release loop requires untrackedAtStartBaseline for untracked files');
  }
  if (untrackedAtStart.length !== untrackedAtStartBaseline.length) {
    throw new Error('release loop requires one untracked baseline fingerprint per untrackedAtStart path');
  }
  return {
    schemaVersion: 1,
    runId,
    startedAt,
    updatedAt: startedAt,
    commit,
    shortCommit,
    version,
    untrackedAtStart: [...untrackedAtStart],
    untrackedAtStartBaseline: untrackedAtStartBaseline.map((entry) => ({ ...entry })),
    sourceIoMode,
    status: 'INIT',
    machine: null,
    package: null,
    public: null,
    evidence: {
      portal: null,
      installed: null,
      desktop: null,
      mobile: null,
    },
    lastFailure: null,
  };
}

function hasReady(record) {
  return record?.status === 'READY';
}

function hasPublicAssetIdentity(asset) {
  return Boolean(
    asset
    && typeof asset.finalUrl === 'string'
    && /^[a-f0-9]{64}$/.test(asset.sha256 ?? '')
    && /^[a-f0-9]{12}$/.test(asset.buildId ?? '')
    && asset.sha256.startsWith(asset.buildId),
  );
}

function hasCurrentPublicReady(state) {
  return hasReady(state.public)
    && hasReady(state.package)
    && state.package.sourceCommit === state.commit
    && state.public.sourceCommit === state.commit
    && state.public.version === state.version
    && state.public.packageSha256 === state.package.sha256
    && hasPublicAssetIdentity(state.public.asset);
}

export function deriveStatus(state) {
  if (state.status === 'COMPLETE' || state.status === 'SUPERSEDED') return state.status;
  if (!hasReady(state.machine)) return 'INIT';
  if (!hasReady(state.package)) return 'MACHINE_READY';
  if (!hasCurrentPublicReady(state)) return 'PACKAGE_READY';
  if (!hasSurfaceEvidence(state, 'portal')) return 'PUBLIC_READY';
  if (!hasSurfaceEvidence(state, 'installed')) return 'PORTAL_READY';
  if (!hasSurfaceEvidence(state, 'desktop')) return 'INSTALLED_READY';
  if (!hasSurfaceEvidence(state, 'mobile')) return 'DESKTOP_READY';
  return 'MOBILE_READY';
}

export function missingGates(state) {
  const gates = [];
  if (!hasReady(state.machine)) gates.push('MACHINE_READY');
  if (!hasReady(state.package)) gates.push('PACKAGE_READY');
  if (!hasCurrentPublicReady(state)) gates.push('PUBLIC_READY');
  if (!hasSurfaceEvidence(state, 'portal')) gates.push('PORTAL_READY');
  if (!hasSurfaceEvidence(state, 'installed')) gates.push('INSTALLED_READY');
  if (!hasSurfaceEvidence(state, 'desktop')) gates.push('DESKTOP_READY');
  if (!hasSurfaceEvidence(state, 'mobile')) gates.push('MOBILE_READY');
  return gates;
}

/**
 * The resumable release:update runner stores browser/Jira attestations under
 * releaseUpdate. Keep the raw CLI completion path from bypassing that contract
 * when it is used directly or invoked by an outdated operator script.
 */
export function assertReleaseUpdateCompletionContract(state) {
  if (!state?.releaseUpdate?.identity) {
    const error = new Error('release completion requires a recorded package/public identity');
    error.code = 'ELOOPBLOCKED';
    throw error;
  }
  if (!['READY', 'VERIFIED'].includes(state.releaseUpdate?.jira?.status)) {
    const error = new Error('release completion requires Jira reconciliation');
    error.code = 'ELOOPBLOCKED';
    throw error;
  }
  const missing = RELEASE_SURFACES.filter((surface) => !state.releaseUpdate?.attestations?.[surface]);
  if (missing.length > 0) {
    const error = new Error(`release completion requires browser attestations: ${missing.join(', ')}`);
    error.code = 'ELOOPBLOCKED';
    throw error;
  }
  return true;
}

function assertSurface(surface) {
  if (!surfaces.includes(surface)) {
    throw new Error(`evidence surface must be one of: ${surfaces.join(', ')}`);
  }
}

function assertSafeSummary(summary) {
  if (typeof summary !== 'string' || summary.trim().length < 8 || summary.length > 1_000) {
    throw new Error('evidence summary must be between 8 and 1000 characters');
  }
  if (/(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|(?:client[_ -]?secret|password|api[_ -]?key)\s*[:=]\s*\S+)/i.test(summary)) {
    throw new Error('evidence summary contains secret or credential-like text');
  }
}

function assertObservedAt(observedAt, state, now) {
  if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) {
    throw new Error('evidence observedAt must be an ISO timestamp');
  }
  const observed = Date.parse(observedAt);
  const current = now instanceof Date ? now.getTime() : Date.now();
  if (observed > current) throw new Error('evidence observedAt cannot be in the future');
  if (Date.parse(state.startedAt) > observed) throw new Error('evidence observedAt predates the release run');
}

function evidencePrerequisiteObservation(state, surface) {
  if (surface === 'portal') return { surface: 'public', observedAt: state.public?.completedAt };
  const prerequisite = surfaces[surfaces.indexOf(surface) - 1];
  return { surface: prerequisite, observedAt: state.evidence?.[prerequisite]?.observedAt };
}

function assertEvidenceAfterPrerequisite(observedAt, state, surface) {
  const prerequisite = evidencePrerequisiteObservation(state, surface);
  const prerequisiteTime = Date.parse(prerequisite.observedAt);
  if (!prerequisite.observedAt || Number.isNaN(prerequisiteTime)) {
    throw new Error(`${surface} evidence prerequisite ${prerequisite.surface} time is missing or invalid`);
  }
  if (Date.parse(observedAt) < prerequisiteTime) {
    throw new Error(`${surface} evidence observedAt predates ${prerequisite.surface} prerequisite time`);
  }
}

function assertExactSupportingArtifactSet(evidence, supportingArtifacts, label) {
  let expected;
  try {
    expected = new Map([
      ['accessibility', absoluteEvidencePath(evidence?.accessibilityPath, `${label} accessibility`)],
      ['runtime-log', absoluteEvidencePath(evidence?.runtimeLogPath, `${label} runtime log`)],
      ['coverage-matrix', absoluteEvidencePath(evidence?.coverage?.matrixPath, `${label} coverage matrix`)],
    ]);
  } catch (error) {
    throw new Error(`${label} requires an exact supporting artifact role/path set: ${error?.message ?? error}`);
  }
  if (!Array.isArray(supportingArtifacts) || supportingArtifacts.length !== expected.size) {
    throw new Error(`${label} requires exactly accessibility, runtime-log, and coverage-matrix supporting artifacts`);
  }
  const seenRoles = new Set();
  for (const artifact of supportingArtifacts) {
    if (!artifact || typeof artifact.role !== 'string' || !expected.has(artifact.role)) {
      throw new Error(`${label} contains an unsupported supporting artifact role`);
    }
    if (seenRoles.has(artifact.role)) {
      throw new Error(`${label} contains a duplicate supporting artifact role ${artifact.role}`);
    }
    seenRoles.add(artifact.role);
    let actualPath;
    try {
      actualPath = absoluteEvidencePath(artifact.path, `${label} ${artifact.role}`);
    } catch (error) {
      throw new Error(`${label} supporting artifact ${artifact.role} path is invalid: ${error?.message ?? error}`);
    }
    if (actualPath !== expected.get(artifact.role)) {
      throw new Error(
        `${label} supporting artifact ${artifact.role} path must exactly match its declared path`,
      );
    }
  }
  if (seenRoles.size !== expected.size) {
    throw new Error(`${label} supporting artifact role/path set is incomplete`);
  }
  return true;
}

export function validateEvidence(
  input,
  state,
  {
    fileExists = (candidate) => true,
    readArtifact = (candidate) => fsSync.readFileSync(candidate),
    statArtifact = (candidate) => fsSync.statSync(candidate),
    realpathArtifact = (candidate) => fsSync.realpathSync(candidate),
    now = new Date(),
  } = {},
) {
  if (!input || typeof input !== 'object') throw new Error('evidence must be an object');
  const {
    surface,
    observedAt,
    commit,
    version,
    packageSha256,
    installedVersion,
    summary,
    screenshotBeforePath,
    screenshotAfterPath,
    accessibilityPath,
    runtimeLogPath,
    coverage,
    userConfirmed,
  } = input;
  const artifactPaths = Array.isArray(input.artifactPaths)
    ? input.artifactPaths
    : Array.isArray(input.artifacts) ? input.artifacts.map((artifact) => artifact?.path) : [];
  assertSurface(surface);
  if (artifactPaths.length > MAX_TOP_LEVEL_ARTIFACT_PATHS) {
    throw new Error(
      `top-level artifactPaths count exceeds the ${MAX_TOP_LEVEL_ARTIFACT_PATHS} artifact path limit`,
    );
  }
  if (state.status === 'COMPLETE') throw new Error('cannot add evidence to a completed release run');
  if (!hasReady(state.package) || !state.package.sha256) throw new Error('package must be READY before evidence is registered');
  if (!surfacePrerequisites[surface](state)) throw new Error(`${surface} evidence prerequisite is not READY`);
  if (commit !== state.commit) throw new Error('evidence commit does not match the release run');
  if (version !== state.version) throw new Error('evidence version does not match the release run');
  if (packageSha256 !== state.package.sha256) throw new Error('evidence package SHA does not match the release run');
  if (surface === 'installed' && installedVersion !== state.version) {
    throw new Error('installed evidence requires installedVersion equal to the release version');
  }
  if (surface === 'mobile' && userConfirmed !== true) {
    throw new Error('mobile evidence requires explicit userConfirmed: true');
  }
  assertObservedAt(observedAt, state, now);
  assertEvidenceAfterPrerequisite(observedAt, state, surface);
  assertSafeSummary(summary);
  if (typeof coverage !== 'object' || coverage === null) {
    throw new Error('evidence requires a coverage matrix result');
  }
  const coverageScope = coverage.scope ?? 'full';
  if (!evidenceScopes.has(coverageScope)) {
    throw new Error(`evidence coverage scope must be one of: ${[...evidenceScopes].join(', ')}`);
  }
  if (coverageScope !== 'full' && coverageScope !== surface) {
    throw new Error(`evidence coverage scope ${coverageScope} does not match surface ${surface}`);
  }
  if (surface === 'mobile' && coverageScope !== 'full') {
    throw new Error('mobile evidence requires a full coverage matrix');
  }
  if (
    coverage.commit !== commit
    || coverage.version !== version
    || typeof coverage.matrixPath !== 'string'
    || !/^[a-f0-9]{64}$/.test(coverage.matrixSha256 ?? '')
    || !Number.isInteger(coverage.totalRows)
    || coverage.totalRows <= 0
    || !Number.isInteger(coverage.passedRows)
    || !Number.isInteger(coverage.notApplicableRows)
    || coverage.passedRows + coverage.notApplicableRows !== coverage.totalRows
    || coverage.blockedRows !== 0
    || coverage.unverifiedRows !== 0
  ) {
    throw new Error('evidence coverage matrix must be current and have all rows passed with no blocked or unverified rows');
  }
  const beforePath = absoluteEvidencePath(screenshotBeforePath, 'screenshotBefore');
  const afterPath = absoluteEvidencePath(screenshotAfterPath, 'screenshotAfter');
  if (beforePath === afterPath) throw new Error('before and after screenshots must use different paths');
  const visualPaths = [...new Set([beforePath, afterPath, ...artifactPaths])];
  if (visualPaths.length < 2) {
    throw new Error('evidence requires distinct before and after screenshot paths');
  }
  const supportingPaths = [
    absoluteEvidencePath(accessibilityPath, 'accessibility'),
    absoluteEvidencePath(runtimeLogPath, 'runtime log'),
    absoluteEvidencePath(coverage.matrixPath, 'coverage matrix'),
  ];
  const evidenceRoot = path.normalize(realpathArtifact(path.dirname(supportingPaths[2])));
  const visualPreflight = visualPaths.map((candidate) => preflightArtifactPath(
    candidate,
    'evidence visual',
    'visual',
    { allowedRoot: evidenceRoot, fileExists, statArtifact, realpathArtifact },
  ));
  const supportingPreflight = supportingPaths.map((candidate) => preflightArtifactPath(
    candidate,
    'supporting evidence',
    'supporting',
    { allowedRoot: evidenceRoot, fileExists, statArtifact, realpathArtifact },
  ));
  const allTopLevelPreflight = [...visualPreflight, ...supportingPreflight];
  const topLevelPathIdentity = pathIdentityIndex();
  for (const artifact of allTopLevelPreflight) {
    assertPathIdentityNotReused(topLevelPathIdentity, artifact, `top-level evidence ${artifact.path}`);
    rememberPathIdentity(topLevelPathIdentity, artifact, `top-level evidence ${artifact.path}`);
  }
  const topLevelAggregateBytes = allTopLevelPreflight.reduce((total, artifact) => total + artifact.bytes, 0);
  if (topLevelAggregateBytes > MAX_MATRIX_AGGREGATE_BYTES) {
    throw new Error('top-level evidence aggregate artifact byte budget exceeds 64 MiB');
  }

  const topLevelIdentity = createArtifactIdentityIndex();
  const topLevelBytes = new Map();
  const topLevelInspections = new Map();
  for (const preflight of visualPreflight) {
    const bytes = readBoundedArtifact(
      preflight.path,
      preflight.bytes,
      MAX_MATRIX_ARTIFACT_BYTES,
      `top-level evidence ${preflight.path}`,
      readArtifact,
    );
    const actual = inspectArtifact(bytes);
    const inspected = { ...preflight, kind: 'visual', ...actual };
    assertArtifactNotReused(topLevelIdentity, inspected, `top-level evidence ${preflight.path}`);
    topLevelBytes.set(preflight.path, bytes);
    topLevelInspections.set(preflight.path, inspected);
  }
  for (const preflight of supportingPreflight) {
    const bytes = readBoundedArtifact(
      preflight.path,
      preflight.bytes,
      MAX_SUPPORTING_ARTIFACT_BYTES,
      `top-level supporting evidence ${preflight.path}`,
      readArtifact,
    );
    const actual = inspectSupportingArtifact(bytes, `top-level supporting evidence ${preflight.path}`);
    const inspected = { ...preflight, kind: 'supporting', ...actual };
    assertArtifactNotReused(topLevelIdentity, inspected, `top-level supporting evidence ${preflight.path}`);
    topLevelBytes.set(preflight.path, bytes);
    topLevelInspections.set(preflight.path, inspected);
  }
  const matrixInspection = inspectCoverageMatrix(
    topLevelBytes.get(supportingPaths[2]),
    coverage,
    { commit, version, packageSha256 },
    { fileExists, readArtifact, statArtifact, realpathArtifact, identityIndex: topLevelIdentity },
  );
  if (new Set(supportingPaths).size !== supportingPaths.length) {
    throw new Error('accessibility, runtime, and coverage artifacts must use distinct paths');
  }
  const artifacts = visualPreflight.map((preflight) => {
    const normalized = preflight.path;
    const inspected = topLevelInspections.get(normalized);
    return {
      ...inspected,
      role: normalized === beforePath ? 'screenshot-before' : normalized === afterPath ? 'screenshot-after' : 'screenshot-extra',
    };
  });
  const supportingArtifacts = supportingPreflight.map((preflight) => {
    const normalized = preflight.path;
    const inspected = topLevelInspections.get(normalized);
    const role = normalized === path.normalize(accessibilityPath)
      ? 'accessibility'
      : normalized === path.normalize(runtimeLogPath) ? 'runtime-log' : 'coverage-matrix';
    return { ...inspected, role };
  });
  assertExactSupportingArtifactSet({
    accessibilityPath: path.normalize(accessibilityPath),
    runtimeLogPath: path.normalize(runtimeLogPath),
    coverage: { matrixPath: path.normalize(coverage.matrixPath) },
  }, supportingArtifacts, 'registered supporting evidence');
  const currentArtifacts = [...artifacts, ...supportingArtifacts, ...matrixInspection.artifacts];
  for (const existingSurface of surfaces) {
    if (existingSurface === surface) continue;
    const existingArtifacts = allEvidenceArtifacts(state.evidence?.[existingSurface]);
    if (existingArtifacts.length === 0) continue;
    const existingIdentity = createArtifactIdentityIndex(existingArtifacts);
    for (const artifact of currentArtifacts) {
      const identity = artifactIdentityKey(artifact);
      const reusedBy = identity.realPath && existingIdentity.realPath.get(identity.realPath)
        || identity.inodeKey && existingIdentity.inodeKey.get(identity.inodeKey)
        || identity.contentKey && existingIdentity.contentKey.get(identity.contentKey);
      if (reusedBy) {
        throw new Error(
          `evidence artifact ${artifact.rowId ?? artifact.role ?? artifact.path} is already used by ${existingSurface} (${reusedBy}); cross-surface reuse is forbidden`,
        );
      }
    }
  }

  return {
    surface,
    observedAt,
    commit,
    version,
    packageSha256,
    ...(surface === 'installed' ? { installedVersion } : {}),
    ...(surface === 'mobile' ? { userConfirmed: true } : {}),
    summary: summary.trim(),
    screenshotBeforePath: beforePath,
    screenshotAfterPath: afterPath,
    accessibilityPath: path.normalize(accessibilityPath),
    runtimeLogPath: path.normalize(runtimeLogPath),
    coverage: {
      ...coverage,
      scope: coverageScope,
      matrixPath: path.normalize(coverage.matrixPath),
    },
    artifactPaths: artifacts.map(({ path: artifactPath }) => artifactPath),
    artifacts,
    supportingArtifacts,
    matrixArtifacts: matrixInspection.artifacts,
  };
}

export function reverifyEvidenceArtifacts(
  state,
  {
    fileExists = (candidate) => fsSync.existsSync(candidate),
    readArtifact = (candidate) => fsSync.readFileSync(candidate),
    statArtifact = (candidate) => fsSync.statSync(candidate),
    realpathArtifact = (candidate) => fsSync.realpathSync(candidate),
  } = {},
) {
  const identityIndex = createArtifactIdentityIndex();
  const pathSeen = pathIdentityIndex(identityIndex);
  for (const surface of surfaces) {
    const evidence = state.evidence?.[surface];
    if (!evidence) continue;
    try {
      assertExactSupportingArtifactSet(evidence, evidence.supportingArtifacts, `${surface} evidence`);
    } catch (error) {
      throw integrityError(error?.message ?? `${surface} supporting artifact role/path set is invalid`, surface);
    }
    const coverageMatrixPath = path.normalize(evidence.coverage?.matrixPath ?? '');
    let evidenceRoot;
    try {
      evidenceRoot = path.normalize(realpathArtifact(path.dirname(coverageMatrixPath)));
    } catch (error) {
      throw integrityError(`${surface} evidence root is unavailable: ${error?.message ?? coverageMatrixPath}`, surface);
    }
    if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) {
      throw integrityError(`${surface} evidence is missing artifact integrity metadata`, surface);
    }
    for (const artifact of evidence.artifacts) {
      if (!artifact || typeof artifact.path !== 'string' || !path.isAbsolute(artifact.path)) {
        throw integrityError(`${surface} evidence artifact path is invalid`, surface);
      }
      const artifactPath = path.normalize(artifact.path);
      if (!fileExists(artifactPath)) throw integrityError(`evidence artifact does not exist: ${artifactPath}`, surface);
      try {
        const preflight = preflightArtifactPath(artifactPath, `${surface} evidence`, 'visual', {
          allowedRoot: evidenceRoot,
          fileExists,
          statArtifact,
          realpathArtifact,
        });
        for (const field of ['realPath', 'bytes', 'device', 'inode']) {
          if (preflight[field] !== artifact[field]) throw new Error(`${field} changed after registration`);
        }
        assertPathIdentityNotReused(pathSeen, preflight, `${surface} evidence ${artifactPath}`);
        rememberPathIdentity(pathSeen, preflight, `${surface} evidence ${artifactPath}`);
        const actual = inspectArtifact(readBoundedArtifact(
          artifactPath,
          preflight.bytes,
          MAX_MATRIX_ARTIFACT_BYTES,
          `${surface} evidence ${artifactPath}`,
          readArtifact,
        ));
        if (actual.sha256 !== artifact.sha256) {
          throw new Error(`evidence artifact hash changed: ${artifactPath}`);
        }
        if (actual.width !== artifact.width || actual.height !== artifact.height) {
          throw new Error(`evidence artifact dimensions changed: ${artifactPath}`);
        }
        assertArtifactNotReused(identityIndex, {
          ...preflight,
          ...actual,
          kind: 'visual',
          role: artifact.role,
          evidenceSurface: surface,
          rowId: artifact.rowId,
        }, `${surface} evidence ${artifactPath}`);
      } catch (error) {
        if (error?.code === 'ELOOPINTEGRITY') throw error;
        throw integrityError(`${surface} evidence artifact is invalid: ${error?.message ?? artifactPath}`, surface);
      }
    }
    if (!Array.isArray(evidence.matrixArtifacts) || evidence.matrixArtifacts.length === 0) {
      throw integrityError(`${surface} evidence is missing persisted row artifact metadata`, surface);
    }
    for (const artifact of evidence.supportingArtifacts) {
      if (!artifact || typeof artifact.path !== 'string' || !path.isAbsolute(artifact.path)) {
        throw integrityError(`${surface} supporting evidence artifact path is invalid`, surface);
      }
      const artifactPath = path.normalize(artifact.path);
      if (!fileExists(artifactPath)) throw integrityError(`supporting evidence artifact does not exist: ${artifactPath}`, surface);
      try {
        const preflight = preflightArtifactPath(artifactPath, `${surface} supporting evidence`, 'supporting', {
          allowedRoot: evidenceRoot,
          fileExists,
          statArtifact,
          realpathArtifact,
        });
        for (const field of ['realPath', 'bytes', 'device', 'inode']) {
          if (preflight[field] !== artifact[field]) throw new Error(`${field} changed after registration`);
        }
        assertPathIdentityNotReused(pathSeen, preflight, `${surface} supporting evidence ${artifactPath}`);
        rememberPathIdentity(pathSeen, preflight, `${surface} supporting evidence ${artifactPath}`);
        const artifactBytes = readBoundedArtifact(
          artifactPath,
          preflight.bytes,
          MAX_SUPPORTING_ARTIFACT_BYTES,
          `${surface} supporting evidence ${artifactPath}`,
          readArtifact,
        );
        const actual = inspectSupportingArtifact(artifactBytes, artifact.role ?? 'supporting');
        if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes) {
          throw new Error(`supporting evidence artifact hash changed: ${artifactPath}`);
        }
        assertArtifactNotReused(identityIndex, {
          ...preflight,
          ...actual,
          kind: 'supporting',
          role: artifact.role,
          evidenceSurface: surface,
        }, `${surface} supporting evidence ${artifactPath}`);
        if (artifact.role === 'coverage-matrix') {
          const matrixInspection = inspectCoverageMatrix(artifactBytes, evidence.coverage, {
            commit: evidence.commit,
            version: evidence.version,
            packageSha256: evidence.packageSha256,
          }, { fileExists, readArtifact, statArtifact, realpathArtifact, identityIndex });
          if (matrixInspection.artifacts.length !== evidence.matrixArtifacts.length) {
            throw new Error('persisted row artifact count changed');
          }
          const persisted = new Map(evidence.matrixArtifacts.map((entry) => [`${entry.rowId}\0${entry.role}`, entry]));
          for (const current of matrixInspection.artifacts) {
            const previous = persisted.get(`${current.rowId}\0${current.role}`);
            if (!previous) throw new Error(`persisted row artifact metadata is missing ${current.rowId} ${current.role}`);
            for (const field of ['path', 'realPath', 'sha256', 'bytes', 'device', 'inode', 'kind', 'evidenceSurface']) {
              if (current[field] !== previous[field]) {
                throw new Error(`persisted row artifact ${current.rowId} ${current.role} ${field} changed`);
              }
            }
          }
        }
      } catch (error) {
        if (error?.code === 'ELOOPINTEGRITY') throw error;
        throw integrityError(`${surface} supporting evidence artifact is invalid: ${error?.message ?? artifactPath}`, surface);
      }
    }
  }
  return true;
}

export function reopenCoverageMatrices(
  state,
  { readArtifact = (candidate) => fsSync.readFileSync(candidate) } = {},
) {
  for (const surface of surfaces) {
    const evidence = state.evidence?.[surface];
    if (!evidence) throw integrityError(`${surface} coverage matrix is missing at completion`, surface);
    let matrixPath;
    try {
      matrixPath = absoluteEvidencePath(evidence.coverage?.matrixPath, `${surface} coverage matrix`);
      const bytes = readArtifact(matrixPath);
      if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_SUPPORTING_ARTIFACT_BYTES) {
        throw new Error(`${surface} coverage matrix reopen returned invalid bounded bytes`);
      }
      if (hashBytes(bytes) !== evidence.coverage.matrixSha256) {
        throw new Error(`${surface} coverage matrix hash changed before completion`);
      }
    } catch (error) {
      if (error?.code === 'ELOOPINTEGRITY') throw error;
      throw integrityError(`${surface} coverage matrix could not be reopened at completion: ${error?.message ?? matrixPath}`, surface);
    }
  }
  return true;
}

export function assertPackageIntegrity(
  state,
  { fileExists = (candidate) => fsSync.existsSync(candidate), readPackage = (candidate) => fsSync.readFileSync(candidate) } = {},
) {
  const packageEntry = state.package;
  if (!hasReady(packageEntry) || typeof packageEntry.packagePath !== 'string' || typeof packageEntry.sha256 !== 'string') {
    throw integrityError('release package integrity metadata is missing', 'package');
  }
  if (packageEntry.sourceCommit !== state.commit) {
    throw integrityError('release package source commit does not match the release run', 'package');
  }
  if (!path.isAbsolute(packageEntry.packagePath)) throw integrityError('release package path must be absolute', 'package');
  if (!fileExists(packageEntry.packagePath)) throw integrityError(`release package does not exist: ${packageEntry.packagePath}`, 'package');
  const actual = hashBytes(readPackage(packageEntry.packagePath));
  if (actual !== packageEntry.sha256) throw integrityError('release package SHA-256 changed after packaging', 'package');
  return true;
}

export function assertCurrentReleaseArtifacts(state, options = {}) {
  if (hasReady(state.package)) assertPackageIntegrity(state, options);
  reverifyEvidenceArtifacts(state, options);
  return true;
}

export function applyEvidence(state, evidence) {
  assertSurface(evidence?.surface);
  if (state.status === 'COMPLETE') throw new Error('cannot add evidence to a completed release run');
  if (!surfacePrerequisites[evidence.surface](state)) {
    throw new Error(`evidence is out of order for ${evidence.surface}`);
  }
  const nextEvidence = {
    ...state.evidence,
    [evidence.surface]: {
      status: 'READY',
      surface: evidence.surface,
      observedAt: evidence.observedAt,
      commit: evidence.commit,
      version: evidence.version,
      packageSha256: evidence.packageSha256,
      ...(evidence.surface === 'installed' ? { installedVersion: evidence.installedVersion } : {}),
      ...(evidence.surface === 'mobile' ? { userConfirmed: evidence.userConfirmed === true } : {}),
      summary: evidence.summary,
      screenshotBeforePath: evidence.screenshotBeforePath,
      screenshotAfterPath: evidence.screenshotAfterPath,
      accessibilityPath: evidence.accessibilityPath,
      runtimeLogPath: evidence.runtimeLogPath,
      coverage: { ...evidence.coverage },
      artifactPaths: [...evidence.artifactPaths],
      artifacts: evidence.artifacts.map((artifact) => ({ ...artifact })),
      supportingArtifacts: evidence.supportingArtifacts.map((artifact) => ({ ...artifact })),
      matrixArtifacts: evidence.matrixArtifacts.map((artifact) => ({ ...artifact })),
    },
  };
  for (const downstream of surfaces.slice(surfaces.indexOf(evidence.surface) + 1)) {
    nextEvidence[downstream] = null;
  }
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
    evidence: nextEvidence,
  };
  next.status = deriveStatus(next);
  return next;
}

function routeResponseHeader(response, name) {
  const fromHeaders = response?.headers?.get?.(name);
  if (typeof fromHeaders === 'string') return fromHeaders;
  const direct = response?.headers?.[name] ?? response?.headers?.[name.toLowerCase()];
  return typeof direct === 'string' ? direct : undefined;
}

function routeUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  return parsed;
}

function routeSearch(query) {
  const value = String(query ?? '');
  if (!value) return '';
  return value.startsWith('?') ? value : `?${value}`;
}

function routeProbeError(message, code = 'ELOOPPHASE') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function fetchPublicRoute(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return { response: await fetch(url, { redirect: 'manual', signal: controller.signal }) };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw routeProbeError(`public tab route probe timed out after ${timeoutMs}ms`, 'ETIMEDOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function assertPublicTabRoutes(routes, label = 'public tab route probe') {
  const redirect = routes?.redirect;
  const canonical = routes?.canonical;
  if (!redirect || !canonical) throw routeProbeError(`${label} must contain redirect and canonical route evidence`);

  const redirectRequest = routeUrl(redirect.requestUrl, `${label} no-slash request URL`);
  if (redirectRequest.pathname !== '/tabs/home') {
    throw routeProbeError(`${label} no-slash request must use /tabs/home`);
  }
  if (redirect.status !== 308) {
    throw routeProbeError(`${label} no-slash /tabs/home must return HTTP 308`);
  }
  const redirectLocation = routeUrl(redirect.location, `${label} redirect location`);
  if (redirectLocation.pathname !== '/tabs/home/') {
    throw routeProbeError(`${label} redirect location must use /tabs/home/`);
  }
  if (redirectLocation.search !== redirectRequest.search) {
    throw routeProbeError(`${label} /tabs/home redirect must preserve its query string`);
  }

  const canonicalRequest = routeUrl(canonical.requestUrl, `${label} canonical request URL`);
  if (canonicalRequest.pathname !== '/tabs/home/') {
    throw routeProbeError(`${label} canonical request must use /tabs/home/`);
  }
  if (canonical.status !== 200) {
    throw routeProbeError(`${label} canonical /tabs/home/ must return HTTP 200`);
  }
  const canonicalFinal = routeUrl(canonical.finalUrl, `${label} canonical final URL`);
  if (canonicalFinal.pathname !== '/tabs/home/') {
    throw routeProbeError(`${label} canonical final URL must use /tabs/home/`);
  }
  if (canonicalFinal.search !== canonicalRequest.search) {
    throw routeProbeError(`${label} canonical /tabs/home/ must preserve its query string`);
  }
  return routes;
}

export async function probePublicTabRoutes({
  baseUrl,
  query = 'release-loop-probe=1',
  timeoutMs = PUBLIC_ROUTE_PROBE_TIMEOUT_MS,
  fetchResource = fetchPublicRoute,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('public tab route probe timeout must be a positive integer');
  }
  const base = routeUrl(baseUrl, 'public route probe base URL');
  const search = routeSearch(query);
  const noSlashUrl = new URL(`/tabs/home${search}`, base.origin).href;
  const canonicalUrl = new URL(`/tabs/home/${search}`, base.origin).href;

  const redirectResult = await fetchResource(noSlashUrl, timeoutMs, { redirect: 'manual' });
  const redirectResponse = redirectResult?.response ?? redirectResult;
  const location = routeResponseHeader(redirectResponse, 'location');
  if (!location) throw routeProbeError('public tab route probe did not return a redirect location for /tabs/home');
  const redirectEvidence = {
    requestUrl: noSlashUrl,
    status: redirectResponse?.status,
    location: new URL(location, redirectResponse?.url || noSlashUrl).href,
  };
  if (routeUrl(redirectEvidence.location, 'public tab redirect location').origin !== base.origin) {
    throw routeProbeError('public tab redirect location must remain on the public tab origin');
  }
  if (redirectEvidence.status !== 308) {
    return assertPublicTabRoutes({
      redirect: redirectEvidence,
      canonical: { requestUrl: canonicalUrl, status: undefined, finalUrl: canonicalUrl },
    });
  }

  const canonicalResult = await fetchResource(canonicalUrl, timeoutMs, { redirect: 'manual' });
  const canonicalResponse = canonicalResult?.response ?? canonicalResult;
  const canonicalFinalUrl = canonicalResponse?.url || canonicalUrl;
  if (routeUrl(canonicalFinalUrl, 'public tab canonical final URL').origin !== base.origin) {
    throw routeProbeError('public tab canonical final URL must remain on the public tab origin');
  }
  return assertPublicTabRoutes({
    redirect: redirectEvidence,
    canonical: {
      requestUrl: canonicalUrl,
      status: canonicalResponse?.status,
      finalUrl: canonicalFinalUrl,
    },
  });
}

function originAndPath(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${parsed.origin}${pathname}`;
}

function assertPublicAssetIdentity(asset, label) {
  if (!hasPublicAssetIdentity(asset)) throw new Error(`${label} public asset build identity is missing or invalid`);
  return asset;
}

export function assertPublicProbeMatches(state, currentPublic) {
  if (
    state.package?.sourceCommit !== state.commit
    || state.public?.sourceCommit !== state.commit
    || currentPublic?.sourceCommit !== state.commit
  ) {
    throw new Error('current or recorded public source commit does not match the release run');
  }
  if (
    currentPublic?.version !== state.version
    || (currentPublic?.health?.version !== undefined && currentPublic.health.version !== currentPublic.version)
    || state.public?.version !== state.version
    || (state.public?.health?.version !== undefined && state.public.health.version !== state.public.version)
  ) {
    throw new Error('current public health version does not match the recorded release version');
  }
  if (currentPublic?.packageSha256 !== state.package?.sha256) {
    throw new Error('current public package SHA does not match the recorded package');
  }
  if (state.public?.packageSha256 !== state.package?.sha256) {
    throw new Error('recorded public package SHA does not match the current release package');
  }
  const packagedUrl = state.package?.manifest?.contentUrl;
  const recordedUrl = state.public?.tab?.finalUrl;
  const currentUrl = currentPublic?.tab?.finalUrl;
  if (!packagedUrl || !recordedUrl || !currentUrl) {
    throw new Error('public probe is missing the packaged or recorded tab URL');
  }
  const expected = originAndPath(packagedUrl, 'packaged tab URL');
  if (originAndPath(recordedUrl, 'recorded tab URL') !== expected) {
    throw new Error('recorded public tab URL does not match the packaged host and path');
  }
  if (originAndPath(currentUrl, 'current tab URL') !== expected) {
    throw new Error('current public tab URL does not match the packaged host and path');
  }
  const recordedRoutes = assertPublicTabRoutes(state.public?.tabRoutes, 'recorded public tab route probe');
  const currentRoutes = assertPublicTabRoutes(currentPublic?.tabRoutes, 'current public tab route probe');
  const packagedOrigin = routeUrl(packagedUrl, 'packaged tab URL').origin;
  for (const [label, routes] of [['recorded', recordedRoutes], ['current', currentRoutes]]) {
    for (const candidate of [routes.redirect.requestUrl, routes.redirect.location, routes.canonical.requestUrl, routes.canonical.finalUrl]) {
      if (routeUrl(candidate, `${label} public tab route URL`).origin !== packagedOrigin) {
        throw new Error(`${label} public tab route probe does not match the packaged host`);
      }
    }
  }
  const recordedAsset = assertPublicAssetIdentity(state.public?.asset, 'recorded');
  const currentAsset = assertPublicAssetIdentity(currentPublic?.asset, 'current');
  if (
    recordedAsset.buildId !== currentAsset.buildId
    || recordedAsset.sha256 !== currentAsset.sha256
    || recordedAsset.finalUrl !== currentAsset.finalUrl
  ) throw new Error('current deployed asset build identity does not match the recorded public phase');
  if (state.public?.tab?.buildId !== undefined && state.public.tab.buildId !== recordedAsset.buildId) {
    throw new Error('recorded public tab build identity does not match its asset');
  }
  if (currentPublic?.tab?.buildId !== undefined && currentPublic.tab.buildId !== currentAsset.buildId) {
    throw new Error('current public tab build identity does not match its asset');
  }
  return true;
}

export function completionMessage(state) {
  if (state.lastFailure) throw new Error('release is blocked by a last phase failure; retry the failed phase before completing');
  const missing = missingGates(state);
  if (missing.length > 0) throw new Error(`release is not complete; missing gates: ${missing.join(', ')}`);
  return [
    '✅ Teams 앱 릴리스 완료',
    `버전: ${state.version}`,
    `커밋: ${state.shortCommit}`,
    `패키지 SHA-256: ${state.package.sha256}`,
    `공개 health: ${state.public.health.environment} / ${state.public.health.auth} / ${state.public.health.bot} / ${state.public.health.outbound}`,
    'UI 증거: 포털 업로드, 설치 버전, 데스크톱, 모바일 확인 완료',
  ].join('\n');
}

export function statePathFromEnv(env = process.env) {
  return path.resolve(env.RELEASE_LOOP_STATE_PATH || path.join(root, '.release', 'current.json'));
}

export function assertCanonicalReleaseDriver(env = process.env) {
  if (env.RELEASE_UPDATE_DRIVER === '1' && env.RELEASE_LOOP_STATE_PATH) return true;
  const error = new Error(
    'release-loop is an internal state-machine driver; use `npm run release:update -- run` so the canonical .release/update-current.json state and lock are preserved',
  );
  error.code = 'ERELEASEENTRYPOINT';
  throw error;
}

export async function readState(statePath = statePathFromEnv()) {
  return JSON.parse(await fs.readFile(statePath, 'utf8'));
}

export async function writeState(state, statePath = statePathFromEnv()) {
  const directory = path.dirname(statePath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${statePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, statePath);
}

const GIT_SNAPSHOT_TIMEOUT_MS = 20_000;

export function classifyGitStatus(porcelain) {
  const lines = String(porcelain || '').split('\n').map((line) => line.trimEnd()).filter(Boolean);
  const untracked = lines.filter((line) => line.startsWith('??'));
  return {
    trackedDirty: lines.some((line) => !line.startsWith('??')),
    untracked,
  };
}

export function requestedSourceIoMode(env = process.env) {
  return env.TEAMS_FILEPROVIDER_SERVER_REUSE === '1'
    ? 'index-tree-fileprovider-fallback'
    : 'normal';
}

function runGitReadOnly(rootDir, args, env = process.env) {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
      timeout: GIT_SNAPSHOT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      killSignal: 'SIGKILL',
    });
  } catch (error) {
    if (error?.code === 'ETIMEDOUT' || error?.killed || error?.signal) {
      const blocker = new Error(
        'Git worktree inspection timed out; check for macOS FileProvider/dataless files before retrying the release loop',
      );
      blocker.code = 'ESOURCEIOBLOCKED';
      blocker.cause = error;
      throw blocker;
    }
    throw error;
  }
}

export function createGitSnapshot({
  rootDir = root,
  env = process.env,
  verifySource = assertCleanTrackedWorktreeForFileProvider,
  resolveSource = resolvePinnedCommitOid,
  runGit = (args) => runGitReadOnly(rootDir, args, env),
} = {}) {
  const pinnedCommitOid = env.TEAMS_SOURCE_COMMIT ?? resolveSource(rootDir, {
    env,
    timeoutMs: GIT_SNAPSHOT_TIMEOUT_MS,
  });
  if (!isFullCommitOid(pinnedCommitOid)) {
    throw new Error('release loop source resolver did not return a full Git OID');
  }
  let verification;
  try {
    verification = verifySource(rootDir, {
      commitOid: pinnedCommitOid,
      env,
      timeoutMs: GIT_SNAPSHOT_TIMEOUT_MS,
    });
  } catch (error) {
    if (error?.code === 'ETIMEDOUT' || error?.signal) {
      const blocker = new Error(
        'Git worktree inspection timed out; check for macOS FileProvider/dataless files before retrying the release loop',
        { cause: error },
      );
      blocker.code = 'ESOURCEIOBLOCKED';
      throw blocker;
    }
    throw error;
  }
  const commit = verification?.commitOid;
  if (commit !== pinnedCommitOid) {
    throw new Error('release loop source verification changed the pinned Git OID');
  }

  let untrackedBytes;
  try {
    untrackedBytes = runGit(['ls-files', '--others', '--exclude-standard', '-z', '--']);
  } catch (error) {
    if (error?.code === 'ESOURCEIOBLOCKED') throw error;
    throw new Error(`failed to inspect untracked release artifacts: ${error?.message ?? error}`, { cause: error });
  }
  const untracked = String(untrackedBytes).split('\0').filter(Boolean).map((fileName) => `?? ${fileName}`);
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    dirty: false,
    untracked,
    porcelain: untracked.join('\n'),
    sourceIoMode: requestedSourceIoMode(env),
    verificationMode: verification.verificationMode,
  };
}

const UNTRACKED_HASH_CHUNK_BYTES = 1024 * 1024;
const UNTRACKED_BASELINE_FIELDS = ['type', 'device', 'inode', 'mode', 'size', 'sha256', 'target'];

function untrackedRelativePath(entry) {
  if (typeof entry !== 'string') throw new Error('release loop untracked path must be a string');
  const candidate = entry.startsWith('?? ')
    ? entry.slice(3)
    : entry.startsWith('??')
      ? entry.slice(2)
      : entry;
  if (candidate.length === 0 || candidate.includes('\0')) {
    throw new Error('release loop untracked path must be non-empty and NUL-free');
  }
  return candidate;
}

function untrackedPathOnDisk(relativePath, rootDir, realpath = fsSync.realpathSync) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`release loop untracked path must be relative: ${relativePath}`);
  }
  const absoluteRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  if (!isPathInside(absoluteRoot, absolutePath) || absolutePath === absoluteRoot) {
    throw new Error(`release loop untracked path escapes the repository: ${relativePath}`);
  }
  const canonicalRoot = realpath(absoluteRoot);
  const canonicalParent = realpath(path.dirname(absolutePath));
  if (!isPathInside(canonicalRoot, canonicalParent)) {
    throw new Error(`release loop untracked path escapes the repository through a symlinked parent: ${relativePath}`);
  }
  // Use the canonical parent for all subsequent operations so a parent
  // symlink cannot be swapped after the containment check and redirect the
  // hash/open operation outside the repository.
  return path.join(canonicalParent, path.basename(absolutePath));
}

function statFingerprint(metadata) {
  return {
    device: safeStatNumber(metadata.dev),
    inode: safeStatNumber(metadata.ino),
    mode: safeStatNumber(metadata.mode) === null ? null : metadata.mode & 0o7777,
    size: safeStatNumber(metadata.size),
  };
}

function assertSameFileFingerprint(expected, observed, filePath) {
  const expectedFingerprint = statFingerprint(expected);
  const observedFingerprint = statFingerprint(observed);
  for (const field of ['device', 'inode', 'mode', 'size']) {
    if (expectedFingerprint[field] !== observedFingerprint[field]) {
      throw new Error(`release loop untracked file changed while reading: ${filePath}`);
    }
  }
}

function hashUntrackedFileSync(filePath, expectedMetadata) {
  const noFollow = fsSync.constants.O_NOFOLLOW ?? 0;
  const descriptor = fsSync.openSync(filePath, fsSync.constants.O_RDONLY | noFollow);
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(UNTRACKED_HASH_CHUNK_BYTES);
  let position = 0;
  try {
    const observedBeforeRead = fsSync.fstatSync(descriptor);
    if (expectedMetadata) assertSameFileFingerprint(expectedMetadata, observedBeforeRead, filePath);
    while (true) {
      const bytesRead = fsSync.readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const observedAfterRead = fsSync.fstatSync(descriptor);
    assertSameFileFingerprint(observedBeforeRead, observedAfterRead, filePath);
    return digest.digest('hex');
  } finally {
    fsSync.closeSync(descriptor);
  }
}

function safeStatNumber(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function snapshotUntrackedPath(
  relativePath,
  {
    rootDir = root,
    lstat = (candidate) => fsSync.lstatSync(candidate),
    readlink = (candidate) => fsSync.readlinkSync(candidate),
    hashFile = hashUntrackedFileSync,
    realpath = (candidate) => fsSync.realpathSync(candidate),
  } = {},
) {
  const absolutePath = untrackedPathOnDisk(relativePath, rootDir, realpath);
  const metadata = lstat(absolutePath);
  const base = {
    path: relativePath,
    type: null,
    device: safeStatNumber(metadata.dev),
    inode: safeStatNumber(metadata.ino),
    mode: safeStatNumber(metadata.mode) === null ? null : metadata.mode & 0o7777,
    size: safeStatNumber(metadata.size),
    sha256: null,
    target: null,
  };
  if (metadata.isSymbolicLink()) {
    const target = readlink(absolutePath);
    return {
      ...base,
      type: 'symlink',
      size: Buffer.byteLength(target),
      sha256: hashBytes(Buffer.from(target, 'utf8')),
      target,
    };
  }
  if (!metadata.isFile()) {
    throw new Error(`release loop baseline untracked path must be a regular file or symlink: ${relativePath}`);
  }
  return {
    ...base,
    type: 'file',
    sha256: hashFile(absolutePath, metadata),
  };
}

export function captureUntrackedBaseline(
  untrackedAtStart,
  {
    rootDir = root,
    lstat,
    readlink,
    hashFile,
    realpath,
  } = {},
) {
  if (!Array.isArray(untrackedAtStart)) throw new Error('release loop requires untrackedAtStart to be an array');
  const paths = untrackedAtStart.map(untrackedRelativePath);
  const seen = new Set();
  return paths.map((relativePath) => {
    if (seen.has(relativePath)) throw new Error(`release loop has duplicate untracked baseline path: ${relativePath}`);
    seen.add(relativePath);
    try {
      return snapshotUntrackedPath(relativePath, { rootDir, lstat, readlink, hashFile, realpath });
    } catch (error) {
      const blocker = new Error(
        `release loop could not fingerprint initial untracked path ${relativePath}: ${error?.message ?? error}`,
        { cause: error },
      );
      blocker.code = 'EUNTRACKEDBASELINEINVALID';
      throw blocker;
    }
  });
}

function untrackedMutationError(relativePath, reason, cause) {
  const blocker = new Error(
    `release loop baseline untracked file was deleted, moved, or replaced: ${relativePath} (${reason})`,
    cause ? { cause } : undefined,
  );
  blocker.code = 'EUNTRACKEDSTARTMUTATED';
  return blocker;
}

export function assertInitialUntrackedPreserved(
  state,
  {
    rootDir = root,
    lstat,
    readlink,
    hashFile,
    realpath,
  } = {},
) {
  const paths = (state?.untrackedAtStart ?? []).map(untrackedRelativePath);
  if (paths.length === 0) return { checked: 0 };
  const baseline = state?.untrackedAtStartBaseline;
  if (!Array.isArray(baseline) || baseline.length !== paths.length) {
    const blocker = new Error(
      'release loop cannot verify baseline untracked files because untrackedAtStart fingerprints are unavailable; supersede and restart the release loop',
    );
    blocker.code = 'EUNTRACKEDBASELINEUNAVAILABLE';
    throw blocker;
  }
  const baselineByPath = new Map();
  for (const entry of baseline) {
    if (!entry || typeof entry.path !== 'string' || baselineByPath.has(entry.path)) {
      const blocker = new Error('release loop baseline untracked fingerprints are invalid; supersede and restart the release loop');
      blocker.code = 'EUNTRACKEDBASELINEUNAVAILABLE';
      throw blocker;
    }
    baselineByPath.set(entry.path, entry);
  }
  for (const relativePath of paths) {
    const expected = baselineByPath.get(relativePath);
    if (!expected) {
      const blocker = new Error(
        `release loop baseline fingerprint is missing for initial untracked path ${relativePath}; supersede and restart the release loop`,
      );
      blocker.code = 'EUNTRACKEDBASELINEUNAVAILABLE';
      throw blocker;
    }
    let current;
    try {
      current = snapshotUntrackedPath(relativePath, { rootDir, lstat, readlink, hashFile, realpath });
    } catch (error) {
      throw untrackedMutationError(relativePath, 'the path is missing or cannot be read', error);
    }
    const changedFields = UNTRACKED_BASELINE_FIELDS.filter((field) => current[field] !== expected[field]);
    if (changedFields.length > 0) {
      throw untrackedMutationError(relativePath, `fingerprint changed (${changedFields.join(', ')})`);
    }
  }
  return { checked: paths.length };
}

export function readSourceVersion(
  sourceCommit,
  {
    rootDir = root,
    env = process.env,
    runGit = (args) => runGitReadOnly(rootDir, args, env),
  } = {},
) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sourceCommit ?? '')) {
    throw new Error('release source version requires a full Git OID');
  }
  return JSON.parse(runGit(['show', `${sourceCommit}:appPackage/manifest.json`])).version;
}

function releaseVersionParts(value, label) {
  const match = RELEASE_VERSION_PATTERN.exec(String(value ?? ''));
  if (!match) {
    const error = new Error(`${label} must be a stable X.Y.Z release version; received ${value ?? '<missing>'}`);
    error.code = 'EVERSIONNOTBUMPED';
    throw error;
  }
  return match.slice(1).map(Number);
}

/**
 * Teams treats an app update as a new versioned package. Keep the release
 * entrypoint from starting a new identity when only the source commit changed.
 */
export function assertReleaseVersionAdvanced(currentVersion, previousVersion) {
  const current = releaseVersionParts(currentVersion, 'current release version');
  const previous = releaseVersionParts(previousVersion, 'previous release version');
  const advanced = current.some((part, index) => part !== previous[index]
    && part > previous[index]
    && current.slice(0, index).every((prefix, prefixIndex) => prefix === previous[prefixIndex]));
  if (!advanced) {
    const error = new Error(
      `release version ${currentVersion} must be greater than the previous source version ${previousVersion}; bump package.json, package-lock.json, and appPackage/manifest.json before release`,
    );
    error.code = 'EVERSIONNOTBUMPED';
    throw error;
  }
  return true;
}

export function readPreviousSourceVersion(
  sourceCommit,
  {
    rootDir = root,
    env = process.env,
    runGit = (args) => runGitReadOnly(rootDir, args, env),
  } = {},
) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sourceCommit ?? '')) {
    throw new Error('previous release version requires a full Git OID');
  }
  let parentCommit;
  try {
    parentCommit = runGit(['rev-parse', `${sourceCommit}^`]).trim();
  } catch {
    return null;
  }
  return { commit: parentCommit, version: readSourceVersion(parentCommit, { rootDir, env, runGit }) };
}

function gitSnapshot(env = process.env) {
  return createGitSnapshot({ env });
}

function assertCurrentGit(state, { requireClean = true } = {}) {
  const currentHead = resolvePinnedCommitOid(root, {
    env: process.env,
    timeoutMs: GIT_SNAPSHOT_TIMEOUT_MS,
  });
  if (currentHead !== state.commit) {
    const error = new Error(
      `release run is stale: recorded commit ${state.commit} does not match current Git HEAD ${currentHead}; supersede and restart the release loop`,
    );
    error.code = 'ESTALERELEASE';
    throw error;
  }
  const current = gitSnapshot({ ...process.env, TEAMS_SOURCE_COMMIT: state.commit });
  if (current.commit !== state.commit) throw new Error('current Git commit does not match the release run');
  if (requireClean && current.dirty) throw new Error('release loop requires a clean Git worktree');
  assertInitialUntrackedPreserved(state);
  return current;
}

async function requireState(statePath) {
  try {
    return await readState(statePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`no active release run at ${statePath}`);
    throw error;
  }
}

function phaseField(phase) {
  return phase === 'machine' ? 'machine' : phase;
}

export function summarizePhase(phase, payload) {
  const completedAt = new Date().toISOString();
  if (phase === 'machine') {
    const evidence = payload.evidence ?? [];
    const sourceCommits = new Set(evidence.map((entry) => entry.sourceCommit).filter(Boolean));
    if (sourceCommits.size !== 1) throw new Error('machine gate did not return one pinned source commit');
    return {
      status: 'READY',
      completedAt,
      sourceCommit: [...sourceCommits][0],
      commands: evidence.map(({ command, exitCode }) => ({ command, exitCode })),
    };
  }
  if (phase === 'package') {
    const packageEntry = payload.evidence?.find((entry) => typeof entry.package === 'string');
    const manifestEvidence = payload.evidence?.find((entry) => entry.manifest)?.manifest;
    if (!packageEntry || !manifestEvidence) throw new Error('package gate returned incomplete package evidence');
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(packageEntry.sourceCommit ?? '')) {
      throw new Error('package gate returned no full pinned source commit');
    }
    return {
      status: 'READY',
      completedAt,
      sourceCommit: packageEntry.sourceCommit,
      packagePath: packageEntry.package,
      version: packageEntry.version,
      sha256: packageEntry.sha256,
      manifest: manifestEvidence,
    };
  }
  const health = payload.evidence?.find((entry) => entry.health)?.health;
  const tab = payload.evidence?.find((entry) => entry.tab)?.tab;
  const asset = payload.evidence?.find((entry) => entry.asset)?.asset;
  const tabRoutes = payload.evidence?.find((entry) => entry.tabRoutes)?.tabRoutes ?? payload.tabRoutes;
  const packageEntry = payload.evidence?.find((entry) => typeof entry.package === 'string');
  if (!health || !tab || !asset || !tabRoutes || !packageEntry) {
    throw new Error('public gate returned incomplete public asset or route evidence');
  }
  if (
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(packageEntry.sourceCommit ?? '')
    || health.sourceCommit !== packageEntry.sourceCommit
  ) {
    throw new Error('public gate source commit does not match the packaged source identity');
  }
  assertPublicAssetIdentity(asset, 'public gate');
  assertPublicTabRoutes(tabRoutes, 'public gate');
  return {
    status: 'READY',
    completedAt,
    sourceCommit: packageEntry.sourceCommit,
    version: health.version,
    health,
    tab,
    tabRoutes,
    asset,
    packagePath: packageEntry.package,
    packageSha256: packageEntry.sha256,
  };
}

const phaseTimeouts = {
  // Keep the outer process alive for every sequential inner command plus
  // bounded process startup and cleanup overhead.
  machine: createPreflightCommands()
    .reduce((total, [, , timeoutMs]) => total + timeoutMs, 30_000),
  // release-gate/package runs four bounded commands in series; the outer
  // process must not reap a healthy build halfway through that contract.
  package: packageGateTimeoutMs(),
  public: 30_000,
};

export function gatePhaseForLoop(phase) {
  return phase === 'machine' ? 'preflight' : phase;
}

export function parseGatePayload(stdout, stderr) {
  const source = String(stdout || stderr || '').trim();
  if (!source) throw new Error('release gate returned no JSON evidence');
  return JSON.parse(source);
}

export async function runGatePhase(
  phase,
  { url, env, runGate = runWithTimeout, probeRoutes = probePublicTabRoutes } = {},
) {
  const gatePath = path.join(root, 'scripts', 'release-gate.mjs');
  const args = [gatePath, gatePhaseForLoop(phase)];
  if (url) args.push('--url', url);
  const result = await runGate(process.execPath, args, {
    cwd: root,
    timeoutMs: phaseTimeouts[phase],
    maxOutputChars: 20_000,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  let payload;
  try {
    payload = parseGatePayload(result.stdout, result.stderr);
  } catch {
    const error = new Error(`release gate ${phase} did not return JSON evidence`);
    error.code = 'ELOOPPHASE';
    error.output = output.slice(-4_000);
    throw error;
  }
  if (result.code !== 0 || payload.status !== 'READY') {
    const error = new Error(`release gate ${phase} is ${payload.status ?? 'FAILED'}`);
    error.code = payload.blocker?.code ?? (result.code === null ? 'ETIMEDOUT' : 'ELOOPPHASE');
    error.output = output.slice(-4_000);
    throw error;
  }
  if (phase === 'public') {
    let runtimeValues = {};
    try {
      runtimeValues = parseDotEnv(await fs.readFile(path.join(root, '.env.runtime'), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const publicUrl = url || resolvePublicUrl({ ...runtimeValues, ...process.env });
    if (!publicUrl) throw routeProbeError('public route probe requires --url, TEAMS_PUBLIC_URL, PUBLIC_BASE_URL, or TAB_DOMAIN');
    let tabRoutes;
    try {
      tabRoutes = await probeRoutes({
        baseUrl: publicUrl,
        timeoutMs: PUBLIC_ROUTE_PROBE_TIMEOUT_MS,
      });
    } catch (error) {
      if (!error?.code) error.code = 'ELOOPPHASE';
      throw error;
    }
    payload.evidence = [...(Array.isArray(payload.evidence) ? payload.evidence : []), { tabRoutes }];
  }
  return payload;
}

export async function completeReleaseState(
  state,
  {
    probePublic = async () => summarizePhase('public', await runGatePhase('public', {
      env: {
        TEAMS_SOURCE_COMMIT: state.commit,
        ...(state.sourceIoMode === 'index-tree-fileprovider-fallback'
          ? { TEAMS_FILEPROVIDER_SERVER_REUSE: '1' }
          : {}),
      },
    })),
    verifyPackage = () => assertPackageIntegrity(state),
    verifyEvidence,
    readArtifact,
    now = new Date(),
  } = {},
) {
  if (state.lastFailure) {
    const error = new Error('release is blocked by a last phase failure; retry the failed phase before completing');
    error.code = 'ELOOPBLOCKED';
    throw error;
  }
  const missing = missingGates(state);
  if (missing.length > 0) {
    const error = new Error(`release is blocked by: ${missing.join(', ')}`);
    error.code = 'ELOOPBLOCKED';
    error.missing = missing;
    throw error;
  }
  const verifyCurrentEvidence = verifyEvidence
    ?? (() => reverifyEvidenceArtifacts(state, readArtifact ? { readArtifact } : undefined));
  verifyPackage();
  verifyCurrentEvidence();
  const probe = await probePublic();
  const currentPublic = probe?.evidence ? summarizePhase('public', probe) : probe;
  assertPublicProbeMatches(state, currentPublic);
  verifyPackage();
  verifyCurrentEvidence();
  reopenCoverageMatrices(state, {
    readArtifact: readArtifact ?? ((candidate) => fsSync.readFileSync(candidate)),
  });
  const timestamp = now instanceof Date ? now.toISOString() : new Date().toISOString();
  return {
    ...state,
    status: 'COMPLETE',
    completedAt: timestamp,
    updatedAt: timestamp,
  };
}

function nextAction(state) {
  if (state.status === 'SUPERSEDED') return 'START';
  return missingGates(state)[0] ?? 'COMPLETE';
}

function publicResult(state) {
  const currentStatus = deriveStatus(state);
  const missing = missingGates(state);
  return {
    status: state.lastFailure ? 'BLOCKED' : state.status === 'COMPLETE' ? 'READY' : 'IN_PROGRESS',
    phase: 'status',
    runId: state.runId,
    state: currentStatus,
    nextAction: nextAction(state),
    missingGates: missing,
    commit: state.shortCommit,
    version: state.version,
    lastFailure: state.lastFailure,
  };
}

function jsonLog(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

async function startRun(statePath) {
  if (fsSync.existsSync(statePath)) {
    const existing = await readState(statePath);
    if (!terminalReleaseStates.has(existing.status)) {
      const error = new Error(`an active release run already exists: ${existing.runId}`);
      error.code = 'ELOOPACTIVE';
      throw error;
    }
  }
  const git = gitSnapshot();
  if (git.dirty) throw new Error('release loop requires a clean Git worktree at start');
  const previousRelease = readPreviousSourceVersion(git.commit);
  if (previousRelease) assertReleaseVersionAdvanced(readSourceVersion(git.commit), previousRelease.version);
  const untrackedAtStartBaseline = captureUntrackedBaseline(git.untracked);
  const startedAt = new Date().toISOString();
  const state = createInitialState({
    runId: crypto.randomUUID(),
    commit: git.commit,
    shortCommit: git.shortCommit,
    version: readSourceVersion(git.commit),
    startedAt,
    untrackedAtStart: git.untracked,
    untrackedAtStartBaseline,
    sourceIoMode: git.sourceIoMode,
  });
  await writeState(state, statePath);
  jsonLog({ status: 'READY', phase: 'start', runId: state.runId, state: state.status, nextAction: nextAction(state) });
}

async function supersedeRun(statePath, reason) {
  const state = await requireState(statePath);
  if (state.status === 'COMPLETE') {
    const error = new Error('a completed release run cannot be superseded');
    error.code = 'ELOOPCOMPLETE';
    throw error;
  }
  if (state.status === 'SUPERSEDED') {
    return jsonLog({
      status: 'READY',
      phase: 'supersede',
      runId: state.runId,
      state: state.status,
      nextAction: 'START',
    });
  }
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 500) {
    throw new Error('supersede requires --reason between 8 and 500 characters');
  }
  const timestamp = new Date().toISOString();
  const next = {
    ...state,
    status: 'SUPERSEDED',
    updatedAt: timestamp,
    supersededAt: timestamp,
    supersededReason: reason.trim(),
  };
  await writeState(next, statePath);
  jsonLog({
    status: 'READY',
    phase: 'supersede',
    runId: next.runId,
    state: next.status,
    nextAction: 'START',
  });
}

async function executePhase(phase, statePath, { url } = {}) {
  const state = await requireState(statePath);
  try {
    assertCurrentGit(state);
    if (phase === 'package' && !hasReady(state.machine)) throw new Error('machine phase must be READY before package');
    if (phase === 'public' && !hasReady(state.package)) throw new Error('package phase must be READY before public');
    if (phase === 'public') assertPackageIntegrity(state);
    const payload = await runGatePhase(phase, {
      url,
      env: {
        TEAMS_SOURCE_COMMIT: state.commit,
        ...(state.sourceIoMode === 'index-tree-fileprovider-fallback'
          ? { TEAMS_FILEPROVIDER_SERVER_REUSE: '1' }
          : {}),
      },
    });
    const summarized = summarizePhase(phase, payload);
    if (summarized.sourceCommit !== state.commit) {
      throw new Error(`${phase} source commit does not match the release run`);
    }
    if (phase === 'package' && summarized.version !== state.version) throw new Error('package version does not match the release run');
    if (phase === 'public') {
      if (summarized.version !== state.version) throw new Error('public health version does not match the release run');
      if (summarized.packageSha256 !== state.package.sha256) throw new Error('public package SHA does not match the release run');
      assertPackageIntegrity(state);
    }
    const next = applyPhaseSuccess(state, phase, summarized);
    await writeState(next, statePath);
    jsonLog({ status: 'READY', phase, runId: next.runId, state: next.status, nextAction: nextAction(next) });
  } catch (error) {
    const failed = resetAfterPhaseFailure(state, phase, error);
    await writeState(failed, statePath);
    throw error;
  }
}

async function addEvidence(statePath, evidencePath) {
  if (!evidencePath) throw new Error('evidence requires --file <path>');
  const state = await requireState(statePath);
  assertCurrentGit(state);
  const rawInput = JSON.parse(await fs.readFile(path.resolve(evidencePath), 'utf8'));
  const { evidence: input } = splitBrowserEvidenceInput(rawInput);
  const normalized = validateEvidence(input, state, { fileExists: (candidate) => fsSync.existsSync(candidate) });
  const next = applyEvidence(state, normalized);
  await writeState(next, statePath);
  jsonLog({ status: 'READY', phase: 'evidence', surface: normalized.surface, runId: next.runId, state: next.status, nextAction: nextAction(next) });
}

export async function completeRun(
  statePath,
  {
    assertGit = assertCurrentGit,
    completeState = completeReleaseState,
    persist = writeState,
    log = jsonLog,
  } = {},
) {
  const state = await requireState(statePath);
  try {
    assertGit(state);
    const completed = await completeState(state);
    assertGit(state);
    const message = completionMessage(completed);
    await persist(completed, statePath);
    log({ status: 'READY', phase: 'complete', runId: completed.runId, state: completed.status, message });
  } catch (error) {
    if (error.code !== 'ELOOPBLOCKED') {
      const failurePhase = phaseOrder.includes(error.releasePhase) ? error.releasePhase : 'public';
      await persist(resetAfterPhaseFailure(state, failurePhase, error), statePath);
    }
    throw error;
  }
}

export function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const options = { command, file: undefined, reason: undefined, url: undefined };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--file') options.file = rest[++index];
    else if (rest[index] === '--reason') options.reason = rest[++index];
    else if (rest[index] === '--url') options.url = rest[++index];
    else throw new Error(`unknown release loop argument: ${rest[index]}`);
  }
  return options;
}

async function runCli(argv) {
  const { command, file, reason, url } = parseArgs(argv);
  const statePath = statePathFromEnv();
  if (command === 'start') return startRun(statePath);
  if (command === 'supersede') return supersedeRun(statePath, reason);
  if (command === 'machine' || command === 'package' || command === 'public') return executePhase(command, statePath, { url });
  if (command === 'status') {
    const state = await requireState(statePath);
    if (state.status === 'SUPERSEDED') {
      return jsonLog({
        status: 'SUPERSEDED',
        phase: 'status',
        runId: state.runId,
        state: state.status,
        nextAction: 'START',
        commit: state.shortCommit,
        version: state.version,
        lastFailure: state.lastFailure,
      });
    }
    assertCurrentGit(state);
    assertCurrentReleaseArtifacts(state);
    return jsonLog(publicResult(state));
  }
  if (command === 'evidence') return addEvidence(statePath, file);
  if (command === 'complete') {
    const state = await requireState(statePath);
    assertCurrentGit(state);
    assertReleaseUpdateCompletionContract(state);
    return completeRun(statePath);
  }
  throw new Error(`unknown release loop command: ${command}`);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    assertCanonicalReleaseDriver(process.env);
    await runCli(process.argv.slice(2));
  } catch (error) {
    const blocked = [
      'ELOOPBLOCKED',
      'ELOOPACTIVE',
      'ELOOPINTEGRITY',
      'ESTALERELEASE',
      'ETIMEDOUT',
      'ESOURCEIOBLOCKED',
      'EVERSIONNOTBUMPED',
      'EWORKTREEDIRTY',
      'EUPDATEOUTPUT',
      'EPROCESSREAPTIMEOUT',
      'ECOMMAND',
      'ERELEASEENTRYPOINT',
    ].includes(error.code);
    const result = {
      status: blocked ? 'BLOCKED' : 'FAILED',
      phase: process.argv[2] ?? 'status',
      blocker: {
        code: error.code ?? 'EUNKNOWN',
        message: error.message,
        ...(error.output
          ? {
            detail: String(error.output)
              .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
              .replace(/(client[_ -]?secret|password|api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
              .slice(-4_000),
          }
          : {}),
      },
      missingGates: error.missing ?? undefined,
      nextAction: error.missing?.[0] ?? 'Inspect the reported release loop failure.',
    };
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}
