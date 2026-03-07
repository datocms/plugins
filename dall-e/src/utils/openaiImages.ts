import { generateImage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export type SupportedImageModel =
  | 'gpt-image-1.5'
  | 'gpt-image-1'
  | 'gpt-image-1-mini';

export type ImageShape = 'square' | 'portrait' | 'landscape';
export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';
export type VariationCount = 1 | 2 | 3 | 4;
export type BackgroundMode = 'auto' | 'transparent';
export type GenerationStatus = 'idle' | 'submitted' | 'completed' | 'error';

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

export type GeneratedAssetImage = {
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

export type GenerationRequest = {
  prompt: string;
  model: SupportedImageModel;
  shape: ImageShape;
  size: ImageSize;
  variations: VariationCount;
  background: BackgroundMode;
};

export type GenerationBatch = {
  id: string;
  createdAt: string;
  createdAtLabel: string;
  request: GenerationRequest;
  images: GeneratedAssetImage[];
  status: Extract<GenerationStatus, 'completed'>;
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
): Promise<GenerationBatch> {
  const trimmedApiKey = apiKey.trim();

  if (!trimmedApiKey) {
    throw new Error('Add an OpenAI API key in plugin settings before generating images.');
  }

  const normalized = normalizeFormState(formState);
  const request: GenerationRequest = {
    prompt: normalized.prompt,
    model,
    shape: normalized.shape,
    size: sizeByShape[normalized.shape],
    variations: normalized.variations,
    background: normalized.background,
  };

  const openai = createOpenAI({ apiKey: trimmedApiKey });
  const result = await generateImage({
    model: openai.image(request.model),
    prompt: request.prompt,
    n: request.variations,
    size: request.size,
    providerOptions: {
      openai: {
        background: request.background,
        moderation: 'auto',
        output_format: 'png',
        quality: 'auto',
      },
    },
  });

  return normalizeGenerateResponse(request, result);
}

export function normalizeOpenAiError(error: unknown): string {
  const { message, status } = readErrorDetails(error);

  if (status === 401) {
    return 'OpenAI rejected the API key. Check the plugin settings and try again.';
  }

  if (status === 429) {
    return 'OpenAI rate limited this request. Wait a moment and try again.';
  }

  if (status === 400) {
    return message || 'OpenAI rejected the prompt. Adjust it and try again.';
  }

  if (status && status >= 500) {
    return 'OpenAI returned a server error. Try again in a moment.';
  }

  if (message) {
    if (/api key/i.test(message)) {
      return 'OpenAI rejected the API key. Check the plugin settings and try again.';
    }

    return message;
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

export function buildGenerationNotes(
  batch: GenerationBatch,
  image?: GeneratedAssetImage,
) {
  const notes = [
    'Generated with OpenAI image generation',
    `Prompt: ${batch.request.prompt}`,
    `Model: ${getModelLabel(batch.request.model)}`,
    `Aspect ratio: ${getShapeLabel(batch.request.shape)}`,
    `Size: ${batch.request.size}`,
    `Variations: ${batch.request.variations}`,
    `Background: ${getBackgroundLabel(batch.request.background)}`,
    'Format: PNG',
  ];

  if (image?.revisedPrompt) {
    notes.push(`Revised prompt: ${image.revisedPrompt}`);
  }

  if (image?.returnedSize && image.returnedSize !== batch.request.size) {
    notes.push(`Returned size: ${image.returnedSize}`);
  }

  if (image?.returnedBackground && image.returnedBackground !== batch.request.background) {
    notes.push(`Returned background: ${image.returnedBackground}`);
  }

  if (image?.returnedQuality) {
    notes.push(`Quality: ${image.returnedQuality}`);
  }

  if (image?.returnedFormat && image.returnedFormat !== 'png') {
    notes.push(`Returned format: ${image.returnedFormat}`);
  }

  return notes.join('\n');
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

async function normalizeGenerateResponse(
  request: GenerationRequest,
  result: Awaited<ReturnType<typeof generateImage>>,
): Promise<GenerationBatch> {
  const createdAt = new Date().toISOString();
  const providerImages = readProviderImages(result.providerMetadata);
  const images = result.images.map((image, index) => {
    const providerImage = providerImages[index];

    return {
      id: `${createdAt}-${index}`,
      base64: image.base64,
      mediaType: image.mediaType,
      previewSrc: `data:${image.mediaType};base64,${image.base64}`,
      position: index + 1,
      revisedPrompt: providerImage?.revisedPrompt,
      returnedBackground: providerImage?.background,
      returnedFormat: providerImage?.outputFormat,
      returnedQuality: providerImage?.quality,
      returnedSize: providerImage?.size,
    } satisfies GeneratedAssetImage;
  });

  if (!images.length) {
    throw new Error('OpenAI did not return image data for this request.');
  }

  return {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    createdAtLabel: timestampFormatter.format(new Date(createdAt)),
    request,
    images,
    status: 'completed',
  };
}

type ProviderImageMetadata = {
  revisedPrompt?: string;
  background?: string;
  outputFormat?: string;
  quality?: string;
  size?: string;
};

function readProviderImages(
  providerMetadata: Awaited<ReturnType<typeof generateImage>>['providerMetadata'],
): ProviderImageMetadata[] {
  const openAiMetadata = providerMetadata?.openai;

  if (!openAiMetadata || typeof openAiMetadata !== 'object') {
    return [];
  }

  const images = (openAiMetadata as { images?: unknown }).images;

  if (!Array.isArray(images)) {
    return [];
  }

  return images.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return {};
    }

    const metadata = entry as Record<string, unknown>;

    return {
      revisedPrompt:
        typeof metadata.revisedPrompt === 'string'
          ? metadata.revisedPrompt
          : undefined,
      background:
        typeof metadata.background === 'string' ? metadata.background : undefined,
      outputFormat:
        typeof metadata.outputFormat === 'string'
          ? metadata.outputFormat
          : undefined,
      quality:
        typeof metadata.quality === 'string' ? metadata.quality : undefined,
      size: typeof metadata.size === 'string' ? metadata.size : undefined,
    } satisfies ProviderImageMetadata;
  });
}

function readErrorDetails(error: unknown): {
  message?: string;
  status?: number;
} {
  if (!(error instanceof Error)) {
    return {};
  }

  const details = error as Error & {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    cause?: unknown;
  };

  const cause =
    details.cause && typeof details.cause === 'object'
      ? (details.cause as {
          status?: number;
          statusCode?: number;
          response?: { status?: number };
          message?: string;
        })
      : undefined;

  return {
    message: details.message || cause?.message,
    status:
      details.status ??
      details.statusCode ??
      details.response?.status ??
      cause?.status ??
      cause?.statusCode ??
      cause?.response?.status,
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
