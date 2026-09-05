import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function validateManifest(manifest, packageJson, { iconExists, packageLockJson } = {}) {
  const missing = required.filter((key) => !(key in manifest));
  if (missing.length > 0) return `Manifest missing required fields: ${missing.join(', ')}`;

  if (manifest.manifestVersion !== '1.25') {
    return `Expected manifestVersion 1.25, received ${manifest.manifestVersion}`;
  }

  if (!manifest.staticTabs.some((tab) => tab.entityId === 'home' && tab.scopes.includes('personal'))) {
    return 'Manifest must declare a personal home static tab.';
  }

  const homeTab = manifest.staticTabs.find((tab) => tab.entityId === 'home');
  if (!homeTab?.contentUrl?.endsWith('/')) {
    return 'Manifest home tab contentUrl must include a trailing slash so the Teams iframe does not depend on an HTTP redirect.';
  }
  if (homeTab.contentUrl !== 'https://${{TAB_DOMAIN}}/tabs/home/') {
    return 'Manifest home tab contentUrl must target https://${{TAB_DOMAIN}}/tabs/home/ so the Teams iframe loads the public home route directly.';
  }
  if (homeTab.websiteUrl !== 'https://${{TAB_DOMAIN}}/') {
    return 'Manifest home tab websiteUrl must use the public tab origin with a trailing slash so Teams does not depend on an HTTP redirect.';
  }

  if (manifest.devicePermissions?.includes('geolocation')) {
    return 'Manifest must not request the removed geolocation device permission.';
  }

  const missingValidDomains = ['${{TAB_DOMAIN}}', 'token.botframework.com']
    .filter((domain) => !manifest.validDomains?.includes(domain));
  if (missingValidDomains.length > 0) {
    return `Manifest validDomains must include ${missingValidDomains.join(', ')} for the tab origin and Teams SSO redirect handling.`;
  }

  const semverPattern = /^\d+\.\d+\.\d+$/;
  if (!semverPattern.test(packageJson.version) || !semverPattern.test(manifest.version)) {
    return `Package and manifest versions must use X.Y.Z semver, received package=${packageJson.version}, manifest=${manifest.version}`;
  }

  if (manifest.version !== packageJson.version) {
    return `Manifest version must match package version ${packageJson.version}, received manifest=${manifest.version}`;
  }

  const lockRoot = packageLockJson?.packages?.[''];
  if (packageLockJson && (packageLockJson.version !== packageJson.version || lockRoot?.version !== packageJson.version)) {
    return `Package lock version must match package version ${packageJson.version}, received top-level=${packageLockJson.version}, root=${lockRoot?.version}`;
  }

  if (manifest.bots?.[0]?.commandLists?.some((list) => list.commands?.some((command) => /^(?:날씨|weather)$/iu.test(command.title)))) {
    return 'Manifest must not expose the removed weather Bot command.';
  }

  if (!manifest.webApplicationInfo.id || !manifest.webApplicationInfo.resource) {
    return 'Manifest webApplicationInfo must include id and resource.';
  }

  for (const icon of Object.values(manifest.icons)) {
    if (iconExists && !iconExists(icon)) return `Manifest icon does not exist: ${icon}`;
  }

  return undefined;
}

function runCli() {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('appPackage/manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  const packageLockJson = JSON.parse(fs.readFileSync(path.resolve('package-lock.json'), 'utf8'));
  const error = validateManifest(manifest, packageJson, {
    iconExists: (icon) => fs.existsSync(path.resolve('appPackage', icon)),
    packageLockJson,
  });

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`Manifest OK: v${manifest.manifestVersion}, ${manifest.staticTabs.length} static tab(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
