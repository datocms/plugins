export type ProviderId = 'openai' | 'google';

export type OpenAiGenerateModel =
  | 'gpt-image-1.5'
  | 'gpt-image-1'
  | 'gpt-image-1-mini';
export type GoogleGenerateModel = 'gemini-2.5-flash-image';

export type SupportedImageModel = OpenAiGenerateModel | GoogleGenerateModel;

export type AspectRatio = '1:1' | '2:3' | '3:2';
export type VariationCount = 1 | 2 | 3 | 4;
export type GenerationStatus = 'idle' | 'submitted' | 'completed' | 'error';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export type AspectRatioOption = {
  value: AspectRatio;
  label: string;
  description: string;
};

export type VariationOption = {
  value: VariationCount;
  label: string;
};

export type ImageOperationRequest = {
  provider: ProviderId;
  model: SupportedImageModel;
  prompt: string;
  aspectRatio: AspectRatio;
  variationCount: VariationCount;
};

export type ProviderCapabilities = {
  supportsVariationCount: boolean;
};

export type NormalizedGeneratedImage = {
  kind: 'success';
  id: string;
  base64: string;
  mediaType: string;
  previewSrc: string;
  position: number;
  revisedPrompt?: string;
  returnedFormat?: string;
  returnedQuality?: string;
  returnedSize?: string;
};

export type NormalizedFailedImage = {
  kind: 'error';
  id: string;
  position: number;
  errorMessage: string;
};

export type NormalizedGenerationImage =
  | NormalizedGeneratedImage
  | NormalizedFailedImage;

export type NormalizedGenerationBatch = {
  id: string;
  createdAt: string;
  request: ImageOperationRequest;
  images: NormalizedGenerationImage[];
};

export type NormalizedProviderError = {
  message: string;
};

export type ImageProviderAdapter = {
  provider: ProviderId;
  getCapabilities: (model: SupportedImageModel) => ProviderCapabilities;
  run: (
    apiKey: string,
    request: ImageOperationRequest,
  ) => Promise<NormalizedGenerationBatch>;
  normalizeError: (error: unknown) => NormalizedProviderError;
};
