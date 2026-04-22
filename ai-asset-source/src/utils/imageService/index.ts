import { googleAdapter } from './adapters/google';
import { openAiAdapter } from './adapters/openai';
import {
  getAspectRatioLabel,
  getImageSizeLabel,
  getModelLabel,
} from './catalog';
import type {
  ImageOperationRequest,
  ImageOutputFormat,
  ImageProviderAdapter,
  NormalizedGeneratedImage,
  NormalizedGenerationBatch,
  ProviderId,
  SupportedImageModel,
} from './types';

export type * from './types';

const adapters: Record<ProviderId, ImageProviderAdapter> = {
  openai: openAiAdapter,
  google: googleAdapter,
};

function getProviderAdapter(provider: ProviderId): ImageProviderAdapter {
  return adapters[provider];
}

export function getProviderCapabilities(
  provider: ProviderId,
  model: SupportedImageModel,
) {
  return getProviderAdapter(provider).getCapabilities(model);
}

export async function generateImages(
  apiKey: string,
  request: ImageOperationRequest,
): Promise<NormalizedGenerationBatch> {
  return getProviderAdapter(request.provider).run(apiKey, request);
}

export function normalizeProviderError(
  provider: ProviderId,
  error: unknown,
): string {
  return getProviderAdapter(provider).normalizeError(error).message;
}

export function buildImportFilename(
  prompt: string,
  createdAt: string,
  position?: number,
  outputFormat: ImageOutputFormat = 'png',
): string {
  const baseName = slugifyPrompt(prompt);
  const timestamp = createdAt
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\..+$/, '');
  const suffix = position ? `-${position}` : '';
  const extension = getFilenameExtension(outputFormat);

  return `image-${baseName}-${timestamp}${suffix}.${extension}`;
}

export function buildGenerationNotes(
  batch: NormalizedGenerationBatch,
  image?: NormalizedGeneratedImage,
): string {
  const notes = [
    `Generated with provider: ${batch.request.provider}`,
    `Prompt: ${batch.request.prompt}`,
    `Model: ${getModelLabel(batch.request.model)}`,
    `Aspect ratio: ${getAspectRatioLabel(batch.request.aspectRatio)}`,
    `Image size: ${getImageSizeLabel(
      batch.request.provider,
      batch.request.model,
      batch.request.aspectRatio,
      batch.request.imageSize,
    )}`,
  ];

  if (batch.request.provider === 'openai') {
    notes.push(`Variations: ${batch.request.variationCount}`);
  }

  const quality = image?.returnedQuality || batch.request.outputQuality;
  const outputFormat =
    readImageOutputFormat(image?.returnedFormat) || batch.request.outputFormat;
  const compression =
    image?.returnedCompression ??
    (outputFormat && outputFormat !== 'png'
      ? batch.request.outputCompression
      : undefined);

  if (quality) {
    notes.push(`Quality: ${quality}`);
  }

  if (outputFormat) {
    notes.push(`Output format: ${outputFormat}`);
  }

  if (typeof compression === 'number') {
    notes.push(`Compression: ${compression}`);
  }

  if (image?.revisedPrompt) {
    notes.push(`Revised prompt: ${image.revisedPrompt}`);
  }

  if (image?.returnedSize) {
    notes.push(`Returned size: ${image.returnedSize}`);
  }

  return notes.join('\n');
}

export function getImageOutputFormat(
  image: NormalizedGeneratedImage,
  configuredFormat?: ImageOutputFormat,
): ImageOutputFormat {
  return (
    readImageOutputFormat(image.returnedFormat) ||
    configuredFormat ||
    readImageOutputFormatFromMediaType(image.mediaType) ||
    'png'
  );
}

function slugifyPrompt(prompt: string): string {
  const normalized = prompt
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.slice(0, 48) || 'generated-image';
}

function getFilenameExtension(format: ImageOutputFormat): string {
  return format;
}

function readImageOutputFormat(
  value: unknown,
): ImageOutputFormat | undefined {
  if (value === 'png' || value === 'jpeg' || value === 'webp') {
    return value;
  }

  return undefined;
}

function readImageOutputFormatFromMediaType(
  mediaType: string,
): ImageOutputFormat | undefined {
  if (mediaType === 'image/png') {
    return 'png';
  }

  if (mediaType === 'image/jpeg' || mediaType === 'image/jpg') {
    return 'jpeg';
  }

  if (mediaType === 'image/webp') {
    return 'webp';
  }

  return undefined;
}
