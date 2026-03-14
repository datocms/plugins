import type {
  AspectRatioOption,
  GoogleGenerateModel,
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

export function getModelLabel(model: SupportedImageModel): string {
  return labelByModel[model];
}

export function getAspectRatioLabel(value: AspectRatioOption['value']): string {
  return labelByAspectRatio[value];
}

export function getSupportedModels(provider: ProviderId): SupportedImageModel[] {
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
    };
  }

  return {
    supportsVariationCount: false,
  };
}
