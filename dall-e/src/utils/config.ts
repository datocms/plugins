import {
  getModelOptions,
  googleGenerateModels,
  openAiGenerateModels,
} from './imageService';
import type {
  GoogleGenerateModel,
  OpenAiGenerateModel,
  ProviderId,
  SupportedImageModel,
} from './imageService';
import type { ConfigParameters, NormalizedConfigParameters } from '../types';

export const defaultConfigParameters: NormalizedConfigParameters = {
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

export function normalizeConfigParameters(
  parameters?: ConfigParameters,
): NormalizedConfigParameters {
  const raw = parameters || {};
  const openAiApiKey =
    raw.providers?.openai?.apiKey?.trim() || raw.apiKey?.trim() || '';
  const legacyModel =
    raw.model && isOpenAiGenerateModel(raw.model) ? raw.model : undefined;
  const defaultProvider =
    raw.defaultProvider === 'google'
      ? 'google'
      : raw.defaultProvider === 'openai'
        ? 'openai'
        : openAiApiKey
          ? 'openai'
          : raw.providers?.google?.apiKey?.trim()
            ? 'google'
            : defaultConfigParameters.defaultProvider;

  return {
    defaultProvider,
    providers: {
      openai: {
        apiKey: openAiApiKey,
        defaultModel: getOpenAiDefaultModel(raw, legacyModel),
      },
      google: {
        apiKey: raw.providers?.google?.apiKey?.trim() || '',
        defaultModel: getGoogleDefaultModel(raw),
      },
    },
  };
}

export function getProviderApiKey(
  parameters: NormalizedConfigParameters,
  provider: ProviderId,
): string {
  return parameters.providers[provider].apiKey.trim();
}

export function getDefaultModelForProvider(
  parameters: NormalizedConfigParameters,
  provider: ProviderId,
): SupportedImageModel {
  const configuredModel = parameters.providers[provider].defaultModel;
  const optionValues = getModelOptions(provider, 'generate').map(
    (option) => option.value,
  );

  return optionValues.includes(configuredModel)
    ? configuredModel
    : optionValues[0];
}

export function getInitialProvider(
  parameters: NormalizedConfigParameters,
): ProviderId {
  const defaultProvider = parameters.defaultProvider;

  if (getProviderApiKey(parameters, defaultProvider)) {
    return defaultProvider;
  }

  if (getProviderApiKey(parameters, 'openai')) {
    return 'openai';
  }

  if (getProviderApiKey(parameters, 'google')) {
    return 'google';
  }

  return defaultProvider;
}

function getOpenAiDefaultModel(
  raw: ConfigParameters,
  legacyModel?: OpenAiGenerateModel,
): OpenAiGenerateModel {
  const configuredModel = raw.providers?.openai?.defaultModel;

  if (isOpenAiGenerateModel(configuredModel)) {
    return configuredModel;
  }

  if (isOpenAiGenerateModel(raw.providers?.openai?.defaultGenerateModel)) {
    return raw.providers.openai.defaultGenerateModel;
  }

  return legacyModel || defaultConfigParameters.providers.openai.defaultModel;
}

function getGoogleDefaultModel(raw: ConfigParameters): GoogleGenerateModel {
  const configuredModel = raw.providers?.google?.defaultModel;

  if (isGoogleGenerateModel(configuredModel)) {
    return configuredModel;
  }

  if (isGoogleGenerateModel(raw.providers?.google?.defaultGenerateModel)) {
    return raw.providers.google.defaultGenerateModel;
  }

  return defaultConfigParameters.providers.google.defaultModel;
}

function isOpenAiGenerateModel(value: unknown): value is OpenAiGenerateModel {
  return (
    typeof value === 'string' &&
    openAiGenerateModels.includes(value as OpenAiGenerateModel)
  );
}

function isGoogleGenerateModel(value: unknown): value is GoogleGenerateModel {
  return (
    typeof value === 'string' &&
    googleGenerateModels.includes(value as GoogleGenerateModel)
  );
}
