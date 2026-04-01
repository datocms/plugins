import type {
  AspectRatio,
  AspectRatioOption,
  GoogleGenerateModel,
  ImageSize,
  ImageSizeOption,
  OpenAiGenerateModel,
  ProviderCapabilities,
  ProviderId,
  SelectOption,
  SupportedImageModel,
  VariationOption,
} from './types';

export const openAiGenerateModels: OpenAiGenerateModel[] = [
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
];

export const googleGenerateModels: GoogleGenerateModel[] = [
  'gemini-2.5-flash-image',
];

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

const labelByModel: Record<SupportedImageModel, string> = {
  'gpt-image-1.5': 'GPT Image 1.5',
  'gpt-image-1': 'GPT Image 1',
  'gpt-image-1-mini': 'GPT Image 1 Mini',
  'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image',
};

const labelByAspectRatio: Record<AspectRatioOption['value'], string> = {
  '1:1': 'Square',
  '2:3': 'Portrait',
  '3:2': 'Landscape',
};

const providerModels = {
  openai: openAiGenerateModels,
  google: googleGenerateModels,
} satisfies {
  openai: OpenAiGenerateModel[];
  google: GoogleGenerateModel[];
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

export function getModelLabel(model: SupportedImageModel): string {
  return labelByModel[model];
}

export function getAspectRatioLabel(value: AspectRatioOption['value']): string {
  return labelByAspectRatio[value];
}

export function getSupportedModels(
  provider: ProviderId,
): SupportedImageModel[] {
  return providerModels[provider];
}

export function getModelOptions(
  provider: ProviderId,
): Array<SelectOption<SupportedImageModel>> {
  return getSupportedModels(provider).map((value) => ({
    value,
    label: getModelLabel(value),
  }));
}

export function getCapabilities(
  provider: ProviderId,
  model: SupportedImageModel,
): ProviderCapabilities {
  const modelSupported = getSupportedModels(provider).includes(model);

  if (provider === 'openai') {
    return {
      supportsVariationCount: modelSupported,
      imageSizeOptionsByAspectRatio: openAiImageSizeOptionsByAspectRatio,
    };
  }

  return {
    supportsVariationCount: false,
    imageSizeOptionsByAspectRatio: googleImageSizeOptionsByAspectRatio,
  };
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
