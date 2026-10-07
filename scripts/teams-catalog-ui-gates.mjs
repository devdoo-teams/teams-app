// Read-only decisions for an explicitly authorized update of one existing app.
// This module never opens tabs, changes policy, authenticates or transfers files.
const decision = (action, reason) => ({ action, reason });
const text = value => typeof value === 'string' && value.trim().length > 0;
const sameScope = (a, b) => a && b && ['tenantId', 'catalogId', 'appId'].every(key => text(a[key]) && a[key] === b[key]);
const sameTargets = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && new Set(a).size === a.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);

export function planExistingTabRecovery(observation, authorization) {
  if (observation?.ownership !== 'agent') return decision('WAIT_USER_HANDOFF', 'CURRENT_SESSION_NOT_AGENT_OWNED');
  if (observation.authInProgress) return decision('WAIT_USER_AUTH', 'PRESERVE_AUTHENTICATION_TAB');
  if (!sameScope(observation.scope, observation.scope)) return decision('BLOCKED', 'SCOPE_UNVERIFIED');
  if (observation.control === 'responsive' && text(observation.existingTabId)) return decision('REUSE_EXISTING', 'ACTUAL_TAB_CONTROL_OBSERVED');
  if (observation.control !== 'timed-out' && observation.control !== 'unexposed') return decision('READ_ACTUAL_TAB', 'TAB_METADATA_IS_NOT_CONTROL_EVIDENCE');
  if ((text(observation.existingTabId) || observation.ambientExistingTab === true) && observation.recoveryAttempts === 0)
    return decision('RECONNECT_EXISTING_ONCE', 'BOUNDED_EXISTING_SESSION_RECOVERY');
  if (observation.recoveryAttempts === 1 && observation.newTabsCreated === 0
    && authorization?.explicit === true && text(authorization.evidenceRef) && sameScope(authorization.scope, observation.scope))
    return decision('OPEN_AUTHORIZED_FALLBACK_ONCE', 'EXPLICIT_SCOPED_EXISTING_PROFILE_FALLBACK');
  return decision('BLOCKED', 'EXISTING_CONTROL_UNAVAILABLE_NO_FURTHER_AUTHORIZED_RECOVERY');
}

export function planCatalogUpload(release, observation) {
  if (observation?.ownership !== 'agent') return decision('WAIT_USER_HANDOFF', 'CURRENT_SESSION_NOT_AGENT_OWNED');
  if (observation.authenticated !== true) return decision('WAIT_USER_AUTH', 'EXISTING_LOGIN_REQUIRED');
  if (!sameScope(release, observation.scope)
    || !/^\d+\.\d+\.\d+$/u.test(release.version ?? '')
    || !/^[a-f0-9]{40}$/u.test(release.commit ?? '') || !/^[a-f0-9]{64}$/u.test(release.packageSha256 ?? '')
    || !text(release.packagePath)
    || !Array.isArray(release.devicePermissions) || release.devicePermissions.length !== 0
    || !Array.isArray(release.resourceSpecificPermissions) || release.resourceSpecificPermissions.length !== 0
    || !sameTargets(release.installedTargets, observation.installedTargets)
    || !text(release.availability) || !text(observation.availability) || release.availability !== observation.availability)
    return decision('BLOCKED', 'RELEASE_IDENTITY_OR_EXISTING_SCOPE_MISMATCH');
  if (!Number.isInteger(observation.transferCount) || observation.transferCount < 0 || observation.transferCount > 1)
    return decision('BLOCKED', 'TRANSFER_HISTORY_UNVERIFIED_OR_DUPLICATED');
  if (observation.currentSnapshot !== true) return decision('READ_CURRENT_STATE', 'FRESH_STATE_REQUIRED_AFTER_EACH_ACTION');
  if (observation.stage === 'catalog-readback')
    return observation.catalogVersion === release.version
      ? decision('CATALOG_UPDATED_ONLY', 'INSTALLATION_RUNTIME_AND_NATIVE_UI_GATES_REMAIN_INDEPENDENT')
      : decision('BLOCKED', 'CATALOG_UPDATE_NOT_CONFIRMED_NO_BLIND_REUPLOAD');
  if (observation.transferCount === 1 || observation.stage === 'upload-uncertain')
    return decision('READ_CATALOG_WITHOUT_REUPLOAD', 'UNCERTAIN_WRITE_REQUIRES_ACTUAL_READBACK');
  if (observation.stage === 'app-details') return decision('OPEN_EXISTING_APP_UPDATE_DIALOG', 'USE_EXISTING_APP_NEW_VERSION_PATH');
  if (observation.stage === 'update-dialog')
    return observation.innerFileControlObserved === true
      ? decision('SELECT_EXACT_PACKAGE_ONCE', 'ARM_CHOOSER_ON_DIALOG_INNER_FILE_CONTROL')
      : decision('READ_CURRENT_DIALOG', 'OUTER_UPLOAD_CONTROL_IS_NOT_FILE_CHOOSER');
  return decision('BLOCKED', 'UPLOAD_STAGE_UNVERIFIED');
}

export const TEAMS_CATALOG_UI_INSTRUCTIONS = Object.freeze([
  'Read current ownership and ambient UI, then verify actual control of the existing in-app browser tab.',
  'Use planExistingTabRecovery: one bounded existing-session recovery; a fallback tab requires recorded explicit approval for the same tenant/catalog/app and the same logged-in profile. Preserve user tabs.',
  'Pause for user-owned sessions and authentication prompts. Do not reload an authentication or upload flow.',
  'Use planCatalogUpload with the verified ZIP identity and unchanged installation/availability scope before every upload step.',
  'Existing app > New version > outer File upload opens the update dialog. Re-read the dialog and arm the file chooser only on its inner file control.',
  'Transfer the exact verified package once. If the write outcome is unknown, read the catalog before any retry; never infer success from a spinner.',
  'Read back catalog, Graph installation, About label and live runtime separately. Catalog success alone does not pass native desktop, mobile or full release gates.',
]);
