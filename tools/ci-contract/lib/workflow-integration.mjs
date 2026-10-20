import { createHash } from 'node:crypto';
export const ORIGINAL_WORKFLOW_SHA256 = '1954404f5c8f9f06460991f76b1aad4c68075ddcc0374f18817c55cce679b031';
const requireValue = (value) => { if (!value) throw new Error('CI_WORKFLOW_INTEGRATION_REJECTED'); };
const expr = (value) => '$' + '{{ ' + value + ' }}';
function jobs(text) {
  const starts = [...text.matchAll(/^  ([A-Za-z0-9_]+):\n/gm)].filter((match) => match.index > text.indexOf('\njobs:\n'));
  requireValue(text.split('\njobs:\n').length === 2 && starts.length === 8);
  return starts.map((match, index) => ({ key: match[1], start: match.index, end: starts[index + 1]?.index ?? text.length }));
}
function helperSteps(count) {
  const results = Object.fromEntries(Array.from({ length: count }, (_, index) => [`step-${index + 1}`, {
    outcome: expr(`steps.ci_original_${index + 1}.outcome`), conclusion: expr(`steps.ci_original_${index + 1}.conclusion`),
  }]));
  return [
    '      - name: Finalize CI observation',
    '        id: ci_receipt_finalize',
    '        if: always()',
    '        timeout-minutes: 5',
    '        shell: bash',
    '        env:',
    `          CI_RECEIPT_JOB_STATUS: ${expr('job.status')}`,
    `          CI_RECEIPT_RESULTS: '${JSON.stringify(results)}'`,
    '        run: |',
    '          set +e',
    '          node tools/ci-contract/finalize-run.mjs',
    '          capture_status=$?',
    '          npm ci --prefix tools/ci-contract --ignore-scripts --no-audit --no-fund',
    '          deps_status=$?',
    '          receipt_root="${RUNNER_TEMP}/teams-ci-receipts/${GITHUB_RUN_ID}/${GITHUB_RUN_ATTEMPT}/${GITHUB_JOB}"',
    '          normalize_status=1',
    '          if [ "$deps_status" -eq 0 ] && [ -f "$receipt_root/capture/producer.json" ]; then',
    '            node tools/ci-contract/produce-receipt.mjs --capture-dir "$receipt_root/capture" --output-dir "$receipt_root/export/packet"',
    '            normalize_status=$?',
    '          fi',
    '          if [ "$capture_status" -ne 0 ] || [ "$deps_status" -ne 0 ] || [ "$normalize_status" -ne 0 ]; then',
    '            exit 1',
    '          fi',
    '      - name: Retain CI observation',
    '        id: ci_receipt_upload',
    '        if: always()',
    '        timeout-minutes: 5',
    '        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4',
    '        with:',
    `          name: ci-observation-${expr('github.run_id')}-${expr('github.run_attempt')}-${expr('github.job')}`,
    `          path: ${expr('runner.temp')}/teams-ci-receipts/${expr('github.run_id')}/${expr('github.run_attempt')}/${expr('github.job')}/export/`,
    '          if-no-files-found: error',
    '          retention-days: 14',
    '          compression-level: 0',
    '',
  ].join('\n');
}
export function instrumentWorkflow(original) {
  requireValue(!original.includes('id: ci_original_') && !original.includes('id: ci_receipt_') && !original.includes('TEAMS_CI_RECEIPT_MODE:'));
  let output = original.slice(0, jobs(original)[0].start).replace(/^env:\n/m, 'env:\n  TEAMS_CI_RECEIPT_MODE: observation\n');
  for (const job of jobs(original)) {
    const block = original.slice(job.start, job.end); const starts = [...block.matchAll(/^      - name: [^\n]+\n/gm)]; requireValue(starts.length > 0);
    output += block.slice(0, starts[0].index);
    for (const [index, start] of starts.entries()) {
      const definition = block.slice(start.index, starts[index + 1]?.index ?? block.length);
      requireValue(!/^        (id|shell):/m.test(definition));
      output += definition.replace(start[0], start[0] + `        id: ci_original_${index + 1}\n` + (/^        run:/m.test(definition)
        ? `        shell: 'node tools/ci-contract/capture-run.mjs step-${index + 1} {0}'\n` : ''));
    }
    output += helperSteps(starts.length);
  }
  requireValue(stripObservationIntegration(output) === original); return output;
}
export function stripObservationIntegration(integrated) {
  let output = integrated.slice(0, jobs(integrated)[0].start).replace(/^  TEAMS_CI_RECEIPT_MODE: observation\n/m, '');
  for (const job of jobs(integrated)) {
    const block = integrated.slice(job.start, job.end); const starts = [...block.matchAll(/^      - name: [^\n]+\n/gm)]; requireValue(starts.length > 0);
    output += block.slice(0, starts[0].index);
    for (const [index, start] of starts.entries()) {
      const definition = block.slice(start.index, starts[index + 1]?.index ?? block.length);
      if (/^        id: ci_receipt_(finalize|upload)\n/m.test(definition)) continue;
      output += definition.replace(/^        id: ci_original_[1-9][0-9]?\n/m, '')
        .replace(/^        shell: 'node tools\/ci-contract\/capture-run\.mjs step-[1-9][0-9]? \{0\}'\n/m, '');
    }
  }
  return output;
}
export function verifyWorkflowIntegration(integrated) {
  const original = stripObservationIntegration(integrated);
  requireValue(createHash('sha256').update(original).digest('hex') === ORIGINAL_WORKFLOW_SHA256);
  requireValue(instrumentWorkflow(original) === integrated); return { jobs: 8, originalSteps: 47, originalNpmCommands: 58 };
}
