import {
  getAspectRatioLabel,
  getImageSizeLabel,
  getModelLabel,
} from './catalog';
import { googleAdapter } from './adapters/google';
import { openAiAdapter } from './adapters/openai';
import type {
  ImageOperationRequest,
  ImageProviderAdapter,
  NormalizedGeneratedImage,
  NormalizedGenerationBatch,
  ProviderId,
  SupportedImageModel,
} from './types';

export * from './catalog';
export * from './types';
export * from './shared';

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
): string {
  const baseName = slugifyPrompt(prompt);
  const timestamp = createdAt
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\..+$/, '');
  const suffix = position ? `-${position}` : '';

  return `image-${baseName}-${timestamp}${suffix}.png`;
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

  if (image?.revisedPrompt) {
    notes.push(`Revised prompt: ${image.revisedPrompt}`);
  }

  if (image?.returnedSize) {
    notes.push(`Returned size: ${image.returnedSize}`);
  }

  if (image?.returnedQuality) {
    notes.push(`Quality: ${image.returnedQuality}`);
  }

  if (image?.returnedFormat) {
    notes.push(`Returned format: ${image.returnedFormat}`);
  }

  return notes.join('\n');
}

function slugifyPrompt(prompt: string): string {
  const normalized = prompt
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.slice(0, 48) || 'generated-image';
}
