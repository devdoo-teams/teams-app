import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { isFullCommitOid, resolvePinnedCommitOid } from './fileprovider-git-clean.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';
import { parseServerBuildMarker } from './server-build-marker.mjs';

const root = process.cwd();
const runtimeRoot = resolveRuntimeDistRoot(root);
const clientAssets = path.join(runtimeRoot, 'client', 'assets');
const serverDir = path.join(runtimeRoot, 'server');
const currentCommit = process.env.TEAMS_SOURCE_COMMIT ?? resolvePinnedCommitOid(root);
assert.equal(
  isFullCommitOid(currentCommit),
  true,
  'core bundle boundary requires the runner-pinned full source Git OID',
);
const clientFiles = await fs.readdir(clientAssets, { recursive: true });
const serverFiles = await fs.readdir(serverDir);
const marker = parseServerBuildMarker(await fs.readFile(path.join(serverDir, '.teams-server-build-commit'), 'utf8'));
const serverEntryBytes = await fs.readFile(path.join(serverDir, 'index.js'));
const bundleSha256 = crypto.createHash('sha256').update(serverEntryBytes).digest('hex');
assert.deepEqual(
  marker,
  { schemaVersion: 3, sourceCommit: currentCommit, commit: currentCommit, mode: 'core', worktree: 'clean', bundleSha256 },
  'core server artifact must be freshly built for the current commit in core mode',
);

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
const serverEntry = serverEntryBytes.toString('utf8');
assert.match(serverEntry, /mcpEnabled/, 'core health still reports MCP disabled state');
assert.doesNotMatch(
  serverEntry,
  /\b(?:LocalCompatibleResponseEngine|OpenAIResponseEngine|GrokResponseEngine)\b/,
  'core server artifact must not embed optional response engine implementations',
);
assert.doesNotMatch(
  serverEntry,
  /\b(?:createGitHubAgentTasksAdapter|createGrokProviderRuntimeAdapter|OPTIONAL_PROVIDER_BUILD_MANIFEST|github-agent-tasks)\b/,
  'core server artifact must not embed optional durable provider implementations',
);
assert.doesNotMatch(
  serverEntry,
  /OPENAI_API_KEY|OPENAI_MODEL|LOCAL_MODEL_BASE_URL|LOCAL_MODEL_NAME|XAI_API_KEY|XAI_MODEL|XAI_BASE_URL/,
  'core server artifact must not expose optional provider configuration paths',
);
const serverBuildConfig = await fs.readFile(path.join(root, 'scripts', 'build-server.mjs'), 'utf8');
assert.match(
  serverBuildConfig,
  /mainFields:\s*\[\s*['"]module['"]\s*,\s*['"]main['"]\s*\]/,
  'core server build must prefer the Teams SDK ESM entry to avoid the esbuild CJS graph hang',
);

console.log('PASS: API-free core artifact excludes optional CopilotKit/MCP files while retaining runtime contracts');
