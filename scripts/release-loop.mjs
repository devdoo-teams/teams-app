import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { runWithTimeout } from './release-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surfaces = ['portal', 'installed', 'desktop', 'mobile'];
const phaseOrder = ['machine', 'package', 'public', ...surfaces];
const MAX_RASTER_BYTES = 20 * 1024 * 1024;
const MAX_RASTER_DIMENSION = 16_384;
const MAX_RASTER_PIXELS = 50_000_000;
const MAX_RASTER_DECODED_BYTES = 128 * 1024 * 1024;
const MAX_SUPPORTING_ARTIFACT_BYTES = 4 * 1024 * 1024;

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
  return { sha256: hashBytes(bytes), width, height };
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

function allEvidenceArtifacts(evidence) {
  return [
    ...(Array.isArray(evidence?.artifacts) ? evidence.artifacts : []),
    ...(Array.isArray(evidence?.supportingArtifacts) ? evidence.supportingArtifacts : []),
  ];
}

function hasFullEvidenceCoverage(evidence) {
  const coverage = evidence?.coverage;
  return Boolean(
    coverage
    && coverage.commit === evidence.commit
    && coverage.version === evidence.version
    && typeof coverage.matrixPath === 'string'
    && /^[a-f0-9]{64}$/.test(coverage.matrixSha256 ?? '')
    && Number.isInteger(coverage.totalRows)
    && coverage.totalRows > 0
    && coverage.passedRows === coverage.totalRows
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
  if (!evidence.screenshotBeforePath || !evidence.screenshotAfterPath) return false;
  if (!hasFullEvidenceCoverage(evidence)) return false;
  if (state.package?.sha256 && evidence.packageSha256 !== state.package.sha256) return false;
  // The portal's published version and the installed conversation's response
  // are different facts. Do not let a chat round-trip stand in for the
  // installed app-info version check.
  if (surface === 'installed' && evidence.installedVersion !== state.version) return false;
  if (surface === 'mobile' && evidence.userConfirmed !== true) return false;
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

export function createInitialState({ runId, commit, shortCommit, version, startedAt }) {
  for (const [name, value] of Object.entries({ runId, commit, shortCommit, version, startedAt })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`release loop requires ${name}`);
    }
  }
  return {
    schemaVersion: 1,
    runId,
    startedAt,
    updatedAt: startedAt,
    commit,
    shortCommit,
    version,
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
    && state.public.version === state.version
    && state.public.packageSha256 === state.package.sha256
    && hasPublicAssetIdentity(state.public.asset);
}

export function deriveStatus(state) {
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

export function validateEvidence(
  input,
  state,
  { fileExists = (candidate) => true, readArtifact = (candidate) => fsSync.readFileSync(candidate), now = new Date() } = {},
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
    : Array.isArray(input.artifacts) ? input.artifacts.map((artifact) => artifact?.path) : undefined;
  assertSurface(surface);
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
  if (
    coverage.commit !== commit
    || coverage.version !== version
    || typeof coverage.matrixPath !== 'string'
    || !/^[a-f0-9]{64}$/.test(coverage.matrixSha256 ?? '')
    || !Number.isInteger(coverage.totalRows)
    || coverage.totalRows <= 0
    || coverage.passedRows !== coverage.totalRows
    || coverage.blockedRows !== 0
    || coverage.unverifiedRows !== 0
  ) {
    throw new Error('evidence coverage matrix must be current and have all rows passed with no blocked or unverified rows');
  }
  const beforePath = absoluteEvidencePath(screenshotBeforePath, 'screenshotBefore');
  const afterPath = absoluteEvidencePath(screenshotAfterPath, 'screenshotAfter');
  if (beforePath === afterPath) throw new Error('before and after screenshots must use different paths');
  const visualPaths = [...new Set([beforePath, afterPath, ...(artifactPaths ?? [])])];
  if (visualPaths.length < 2) {
    throw new Error('evidence requires distinct before and after screenshot paths');
  }
  const supportingPaths = [
    absoluteEvidencePath(accessibilityPath, 'accessibility'),
    absoluteEvidencePath(runtimeLogPath, 'runtime log'),
    absoluteEvidencePath(coverage.matrixPath, 'coverage matrix'),
  ];
  if (new Set(supportingPaths).size !== supportingPaths.length) {
    throw new Error('accessibility, runtime, and coverage artifacts must use distinct paths');
  }
  const artifacts = visualPaths.map((candidate) => {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
      throw new Error('evidence artifact paths must be absolute');
    }
    const normalized = path.normalize(candidate);
    if (!fileExists(normalized)) throw new Error(`evidence artifact does not exist: ${normalized}`);
    return {
      path: normalized,
      role: normalized === beforePath ? 'screenshot-before' : normalized === afterPath ? 'screenshot-after' : 'screenshot-extra',
      ...inspectArtifact(readArtifact(normalized)),
    };
  });
  const supportingArtifacts = supportingPaths.map((candidate) => {
    const normalized = path.normalize(candidate);
    if (!fileExists(normalized)) throw new Error(`supporting evidence artifact does not exist: ${normalized}`);
    const role = normalized === path.normalize(accessibilityPath)
      ? 'accessibility'
      : normalized === path.normalize(runtimeLogPath) ? 'runtime-log' : 'coverage-matrix';
    return { path: normalized, role, ...inspectSupportingArtifact(readArtifact(normalized), role) };
  });
  for (const existingSurface of surfaces) {
    if (existingSurface === surface) continue;
    const existingArtifacts = allEvidenceArtifacts(state.evidence?.[existingSurface]);
    if (existingArtifacts.length === 0) continue;
    for (const artifact of [...artifacts, ...supportingArtifacts]) {
      if (existingArtifacts.some((existing) => path.normalize(existing.path) === artifact.path)) {
        throw new Error(`evidence artifact path is already used by ${existingSurface}; cross-surface reuse is forbidden`);
      }
      if (existingArtifacts.some((existing) => existing.sha256 === artifact.sha256)) {
        throw new Error(`evidence artifact hash is already used by ${existingSurface}; cross-surface reuse is forbidden`);
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
      matrixPath: path.normalize(coverage.matrixPath),
    },
    artifactPaths: artifacts.map(({ path: artifactPath }) => artifactPath),
    artifacts,
    supportingArtifacts,
  };
}

export function reverifyEvidenceArtifacts(
  state,
  { fileExists = (candidate) => fsSync.existsSync(candidate), readArtifact = (candidate) => fsSync.readFileSync(candidate) } = {},
) {
  for (const surface of surfaces) {
    const evidence = state.evidence?.[surface];
    if (!evidence) continue;
    if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) {
      throw integrityError(`${surface} evidence is missing artifact integrity metadata`, surface);
    }
    for (const artifact of evidence.artifacts) {
      if (!artifact || typeof artifact.path !== 'string' || !path.isAbsolute(artifact.path)) {
        throw integrityError(`${surface} evidence artifact path is invalid`, surface);
      }
      const artifactPath = path.normalize(artifact.path);
      if (!fileExists(artifactPath)) throw integrityError(`evidence artifact does not exist: ${artifactPath}`, surface);
      let actual;
      try {
        actual = inspectArtifact(readArtifact(artifactPath));
      } catch (error) {
        if (error?.code === 'ELOOPINTEGRITY') throw error;
        throw integrityError(`${surface} evidence artifact is invalid: ${error?.message ?? artifactPath}`, surface);
      }
      if (actual.sha256 !== artifact.sha256) {
        throw integrityError(`evidence artifact hash changed: ${artifactPath}`, surface);
      }
      if (actual.width !== artifact.width || actual.height !== artifact.height) {
        throw integrityError(`evidence artifact dimensions changed: ${artifactPath}`, surface);
      }
    }
    if (!Array.isArray(evidence.supportingArtifacts) || evidence.supportingArtifacts.length < 2) {
      throw integrityError(`${surface} evidence is missing accessibility, runtime, or coverage artifacts`, surface);
    }
    for (const artifact of evidence.supportingArtifacts) {
      if (!artifact || typeof artifact.path !== 'string' || !path.isAbsolute(artifact.path)) {
        throw integrityError(`${surface} supporting evidence artifact path is invalid`, surface);
      }
      const artifactPath = path.normalize(artifact.path);
      if (!fileExists(artifactPath)) throw integrityError(`supporting evidence artifact does not exist: ${artifactPath}`, surface);
      let actual;
      try {
        actual = inspectSupportingArtifact(readArtifact(artifactPath), artifact.role ?? 'supporting');
      } catch (error) {
        if (error?.code === 'ELOOPINTEGRITY') throw error;
        throw integrityError(`${surface} supporting evidence artifact is invalid: ${error?.message ?? artifactPath}`, surface);
      }
      if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes) {
        throw integrityError(`supporting evidence artifact hash changed: ${artifactPath}`, surface);
      }
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

function gitSnapshot() {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const porcelain = run(['status', '--porcelain']);
  return {
    commit: run(['rev-parse', 'HEAD']),
    shortCommit: run(['rev-parse', '--short=7', 'HEAD']),
    dirty: porcelain.length > 0,
    porcelain,
  };
}

function sourceVersion() {
  const manifest = JSON.parse(fsSync.readFileSync(path.join(root, 'appPackage', 'manifest.json'), 'utf8'));
  return manifest.version;
}

function assertCurrentGit(state, { requireClean = true } = {}) {
  const current = gitSnapshot();
  if (current.commit !== state.commit) throw new Error('current Git commit does not match the release run');
  if (requireClean && current.dirty) throw new Error('release loop requires a clean Git worktree');
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
    return { status: 'READY', completedAt, commands: payload.evidence?.map(({ command, exitCode }) => ({ command, exitCode })) ?? [] };
  }
  if (phase === 'package') {
    const packageEntry = payload.evidence?.find((entry) => typeof entry.package === 'string');
    const manifestEvidence = payload.evidence?.find((entry) => entry.manifest)?.manifest;
    if (!packageEntry || !manifestEvidence) throw new Error('package gate returned incomplete package evidence');
    return {
      status: 'READY',
      completedAt,
      packagePath: packageEntry.package,
      version: packageEntry.version,
      sha256: packageEntry.sha256,
      manifest: manifestEvidence,
    };
  }
  const health = payload.evidence?.find((entry) => entry.health)?.health;
  const tab = payload.evidence?.find((entry) => entry.tab)?.tab;
  const asset = payload.evidence?.find((entry) => entry.asset)?.asset;
  const packageEntry = payload.evidence?.find((entry) => typeof entry.package === 'string');
  if (!health || !tab || !asset || !packageEntry) throw new Error('public gate returned incomplete public asset evidence');
  assertPublicAssetIdentity(asset, 'public gate');
  return {
    status: 'READY',
    completedAt,
    version: health.version,
    health,
    tab,
    asset,
    packagePath: packageEntry.package,
    packageSha256: packageEntry.sha256,
  };
}

const phaseTimeouts = {
  machine: 330_000,
  package: 60_000,
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

async function runGatePhase(phase) {
  const gatePath = path.join(root, 'scripts', 'release-gate.mjs');
  const result = await runWithTimeout(process.execPath, [gatePath, gatePhaseForLoop(phase)], {
    cwd: root,
    timeoutMs: phaseTimeouts[phase],
    maxOutputChars: 20_000,
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
    error.code = result.code === null ? 'ETIMEDOUT' : 'ELOOPPHASE';
    error.output = output.slice(-4_000);
    throw error;
  }
  return payload;
}

export async function completeReleaseState(
  state,
  {
    probePublic = async () => summarizePhase('public', await runGatePhase('public')),
    verifyPackage = () => assertPackageIntegrity(state),
    verifyEvidence = () => reverifyEvidenceArtifacts(state),
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
  verifyPackage();
  verifyEvidence();
  const probe = await probePublic();
  const currentPublic = probe?.evidence ? summarizePhase('public', probe) : probe;
  assertPublicProbeMatches(state, currentPublic);
  verifyPackage();
  verifyEvidence();
  const timestamp = now instanceof Date ? now.toISOString() : new Date().toISOString();
  return {
    ...state,
    status: 'COMPLETE',
    completedAt: timestamp,
    updatedAt: timestamp,
  };
}

function nextAction(state) {
  return missingGates(state)[0] ?? 'COMPLETE';
}

function publicResult(state) {
  const currentStatus = deriveStatus(state);
  return {
    status: state.lastFailure ? 'BLOCKED' : 'READY',
    phase: 'status',
    runId: state.runId,
    state: currentStatus,
    nextAction: nextAction(state),
    missingGates: missingGates(state),
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
    if (existing.status !== 'COMPLETE') {
      const error = new Error(`an active release run already exists: ${existing.runId}`);
      error.code = 'ELOOPACTIVE';
      throw error;
    }
  }
  const git = gitSnapshot();
  if (git.dirty) throw new Error('release loop requires a clean Git worktree at start');
  const startedAt = new Date().toISOString();
  const state = createInitialState({
    runId: crypto.randomUUID(),
    commit: git.commit,
    shortCommit: git.shortCommit,
    version: sourceVersion(),
    startedAt,
  });
  await writeState(state, statePath);
  jsonLog({ status: 'READY', phase: 'start', runId: state.runId, state: state.status, nextAction: nextAction(state) });
}

async function executePhase(phase, statePath) {
  const state = await requireState(statePath);
  try {
    assertCurrentGit(state);
    if (phase === 'package' && !hasReady(state.machine)) throw new Error('machine phase must be READY before package');
    if (phase === 'public' && !hasReady(state.package)) throw new Error('package phase must be READY before public');
    if (phase === 'public') assertPackageIntegrity(state);
    const payload = await runGatePhase(phase);
    const summarized = summarizePhase(phase, payload);
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
  const input = JSON.parse(await fs.readFile(path.resolve(evidencePath), 'utf8'));
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

function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const options = { command, file: undefined };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--file') options.file = rest[++index];
    else throw new Error(`unknown release loop argument: ${rest[index]}`);
  }
  return options;
}

async function runCli(argv) {
  const { command, file } = parseArgs(argv);
  const statePath = statePathFromEnv();
  if (command === 'start') return startRun(statePath);
  if (command === 'machine' || command === 'package' || command === 'public') return executePhase(command, statePath);
  if (command === 'status') {
    const state = await requireState(statePath);
    assertCurrentGit(state);
    assertCurrentReleaseArtifacts(state);
    return jsonLog(publicResult(state));
  }
  if (command === 'evidence') return addEvidence(statePath, file);
  if (command === 'complete') return completeRun(statePath);
  throw new Error(`unknown release loop command: ${command}`);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const blocked = ['ELOOPBLOCKED', 'ELOOPACTIVE', 'ELOOPINTEGRITY', 'ETIMEDOUT'].includes(error.code);
    const result = {
      status: blocked ? 'BLOCKED' : 'FAILED',
      phase: process.argv[2] ?? 'status',
      blocker: { code: error.code ?? 'EUNKNOWN', message: error.message },
      missingGates: error.missing ?? undefined,
      nextAction: error.missing?.[0] ?? 'Inspect the reported release loop failure.',
    };
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}
