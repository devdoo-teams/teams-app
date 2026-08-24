const MARKER_SCHEMA_VERSION = 3;
const FULL_GIT_OID = /^[a-f0-9]{40}$/;

export function createServerBuildMarker({ sourceCommit, coreBuild, bundleSha256, worktree = 'clean' }) {
  if (!FULL_GIT_OID.test(sourceCommit)) throw new Error('server build marker requires a full source Git OID');
  if (!/^[a-f0-9]{64}$/.test(bundleSha256)) throw new Error('server build marker requires a SHA-256 bundle digest');
  if (worktree !== 'clean') throw new Error('server build marker requires a clean tracked worktree');
  return `${JSON.stringify({
    schemaVersion: MARKER_SCHEMA_VERSION,
    commit: sourceCommit,
    mode: coreBuild ? 'core' : 'optional',
    worktree,
    bundleSha256,
  })}\n`;
}

export function parseServerBuildMarker(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed?.schemaVersion !== MARKER_SCHEMA_VERSION) return null;
    if (!FULL_GIT_OID.test(parsed.commit)) return null;
    if (!/^[a-f0-9]{64}$/.test(parsed.bundleSha256)) return null;
    if (parsed.mode !== 'core' && parsed.mode !== 'optional') return null;
    if (parsed.worktree !== 'clean') return null;
    return {
      schemaVersion: parsed.schemaVersion,
      sourceCommit: parsed.commit,
      commit: parsed.commit,
      mode: parsed.mode,
      worktree: parsed.worktree,
      bundleSha256: parsed.bundleSha256,
    };
  } catch {
    return null;
  }
}

export function isReusableServerBuild(raw, { sourceCommit, commit, coreBuild, bundleSha256 }) {
  const marker = parseServerBuildMarker(raw);
  const expectedSourceCommit = sourceCommit ?? commit;
  return Boolean(
    marker
    && marker.sourceCommit === expectedSourceCommit
    && marker.mode === (coreBuild ? 'core' : 'optional')
    && marker.bundleSha256 === bundleSha256,
  );
}
