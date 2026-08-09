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
