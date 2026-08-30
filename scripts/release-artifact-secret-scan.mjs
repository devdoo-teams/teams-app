import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const prohibitedEntryPattern = /(^|\/)(?:\.env(?:\.[^/]*)?|auth(?:entication)?\.json|credentials?\.json|[^/]+\.(?:pem|key|p12|pfx|der)|id_(?:rsa|ed25519))(?:$|\/)/i;
const textExtensionPattern = /\.(?:cfg|conf|css|env|html|ini|js|json|jsx|mjs|ts|tsx|txt|xml|ya?ml)$/i;
const credentialContentPatterns = [
  /["'`]?(?:client[_-]?secret|xai[_-]?api[_-]?key|api[_-]?key|password|access[_-]?token|bearer[_-]?token|token)["'`]?\s*[=:]\s*["'`]?[^\s"'`,}\]]{3,}/i,
  /authorization\s*:\s*bearer\s+[^\s"'`]+/i,
  /(?:^|[\s"'`])(?:sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})(?:$|[\s"'`])/i,
];

function normalizeEntryName(entryName) {
  if (typeof entryName !== 'string' || entryName.length === 0) {
    throw new Error('release package contains an invalid entry name');
  }
  const normalized = entryName.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..') || normalized.startsWith('-')) {
    throw new Error('release package contains an unsafe entry path');
  }
  return normalized;
}

export function isTextEntry(entryName) {
  return textExtensionPattern.test(normalizeEntryName(entryName));
}

export function assertSafePackageEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('release package entry list is invalid');
  for (const entry of entries) {
    const normalized = normalizeEntryName(entry);
    if (prohibitedEntryPattern.test(normalized)) {
      throw new Error('release package contains a prohibited sensitive file name');
    }
  }
  return true;
}

export function assertSafePackageText(entryName, content) {
  const normalized = normalizeEntryName(entryName);
  if (typeof content !== 'string') throw new Error('release package text content is invalid');
  if (credentialContentPatterns.some((pattern) => pattern.test(content))) {
    throw new Error('release package contains credential-like content');
  }
  return true;
}

export function scanReleaseZip(zipPath) {
  const absoluteZipPath = path.resolve(zipPath);
  if (!fs.statSync(absoluteZipPath).isFile()) throw new Error('release package path is not a file');
  const entries = execFileSync('unzip', ['-Z1', absoluteZipPath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  assertSafePackageEntries(entries);
  for (const entry of entries) {
    if (!isTextEntry(entry)) continue;
    const content = execFileSync('unzip', ['-p', absoluteZipPath, entry], { encoding: 'utf8' });
    assertSafePackageText(entry, content);
  }
  return Object.freeze({ entryCount: entries.length, packageSha256: crypto.createHash('sha256').update(fs.readFileSync(absoluteZipPath)).digest('hex') });
}

function runCli() {
  const zipPath = process.argv[2] || path.join(process.cwd(), 'appPackage', 'build', 'teams-sdk-mvp.zip');
  const result = scanReleaseZip(zipPath);
  console.log(JSON.stringify({ status: 'PASS', ...result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}
