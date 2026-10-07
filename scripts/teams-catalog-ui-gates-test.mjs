import assert from 'node:assert/strict';
const gates = await import('./teams-catalog-ui-gates.mjs').catch(() => ({}));
assert.equal(typeof gates.planExistingTabRecovery, 'function', 'existing-tab recovery must distinguish metadata from actual control');
assert.equal(typeof gates.planCatalogUpload, 'function', 'catalog update must enforce the two-stage dialog and uncertain-write read-back');
const scope = { tenantId: 'tenant-a', catalogId: 'catalog-a', appId: 'app-a' };
const browser = { ownership: 'agent', scope, existingTabId: 'p8', ambientExistingTab: true,
  control: 'timed-out', recoveryAttempts: 0, newTabsCreated: 0, authInProgress: false };
assert.equal(gates.planExistingTabRecovery(browser).action, 'RECONNECT_EXISTING_ONCE');
assert.equal(gates.planExistingTabRecovery({ ...browser, recoveryAttempts: 1 }).action, 'BLOCKED');
assert.equal(gates.planExistingTabRecovery({ ...browser, ownership: 'user' }).action, 'WAIT_USER_HANDOFF');
assert.equal(gates.planExistingTabRecovery({ ...browser, control: 'responsive' }).action, 'REUSE_EXISTING');
assert.equal(gates.planExistingTabRecovery({ ...browser, existingTabId: undefined }).action, 'RECONNECT_EXISTING_ONCE', 'empty tabs list with ambient evidence is not no-tabs');
const authorization = { explicit: true, evidenceRef: 'user-20261006-2222', scope };
assert.equal(gates.planExistingTabRecovery({ ...browser, recoveryAttempts: 1 }, authorization).action, 'OPEN_AUTHORIZED_FALLBACK_ONCE');
for (const changed of [{ scope: { ...scope, tenantId: 'other' } }, { explicit: false }, { evidenceRef: '' }])
  assert.equal(gates.planExistingTabRecovery({ ...browser, recoveryAttempts: 1 }, { ...authorization, ...changed }).action, 'BLOCKED');
assert.equal(gates.planExistingTabRecovery({ ...browser, recoveryAttempts: 1, newTabsCreated: 1 }, authorization).action, 'BLOCKED');
assert.equal(gates.planExistingTabRecovery({ ...browser, authInProgress: true, control: 'responsive' }, authorization).action, 'WAIT_USER_AUTH');
assert.equal(gates.planExistingTabRecovery({ ...browser, control: 'unknown', recoveryAttempts: 1 }, authorization).action, 'READ_ACTUAL_TAB', 'metadata alone cannot authorize fallback');

const release = { ...scope, version: '1.0.113', commit: 'a'.repeat(40), packageSha256: 'b'.repeat(64),
  packagePath: '/tmp/exact.zip', devicePermissions: [], resourceSpecificPermissions: [], installedTargets: ['existing-user'], availability: 'organization-default' };
const observation = { ownership: 'agent', authenticated: true, scope, currentSnapshot: true,
  stage: 'app-details', transferCount: 0, installedTargets: ['existing-user'], availability: 'organization-default' };
assert.equal(gates.planCatalogUpload(release, observation).action, 'OPEN_EXISTING_APP_UPDATE_DIALOG');
assert.equal(gates.planCatalogUpload(release, { ...observation, stage: 'update-dialog', innerFileControlObserved: true }).action, 'SELECT_EXACT_PACKAGE_ONCE');
assert.equal(gates.planCatalogUpload(release, { ...observation, stage: 'update-dialog' }).action, 'READ_CURRENT_DIALOG', 'the outer upload button is not the file chooser');
const readyDialog = { ...observation, stage: 'update-dialog', innerFileControlObserved: true };
assert.equal(gates.planCatalogUpload({ ...release, availability: undefined }, { ...readyDialog, availability: undefined }).action, 'BLOCKED', 'two omitted availability fields are not verified equal scope');
assert.equal(gates.planCatalogUpload({ ...release, availability: '' }, { ...readyDialog, availability: '' }).action, 'BLOCKED');
for (const value of ['unknown', 1, undefined]) {
  assert.equal(gates.planCatalogUpload(release, { ...readyDialog, authenticated: value }).action, 'WAIT_USER_AUTH', 'authentication requires a measured boolean true');
  assert.equal(gates.planCatalogUpload(release, { ...readyDialog, currentSnapshot: value }).action, 'READ_CURRENT_STATE', 'truthy freshness is not current state');
}
assert.equal(gates.planCatalogUpload(release, { ...observation, currentSnapshot: false }).action, 'READ_CURRENT_STATE');
assert.equal(gates.planCatalogUpload(release, { ...observation, stage: 'upload-uncertain', transferCount: 1 }).action, 'READ_CATALOG_WITHOUT_REUPLOAD');
assert.equal(gates.planCatalogUpload(release, { ...observation, stage: 'update-dialog', transferCount: 1, innerFileControlObserved: true }).action, 'READ_CATALOG_WITHOUT_REUPLOAD');
assert.equal(gates.planCatalogUpload(release, { ...observation, ownership: 'user' }).action, 'WAIT_USER_HANDOFF');
for (const changed of [{ installedTargets: ['another-user'] }, { availability: 'everyone' }, { scope: { ...scope, catalogId: 'new-catalog' } }])
  assert.equal(gates.planCatalogUpload(release, { ...observation, ...changed }).action, 'BLOCKED');
for (const changed of [{ devicePermissions: ['geolocation'] }, { resourceSpecificPermissions: ['new-permission'] }, { packageSha256: '' }])
  assert.equal(gates.planCatalogUpload({ ...release, ...changed }, observation).action, 'BLOCKED');
assert.equal(gates.planCatalogUpload(release, { ...observation, stage: 'catalog-readback', catalogVersion: release.version, transferCount: 1 }).action, 'CATALOG_UPDATED_ONLY');
assert.equal(gates.planCatalogUpload(release, { ...observation, stage: 'catalog-readback', catalogVersion: '1.0.112', transferCount: 1 }).action, 'BLOCKED', 'old or ambiguous catalog read-back does not permit a duplicate transfer');
console.log('PASS: bounded existing-session recovery, scoped explicit fallback, ownership/auth pause, two-stage chooser, immutable scope and uncertain upload read-back');
