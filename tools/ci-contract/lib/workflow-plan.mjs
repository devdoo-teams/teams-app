import { createHash } from 'node:crypto';
const fail = (value) => { if (!value) throw new Error('WORKFLOW_LAYOUT_UNSUPPORTED'); };
export const jobPolicies = Object.freeze({ core: ['teams-core', 'TEST'], a2a: ['teams-a2a', 'TEST'], continuity: ['teams-continuity', 'TEST'], azure: ['teams-azure', 'TEST'],
  optional: ['teams-optional', 'TEST'], copilot_ui: ['teams-optional', 'TEST'], container: ['teams-container', 'BUILD'], artifact: ['teams-candidate', 'BUILD'] });
export function workflowJobPlan(text, jobKey) {
  fail(Object.hasOwn(jobPolicies, jobKey));
  fail(typeof text === 'string' && !text.includes('\r') && text.split('\njobs:\n').length === 2);
  const jobs = [...text.matchAll(/^  ([A-Za-z0-9_]+):\n/gm)].filter((match) => match.index > text.indexOf('\njobs:\n'));
  fail(jobs.length > 0 && jobs.length <= 16 && new Set(jobs.map((x) => x[1])).size === jobs.length);
  const index = jobs.findIndex((match) => match[1] === jobKey); fail(index >= 0);
  const block = text.slice(jobs[index].index, jobs[index + 1]?.index ?? text.length);
  fail((block.match(/^    steps:\n/gm) ?? []).length === 1);
  const starts = [...block.matchAll(/^      - name: ([^\r\n]{1,160})\n/gm)];
  fail(starts.length > 0 && starts.length <= 100 && (block.match(/^      - /gm) ?? []).length === starts.length);
  let original = 0;
  return starts.map((match, index) => {
    const definition = block.slice(match.index, starts[index + 1]?.index ?? block.length);
    const actions = [...definition.matchAll(/^        (run|uses):/gm)]; fail(actions.length === 1);
    if (/^        id: ci_receipt_(finalize|upload)\n/m.test(definition)) return null;
    original++;
    const explicit = definition.match(/^        id: ci_original_([1-9][0-9]?)\n/m);
    fail(!explicit || Number(explicit[1]) === original);
    return { id: `step-${original}`, name: match[1], type: actions[0][1] === 'run' ? 'RUN' : 'ACTION', definitionDigest: createHash('sha256').update(definition).digest('hex') };
  }).filter(Boolean);
}
