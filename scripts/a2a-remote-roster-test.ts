import assert from 'node:assert/strict';

import {
  parseA2ARemotePeerRoster,
  resolveA2ARemotePeerCredentials,
  type A2ARemotePeerConfig,
} from '../src/server/a2a-remote-roster.js';

const secretEndpoint = 'https://remote.example.test/secret-agent';
const secretToken = 'super-secret-bearer-token';

type PeerInput = {
  agentId: string;
  providerId: string;
  kind: 'a2a' | 'hermes' | 'grok-hermes';
  endpoint: string;
  tokenEnv: string;
  executionIdentity: string;
  executionBoundaryId: string;
  roles: string[];
  capabilities: string[];
};

function peer(overrides: Partial<PeerInput> = {}): PeerInput {
  return {
    agentId: 'hermes-researcher',
    providerId: 'hermes-a2a',
    kind: 'hermes',
    endpoint: secretEndpoint,
    tokenEnv: 'HERMES_RESEARCH_TOKEN',
    executionIdentity: 'hermes-research-profile',
    executionBoundaryId: 'hermes-boundary-research',
    roles: ['researcher'],
    capabilities: ['source.read', 'web_search', 'research'],
    ...overrides,
  };
}

function parse(input: unknown): readonly A2ARemotePeerConfig[] {
  return parseA2ARemotePeerRoster(JSON.stringify(input));
}

function thrownMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
  assert.fail('expected an error');
}

function assertSafeFailure(action: () => unknown, forbidden: readonly string[]): void {
  const message = thrownMessage(action);
  assert.ok(message.length <= 256, 'configuration errors must remain bounded');
  for (const value of forbidden) {
    assert.equal(message.includes(value), false, `configuration error leaked ${value}`);
  }
}

const validRoster = parse([
  peer(),
  peer({
    agentId: 'grok-reviewer',
    providerId: 'grok-hermes-a2a',
    kind: 'grok-hermes',
    endpoint: 'https://grok-hermes.example.test/review',
    tokenEnv: 'GROK_HERMES_REVIEW_TOKEN',
    executionIdentity: 'grok-review-profile',
    executionBoundaryId: 'grok-boundary-review',
    roles: ['reviewer'],
    capabilities: ['source.read', 'review.report'],
  }),
]);

assert.equal(validRoster.length, 2);
assert.deepEqual(validRoster.map((entry) => entry.kind), ['hermes', 'grok-hermes']);
assert.equal(validRoster[0]?.tokenEnv, 'HERMES_RESEARCH_TOKEN');
assert.equal('bearerToken' in (validRoster[0] ?? {}), false, 'roster config must not contain a credential');
assert.ok(Object.isFrozen(validRoster));
assert.ok(Object.isFrozen(validRoster[0]));
assert.ok(Object.isFrozen(validRoster[0]?.roles));
assert.ok(Object.isFrozen(validRoster[0]?.capabilities));

const deterministicOne = parseA2ARemotePeerRoster(JSON.stringify([peer()]));
const deterministicTwo = parseA2ARemotePeerRoster(JSON.stringify([peer()]));
assert.deepEqual(deterministicOne, deterministicTwo, 'the same configuration must normalize deterministically');
assert.equal(JSON.stringify(deterministicOne), JSON.stringify(deterministicTwo));

const credentials = resolveA2ARemotePeerCredentials(validRoster, {
  HERMES_RESEARCH_TOKEN: secretToken,
  GROK_HERMES_REVIEW_TOKEN: 'grok-review-secret',
});
assert.deepEqual(credentials.map((entry) => ({
  agentId: entry.agentId,
  bearerToken: entry.bearerToken,
})), [
  { agentId: 'hermes-researcher', bearerToken: secretToken },
  { agentId: 'grok-reviewer', bearerToken: 'grok-review-secret' },
]);
assert.ok(Object.isFrozen(credentials));
assert.ok(Object.isFrozen(credentials[0]));
assert.equal('bearerToken' in (validRoster[0] ?? {}), false, 'resolving credentials must not mutate the roster');

assertSafeFailure(
  () => parseA2ARemotePeerRoster('{"endpoint":"https://remote.example.test/secret-agent'),
  [secretEndpoint, secretToken],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify({ ...peer(), bearerToken: secretToken })),
  [secretEndpoint, secretToken],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify({ ...peer(), endpoint: 'http://remote.example.test/review' })),
  ['http://remote.example.test/review'],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify({ ...peer(), endpoint: 'https://remote.example.test/review?token=secret' })),
  ['https://remote.example.test/review?token=secret', 'secret'],
);
assertSafeFailure(
  () => resolveA2ARemotePeerCredentials(validRoster, { GROK_HERMES_REVIEW_TOKEN: 'grok-review-secret' }),
  [secretEndpoint, secretToken],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster('x'.repeat(100_000)),
  [secretEndpoint, secretToken],
);

for (const field of [
  'agentId',
  'providerId',
  'endpoint',
  'tokenEnv',
  'executionIdentity',
  'executionBoundaryId',
] as const) {
  const first = peer();
  const second = peer({
    agentId: 'second-agent',
    providerId: 'second-provider',
    endpoint: 'https://second.example.test',
    tokenEnv: 'SECOND_TOKEN',
    executionIdentity: 'second-profile',
    executionBoundaryId: 'second-boundary',
  });
  second[field] = first[field];
  assertSafeFailure(
    () => parseA2ARemotePeerRoster(JSON.stringify([first, second])),
    [String(first[field]), secretEndpoint],
  );
}

assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify([{ ...peer(), kind: 'unknown' }])),
  [secretEndpoint],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify([{ ...peer(), roles: [] }])),
  [secretEndpoint],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify([{ ...peer(), capabilities: [''] }])),
  [secretEndpoint],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify([{ ...peer(), tokenEnv: 'not-safe-token-env' }])),
  [secretEndpoint],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify([{ ...peer(), endpoint: 'https://user:password@remote.example.test' }])),
  ['https://user:password@remote.example.test', 'password'],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify([{ ...peer(), unknown: 'field' }])),
  [secretEndpoint],
);

assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify(Array.from({ length: 9 }, (_, index) => peer({
    agentId: `agent-${index}`,
    providerId: `provider-${index}`,
    endpoint: `https://remote-${index}.example.test`,
    tokenEnv: `REMOTE_${index}_TOKEN`,
    executionIdentity: `profile-${index}`,
    executionBoundaryId: `boundary-${index}`,
  })))),
  [secretEndpoint],
);
assertSafeFailure(
  () => parseA2ARemotePeerRoster(JSON.stringify([{ ...peer(), roles: ['x'.repeat(121)] }])),
  [secretEndpoint],
);

assert.deepEqual(parseA2ARemotePeerRoster(undefined), []);
assert.deepEqual(parseA2ARemotePeerRoster('  '), []);

console.log('a2a-remote-roster-test: PASS');
