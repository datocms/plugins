import { backgroundOptions, getAspectRatioLabel, getBackgroundLabel, getCapabilities, getModelLabel } from './catalog';
import { googleAdapter } from './adapters/google';
import { openAiAdapter } from './adapters/openai';
import type {
  BackgroundMode,
  ImageOperationRequest,
  ImageProviderAdapter,
  NormalizedGeneratedImage,
  NormalizedGenerationBatch,
  ProviderCapabilities,
  ProviderId,
  SupportedImageModel,
} from './types';

export * from './catalog';
export * from './types';

const adapters: Record<ProviderId, ImageProviderAdapter> = {
  openai: openAiAdapter,
  google: googleAdapter,
};

export function getProviderAdapter(provider: ProviderId): ImageProviderAdapter {
  return adapters[provider];
}

export function getProviderCapabilities(
  provider: ProviderId,
  mode: ImageOperationRequest['mode'],
  model: SupportedImageModel,
): ProviderCapabilities {
  return getCapabilities(provider, mode, model);
}

export async function generateOrEditImages(
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
  batch: NormalizedGenerationBatch,
  image?: NormalizedGeneratedImage,
) {
  const notes = [
    `Generated with provider: ${batch.request.provider}`,
    `Mode: ${batch.request.mode}`,
    `Prompt: ${batch.request.prompt}`,
    `Model: ${getModelLabel(batch.request.model)}`,
    `Aspect ratio: ${getAspectRatioLabel(batch.request.aspectRatio)}`,
    `Source images: ${batch.request.sourceImages.length}`,
  ];

  if (batch.request.mode === 'edit') {
    notes.push(`Edit scope: ${batch.request.editScope || 'full'}`);
    notes.push(`Mask used: ${batch.request.maskImage ? 'yes' : 'no'}`);
  }

  if (supportsTransparent(batch.request.background, batch.request.provider)) {
    notes.push(`Background: ${getBackgroundLabel(batch.request.background)}`);
  }

  if (batch.request.provider === 'openai') {
    notes.push(`Variations: ${batch.request.variationCount}`);
  }

  if (image?.revisedPrompt) {
    notes.push(`Revised prompt: ${image.revisedPrompt}`);
  }

  if (image?.returnedSize) {
    notes.push(`Returned size: ${image.returnedSize}`);
  }

  if (image?.returnedBackground) {
    notes.push(`Returned background: ${image.returnedBackground}`);
  }

  if (image?.returnedQuality) {
    notes.push(`Quality: ${image.returnedQuality}`);
  }

  if (image?.returnedFormat) {
    notes.push(`Returned format: ${image.returnedFormat}`);
  }

  return notes.join('\n');
}

function supportsTransparent(background: BackgroundMode, provider: ProviderId) {
  return provider === 'openai' || background !== backgroundOptions[0].value;
}

function slugifyPrompt(prompt: string) {
  const normalized = prompt
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.slice(0, 48) || 'generated-image';
}
