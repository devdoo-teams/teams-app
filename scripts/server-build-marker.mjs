const MARKER_SCHEMA_VERSION = 2;

export function createServerBuildMarker({ commit, coreBuild, worktree = 'clean' }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('server build marker requires a full Git commit');
  if (worktree !== 'clean') throw new Error('server build marker requires a clean tracked worktree');
  return `${JSON.stringify({
    schemaVersion: MARKER_SCHEMA_VERSION,
    commit,
    mode: coreBuild ? 'core' : 'optional',
    worktree,
  })}\n`;
}

export function parseServerBuildMarker(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed?.schemaVersion !== MARKER_SCHEMA_VERSION) return null;
    if (!/^[a-f0-9]{40}$/.test(parsed.commit)) return null;
    if (parsed.mode !== 'core' && parsed.mode !== 'optional') return null;
    if (parsed.worktree !== 'clean') return null;
    return {
      schemaVersion: parsed.schemaVersion,
      commit: parsed.commit,
      mode: parsed.mode,
      worktree: parsed.worktree,
    };
  } catch {
    return null;
  }
}

export function isReusableServerBuild(raw, { commit, coreBuild }) {
  const marker = parseServerBuildMarker(raw);
  return Boolean(
    marker
    && marker.commit === commit
    && marker.mode === (coreBuild ? 'core' : 'optional'),
  );
}
