import assert from 'node:assert/strict';
import {
  assertSafePackageEntries,
  assertSafePackageText,
  isTextEntry,
} from './release-artifact-secret-scan.mjs';

const safeManifest = JSON.stringify({
  id: '00000000-0000-4000-8000-000000000001',
  version: '1.0.101',
  developer: { name: 'Teams SDK MVP' },
  staticTabs: [{ contentUrl: 'https://runtime.example.com/tabs/home/' }],
});

assert.equal(isTextEntry('manifest.json'), true);
assert.equal(isTextEntry('outline.png'), false);
assert.equal(isTextEntry('nested/icon.PNG'), false);

assert.doesNotThrow(() => assertSafePackageEntries(['manifest.json', 'color.png', 'outline.png']));
for (const entry of [
  '.env',
  '.env.production',
  'auth.json',
  'credentials.json',
  'secrets/client.pem',
  'private.key',
  'id_rsa',
]) {
  assert.throws(
    () => assertSafePackageEntries(['manifest.json', entry]),
    /release package contains a prohibited sensitive file name/,
    `${entry} must be rejected before upload`,
  );
}

assert.doesNotThrow(() => assertSafePackageText('manifest.json', safeManifest));
assert.doesNotThrow(() => assertSafePackageText('manifest.json', '{"description":"API key support"}'));
for (const content of [
  '{"clientSecret":"real-secret"}',
  '{"password":"real-password"}',
  'Authorization: Bearer real-bearer',
  'XAI_API_KEY=real-key',
  '{"token":"real-token"}',
]) {
  assert.throws(
    () => assertSafePackageText('manifest.json', content),
    /release package contains credential-like content/,
    'credential-like package content must be rejected without echoing its value',
  );
}

console.log('Release artifact secret-scan contract tests passed.');
