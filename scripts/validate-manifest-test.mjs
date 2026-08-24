import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const validatorModule = await import('./validate-manifest.mjs');
assert.equal(
  typeof validatorModule.validateManifest,
  'function',
  'manifest validation must expose a pure function for in-memory negative fixtures',
);

const manifest = JSON.parse(await fs.readFile('appPackage/manifest.json', 'utf8'));
const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
const packageLockJson = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const validate = (candidate) => validatorModule.validateManifest(candidate, packageJson, {
  iconExists: () => true,
  packageLockJson,
});

assert.equal(validate(structuredClone(manifest)), undefined, 'the checked-in source manifest contract is valid');

{
  const candidateLock = structuredClone(packageLockJson);
  candidateLock.version = '1.0.45';
  assert.match(
    validatorModule.validateManifest(manifest, packageJson, { iconExists: () => true, packageLockJson: candidateLock }) ?? '',
    /Package lock version must match/,
    'manifest validation rejects package-lock version drift',
  );
}

{
  const candidate = structuredClone(manifest);
  candidate.version = '9.9.9';
  assert.match(validate(candidate) ?? '', /must match package version/, 'manifest validation rejects a package version mismatch');
}

{
  const candidate = structuredClone(manifest);
  candidate.version = 'next';
  assert.match(validate(candidate) ?? '', /X\.Y\.Z semver/, 'manifest validation rejects an invalid semantic version');
}

for (const requiredDomain of ['${{TAB_DOMAIN}}', 'token.botframework.com']) {
  const candidate = structuredClone(manifest);
  candidate.validDomains = candidate.validDomains.filter((domain) => domain !== requiredDomain);
  assert.match(
    validate(candidate) ?? '',
    new RegExp(requiredDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `source manifest validation rejects omission of ${requiredDomain}`,
  );
}

{
  const candidate = structuredClone(manifest);
  candidate.staticTabs[0].contentUrl = 'https://${{TAB_DOMAIN}}/tabs/home';
  assert.match(
    validate(candidate) ?? '',
    /trailing slash/,
    'manifest validation rejects a Teams tab URL that redirects before the iframe can load',
  );
}

{
  const candidate = structuredClone(manifest);
  candidate.staticTabs[0].contentUrl = 'https://${{TAB_DOMAIN}}/other/';
  assert.match(
    validate(candidate) ?? '',
    /\/tabs\/home\//,
    'manifest validation rejects a personal tab URL that does not target the public home route',
  );
}

{
  const candidate = structuredClone(manifest);
  candidate.staticTabs[0].websiteUrl = 'https://${{TAB_DOMAIN}}';
  assert.match(
    validate(candidate) ?? '',
    /websiteUrl.*trailing slash/i,
    'manifest validation rejects a personal website URL that redirects before Teams can open the origin',
  );
}

console.log('Source manifest contract tests passed.');
