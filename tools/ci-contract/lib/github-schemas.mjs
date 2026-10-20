import { schema as result } from './schema.mjs';
const object = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const array = (items, maxItems = 30) => ({ type: 'array', items, maxItems });
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const filename = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' };
const date = { type: 'string', format: 'date-time', maxLength: 40 };
const attempt = { type: 'integer', minimum: 1, maximum: 10000 };
const page = { type: 'integer', minimum: 1, maximum: 30 };
const perPage = { type: 'integer', minimum: 1, maximum: 100 };
const pageFields = { file: filename, page, perPage, fetchedAt: date };
const manifest = (properties) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...object(properties), $defs: result.$defs });
export const captureSchema = manifest({
  captureVersion: { const: '1.0.0' }, evidenceKind: result.properties.evidenceKind,
  repository: result.properties.identity.properties.repository, runId: ref('id'), attempt,
  run: object({ file: filename, fetchedAt: date }),
  jobPages: array(object({ ...pageFields, attempt })), historyJobPages: array(object({ ...pageFields, attempt })),
  artifactPages: array(object(pageFields)),
  receiptFiles: array(object({ listedJobId: ref('id'), file: filename }), 500),
  artifactFiles: array(object({ artifactId: ref('id'), file: filename }), 20),
  releaseIdentityFiles: array(object({ artifactId: ref('id'), file: filename }), 20),
});
export const policySchema = manifest({
  policyVersion: { const: 'github-reader/1' }, repository: result.properties.identity.properties.repository,
  workflow: result.properties.identity.properties.workflow,
  runHeadSha: { anyOf: [ref('sha'), { type: 'null' }] }, profile: result.properties.identity.properties.profile,
  requirements: result.properties.requirements,
  bindings: array(object({
    name: { type: 'string', pattern: '^[^\\u0000-\\u001f\\u007f]{1,200}$' },
    key: result.properties.jobs.items.properties.key,
    matrixDigest: result.properties.jobs.items.properties.matrixDigest,
    kind: result.properties.jobs.items.properties.kind,
    expectedInputs: ref('inputs'), expectedDependencyDigests: result.properties.jobs.items.properties.expectedDependencyDigests,
  }), 500),
});
