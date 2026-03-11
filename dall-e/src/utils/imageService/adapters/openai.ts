import { generateImage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getCapabilities } from '../catalog';
import type {
  AspectRatio,
  ImageOperationRequest,
  ImageProviderAdapter,
  NormalizedGeneratedImage,
  NormalizedGenerationBatch,
  NormalizedProviderError,
  OperationMode,
  SupportedImageModel,
} from '../types';

const sizeByAspectRatio: Record<AspectRatio, `${number}x${number}`> = {
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
};

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const openAiAdapter: ImageProviderAdapter = {
  provider: 'openai',
  getCapabilities(mode: OperationMode, model: SupportedImageModel) {
    return getCapabilities('openai', mode, model);
  },
  async run(apiKey: string, request: ImageOperationRequest) {
    const client = createOpenAI({ apiKey: apiKey.trim() });
    const prompt =
      request.mode === 'edit'
        ? {
            text: request.prompt,
            images: request.sourceImages.map((image) => image.dataUrl),
            mask: request.maskImage?.dataUrl,
          }
        : request.prompt;

    const result = await generateImage({
      model: client.image(request.model),
      prompt,
      n: request.variationCount,
      size: sizeByAspectRatio[request.aspectRatio],
      providerOptions: {
        openai: {
          background: request.background,
          moderation: 'auto',
          output_format: 'png',
          quality: 'auto',
        },
      },
    });

    const createdAt = new Date().toISOString();
    const providerImages = readProviderImages(result.providerMetadata);
    const images = result.images.map((image, index) => {
      const metadata = providerImages[index];
      return {
        id: `${createdAt}-${index}`,
        base64: image.base64,
        mediaType: image.mediaType,
        previewSrc: `data:${image.mediaType};base64,${image.base64}`,
        position: index + 1,
        revisedPrompt: metadata?.revisedPrompt,
        returnedBackground: metadata?.background,
        returnedFormat: metadata?.outputFormat,
        returnedQuality: metadata?.quality,
        returnedSize: metadata?.size,
      } satisfies NormalizedGeneratedImage;
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
    } satisfies NormalizedGenerationBatch;
  },
  normalizeError(error: unknown): NormalizedProviderError {
    return readProviderError(error, 'OpenAI');
  },
};

type ProviderImageMetadata = {
  revisedPrompt?: string;
  background?: string;
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
      background:
        typeof metadata.background === 'string' ? metadata.background : undefined,
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

function readProviderError(error: unknown, providerLabel: string): NormalizedProviderError {
  const details = readErrorDetails(error);

  if (!details.message && !details.status) {
    return {
      message: `Something went wrong while talking to ${providerLabel}.`,
    };
  }

  if (details.status === 401) {
    return {
      message: `${providerLabel} rejected the API key. Check the plugin settings and try again.`,
      status: details.status,
    };
  }

  if (details.status === 429) {
    return {
      message: `${providerLabel} rate limited this request. Wait a moment and try again.`,
      status: details.status,
    };
  }

  if (details.status === 400) {
    return {
      message:
        details.message || `${providerLabel} rejected this request. Adjust it and try again.`,
      status: details.status,
    };
  }

  if (details.status && details.status >= 500) {
    return {
      message: `${providerLabel} returned a server error. Try again in a moment.`,
      status: details.status,
    };
  }

  return {
    message: details.message || `Something went wrong while talking to ${providerLabel}.`,
    status: details.status,
  };
}

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
