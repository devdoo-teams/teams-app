// Single schema source; generate-schema.mjs exports the portable JSON document.
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const object = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const array = (items, maxItems = 500) => ({ type: 'array', items, maxItems });
const nullable = (value) => ({ anyOf: [value, { type: 'null' }] });
const choices = (...values) => ({ enum: values });
const count = { type: 'integer', minimum: 0, maximum: 1000000000 };
const attempt = { type: 'integer', minimum: 1, maximum: 10000 };
const short = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:/ -]{0,159}$' };
const jobKey = { type: 'string', pattern: '^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$' };
const date = { type: 'string', format: 'date-time', maxLength: 40 };
const status = choices('queued', 'in_progress', 'completed', 'requested', 'waiting', 'pending');
const conclusion = choices(null, 'success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'stale', 'startup_failure');
const availability = choices('AVAILABLE', 'NOT_AVAILABLE_AT_READ', 'EXPIRED', 'NOT_UPLOADED', 'UNKNOWN');
const repository = choices('devdoo-teams/teams-app', 'doosanofficial-ui/WebDashboard');
const workflow = { type: 'string', pattern: '^\\.github/workflows/[A-Za-z0-9_-]+\\.ya?ml$', maxLength: 160 };

export const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:devdoo:ci-evidence-result:1.2.0',
  title: 'Teams and iPhone normalized CI evidence record (P0)',
  description: 'Structural/consistency contract only. This document does not authenticate producer claims or admit a release.',
  ...object({
    schemaVersion: choices('1.0.0', '1.1.0', '1.2.0'), policyVersion: { const: 'ci-contract-p0/1' },
    evidenceKind: choices('FIXTURE', 'OBSERVATION'),
    identity: object({
      repository, workflow, runId: ref('id'), attempt,
      profile: choices('core', 'optional', 'native-full', 'native-se', 'native-help', 'candidate', 'collector'),
      testedSha: nullable(ref('sha')), prHeadSha: nullable(ref('sha')), mergeSha: nullable(ref('sha')), collectorSha: nullable(ref('sha')),
    }),
    observation: object({
      status, apiConclusion: conclusion, attemptStartedAt: nullable(date), fetchedAt: date,
      paginationComplete: { type: 'boolean' },
      endpoint: { type: 'string', pattern: '^/repos/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+/actions/runs/[1-9][0-9]{0,19}/attempts/[1-9][0-9]{0,3}/jobs$', maxLength: 240 },
      responseDigest: ref('digest'),
    }),
    requirements: { ...array(object({
      scope: choices('teams-core', 'teams-optional', 'teams-a2a', 'teams-continuity', 'teams-azure', 'teams-container', 'teams-candidate', 'iphone-native-full', 'iphone-se', 'iphone-help', 'iphone-seed', 'iphone-candidate', 'collector'),
      required: { type: 'boolean' }, expectedTests: nullable(count),
      jobs: { ...array(object({ key: jobKey, matrixDigest: nullable(ref('digest')) })), minItems: 1 },
    }), 32), minItems: 1 },
    jobs: array(object({
      key: jobKey, matrixDigest: nullable(ref('digest')), kind: choices('TEST', 'BUILD', 'SEED', 'COLLECTOR', 'UNKNOWN'),
      listedJobId: ref('id'), listedAttempt: nullable(attempt), status, apiConclusion: conclusion,
      startedAt: nullable(date), completedAt: nullable(date), receiptAvailability: availability,
      expectedInputs: ref('inputs'), expectedDependencyDigests: nullable({ ...array(ref('digest'), 200), uniqueItems: true }),
      receiptDigest: nullable(ref('digest')), receipt: nullable(ref('receipt')),
      candidateOrigins: array(ref('origin'), 32), carriedForwardFrom: nullable(ref('origin')),
      reuseProof: nullable(object({
        policyVersion: { const: 'ci-contract-p0/1' }, originReceiptDigest: ref('digest'),
        compatibilityDigest: ref('digest'), consumedArtifactDigests: { ...array(ref('digest'), 200), uniqueItems: true },
      })),
    })),
    artifacts: array(object({ id: ref('id'), digest: nullable(ref('digest')), availability, digestVerified: { type: 'boolean' } }), 200),
    liveGates: array(object({
      surface: choices('server', 'personal-app', 'organization-catalog', 'teams-web', 'teams-desktop', 'iphone', 'carplay'),
      state: choices('PASS', 'FAIL', 'BLOCKED', 'UNVERIFIED', 'NOT_APPLICABLE'), evidenceDigest: nullable(ref('digest')),
    }), 7),
    delivery: object({
      state: choices('NOT_ATTEMPTED', 'PENDING', 'ACKNOWLEDGED', 'UNCERTAIN', 'FAILED'),
      ack: nullable(object({ notificationId: ref('digest'), payloadDigest: ref('digest'), receiptDigest: ref('digest'), acknowledgedAt: date })),
    }),
    revision: object({
      kind: choices('partial-failure', 'final', 'evidence-update'), sequence: { ...count, minimum: 1 },
      previousNotificationId: nullable(ref('digest')),
    }),
  }),
  $defs: {
    digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    sha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
    id: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' },
    inputs: object({ testedSha: nullable(ref('sha')), toolchainDigest: nullable(ref('digest')), suiteDigest: nullable(ref('digest')), inputDigest: nullable(ref('digest')), profileDigest: nullable(ref('digest')) }),
    origin: object({ runId: ref('id'), attempt, jobKey, matrixDigest: nullable(ref('digest')), receiptDigest: nullable(ref('digest')) }),
    receipt: object({
      producer: object({ repository, workflow, runId: ref('id'), attempt, jobKey, matrixDigest: ref('digest'), invocationId: short }),
      inputs: ref('inputs'), startedAt: date, completedAt: date, exitCode: { type: 'integer', minimum: 0, maximum: 255 },
      tests: nullable(object({ expected: nullable(count), executed: nullable(count), failed: nullable(count), unexpectedSkipped: nullable(count) })),
      cleanup: choices('VERIFIED', 'FAILED', 'UNKNOWN', 'NOT_REQUIRED'),
      producedArtifactDigests: { ...array(ref('digest'), 200), uniqueItems: true },
      consumedArtifactDigests: { ...array(ref('digest'), 200), uniqueItems: true },
      modelMeasurement: object({
        measurementScope: nullable(short), instrumentationVersion: nullable(short),
        coverageComplete: { type: 'boolean' }, credentialIsolationVerified: { type: 'boolean' },
        unobservedPaths: { ...array(short, 100), uniqueItems: true },
        observedModelCalls: nullable(count), blockedModelAttempts: nullable(count),
      }),
    }),
  },
};
// Optional additions preserve acceptance of existing 1.0 records.
schema.properties.identity.properties.runHeadSha = nullable(ref('sha'));
schema.properties.identity.properties.runNumber = nullable(ref('id'));
schema.properties.observation.properties.responseDigestKind = choices('RAW_BODY', 'PAGE_MANIFEST');
schema.properties.jobs.items.properties.keySource = choices('WORKFLOW_JOB_KEY', 'POLICY', 'API_ID');
schema.properties.evidenceIssues = array(choices('ARTIFACT_DIGEST_MISMATCH', 'LEGACY_RELEASE_IDENTITY_MISMATCH', 'RECEIPT_TESTED_SHA_CONFLICT'), 32);
schema.$defs.receipt.properties.producer.properties.runNumber = ref('id');
schema.$defs.receipt.properties.sourceEvidenceDigest = ref('digest');
schema.$defs.receipt.properties.evidenceKind = choices('FIXTURE', 'OBSERVATION');
