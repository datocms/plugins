import type { ConfigParameters, NormalizedConfigParameters } from '../types';
import type {
  ImageOutputFormat,
  ImageQuality,
  ProviderId,
  SupportedImageModel,
} from './imageService/types';

const providerFallbackOrder: ProviderId[] = ['openai', 'google'];
const imageQualityValues = ['auto', 'low', 'medium', 'high'] as const;
const imageOutputFormatValues = ['png', 'jpeg', 'webp'] as const;

const defaultConfigParameters: NormalizedConfigParameters = {
  defaultProvider: 'openai',
  providers: {
    openai: {
      apiKey: '',
      defaultModel: '',
      defaultQuality: 'high',
      defaultOutputFormat: 'webp',
      defaultCompression: 100,
    },
    google: {
      apiKey: '',
      defaultModel: '',
    },
  },
};

type ProviderConfigMap = NormalizedConfigParameters['providers'];
type ProviderConfig<P extends ProviderId> = ProviderConfigMap[P];

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
        defaultModel: resolveProviderModel([
          parameters.providers?.openai?.defaultModel,
          parameters.providers?.openai?.defaultGenerateModel,
          parameters.model,
        ]),
        defaultQuality: resolveImageQuality(
          parameters.providers?.openai?.defaultQuality,
        ),
        defaultOutputFormat: resolveImageOutputFormat(
          parameters.providers?.openai?.defaultOutputFormat,
        ),
        defaultCompression: resolveCompressionValue(
          parameters.providers?.openai?.defaultCompression,
        ),
      },
      google: {
        apiKey: getTrimmedValue(parameters.providers?.google?.apiKey),
        defaultModel: resolveProviderModel([
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
        defaultModel: getTrimmedValue(values.providers.openai.defaultModel),
        defaultQuality: resolveImageQuality(values.providers.openai.defaultQuality),
        defaultOutputFormat: resolveImageOutputFormat(
          values.providers.openai.defaultOutputFormat,
        ),
        defaultCompression: resolveCompressionValue(
          values.providers.openai.defaultCompression,
        ),
      },
      google: {
        apiKey: getTrimmedValue(values.providers.google.apiKey),
        defaultModel: getTrimmedValue(values.providers.google.defaultModel),
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
  return getTrimmedValue(parameters.providers[provider].defaultModel);
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

function resolveProviderModel(candidates: readonly unknown[]): string {
  const model = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && Boolean(candidate.trim()),
  );

  return getTrimmedValue(model);
}

function resolveImageQuality(value: unknown): ImageQuality {
  return isImageQuality(value)
    ? value
    : defaultConfigParameters.providers.openai.defaultQuality;
}

function resolveImageOutputFormat(value: unknown): ImageOutputFormat {
  return isImageOutputFormat(value)
    ? value
    : defaultConfigParameters.providers.openai.defaultOutputFormat;
}

function resolveCompressionValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultConfigParameters.providers.openai.defaultCompression;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function isImageQuality(value: unknown): value is ImageQuality {
  return (
    typeof value === 'string' &&
    imageQualityValues.includes(value as (typeof imageQualityValues)[number])
  );
}

function isImageOutputFormat(value: unknown): value is ImageOutputFormat {
  return (
    typeof value === 'string' &&
    imageOutputFormatValues.includes(
      value as (typeof imageOutputFormatValues)[number],
    )
  );
}

function getTrimmedValue(value?: string): string {
  return value?.trim() || '';
}
