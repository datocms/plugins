import { createOpenAI } from '@ai-sdk/openai';
import { generateImage } from 'ai';
import { getCapabilities, getOpenAiRequestSize } from '../catalog';
import {
  createGenerationBatch,
  normalizeGeneratedImages,
  readProviderErrorDetails,
} from '../shared';
import type {
  ImageOperationRequest,
  ImageProviderAdapter,
  NormalizedProviderError,
  SupportedImageModel,
} from '../types';

export const openAiAdapter: ImageProviderAdapter = {
  provider: 'openai',
  getCapabilities(model: SupportedImageModel) {
    return getCapabilities('openai', model);
  },
  async run(apiKey: string, request: ImageOperationRequest) {
    const client = createOpenAI({ apiKey: apiKey.trim() });
    const result = await generateImage({
      model: client.image(request.model),
      prompt: request.prompt,
      n: request.variationCount,
      size: getOpenAiRequestSize(request.aspectRatio),
      providerOptions: {
        openai: {
          moderation: 'auto',
          output_format: 'png',
          quality: 'auto',
        },
      },
    });

    const createdAt = new Date().toISOString();
    const providerImages = readProviderImages(result.providerMetadata);
    const images = normalizeGeneratedImages(result.images, createdAt, (index) => {
      const metadata = providerImages[index];

      if (!metadata) {
        return undefined;
      }

      return {
        revisedPrompt: metadata.revisedPrompt,
        returnedFormat: metadata.outputFormat,
        returnedQuality: metadata.quality,
        returnedSize: metadata.size,
      };
    });

    if (!images.length) {
      throw new Error('OpenAI did not return image data for this request.');
    }

    return createGenerationBatch(request, createdAt, images);
  },
  normalizeError(error: unknown): NormalizedProviderError {
    return readProviderError(error, 'OpenAI');
  },
};

type ProviderImageMetadata = {
  revisedPrompt?: string;
  outputFormat?: string;
  quality?: string;
  size?: string;
};

function readProviderImages(providerMetadata: unknown): ProviderImageMetadata[] {
  if (!providerMetadata || typeof providerMetadata !== 'object') {
    return [];
  }

  const openAiMetadata = (providerMetadata as Record<string, unknown>).openai;

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
      outputFormat:
        typeof metadata.outputFormat === 'string'
          ? metadata.outputFormat
          : undefined,
      quality:
        typeof metadata.quality === 'string' ? metadata.quality : undefined,
      size: typeof metadata.size === 'string' ? metadata.size : undefined,
    };
  });
}

function readProviderError(
  error: unknown,
  providerLabel: string,
): NormalizedProviderError {
  const details = readProviderErrorDetails(error);

  if (!details.message && !details.status) {
    return {
      message: `Something went wrong while talking to ${providerLabel}.`,
    };
  }

  if (details.status === 401) {
    return {
      message: `${providerLabel} rejected the API key. Check the plugin settings and try again.`,
    };
  }

  if (details.status === 429) {
    return {
      message: `${providerLabel} rate limited this request. Wait a moment and try again.`,
    };
  }

  if (details.status === 400) {
    return {
      message:
        details.message ||
        `${providerLabel} rejected this request. Adjust it and try again.`,
    };
  }

  if (details.status && details.status >= 500) {
    return {
      message: `${providerLabel} returned a server error. Try again in a moment.`,
    };
  }

  return {
    message:
      details.message || `Something went wrong while talking to ${providerLabel}.`,
  };
}
