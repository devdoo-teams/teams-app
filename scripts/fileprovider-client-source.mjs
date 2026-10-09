const OPTIONAL_CLIENT_SOURCE_FILES = new Set([
  'src/client/CopilotWorkspaceAssistant.tsx',
  'src/client/CopilotJobView.tsx',
  'src/client/copilot-job-view.css',
]);

export function isOptionalClientSource(relativeFile) {
  return OPTIONAL_CLIENT_SOURCE_FILES.has(relativeFile)
    || relativeFile.startsWith('src/client/mcp/');
}

export function filterClientSourceFiles(relativeFiles, { coreBuild }) {
  if (!coreBuild) return [...relativeFiles];
  return relativeFiles.filter((relativeFile) => !isOptionalClientSource(relativeFile));
}
