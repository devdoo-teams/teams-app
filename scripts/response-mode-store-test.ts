import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type ResponseMode = 'deterministic' | 'openai' | 'local' | 'grok';
type ResponseModeScope = { tenantId: string; requesterId: string };
type ResponseModeAvailability = {
  mode: ResponseMode;
  label: string;
  configured: boolean;
  requiresServerConfiguration: boolean;
};

type ResponseModeStore = {
  get(scope: ResponseModeScope): Promise<ResponseMode>;
  set(scope: ResponseModeScope, mode: ResponseMode): Promise<unknown>;
  availability(): ResponseModeAvailability[];
};

type ResponseModeModules = {
  DEFAULT_RESPONSE_MODE: ResponseMode;
  ResponseModeSchema: { safeParse(value: unknown): { success: boolean } };
  ResponseModeStore: new (filePath: string, options?: { defaultMode?: ResponseMode; providers?: { openai: boolean; local: boolean; grok?: boolean } }) => ResponseModeStore;
  responseModeLabel(mode: ResponseMode): string;
  isLocalModelBaseUrlConfigured(value: string | undefined): boolean;
};

const localBaseUrlCases: Array<{ value: string; configured: boolean }> = [
  { value: 'https://model.internal.example/v1', configured: true },
  { value: 'https://user:password@model.internal.example/v1', configured: false },
  { value: 'https://model.internal.example/v1?api_key=url-secret', configured: false },
  { value: 'https://model.internal.example/v1#fragment', configured: false },
  { value: 'file:///tmp/local-model', configured: false },
  { value: 'https://', configured: false },
];

