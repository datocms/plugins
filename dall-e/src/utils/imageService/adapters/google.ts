import { generateImage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getCapabilities } from '../catalog';
import type {
  ImageOperationRequest,
  ImageProviderAdapter,
  NormalizedGeneratedImage,
  NormalizedGenerationBatch,
  NormalizedProviderError,
  OperationMode,
  SupportedImageModel,
} from '../types';

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const googleAdapter: ImageProviderAdapter = {
  provider: 'google',
  getCapabilities(mode: OperationMode, model: SupportedImageModel) {
    return getCapabilities('google', mode, model);
  },
  async run(apiKey: string, request: ImageOperationRequest) {
    const client = createGoogleGenerativeAI({ apiKey: apiKey.trim() });
    const prompt =
      request.mode === 'edit'
        ? {
            text: request.prompt,
            images: request.sourceImages.map((image) => image.dataUrl),
          }
        : request.prompt;

    const result = await generateImage({
      model: client.image(request.model),
      prompt,
      aspectRatio: request.aspectRatio,
    });

    const createdAt = new Date().toISOString();
    const images = result.images.map((image, index) => ({
      id: `${createdAt}-${index}`,
      base64: image.base64,
      mediaType: image.mediaType,
      previewSrc: `data:${image.mediaType};base64,${image.base64}`,
      position: index + 1,
    } satisfies NormalizedGeneratedImage));

    if (!images.length) {
      throw new Error('Google did not return image data for this request.');
    }

    return {
      id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      createdAtLabel: timestampFormatter.format(new Date(createdAt)),
      request,
      images,
      status: 'completed',
    } satisfies NormalizedGenerationBatch;
  },
  normalizeError(error: unknown): NormalizedProviderError {
    const details = readErrorDetails(error);

    if (!details.message && !details.status) {
      return { message: 'Something went wrong while talking to Google.' };
    }

    if (details.status === 401 || details.status === 403) {
      return {
        message: 'Google rejected the API key. Check the plugin settings and try again.',
        status: details.status,
      };
    }

    if (details.status === 429) {
      return {
        message: 'Google rate limited this request. Wait a moment and try again.',
        status: details.status,
      };
    }

    if (details.status === 400) {
      return {
        message: details.message || 'Google rejected this request. Adjust it and try again.',
        status: details.status,
      };
    }

    if (details.status && details.status >= 500) {
      return {
        message: 'Google returned a server error. Try again in a moment.',
        status: details.status,
      };
    }

    return {
      message: details.message || 'Something went wrong while talking to Google.',
      status: details.status,
    };
  },
};

function readErrorDetails(error: unknown): { message?: string; status?: number } {
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
