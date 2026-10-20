import { hash } from './factory.mjs';

export function producerFixture({ attempt = 1 } = {}) {
  const time = (seconds) => new Date(Date.parse('2026-10-20T00:00:00Z') + (attempt - 1) * 3600000 + seconds * 1000).toISOString();
  const steps = [
    '      - name: First synthetic check\n        run: node first-test.mjs\n',
    '      - name: Second synthetic check\n        run: node second-test.mjs\n',
  ];
  const workflow = 'name: Synthetic CI\njobs:\n  core:\n    name: Core verification\n    runs-on: ubuntu-latest\n    steps:\n' + steps.join('');
  const context = { repository: 'devdoo-teams/teams-app', workflow: '.github/workflows/core-ci.yml',
    runId: '1001', runNumber: '42', attempt, jobKey: 'core', invocationId: `synthetic-core-${attempt}`, testedSha: 'a'.repeat(40) };
  const files = {
    'workflow.yml': workflow, 'package.json': JSON.stringify({ name: 'synthetic', scripts: { test: 'node first-test.mjs && node second-test.mjs' } }),
    'lock.json': JSON.stringify({ lockfileVersion: 3, packages: {} }),
    'toolchain.json': JSON.stringify({ schemaVersion: 'ci-toolchain/1', matrix: { os: 'Linux', arch: 'X64', node: '24.13.1', variant: 'synthetic' }, tools: [{ name: 'node', version: '24.13.1' }] }),
    'profile.json': JSON.stringify({ schemaVersion: 'ci-profile/1', profile: 'core', scope: 'teams-core', kind: 'TEST', producedArtifacts: ['package'], consumedArtifacts: [] }),
    'input.bin': 'synthetic test input', 'package.bin': 'synthetic package bytes',
  };
  files['source.json'] = JSON.stringify({ schemaVersion: 'ci-source/1', repository: context.repository,
    testedSha: context.testedSha, worktree: 'clean', workflowSha256: hash(files['workflow.yml']),
    packageSha256: hash(files['package.json']), lockSha256: hash(files['lock.json']) });
  files['job.json'] = JSON.stringify({ schemaVersion: 'ci-job-observation/1', context,
    startedAt: time(60), completedAt: time(120), exitCode: 0, cleanup: 'VERIFIED' });
  for (const [index, step] of steps.entries()) {
    const start = time(index === 0 ? 60 : 90);
    const end = time(index === 0 ? 80 : 120);
    files[`step-${index + 1}.json`] = JSON.stringify({ schemaVersion: 'ci-scope-observation/1', context,
      scopeId: `step-${index + 1}`, definitionDigest: hash(step), state: 'EXECUTED', startedAt: start, completedAt: end,
      exitCode: 0, testEvidence: 'COUNTS', tests: { expected: index + 2, executed: index + 2, failed: 0, unexpectedSkipped: 0 } });
  }
  const descriptor = (file) => ({ file, sha256: hash(files[file]) });
  const capture = { schemaVersion: 'ci-producer/1', evidenceKind: 'FIXTURE', context,
    source: descriptor('source.json'), workflow: descriptor('workflow.yml'), package: descriptor('package.json'), lock: descriptor('lock.json'),
    toolchain: descriptor('toolchain.json'), profile: descriptor('profile.json'), job: descriptor('job.json'),
    inputs: [{ name: 'fixture-input', ...descriptor('input.bin') }],
    scopes: steps.map((_, index) => ({ scopeId: `step-${index + 1}`, ...descriptor(`step-${index + 1}.json`) })),
    producedArtifacts: [{ name: 'package', ...descriptor('package.bin') }], consumedArtifacts: [],
  };
  return { capture, files };
}
