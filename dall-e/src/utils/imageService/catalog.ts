import type {
  AspectRatioOption,
  BackgroundOption,
  BackgroundMode,
  GoogleEditModel,
  GoogleGenerateModel,
  OpenAiEditModel,
  OpenAiGenerateModel,
  OperationMode,
  ProviderCapabilities,
  ProviderId,
  ProviderModelDefinition,
  SelectOption,
  SupportedImageModel,
  VariationCount,
  VariationOption,
} from './types';

export const openAiGenerateModels: OpenAiGenerateModel[] = [
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
];

export const openAiEditModels: OpenAiEditModel[] = [
  'gpt-image-1.5',
  'gpt-image-1',
];

export const googleGenerateModels: GoogleGenerateModel[] = [
  'gemini-2.5-flash-image',
];

export const googleEditModels: GoogleEditModel[] = [
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
];

export const providerOptions: Array<SelectOption<ProviderId>> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
];

export const modeOptions: Array<SelectOption<OperationMode>> = [
  { value: 'generate', label: 'Generate' },
  { value: 'edit', label: 'Edit' },
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

export const backgroundOptions: BackgroundOption[] = [
  { value: 'auto', label: 'Default' },
  { value: 'transparent', label: 'Transparent' },
];

const labelByModel: Record<SupportedImageModel, string> = {
  'gpt-image-1.5': 'GPT Image 1.5',
  'gpt-image-1': 'GPT Image 1',
  'gpt-image-1-mini': 'GPT Image 1 Mini',
  'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image',
  'gemini-3-pro-image-preview': 'Gemini 3 Pro Image Preview',
};

const labelByAspectRatio: Record<AspectRatioOption['value'], string> = {
  '1:1': 'Square',
  '2:3': 'Portrait',
  '3:2': 'Landscape',
};

const labelByBackground: Record<BackgroundMode, string> = {
  auto: 'Default background',
  transparent: 'Transparent background',
};

export const allModelDefinitions: ProviderModelDefinition[] = [
  ...openAiGenerateModels.map((value) => ({
    value,
    label: getModelLabel(value),
    provider: 'openai' as const,
    modes: ['generate'] as OperationMode[],
  })),
  ...openAiEditModels.map((value) => ({
    value,
    label: getModelLabel(value),
    provider: 'openai' as const,
    modes: ['edit'] as OperationMode[],
  })),
  ...googleGenerateModels.map((value) => ({
    value,
    label: getModelLabel(value),
    provider: 'google' as const,
    modes: ['generate'] as OperationMode[],
  })),
  ...googleEditModels.map((value) => ({
    value,
    label: getModelLabel(value),
    provider: 'google' as const,
    modes: ['edit'] as OperationMode[],
  })),
];

export function getModelLabel(model: SupportedImageModel): string {
  return labelByModel[model];
}

export function getAspectRatioLabel(value: AspectRatioOption['value']): string {
  return labelByAspectRatio[value];
}

export function getBackgroundLabel(value: BackgroundMode): string {
  return labelByBackground[value];
}

export function getProviderModelOptions(
  provider: ProviderId,
): Array<SelectOption<SupportedImageModel>> {
  const seen = new Set<SupportedImageModel>();

  return allModelDefinitions
    .filter((definition) => definition.provider === provider)
    .filter((definition) => {
      if (seen.has(definition.value)) {
        return false;
      }

      seen.add(definition.value);
      return true;
    })
    .map((definition) => ({
      value: definition.value,
      label: definition.label,
    }));
}

export function getModelOptions(
  provider: ProviderId,
  mode: OperationMode,
): Array<SelectOption<SupportedImageModel>> {
  return allModelDefinitions
    .filter((definition) => definition.provider === provider)
    .filter((definition) => definition.modes.includes(mode))
    .map((definition) => ({
      value: definition.value,
      label: definition.label,
    }));
}

export function modelSupportsMode(
  provider: ProviderId,
  model: SupportedImageModel,
  mode: OperationMode,
): boolean {
  return allModelDefinitions.some(
    (definition) =>
      definition.provider === provider &&
      definition.value === model &&
      definition.modes.includes(mode),
  );
}

export function getPreferredMode(
  provider: ProviderId,
  model: SupportedImageModel,
): OperationMode {
  return modelSupportsMode(provider, model, 'generate') ? 'generate' : 'edit';
}

export function getCapabilities(
  provider: ProviderId,
  mode: OperationMode,
  model: SupportedImageModel,
): ProviderCapabilities {
  const modeSupported = modelSupportsMode(provider, model, mode);

  if (provider === 'openai') {
    return {
      provider,
      mode,
      model,
      supportsMask: mode === 'edit' && modeSupported,
      supportsVariationCount: modeSupported,
      supportsTransparentBackground: modeSupported,
      supportsAspectRatio: modeSupported,
      maxInputImages: 16,
      maxReferenceImages: 16,
      supportedModelsByMode: {
        generate: openAiGenerateModels,
        edit: openAiEditModels,
      },
    };
  }

  const isPreviewModel = model === 'gemini-3-pro-image-preview';

  return {
    provider,
    mode,
    model,
    supportsMask: false,
    supportsVariationCount: false,
    supportsTransparentBackground: false,
    supportsAspectRatio: modeSupported,
    maxInputImages: isPreviewModel ? 14 : 4,
    maxReferenceImages: isPreviewModel ? 14 : 4,
    supportedModelsByMode: {
      generate: googleGenerateModels,
      edit: googleEditModels,
    },
  };
}

export function getDefaultVariationCount(
  provider: ProviderId,
): VariationCount {
  return provider === 'openai' ? 1 : 1;
}
