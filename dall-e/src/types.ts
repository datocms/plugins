import type {
  GoogleGenerateModel,
  OpenAiGenerateModel,
  ProviderId,
  SupportedImageModel,
} from './utils/imageService';

/**
 * Raw plugin settings, including legacy single-provider fields kept for backward compatibility.
 */
export type ConfigParameters = {
  apiKey?: string;
  model?: OpenAiGenerateModel;
  defaultProvider?: ProviderId;
  providers?: {
    openai?: {
      apiKey?: string;
      defaultModel?: SupportedImageModel;
      defaultGenerateModel?: OpenAiGenerateModel;
    };
    google?: {
      apiKey?: string;
      defaultModel?: SupportedImageModel;
      defaultGenerateModel?: GoogleGenerateModel;
    };
  };
};

/**
 * Settings shape consumed by the config screen and asset source.
 */
export type NormalizedConfigParameters = {
  defaultProvider: ProviderId;
  providers: {
    openai: {
      apiKey: string;
      defaultModel: OpenAiGenerateModel;
    };
    google: {
      apiKey: string;
      defaultModel: GoogleGenerateModel;
    };
  };
};