async function loadResponseModeModules(): Promise<ResponseModeModules> {
  try {
    const [contract, store, localModelUrl] = await Promise.all([
      import('../src/shared/response-mode.js'),
      import('../src/server/response-mode-store.js'),
      import('../src/server/local-model-url.js'),
    ]);
    return {
      DEFAULT_RESPONSE_MODE: contract.DEFAULT_RESPONSE_MODE,
      ResponseModeSchema: contract.ResponseModeSchema,
      ResponseModeStore: store.ResponseModeStore,
      responseModeLabel: contract.responseModeLabel,
      isLocalModelBaseUrlConfigured: localModelUrl.isLocalModelBaseUrlConfigured,
    };
  } catch (error) {
    assert.fail(
      `response-mode implementation is missing or cannot be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function withEnvironment<T>(
  changes: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(changes)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const modules = await loadResponseModeModules();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'response-mode-store-test-'));

try {
  assert.equal(modules.DEFAULT_RESPONSE_MODE, 'deterministic');
  assert.equal(modules.ResponseModeSchema.safeParse('deterministic').success, true);
  assert.equal(modules.ResponseModeSchema.safeParse('unknown').success, false);
  assert.equal(modules.responseModeLabel('deterministic'), '결정형');
  assert.equal(modules.responseModeLabel('openai'), 'OpenAI');
  assert.equal(modules.responseModeLabel('local'), '로컬/사내 모델');

  const storePath = path.join(root, 'response-modes.json');
  const store = new modules.ResponseModeStore(storePath);
  const firstScope = { tenantId: 'tenant-a', requesterId: 'requester-a' };
  const secondScope = { tenantId: 'tenant-b', requesterId: 'requester-a' };

  assert.equal(await store.get(firstScope), 'deterministic', 'new scopes use the deterministic default');
  await store.set(firstScope, 'openai');
  assert.equal(await store.get(firstScope), 'openai', 'a selected mode persists for its scope');
  assert.equal(await store.get(secondScope), 'deterministic', 'a tenant cannot inherit another tenant\'s mode');

  const grokDefaultPath = path.join(root, 'grok-default-response-modes.json');
  const grokDefaultStore = new modules.ResponseModeStore(grokDefaultPath, {
    defaultMode: 'grok',
    providers: { openai: false, local: false, grok: true },
  });
  assert.equal(await grokDefaultStore.get(secondScope), 'grok', 'an explicit optional deployment default may select Grok for new scopes');
  await grokDefaultStore.set(secondScope, 'openai');
  assert.equal(await grokDefaultStore.get(secondScope), 'openai', 'a persisted scope preference overrides the configured default');
  const restartedGrokDefaultStore = new modules.ResponseModeStore(grokDefaultPath, { defaultMode: 'grok' });
  assert.equal(await restartedGrokDefaultStore.get(secondScope), 'openai', 'the explicit preference remains authoritative after restart');
  assert.throws(
    () => new modules.ResponseModeStore(path.join(root, 'invalid-default-response-modes.json'), { defaultMode: 'unknown' as ResponseMode }),
    /response mode/i,
    'an invalid configured default response mode is rejected',
  );

  const restartedStore = new modules.ResponseModeStore(storePath);
  assert.equal(await restartedStore.get(firstScope), 'openai', 'the preference survives a store restart');

  const persisted = JSON.parse(await fs.readFile(storePath, 'utf8')) as Array<Record<string, unknown>>;
  assert.equal(persisted.length, 1);
  assert.deepEqual(Object.keys(persisted[0]).sort(), ['mode', 'requesterId', 'tenantId', 'updatedAt']);
  assert.equal(persisted[0].tenantId, firstScope.tenantId);
  assert.equal(persisted[0].requesterId, firstScope.requesterId);
  assert.equal(persisted[0].mode, 'openai');
  assert.equal(typeof persisted[0].updatedAt, 'string');
  assert.equal(JSON.stringify(persisted).includes('OPENAI_API_KEY'), false);

  await assert.rejects(
    () => store.set(firstScope, 'unknown' as ResponseMode),
    /response mode/i,
    'unknown response modes are rejected',
  );
  await assert.rejects(
    () => store.get({ tenantId: '   ', requesterId: 'requester-a' }),
    /scope/i,
    'blank tenant IDs are rejected',
  );
  await assert.rejects(
    () => store.set({ tenantId: 'tenant-a', requesterId: '' }, 'local'),
    /scope/i,
    'blank requester IDs are rejected',
  );

  const malformedPath = path.join(root, 'malformed-response-modes.json');
  await fs.writeFile(malformedPath, '{"malformed":', 'utf8');
  const malformedBefore = await fs.readFile(malformedPath, 'utf8');
  const malformedStore = new modules.ResponseModeStore(malformedPath);
  await assert.rejects(
    () => malformedStore.set(firstScope, 'openai'),
    /invalid response mode store/i,
    'malformed persisted JSON is rejected',
  );
  assert.equal(
    await fs.readFile(malformedPath, 'utf8'),
    malformedBefore,
    'malformed persisted JSON is not overwritten',
  );

  const invalidRecordPath = path.join(root, 'invalid-record-response-modes.json');
  const invalidRecord = JSON.stringify([{
    tenantId: 'tenant-a',
    requesterId: 'requester-a',
    mode: 'unknown',
    updatedAt: new Date().toISOString(),
  }]);
  await fs.writeFile(invalidRecordPath, invalidRecord, 'utf8');
  const invalidRecordStore = new modules.ResponseModeStore(invalidRecordPath);
  await assert.rejects(
    () => invalidRecordStore.get(firstScope),
    /invalid response mode store/i,
    'invalid persisted modes are rejected',
  );
  assert.equal(await fs.readFile(invalidRecordPath, 'utf8'), invalidRecord);

  await withEnvironment(
    { OPENAI_API_KEY: '  ', LOCAL_MODEL_BASE_URL: 'not a url' },
    async () => {
      const unavailableStore = new modules.ResponseModeStore(storePath, { providers: { openai: false, local: false } });
      assert.deepEqual(unavailableStore.availability(), [
        {
          mode: 'deterministic',
          label: '결정형',
          configured: true,
          requiresServerConfiguration: false,
        },
        {
          mode: 'openai',
          label: 'OpenAI',
          configured: false,
          requiresServerConfiguration: true,
        },
        {
          mode: 'local',
          label: '로컬/사내 모델',
          configured: false,
          requiresServerConfiguration: true,
        },
        {
          mode: 'grok',
          label: 'Grok (xAI)',
          configured: false,
          requiresServerConfiguration: true,
        },
      ]);
    },
  );

  await withEnvironment(
    { OPENAI_API_KEY: 'server-secret', LOCAL_MODEL_BASE_URL: 'https://model.internal.example/v1' },
    async () => {
      const configuredStore = new modules.ResponseModeStore(storePath, {
        providers: {
          openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
          local: modules.isLocalModelBaseUrlConfigured(process.env.LOCAL_MODEL_BASE_URL),
        },
      });
      const availability = configuredStore.availability();
      assert.equal(availability.find((entry) => entry.mode === 'deterministic')?.configured, true);
      assert.equal(availability.find((entry) => entry.mode === 'openai')?.configured, true);
      assert.equal(availability.find((entry) => entry.mode === 'local')?.configured, true);
      assert.equal(JSON.stringify(availability).includes('server-secret'), false);
      assert.equal(JSON.stringify(availability).includes('model.internal.example'), false);
    },
  );

  for (const testCase of localBaseUrlCases) {
    await withEnvironment({ LOCAL_MODEL_BASE_URL: testCase.value }, async () => {
      assert.equal(
        modules.isLocalModelBaseUrlConfigured(process.env.LOCAL_MODEL_BASE_URL),
        testCase.configured,
        `local model URL configuration for ${testCase.value}`,
      );
      const availabilityStore = new modules.ResponseModeStore(storePath, {
        providers: { openai: false, local: testCase.configured },
      });
      assert.equal(
        availabilityStore.availability().find((entry) => entry.mode === 'local')?.configured,
        testCase.configured,
        `local response mode configuration for ${testCase.value}`,
      );
    });
  }

  console.log('PASS: response mode contract, scoped persistence, validation, and availability checks');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
