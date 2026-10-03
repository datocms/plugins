import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { getCapabilities } from '../catalog';
import { validateGenerationRequest } from '../generationValidation';
import { createProviderFetch } from '../providerTransport';
import {
  createGenerationBatch,
  normalizeGeneratedImages,
  readProviderErrorDetails,
} from '../shared';
import type {
  ImageOperationRequest,
  ImageProviderAdapter,
  ImageServiceOptions,
  NormalizedProviderError,
  SupportedImageModel,
} from '../types';

export const googleAdapter: ImageProviderAdapter = {
  provider: 'google',
  getCapabilities(model: SupportedImageModel) {
    return getCapabilities('google', model);
  },
  async run(apiKey: string, request: ImageOperationRequest, options = {}) {
    validateGenerationRequest(request);
    options.signal?.throwIfAborted();

    if (!apiKey.trim()) {
      throw new Error('Configure a Google API key before generating images.');
    }

    const client = createGoogleGenerativeAI({
      apiKey: apiKey.trim(),
      fetch: createProviderFetch(options),
    });
    const createdAt = new Date().toISOString();
    const result = await generateContentImages(
      client,
      request,
      createdAt,
      options,
    );

    if (!result.images.length) {
      throw new Error('Google did not return image data for this request.');
    }

    return createGenerationBatch(
      request,
      createdAt,
      result.images,
      'Google did not return this image. The request was not repeated automatically.',
      result.returnedImageCount,
    );
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
          details.message ||
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
        message:
          'Google returned a server error. The request may have been charged; it was not repeated automatically.',
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
type GeneratedImagesResult = {
  images: GeneratedImage[];
  returnedImageCount: number;
};

async function generateContentImages(
  client: GoogleClient,
  request: ImageOperationRequest,
  createdAt: string,
  options: ImageServiceOptions,
): Promise<GeneratedImagesResult> {
  const responseModalities: Array<'IMAGE'> = ['IMAGE'];

  const result = await generateText({
    model: client(request.model),
    prompt: request.prompt,
    maxRetries: 0,
    abortSignal: options.signal,
    providerOptions: {
      google: {
        responseModalities,
        imageConfig: {
          aspectRatio: request.aspectRatio,
        },
      },
    },
  });

  const imageFiles = result.files.filter((file) =>
    file.mediaType.startsWith('image/'),
  );

  return {
    images: normalizeGeneratedImages(imageFiles, createdAt),
    returnedImageCount: imageFiles.length,
  };
}
