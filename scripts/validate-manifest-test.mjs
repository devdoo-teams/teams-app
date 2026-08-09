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
const validate = (candidate) => validatorModule.validateManifest(candidate, packageJson, {
  iconExists: () => true,
});

assert.equal(validate(structuredClone(manifest)), undefined, 'the checked-in source manifest contract is valid');

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

console.log('Source manifest contract tests passed.');
