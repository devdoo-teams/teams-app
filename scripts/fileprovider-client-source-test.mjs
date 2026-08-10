import assert from 'node:assert/strict';
import { filterClientSourceFiles, isOptionalClientSource } from './fileprovider-client-source.mjs';

const files = [
  'src/client/App.tsx',
  'src/client/CopilotWorkspaceAssistant.tsx',
  'src/client/mcp/McpGenUiWidget.tsx',
  'src/client/mcp/main.tsx',
  'src/client/index.html',
  'src/shared/contracts.ts',
];

assert.equal(isOptionalClientSource('src/client/CopilotWorkspaceAssistant.tsx'), true);
assert.equal(isOptionalClientSource('src/client/mcp/McpGenUiWidget.tsx'), true);
assert.equal(isOptionalClientSource('src/client/App.tsx'), false);
assert.deepEqual(filterClientSourceFiles(files, { coreBuild: true }), [
  'src/client/App.tsx',
  'src/client/index.html',
  'src/shared/contracts.ts',
]);
assert.deepEqual(filterClientSourceFiles(files, { coreBuild: false }), files);
console.log('PASS: FileProvider Core materialization excludes optional client providers and preserves optional builds');
