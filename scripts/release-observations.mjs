// Shared by the operator release command and CI. This validates observations;
// it never uploads, grants consent, clicks Continue, or changes tunnel security.
const identityFields = ['tenantId', 'catalogId', 'appId', 'version', 'sourceCommit', 'packageSha256', 'serverBundleSha256', 'publicOrigin', 'assetSha256'];
const sources = { portal: ['admin-center-ui', 'catalog-service'], personalInstall: ['teams-about-ui', 'graph-installed-app'], runtime: ['live-health'], desktop: ['native-teams'] };

export function validateReleaseObservations(evidence, expected, now = new Date()) {
  for (const field of identityFields) {
    if (typeof expected?.[field] !== 'string' || !expected[field].trim()) throw new Error(`expected release identity missing ${field}`);
  }
  for (const [boundary, allowed] of Object.entries(sources)) {
    const observation = evidence?.[boundary];
    if (!observation || !allowed.includes(observation.source)) throw new Error(`${boundary}: missing observation or unsupported source (cache/fixture is not live evidence)`);
    const time = Date.parse(observation.observedAt);
    if (!Number.isFinite(time) || time > now.getTime() || now.getTime() - time > 24 * 60 * 60 * 1000) throw new Error(`${boundary}: stale or invalid observation time`);
    if (observation.result !== 'PASS') throw new Error(`${boundary}: not PASS`);
    for (const field of identityFields) {
      if (observation.identity?.[field] !== expected[field]) throw new Error(`${boundary}: release identity mismatch ${field}`);
    }
  }
  if (evidence.personalInstall.installedVersion !== expected.version) throw new Error('observed personal installed version mismatch');
  const runtime = evidence.runtime;
  if (!(Date.parse(runtime.expiresAt) > now.getTime())) throw new Error('runtime: expired or missing live window');
  for (const [key, value] of Object.entries({ auth: 'teams-authenticated', bot: 'teams-sdk', outbound: 'teams-sdk' })) {
    if (runtime.health?.[key] !== value) throw new Error(`runtime: ${key} mismatch`);
  }
  for (const field of ['version', 'sourceCommit', 'serverBundleSha256']) {
    if (runtime.health?.[field] !== expected[field]) throw new Error(`runtime: observed health ${field} mismatch`);
  }
  if (evidence.desktop.applicationId !== 'com.microsoft.teams2') throw new Error('desktop: native Teams application identity missing');
  for (const id of ['delegate-message', 'dialog', 'personal-job', 'detail-deep-link']) {
    const matches = evidence.desktop.rows?.filter(row => row.id === id) ?? [];
    if (matches.length !== 1 || matches[0].result !== 'PASS') throw new Error(`desktop: missing current flow ${id}`);
    for (const field of ['screenshotBefore', 'screenshotAfter', 'accessibilityEvidence', 'runtimeEvidence']) {
      if (typeof matches[0][field] !== 'string' || !matches[0][field].trim()) throw new Error(`desktop: ${id} missing ${field}`);
    }
  }
  return true;
}

export function canContinueTunnelNotice(notice, verifiedOrigin, isCurrentlyAuthorized = () => false) {
  if (notice?.kind !== 'service-html' || notice.origin !== verifiedOrigin) return false;
  const text = String(notice.text ?? '');
  const known = (/about to connect to a dev tunnel/i.test(text) && /trust the sender/i.test(text))
    || (/개발자 터널에 연결하려고/.test(text) && /링크를 보낸 사람을 신뢰/.test(text));
  // The caller consults current task authorization. Persisted rules/receipts
  // are never interpreted as permission, and TLS/unknown warnings stay blocked.
  return known && typeof isCurrentlyAuthorized === 'function' && isCurrentlyAuthorized({ action: 'continue-service-notice', origin: verifiedOrigin }) === true;
}
