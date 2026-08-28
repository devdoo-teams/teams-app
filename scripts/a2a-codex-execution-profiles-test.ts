import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createA2ACodexExecutionProfiles } from '../src/server/a2a-codex-execution-profiles.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-codex-profiles-'));
const firstHome = path.join(root, 'codex-home-1');
const secondHome = path.join(root, 'codex-home-2');
const legacyHome = path.join(root, 'legacy-service-codex-home');
const insecureHome = path.join(root, 'insecure-codex-home');
const sharedExecutable = path.join(root, 'codex');
const sharedDigest = 'a'.repeat(64);

try {
  await fs.mkdir(firstHome, { mode: 0o700 });
  await fs.mkdir(secondHome, { mode: 0o700 });
  await fs.mkdir(legacyHome, { mode: 0o700 });
  await fs.mkdir(insecureHome, { mode: 0o755 });
  await fs.chmod(insecureHome, 0o755);
  await fs.writeFile(path.join(firstHome, 'auth.json'), '{"fixture":"profile-one"}\n', { mode: 0o600 });
  await fs.writeFile(path.join(secondHome, 'auth.json'), '{"fixture":"profile-two"}\n', { mode: 0o600 });

  const profiles = await createA2ACodexExecutionProfiles({
    ordinals: [1, 2],
    environment: {
      AGENT_CODEX_HOME_1: firstHome,
      AGENT_CODEX_HOME_2: secondHome,
      CODEX_BIN: sharedExecutable,
      CODEX_BIN_SHA256: sharedDigest,
    },
  });

  assert.deepEqual(
    profiles.map(({ ordinal, codexHome, codexExecutable, codexExecutableSha256 }) => ({
      ordinal,
      codexHome,
      codexExecutable,
      codexExecutableSha256,
    })),
    [
      {
        ordinal: 1,
        codexHome: await fs.realpath(firstHome),
        codexExecutable: path.normalize(sharedExecutable),
        codexExecutableSha256: sharedDigest,
      },
      {
        ordinal: 2,
        codexHome: await fs.realpath(secondHome),
        codexExecutable: path.normalize(sharedExecutable),
        codexExecutableSha256: sharedDigest,
      },
    ],
    'each indexed Codex worker must receive its own home while sharing only the pinned executable inputs',
  );
  assert.notEqual(profiles[0]?.codexHome, profiles[1]?.codexHome);
  assert.ok(Object.isFrozen(profiles));
  assert.ok(profiles.every((profile) => Object.isFrozen(profile)));

  const missingAuthHome = path.join(root, 'missing-auth-home');
  await fs.mkdir(missingAuthHome, { mode: 0o700 });
  await assert.rejects(
    () => createA2ACodexExecutionProfiles({
      ordinals: [1],
      environment: {
        AGENT_CODEX_HOME_1: missingAuthHome,
        CODEX_BIN: sharedExecutable,
        CODEX_BIN_SHA256: sharedDigest,
      },
    }),
    /AGENT_CODEX_HOME_1\/auth\.json is unavailable/u,
    'a worker without auth metadata must not be advertised as execution-ready',
  );

  await assert.rejects(
    () => createA2ACodexExecutionProfiles({
      ordinals: [1, 2],
      environment: {
        AGENT_CODEX_HOME_1: firstHome,
        AGENT_CODEX_HOME_2: firstHome,
        CODEX_BIN: sharedExecutable,
        CODEX_BIN_SHA256: sharedDigest,
      },
    }),
    /distinct private homes/u,
    'two indexed workers must not share one Codex home',
  );

  await assert.rejects(
    () => createA2ACodexExecutionProfiles({
      ordinals: [1, 2],
      environment: {
        AGENT_CODEX_HOME: legacyHome,
        AGENT_CODEX_HOME_1: firstHome,
        CODEX_BIN: sharedExecutable,
        CODEX_BIN_SHA256: sharedDigest,
      },
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /AGENT_CODEX_HOME_2/u);
      assert.doesNotMatch(message, /legacy-service-codex-home/u);
      return true;
    },
    'an unsuffixed service home must never satisfy a missing indexed worker home',
  );

  await assert.rejects(
    () => createA2ACodexExecutionProfiles({
      ordinals: [1, 2],
      environment: {
        AGENT_CODEX_HOME: firstHome,
        AGENT_CODEX_HOME_1: firstHome,
        AGENT_CODEX_HOME_2: secondHome,
        CODEX_BIN: sharedExecutable,
        CODEX_BIN_SHA256: sharedDigest,
      },
    }),
    /distinct from the legacy service/u,
    'an indexed worker must not alias the ordinary service Codex home',
  );

  await assert.rejects(
    () => createA2ACodexExecutionProfiles({
      ordinals: [1],
      environment: {
        AGENT_CODEX_HOME_1: insecureHome,
        CODEX_BIN: sharedExecutable,
        CODEX_BIN_SHA256: sharedDigest,
      },
    }),
    /owner-only/u,
    'each indexed Codex home must remain private to the service user',
  );

  console.log('a2a-codex-execution-profiles-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
