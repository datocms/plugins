import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateImage, generateText } from 'ai';
import { getCapabilities, isGooglePredictImageModel } from '../catalog';
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

export const googleAdapter: ImageProviderAdapter = {
  provider: 'google',
  getCapabilities(model: SupportedImageModel) {
    return getCapabilities('google', model);
  },
  async run(apiKey: string, request: ImageOperationRequest) {
    const client = createGoogleGenerativeAI({ apiKey: apiKey.trim() });
    const createdAt = new Date().toISOString();
    const images = isGooglePredictImageModel(request.model)
      ? await generatePredictImages(client, request, createdAt)
      : await generateContentImages(client, request, createdAt);

    if (!images.length) {
      throw new Error('Google did not return image data for this request.');
    }

    return createGenerationBatch(request, createdAt, images);
  },
  normalizeError(error: unknown): NormalizedProviderError {
    const details = readProviderErrorDetails(error);

    if (!details.message && !details.status) {
      return { message: 'Something went wrong while talking to Google.' };
    }

    if (details.status === 401 || details.status === 403) {
      return {
        message:
          'Google rejected the API key. Check the plugin settings and try again.',
      };
    }

    if (details.status === 429) {
      return {
        message:
          'Google rate limited this request. Wait a moment and try again.',
      };
    }

    if (details.status === 400) {
      return {
        message:
          details.message ||
          'Google rejected this request. Adjust it and try again.',
      };
    }

    if (details.status && details.status >= 500) {
      return {
        message: 'Google returned a server error. Try again in a moment.',
      };
    }

    return {
      message:
        details.message || 'Something went wrong while talking to Google.',
    };
  },
};

type GoogleClient = ReturnType<typeof createGoogleGenerativeAI>;

type GeneratedImage = ReturnType<typeof normalizeGeneratedImages>[number];

async function generatePredictImages(
  client: GoogleClient,
  request: ImageOperationRequest,
  createdAt: string,
): Promise<GeneratedImage[]> {
  const result = await generateImage({
    model: client.image(request.model),
    prompt: request.prompt,
    aspectRatio: request.aspectRatio,
  });

  return normalizeGeneratedImages(result.images, createdAt);
}

async function generateContentImages(
  client: GoogleClient,
  request: ImageOperationRequest,
  createdAt: string,
): Promise<GeneratedImage[]> {
  const responseModalities: Array<'IMAGE'> = ['IMAGE'];

  const result = await generateText({
    model: client(request.model),
    prompt: request.prompt,
    providerOptions: {
      google: {
        responseModalities,
        imageConfig: {
          aspectRatio: request.aspectRatio,
        },
      },
    },
  });

  return normalizeGeneratedImages(
    result.files.filter((file) => file.mediaType.startsWith('image/')),
    createdAt,
  );
}
