export type ProviderId = 'openai' | 'google';
export type OperationMode = 'generate' | 'edit';

export type OpenAiGenerateModel =
  | 'gpt-image-1.5'
  | 'gpt-image-1'
  | 'gpt-image-1-mini';
export type OpenAiEditModel = 'gpt-image-1.5' | 'gpt-image-1';
export type GoogleGenerateModel = 'gemini-2.5-flash-image';
export type GoogleEditModel =
  | 'gemini-2.5-flash-image'
  | 'gemini-3-pro-image-preview';

export type SupportedImageModel =
  | OpenAiGenerateModel
  | OpenAiEditModel
  | GoogleGenerateModel
  | GoogleEditModel;

export type AspectRatio = '1:1' | '2:3' | '3:2';
export type BackgroundMode = 'auto' | 'transparent';
export type EditScope = 'full' | 'mask';
export type VariationCount = 1 | 2 | 3 | 4;
export type GenerationStatus = 'idle' | 'submitted' | 'completed' | 'error';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export type ProviderModelDefinition = {
  value: SupportedImageModel;
  label: string;
  provider: ProviderId;
  modes: OperationMode[];
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

export type BackgroundOption = {
  value: BackgroundMode;
  label: string;
};

export type InputImage = {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  width?: number;
  height?: number;
};

export type ImageOperationRequest = {
  provider: ProviderId;
  mode: OperationMode;
  model: SupportedImageModel;
  prompt: string;
  aspectRatio: AspectRatio;
  variationCount: VariationCount;
  background: BackgroundMode;
  editScope?: EditScope;
  sourceImages: InputImage[];
  maskImage?: InputImage;
};

export type ProviderCapabilities = {
  provider: ProviderId;
  mode: OperationMode;
  model: SupportedImageModel;
  supportsMask: boolean;
  supportsVariationCount: boolean;
  supportsTransparentBackground: boolean;
  supportsAspectRatio: boolean;
  maxInputImages: number;
  maxReferenceImages: number;
  supportedModelsByMode: Record<OperationMode, SupportedImageModel[]>;
};

export type NormalizedGeneratedImage = {
  id: string;
  base64: string;
  mediaType: string;
  previewSrc: string;
  position: number;
  revisedPrompt?: string;
  returnedBackground?: string;
  returnedFormat?: string;
  returnedQuality?: string;
  returnedSize?: string;
};

export type NormalizedGenerationBatch = {
  id: string;
  createdAt: string;
  createdAtLabel: string;
  request: ImageOperationRequest;
  images: NormalizedGeneratedImage[];
  status: Extract<GenerationStatus, 'completed'>;
};

export type NormalizedProviderError = {
  message: string;
  status?: number;
};

export type ImageProviderAdapter = {
  provider: ProviderId;
  getCapabilities: (
    mode: OperationMode,
    model: SupportedImageModel,
  ) => ProviderCapabilities;
  run: (
    apiKey: string,
    request: ImageOperationRequest,
  ) => Promise<NormalizedGenerationBatch>;
  normalizeError: (error: unknown) => NormalizedProviderError;
};
