import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sourceCommit = process.env.TEAMS_SOURCE_COMMIT?.trim();
if (!sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error('TEAMS_SOURCE_COMMIT must be a full lowercase Git commit OID');
}

const serverPath = path.join(process.cwd(), 'dist', 'server', 'index.js');
const markerPath = path.join(process.cwd(), 'dist', 'server', '.teams-server-build-commit');
const clientPath = path.join(process.cwd(), 'dist', 'client', 'index.html');
const serverBytes = fs.readFileSync(serverPath);
const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
const bundleSha256 = crypto.createHash('sha256').update(serverBytes).digest('hex');

if (
  marker.schemaVersion !== 3
  || marker.commit !== sourceCommit
  || marker.mode !== 'core'
  || marker.worktree !== 'clean'
  || marker.bundleSha256 !== bundleSha256
) {
  throw new Error('CI dist marker does not prove the exact clean Core server bundle');
}
if (fs.statSync(clientPath).size <= 0) {
  throw new Error('CI dist client index.html is empty');
}

console.log(`verified CI Core dist for ${sourceCommit}: server bundle ${bundleSha256}`);
