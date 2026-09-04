import type { ProviderLifecycleStore } from './provider-lifecycle-runner.js';
import type { ResponseEngine } from './response-engine.js';
import type { OptionalProviderRuntimeSnapshot } from './providers/optional-provider-runtime.js';

export type OptionalRuntimeLoaderResult = Readonly<{
  providerRuntime: OptionalProviderRuntimeSnapshot;
  responseEngines: readonly ResponseEngine[];
  openAiConfigured: boolean;
  localModelConfigured: boolean;
  grokConfigured: boolean;
  responseModel?: string;
}>;

export type OptionalRuntimeLoaderOptions = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  lifecycleStore?: ProviderLifecycleStore;
}>;

/**
 * Optional-only module boundary. The Core server imports this file as an
 * external lazy module, so its provider implementations cannot enter the Core
 * artifact even though the optional build uses the same loader.
 */
export async function loadOptionalRuntime(
  options: OptionalRuntimeLoaderOptions,
): Promise<OptionalRuntimeLoaderResult> {
  const environment = options.environment;
  const [{ LocalCompatibleResponseEngine }, { OpenAIResponseEngine }, { GrokResponseEngine }, { isLocalModelBaseUrlConfigured }, { createOptionalProviderRuntime }] = await Promise.all([
    import('./response-engine-local.js'),
    import('./response-engine-openai.js'),
    import('./response-engine-grok.js'),
    import('./local-model-url.js'),
    import('./providers/optional-provider-runtime.js'),
  ]);

  const openAiConfigured = Boolean(environment.OPENAI_API_KEY?.trim());
  const legacyGrokResponseConfigured = Boolean(environment.XAI_API_KEY?.trim());
  const providerRuntime = await createOptionalProviderRuntime({
    enabled: true,
    configuration: environment.TEAMS_OPTIONAL_PROVIDERS,
    environment,
    ...(options.lifecycleStore === undefined ? {} : { lifecycleStore: options.lifecycleStore }),
  });
  const localModelConfigured = isLocalModelBaseUrlConfigured(environment.LOCAL_MODEL_BASE_URL);
  const responseEngines = [
    ...(localModelConfigured ? [new LocalCompatibleResponseEngine()] : []),
    ...(openAiConfigured ? [new OpenAIResponseEngine()] : []),
    ...(legacyGrokResponseConfigured && !providerRuntime.responseProviderConfigured
      ? [new GrokResponseEngine()]
      : []),
    ...providerRuntime.responseEngines,
  ];
  const grokConfigured = legacyGrokResponseConfigured || providerRuntime.responseProviderConfigured;
  return Object.freeze({
    providerRuntime,
    responseEngines: Object.freeze(responseEngines),
    openAiConfigured,
    localModelConfigured,
    grokConfigured,
    ...(providerRuntime.responseModel === undefined ? {} : { responseModel: providerRuntime.responseModel }),
  });
}
