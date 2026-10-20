import { schema as common } from './schema.mjs';
const object = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const array = (items, maxItems = 100) => ({ type: 'array', items, maxItems });
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const choices = (...values) => ({ enum: values });
const nullable = (value) => ({ anyOf: [value, { type: 'null' }] });
const label = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$' };
const short = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:/ ()-]{0,159}$' };
const filename = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' };
const descriptor = object({ file: filename, sha256: ref('digest') });
const namedFile = object({ name: label, ...descriptor.properties });
const date = { type: 'string', format: 'date-time', maxLength: 40 };
const exit = { type: 'integer', minimum: 0, maximum: 255 };
const count = { type: 'integer', minimum: 0, maximum: 1000000000 };
const context = object({ repository: { const: 'devdoo-teams/teams-app' }, workflow: { const: '.github/workflows/core-ci.yml' },
  runId: ref('id'), runNumber: ref('id'), attempt: { type: 'integer', minimum: 1, maximum: 10000 },
  jobKey: choices('core', 'a2a', 'continuity', 'azure', 'optional', 'copilot_ui', 'container', 'artifact'),
  invocationId: label, testedSha: ref('sha') });
const tests = object({ expected: nullable(count), executed: nullable(count), failed: nullable(count), unexpectedSkipped: nullable(count) });
const schema = (properties) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...object(properties), $defs: common.$defs });
export const producerSchemas = {
  capture: schema({ schemaVersion: { const: 'ci-producer/1' }, evidenceKind: common.properties.evidenceKind, context,
    source: descriptor, workflow: descriptor, package: descriptor, lock: descriptor, toolchain: descriptor, profile: descriptor, job: descriptor,
    inputs: { ...array(namedFile, 100), minItems: 1 },
    scopes: { ...array(object({ scopeId: label, ...descriptor.properties })), minItems: 1 },
    producedArtifacts: array(namedFile, 20), consumedArtifacts: array(namedFile, 20) }),
  source: schema({ schemaVersion: { const: 'ci-source/1' }, repository: context.properties.repository,
    testedSha: ref('sha'), worktree: { const: 'clean' }, workflowSha256: ref('digest'), packageSha256: ref('digest'), lockSha256: ref('digest') }),
  toolchain: schema({ schemaVersion: { const: 'ci-toolchain/1' },
    matrix: object({ os: choices('Linux', 'macOS', 'Windows'), arch: choices('X86', 'X64', 'ARM', 'ARM64'), node: short, variant: short }),
    tools: { ...array(object({ name: label, version: short }), 32), minItems: 1 } }),
  profile: schema({ schemaVersion: { const: 'ci-profile/1' }, profile: common.properties.identity.properties.profile,
    scope: common.properties.requirements.items.properties.scope, kind: choices('TEST', 'BUILD'),
    producedArtifacts: { ...array(label, 20), uniqueItems: true }, consumedArtifacts: { ...array(label, 20), uniqueItems: true } }),
  job: schema({ schemaVersion: { const: 'ci-job-observation/1' }, context, startedAt: date, completedAt: date,
    exitCode: nullable(exit), cleanup: common.$defs.receipt.properties.cleanup }),
  observation: schema({ schemaVersion: { const: 'ci-scope-observation/1' }, context, scopeId: label,
    definitionDigest: ref('digest'), state: choices('EXECUTED', 'NOT_RUN', 'CANCELLED', 'SIGNALLED', 'SKIPPED', 'OUTCOME_ONLY', 'MISSING'),
    startedAt: nullable(date), completedAt: nullable(date), exitCode: nullable(exit), testEvidence: choices('COUNTS', 'NONE', 'UNKNOWN'), tests: nullable(tests) }),
};
producerSchemas.job.properties.coverageComplete = { type: 'boolean' };
producerSchemas.capture.properties.evidenceFiles = array(descriptor, 20);
producerSchemas.job.properties.executionBoundary = choices('API_JOB', 'RUN_SCOPES');
producerSchemas.observation.properties.runner = object({ source: choices('SHELL', 'ENGINE', 'MISSING'),
  outcome: choices(null, 'success', 'failure', 'cancelled', 'skipped'), conclusion: choices(null, 'success', 'failure', 'cancelled', 'skipped'),
  scriptSha256: nullable(ref('digest')), signal: nullable({ type: 'string', pattern: '^SIG[A-Z0-9]{1,12}$', maxLength: 15 }),
  requestedSignal: choices(null, 'SIGINT', 'SIGTERM') });
