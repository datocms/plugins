import type {
  GoogleGenerateModel,
  OpenAiGenerateModel,
  ProviderId,
  SupportedImageModel,
} from './utils/imageService';

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
