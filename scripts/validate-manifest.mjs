import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('appPackage/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const packagePath = path.resolve('package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const releaseVersion = '1.0.7';
const required = [
  'manifestVersion',
  'version',
  'id',
  'developer',
  'name',
  'description',
  'icons',
  'staticTabs',
  'validDomains',
  'webApplicationInfo',
];
const missing = required.filter((key) => !(key in manifest));

if (missing.length > 0) {
  console.error(`Manifest missing required fields: ${missing.join(', ')}`);
  process.exit(1);
}

if (manifest.manifestVersion !== '1.25') {
  console.error(`Expected manifestVersion 1.25, received ${manifest.manifestVersion}`);
  process.exit(1);
}

if (packageJson.version !== releaseVersion || manifest.version !== releaseVersion) {
  console.error(`Expected package and manifest version ${releaseVersion}, received package=${packageJson.version}, manifest=${manifest.version}`);
  process.exit(1);
}

if (!manifest.staticTabs.some((tab) => tab.entityId === 'home' && tab.scopes.includes('personal'))) {
  console.error('Manifest must declare a personal home static tab.');
  process.exit(1);
}

if (!manifest.devicePermissions?.includes('geolocation')) {
  console.error('Manifest must declare geolocation device permission.');
  process.exit(1);
}

if (!manifest.bots?.[0]?.commandLists?.some((list) => list.commands?.some((command) => command.title === '날씨'))) {
  console.error('Manifest must expose the 날씨 Bot command.');
  process.exit(1);
}

if (!manifest.webApplicationInfo.id || !manifest.webApplicationInfo.resource) {
  console.error('Manifest webApplicationInfo must include id and resource.');
  process.exit(1);
}

for (const icon of Object.values(manifest.icons)) {
  if (!fs.existsSync(path.resolve('appPackage', icon))) {
    console.error(`Manifest icon does not exist: ${icon}`);
    process.exit(1);
  }
}

console.log(`Manifest OK: v${manifest.manifestVersion}, ${manifest.staticTabs.length} static tab(s)`);
