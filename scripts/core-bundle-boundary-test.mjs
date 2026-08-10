import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const runtimeRoot = resolveRuntimeDistRoot(root);
const clientAssets = path.join(runtimeRoot, 'client', 'assets');
const serverDir = path.join(runtimeRoot, 'server');
const clientFiles = await fs.readdir(clientAssets, { recursive: true });
const serverFiles = await fs.readdir(serverDir);

const optionalFilePattern = /copilot|mcp-genui|mcp-widget/i;
assert.equal(
  clientFiles.some((file) => optionalFilePattern.test(file)),
  false,
  'core client artifact must not ship CopilotKit/MCP chunks',
);
assert.equal(
  serverFiles.some((file) => optionalFilePattern.test(file)),
  false,
  'core server artifact must not ship CopilotKit/MCP chunks',
);

const clientHtml = await fs.readFile(path.join(runtimeRoot, 'client', 'index.html'), 'utf8');
assert.match(clientHtml, /assets\/main\.js\?v=/, 'core tab points to the built main asset');
const serverEntry = await fs.readFile(path.join(serverDir, 'index.js'), 'utf8');
assert.match(serverEntry, /mcpEnabled/, 'core health still reports MCP disabled state');
assert.doesNotMatch(
  serverEntry,
  /\b(?:LocalCompatibleResponseEngine|OpenAIResponseEngine)\b/,
  'core server artifact must not embed optional response engine implementations',
);
const serverBuildConfig = await fs.readFile(path.join(root, 'scripts', 'build-server.mjs'), 'utf8');
assert.match(
  serverBuildConfig,
  /mainFields:\s*\[\s*['"]module['"]\s*,\s*['"]main['"]\s*\]/,
  'core server build must prefer the Teams SDK ESM entry to avoid the esbuild CJS graph hang',
);

console.log('PASS: API-free core artifact excludes optional CopilotKit/MCP files while retaining runtime contracts');
