import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [manifestText, appSource, stylesSource, serverSource, deterministicSource, responseContractSource, genUiSource, genUiResponseSource, genUiTeamsSource, mcpSource, openAiSource, localSource, grokSource, copilotAgentSource, channelsSource, copilotClientSource, clientAdaptersSource, packageSource, workflowSource] = await Promise.all([
  fs.readFile('appPackage/manifest.json', 'utf8'),
  fs.readFile('src/client/App.tsx', 'utf8'),
  fs.readFile('src/client/styles.css', 'utf8'),
  fs.readFile('src/server/index.ts', 'utf8'),
  fs.readFile('src/server/response-engine-deterministic.ts', 'utf8'),
  fs.readFile('src/server/response-engine.ts', 'utf8'),
  fs.readFile('src/shared/genui.ts', 'utf8'),
  fs.readFile('src/server/genui-response.ts', 'utf8'),
  fs.readFile('src/server/genui-teams.ts', 'utf8'),
  fs.readFile('src/server/mcp-genui.ts', 'utf8'),
  fs.readFile('src/server/response-engine-openai.ts', 'utf8'),
  fs.readFile('src/server/response-engine-local.ts', 'utf8'),
  fs.readFile('src/server/response-engine-grok.ts', 'utf8'),
  fs.readFile('src/server/copilot-agent.ts', 'utf8'),
  fs.readFile('src/server/copilot-channels-shadow.ts', 'utf8'),
  fs.readFile('src/client/CopilotWorkspaceAssistant.tsx', 'utf8'),
  fs.readFile('src/client/genui/tool-adapters.ts', 'utf8'),
  fs.readFile('scripts/package-app.mjs', 'utf8'),
  fs.readFile('.github/workflows/core-ci.yml', 'utf8'),
]);
const manifest = JSON.parse(manifestText);
const commands = manifest.bots?.flatMap((bot) => bot.commandLists ?? [])
  .flatMap((list) => list.commands ?? [])
  .map((command) => String(command.title).toLowerCase()) ?? [];

assert.equal(commands.includes('날씨'), false, 'the Teams command menu must not advertise weather');
assert.equal(commands.includes('weather'), false, 'the Teams command menu must not advertise weather');
assert.equal(manifest.devicePermissions?.includes('geolocation') ?? false, false, 'the package must not request geolocation');
assert.doesNotMatch(manifestText, /날씨|weather|geolocation/i, 'the package metadata must describe only the agent hub');
assert.doesNotMatch(appSource, /geoLocation|teamsLocation|\.\/location\.js|weather-widget|내 위치 사용/i, 'the shipped client must not contain location or weather behavior');
assert.doesNotMatch(stylesSource, /weather|geolocation|location-widget/i, 'the shipped stylesheet must contain only the minimal agent hub');
assert.doesNotMatch(serverSource, /['"]\/api\/weather['"]|weatherMatch|getWeather\(|formatWeatherMessage\(/, 'the Core server must not expose weather routes or commands');
for (const [name, source] of [
  ['deterministic response engine', deterministicSource],
  ['response tool contract', responseContractSource],
  ['shared GenUI contract', genUiSource],
  ['Teams response factory', genUiResponseSource],
  ['Teams card renderer', genUiTeamsSource],
  ['MCP router', mcpSource],
  ['OpenAI provider', openAiSource],
  ['local provider', localSource],
  ['Grok provider', grokSource],
  ['Copilot agent', copilotAgentSource],
  ['Channels shadow', channelsSource],
  ['Copilot client', copilotClientSource],
  ['client tool adapters', clientAdaptersSource],
]) {
  assert.doesNotMatch(source, /weather|geolocation|날씨/i, `${name} must not retain the removed weather contract`);
}
for (const retiredPath of [
  'src/client/location.ts',
  'src/server/weather-service.ts',
  'scripts/client-location-test.ts',
  'scripts/weather-service-test.ts',
]) {
  await assert.rejects(fs.access(retiredPath), { code: 'ENOENT' }, `${retiredPath} must remain deleted`);
}
assert.match(packageSource, /must not request the removed geolocation/i, 'packaging must reject the removed location permission');
assert.match(workflowSource, /must not request removed geolocation/i, 'the immutable artifact workflow must reject the removed location permission');

console.log('PASS: shipped Teams Core surface is agent-only and contains no weather or geolocation contract');
