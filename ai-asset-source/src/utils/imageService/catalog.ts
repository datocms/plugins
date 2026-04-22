import type {
  AspectRatio,
  AspectRatioOption,
  ImageOutputFormat,
  ImageQuality,
  ImageSize,
  ImageSizeOption,
  ProviderCapabilities,
  ProviderId,
  SelectOption,
  SupportedImageModel,
  VariationOption,
} from './types';

export const providerOptions: Array<SelectOption<ProviderId>> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
];

export const aspectRatioOptions: AspectRatioOption[] = [
  { value: '1:1', label: 'Square', description: '1:1' },
  { value: '2:3', label: 'Portrait', description: '2:3' },
  { value: '3:2', label: 'Landscape', description: '3:2' },
];

export const variationOptions: VariationOption[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
];

export const imageQualityOptions: Array<SelectOption<ImageQuality>> = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const imageOutputFormatOptions: Array<SelectOption<ImageOutputFormat>> = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
];

const labelByAspectRatio: Record<AspectRatioOption['value'], string> = {
  '1:1': 'Square',
  '2:3': 'Portrait',
  '3:2': 'Landscape',
};

const openAiImageSizeOptionsByAspectRatio = {
  '1:1': [{ value: 'native', label: '1024×1024 px' }],
  '2:3': [{ value: 'native', label: '1024×1536 px' }],
  '3:2': [{ value: 'native', label: '1536×1024 px' }],
} satisfies Record<AspectRatio, ImageSizeOption[]>;

const googleImageSizeOptionsByAspectRatio = {
  '1:1': [{ value: 'native', label: '1024×1024 px' }],
  '2:3': [{ value: 'native', label: '832×1248 px' }],
  '3:2': [{ value: 'native', label: '1248×832 px' }],
} satisfies Record<AspectRatio, ImageSizeOption[]>;

const openAiRequestSizeByAspectRatio: Record<
  AspectRatio,
  `${number}x${number}`
> = {
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
};

const excludedModelSignals = [
  'audio',
  'embedding',
  'moderation',
  'realtime',
  'search',
  'speech',
  'transcribe',
  'tts',
  'video',
  'vision',
];

export function getModelLabel(model: SupportedImageModel): string {
  return stripModelResourcePrefix(model);
}

export function getAspectRatioLabel(value: AspectRatioOption['value']): string {
  return labelByAspectRatio[value];
}

export function getCapabilities(
  provider: ProviderId,
  model: SupportedImageModel,
): ProviderCapabilities {
  if (provider === 'openai') {
    const supportsImageEndpoint = isOpenAiImageGenerationModel(model);

    return {
      supportsVariationCount: supportsImageEndpoint,
      supportsOutputControls: supportsImageEndpoint,
      imageSizeOptionsByAspectRatio: openAiImageSizeOptionsByAspectRatio,
    };
  }

  return {
    supportsVariationCount: false,
    supportsOutputControls: false,
    imageSizeOptionsByAspectRatio: googleImageSizeOptionsByAspectRatio,
  };
}

export function supportsOutputControls(
  provider: ProviderId,
  model: SupportedImageModel,
): boolean {
  return getCapabilities(provider, model).supportsOutputControls;
}

export function getImageSizeOptions(
  provider: ProviderId,
  model: SupportedImageModel,
  aspectRatio: AspectRatio,
): ImageSizeOption[] {
  return getCapabilities(provider, model).imageSizeOptionsByAspectRatio[
    aspectRatio
  ];
}

export function getDefaultImageSize(
  provider: ProviderId,
  model: SupportedImageModel,
  aspectRatio: AspectRatio,
): ImageSize {
  return getImageSizeOptions(provider, model, aspectRatio)[0].value;
}

export function getImageSizeLabel(
  provider: ProviderId,
  model: SupportedImageModel,
  aspectRatio: AspectRatio,
  imageSize: ImageSize,
): string {
  return (
    getImageSizeOptions(provider, model, aspectRatio).find(
      (option) => option.value === imageSize,
    )?.label || getImageSizeOptions(provider, model, aspectRatio)[0].label
  );
}

export function getOpenAiRequestSize(
  aspectRatio: AspectRatio,
): `${number}x${number}` {
  return openAiRequestSizeByAspectRatio[aspectRatio];
}

export function isOpenAiImageGenerationModel(model: string): boolean {
  return hasImageFamilySignal(model) && !hasExcludedModelSignal(model);
}

export function isGoogleImageGenerationModel(model: string): boolean {
  return hasImageFamilySignal(model) && !hasExcludedModelSignal(model);
}

export function isGooglePredictImageModel(model: string): boolean {
  return normalizeModelSignal(model).includes('imagen');
}

export function hasImageFamilySignal(value: string): boolean {
  const normalizedValue = normalizeModelSignal(value);

  return (
    normalizedValue.includes('image') || normalizedValue.includes('imagen')
  );
}

export function normalizeModelSignal(value: string): string {
  return stripModelResourcePrefix(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function hasExcludedModelSignal(model: string): boolean {
  const normalizedModel = normalizeModelSignal(model);

  return excludedModelSignals.some((signal) => normalizedModel.includes(signal));
}

function stripModelResourcePrefix(model: string): string {
  return model.replace(/^models\//, '');
}
