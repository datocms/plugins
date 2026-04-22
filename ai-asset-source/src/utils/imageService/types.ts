export type ProviderId = 'openai' | 'google';

export type OpenAiGenerateModel = string;
export type GoogleGenerateModel = string;
export type SupportedImageModel = string;

export type AspectRatio = '1:1' | '2:3' | '3:2';
export type ImageSize = 'native' | '512' | '1k' | '2k' | '4k';
export type VariationCount = 1 | 2 | 3 | 4;
export type GenerationStatus = 'idle' | 'submitted' | 'completed' | 'error';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type GoogleGenerationMethod = 'predict' | 'generateContent';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  unavailable?: boolean;
  generationMethod?: GoogleGenerationMethod;
};

export type AspectRatioOption = {
  value: AspectRatio;
  label: string;
  description: string;
};

export type ImageSizeOption = {
  value: ImageSize;
  label: string;
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
  imageSize: ImageSize;
  variationCount: VariationCount;
  outputQuality?: ImageQuality;
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
};

export type ProviderCapabilities = {
  supportsVariationCount: boolean;
  supportsOutputControls: boolean;
  imageSizeOptionsByAspectRatio: Record<AspectRatio, ImageSizeOption[]>;
};

export type NormalizedGeneratedImage = {
  kind: 'success';
  id: string;
  base64: string;
  mediaType: string;
  previewSrc: string;
  position: number;
  revisedPrompt?: string;
  returnedFormat?: ImageOutputFormat | string;
  returnedQuality?: ImageQuality | string;
  returnedSize?: string;
  returnedCompression?: number;
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
