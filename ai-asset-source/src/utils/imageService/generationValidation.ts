import {
  getImageSizeOptions,
  isGoogleImageGenerationModel,
  isGooglePredictImageModel,
  isOpenAiImageGenerationModel,
} from './catalog';
import type { ImageOperationRequest, ProviderId } from './types';

export const MAX_GENERATED_IMAGES = 4;
// Browser memory safeguards, independent of a provider's billing or token limit.
export const MAX_GENERATED_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_GENERATED_IMAGE_BASE64_LENGTH =
  Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4;

export function getGenerationPromptLimit(
  _provider: ProviderId,
  _model: string,
): number {
  // OpenAI documents 32,000 characters. Google enforces model token limits;
  // this plugin also caps prompt memory rather than estimating those tokens.
  return 32_000;
}

export function validateGenerationRequest(
  request: ImageOperationRequest,
): void {
  validateProviderModel(request);
  validatePrompt(request);
  validateImageParameters(request);

  if (request.provider === 'openai') {
    validateOpenAiOutput(request);
  }
}

function validateProviderModel(request: ImageOperationRequest): void {
  if (request.provider !== 'openai' && request.provider !== 'google') {
    throw new Error('Select a supported image provider.');
  }

  if (!request.model?.trim()) {
    throw new Error('Select an image generation model.');
  }

  if (
    request.provider === 'google' &&
    isGooglePredictImageModel(request.model)
  ) {
    throw new Error(
      'Imagen models have been retired from the Gemini API. Select a Gemini image model in the plugin settings.',
    );
  }

  const supportedModel =
    request.provider === 'openai'
      ? isOpenAiImageGenerationModel(request.model)
      : isGoogleImageGenerationModel(request.model);

  if (!supportedModel) {
    throw new Error(
      'Select a supported image generation model in the plugin settings.',
    );
  }
}

function validatePrompt(request: ImageOperationRequest): void {
  if (!request.prompt?.trim()) {
    throw new Error('Enter a prompt before generating an image.');
  }

  const promptLimit = getGenerationPromptLimit(request.provider, request.model);

  if (request.prompt.length > promptLimit) {
    throw new Error(
      `The prompt exceeds this plugin's ${promptLimit.toLocaleString('en-US')} character limit.`,
    );
  }
}

function validateImageParameters(request: ImageOperationRequest): void {
  const maximumCount = request.provider === 'openai' ? MAX_GENERATED_IMAGES : 1;

  if (
    !Number.isInteger(request.variationCount) ||
    request.variationCount < 1 ||
    request.variationCount > maximumCount
  ) {
    throw new Error(
      `This provider supports between 1 and ${maximumCount} images per request in this plugin.`,
    );
  }

  if (!['1:1', '2:3', '3:2'].includes(request.aspectRatio)) {
    throw new Error('Select a supported image aspect ratio.');
  }

  const imageSizes = getImageSizeOptions(
    request.provider,
    request.model,
    request.aspectRatio,
  );

  if (!imageSizes.some((size) => size.value === request.imageSize)) {
    throw new Error('Select a supported image size.');
  }
}

function validateOpenAiOutput(request: ImageOperationRequest): void {
  if (
    request.outputQuality &&
    !['auto', 'low', 'medium', 'high'].includes(request.outputQuality)
  ) {
    throw new Error('Select a supported output quality.');
  }

  if (
    request.outputFormat &&
    !['png', 'jpeg', 'webp'].includes(request.outputFormat)
  ) {
    throw new Error('Select a supported output format.');
  }

  if (
    request.outputCompression !== undefined &&
    (!Number.isInteger(request.outputCompression) ||
      request.outputCompression < 0 ||
      request.outputCompression > 100)
  ) {
    throw new Error('Output compression must be an integer between 0 and 100.');
  }
}
