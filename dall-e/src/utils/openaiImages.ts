import OpenAI from 'openai';
import type { ImageModel, ImagesResponse } from 'openai/resources/images';

export type SupportedImageModel = Extract<
  ImageModel,
  'gpt-image-1.5' | 'gpt-image-1' | 'gpt-image-1-mini'
>;

export type ImageShape = 'square' | 'portrait' | 'landscape';
export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';
export type VariationCount = 1 | 2 | 3 | 4;
export type BackgroundMode = 'auto' | 'transparent';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export type ShapeOption = {
  value: ImageShape;
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

export type GenerateFormState = {
  prompt: string;
  shape: ImageShape;
  variations: VariationCount;
  background: BackgroundMode;
};

export type GeneratedImage = {
  id: string;
  b64Json: string;
  previewSrc: string;
  position: number;
};

export type GenerationRequest = {
  prompt: string;
  model: SupportedImageModel;
  shape: ImageShape;
  size: ImageSize;
  variations: VariationCount;
  background: BackgroundMode;
};

export type ImageRequestRecord = {
  id: string;
  createdAt: string;
  createdAtLabel: string;
  request: GenerationRequest;
  images: GeneratedImage[];
};

export const supportedModelIds: SupportedImageModel[] = [
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
];

export const defaultGenerateFormState: GenerateFormState = {
  prompt: '',
  shape: 'square',
  variations: 1,
  background: 'auto',
};

export const modelOptions: Array<SelectOption<SupportedImageModel>> = [
  { value: 'gpt-image-1.5', label: 'GPT Image 1.5' },
  { value: 'gpt-image-1', label: 'GPT Image 1' },
  { value: 'gpt-image-1-mini', label: 'GPT Image 1 Mini' },
];

export const shapeOptions: ShapeOption[] = [
  { value: 'square', label: 'Square', description: '1:1 · 1024 × 1024' },
  { value: 'portrait', label: 'Portrait', description: '2:3 · 1024 × 1536' },
  { value: 'landscape', label: 'Landscape', description: '3:2 · 1536 × 1024' },
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

const sizeByShape: Record<ImageShape, ImageSize> = {
  square: '1024x1024',
  portrait: '1024x1536',
  landscape: '1536x1024',
};

const labelByModel: Record<SupportedImageModel, string> = {
  'gpt-image-1.5': 'GPT Image 1.5',
  'gpt-image-1': 'GPT Image 1',
  'gpt-image-1-mini': 'GPT Image 1 Mini',
};

const labelByShape: Record<ImageShape, string> = {
  square: 'Square',
  portrait: 'Portrait',
  landscape: 'Landscape',
};

const labelByBackground: Record<BackgroundMode, string> = {
  auto: 'Default background',
  transparent: 'Transparent background',
};

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function createOpenAiClient(apiKey: string) {
  return new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}

export function getConfiguredModel(model?: string): SupportedImageModel {
  return supportedModelIds.includes(model as SupportedImageModel)
    ? (model as SupportedImageModel)
    : supportedModelIds[0];
}

export function normalizeFormState(
  formState: GenerateFormState,
): GenerateFormState {
  return {
    prompt: formState.prompt.trim(),
    shape: formState.shape,
    variations: formState.variations,
    background: formState.background,
  };
}

export async function generateImages(
  apiKey: string,
  formState: GenerateFormState,
  model: SupportedImageModel,
): Promise<ImageRequestRecord> {
  const normalized = normalizeFormState(formState);
  const request: GenerationRequest = {
    prompt: normalized.prompt,
    model,
    shape: normalized.shape,
    size: sizeByShape[normalized.shape],
    variations: normalized.variations,
    background: normalized.background,
  };

  const client = createOpenAiClient(apiKey);
  const response = await client.images.generate({
    prompt: request.prompt,
    model: request.model,
    n: request.variations,
    size: request.size,
    quality: 'auto',
    output_format: 'png',
    background: request.background,
    moderation: 'auto',
  });

  return normalizeGenerateResponse(request, response);
}

export function normalizeOpenAiError(error: unknown): string {
  if (error instanceof Error) {
    const apiError = error as Error & {
      status?: number;
      message?: string;
      response?: { status?: number };
    };

    const status = apiError.status ?? apiError.response?.status;

    if (status === 401) {
      return 'OpenAI rejected the API key. Check the plugin settings and try again.';
    }

    if (status === 429) {
      return 'OpenAI rate limited this request. Wait a moment and try again.';
    }

    if (status === 400) {
      return (
        apiError.message ||
        'OpenAI rejected the prompt. Adjust it and try again.'
      );
    }

    if (status && status >= 500) {
      return 'OpenAI returned a server error. Try again in a moment.';
    }

    if (apiError.message) {
      return apiError.message;
    }
  }

  return 'Something went wrong while generating images.';
}

export function buildImportFilename(
  prompt: string,
  createdAt: string,
  position?: number,
) {
  const baseName = slugifyPrompt(prompt);
  const timestamp = createdAt
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\..+$/, '');
  const suffix = position ? `-${position}` : '';

  return `image-${baseName}-${timestamp}${suffix}.png`;
}

export function buildGenerationNotes(request: GenerationRequest) {
  return [
    'Generated with OpenAI image generation',
    `Prompt: ${request.prompt}`,
    `Model: ${getModelLabel(request.model)}`,
    `Aspect ratio: ${getShapeLabel(request.shape)}`,
    `Size: ${request.size}`,
    `Variations: ${request.variations}`,
    `Background: ${getBackgroundLabel(request.background)}`,
    'Format: PNG',
  ].join('\n');
}

export function getModelLabel(model: SupportedImageModel) {
  return labelByModel[model];
}

export function getShapeLabel(shape: ImageShape) {
  return labelByShape[shape];
}

export function getBackgroundLabel(background: BackgroundMode) {
  return labelByBackground[background];
}

function normalizeGenerateResponse(
  request: GenerationRequest,
  response: ImagesResponse,
): ImageRequestRecord {
  const createdAt = new Date().toISOString();
  const images = (response.data || [])
    .filter((image): image is { b64_json: string } => Boolean(image.b64_json))
    .map((image, index) => ({
      id: `${createdAt}-${index}`,
      b64Json: image.b64_json,
      previewSrc: `data:image/png;base64,${image.b64_json}`,
      position: index + 1,
    }));

  if (!images.length) {
    throw new Error('OpenAI did not return image data for this request.');
  }

  return {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    createdAtLabel: timestampFormatter.format(new Date(createdAt)),
    request,
    images,
  };
}

function slugifyPrompt(prompt: string) {
  const normalized = prompt
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.slice(0, 48) || 'generated-image';
}
