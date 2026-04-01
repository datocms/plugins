import type { ConfigParameters, NormalizedConfigParameters } from '../types';
import type { ProviderId, SupportedImageModel } from './imageService';
import {
  getSupportedModels,
  googleGenerateModels,
  openAiGenerateModels,
} from './imageService';

const providerFallbackOrder: ProviderId[] = ['openai', 'google'];

type ProviderConfigMap = NormalizedConfigParameters['providers'];
type ProviderConfig<P extends ProviderId> = ProviderConfigMap[P];
type ProviderModel<P extends ProviderId> = ProviderConfig<P>['defaultModel'];

const defaultConfigParameters: NormalizedConfigParameters = {
  defaultProvider: 'openai',
  providers: {
    openai: {
      apiKey: '',
      defaultModel: openAiGenerateModels[0],
    },
    google: {
      apiKey: '',
      defaultModel: googleGenerateModels[0],
    },
  },
};

/**
 * Normalizes current and legacy plugin parameters into the shape used by the UI.
 */
export function normalizeConfigParameters(
  parameters: ConfigParameters = {},
): NormalizedConfigParameters {
  const openAiApiKey =
    getTrimmedValue(parameters.providers?.openai?.apiKey) ||
    getTrimmedValue(parameters.apiKey);

  return {
    defaultProvider: resolveDefaultProvider(parameters, openAiApiKey),
    providers: {
      openai: {
        apiKey: openAiApiKey,
        defaultModel: resolveProviderModel('openai', [
          parameters.providers?.openai?.defaultModel,
          parameters.providers?.openai?.defaultGenerateModel,
          parameters.model,
        ]),
      },
      google: {
        apiKey: getTrimmedValue(parameters.providers?.google?.apiKey),
        defaultModel: resolveProviderModel('google', [
          parameters.providers?.google?.defaultModel,
          parameters.providers?.google?.defaultGenerateModel,
        ]),
      },
    },
  };
}

/**
 * Trims persisted values so saved payloads and dirty-state checks use the same shape.
 */
export function sanitizeConfigParameters(
  values: NormalizedConfigParameters,
): NormalizedConfigParameters {
  return {
    defaultProvider: values.defaultProvider,
    providers: {
      openai: {
        apiKey: getTrimmedValue(values.providers.openai.apiKey),
        defaultModel: values.providers.openai.defaultModel,
      },
      google: {
        apiKey: getTrimmedValue(values.providers.google.apiKey),
        defaultModel: values.providers.google.defaultModel,
      },
    },
  };
}

export function serializeConfigParameters(
  values: NormalizedConfigParameters,
): string {
  return JSON.stringify(sanitizeConfigParameters(values));
}

export function updateProviderSettings<P extends ProviderId>(
  values: NormalizedConfigParameters,
  provider: P,
  updates: Partial<ProviderConfig<P>>,
): NormalizedConfigParameters {
  const nextProviders = {
    ...values.providers,
    [provider]: {
      ...values.providers[provider],
      ...updates,
    },
  } as ProviderConfigMap;

  return {
    ...values,
    providers: nextProviders,
  };
}

export function getProviderApiKey(
  parameters: NormalizedConfigParameters,
  provider: ProviderId,
): string {
  return getTrimmedValue(parameters.providers[provider].apiKey);
}

export function getDefaultModelForProvider(
  parameters: NormalizedConfigParameters,
  provider: ProviderId,
): SupportedImageModel {
  return resolveProviderModel(provider, [
    parameters.providers[provider].defaultModel,
  ]);
}

export function getInitialProvider(
  parameters: NormalizedConfigParameters,
): ProviderId {
  if (getProviderApiKey(parameters, parameters.defaultProvider)) {
    return parameters.defaultProvider;
  }

  return (
    providerFallbackOrder.find((provider) =>
      getProviderApiKey(parameters, provider),
    ) || parameters.defaultProvider
  );
}

function resolveDefaultProvider(
  parameters: ConfigParameters,
  openAiApiKey: string,
): ProviderId {
  if (parameters.defaultProvider === 'google') {
    return 'google';
  }

  if (parameters.defaultProvider === 'openai') {
    return 'openai';
  }

  if (openAiApiKey) {
    return 'openai';
  }

  if (getTrimmedValue(parameters.providers?.google?.apiKey)) {
    return 'google';
  }

  return defaultConfigParameters.defaultProvider;
}

function resolveProviderModel<P extends ProviderId>(
  provider: P,
  candidates: readonly unknown[],
): ProviderModel<P> {
  const supportedModels = getSupportedModels(provider) as ProviderModel<P>[];
  const model = candidates.find(
    (candidate): candidate is ProviderModel<P> =>
      typeof candidate === 'string' &&
      supportedModels.includes(candidate as ProviderModel<P>),
  );

  return model || defaultConfigParameters.providers[provider].defaultModel;
}

function getTrimmedValue(value?: string): string {
  return value?.trim() || '';
}
