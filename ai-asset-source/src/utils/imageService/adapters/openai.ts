import {
  getCapabilities,
  getOpenAiRequestSize,
  supportsOutputControls,
} from '../catalog';
import {
  createGenerationBatch,
  normalizeGeneratedImages,
  readProviderErrorDetails,
} from '../shared';
import type {
  ImageOperationRequest,
  ImageOutputFormat,
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
    const body = buildImageGenerationBody(request);
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw createProviderError(response, payload);
    }

    const createdAt = new Date().toISOString();
    const generatedResponse = readImageGenerationResponse(
      payload,
      request.outputFormat,
    );
    const outputFormat = resolveResponseFormat(generatedResponse, request);
    const outputCompression = readOutputCompression(request, outputFormat);
    const images = normalizeGeneratedImages(
      generatedResponse.images,
      createdAt,
      (index) => {
        const metadata = generatedResponse.metadata[index];

        return {
          revisedPrompt: metadata?.revisedPrompt,
          returnedFormat: outputFormat,
          returnedQuality: generatedResponse.quality || request.outputQuality,
          returnedSize: generatedResponse.size,
          returnedCompression: outputCompression,
        };
      },
    );

    if (!images.length) {
      throw new Error('OpenAI did not return image data for this request.');
    }

    return createGenerationBatch(request, createdAt, images);
  },
  normalizeError(error: unknown): NormalizedProviderError {
    return readProviderError(error, 'OpenAI');
  },
};

type ImageGenerationRequestBody = {
  model: string;
  prompt: string;
  n: number;
  size: string;
  moderation?: 'auto';
  quality?: string;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  response_format?: 'b64_json';
};

type ImageGenerationResponse = {
  data?: unknown;
  output_format?: unknown;
  quality?: unknown;
  size?: unknown;
};

type ImageGenerationImage = {
  b64_json?: unknown;
  revised_prompt?: unknown;
};

type ReadImageGenerationResponse = {
  images: Array<{ base64: string; mediaType: string }>;
  metadata: Array<{ revisedPrompt?: string }>;
  outputFormat?: ImageOutputFormat;
  quality?: string;
  size?: string;
};

function buildImageGenerationBody(
  request: ImageOperationRequest,
): ImageGenerationRequestBody {
  const body: ImageGenerationRequestBody = {
    model: request.model,
    prompt: request.prompt,
    n: request.variationCount,
    size: getOpenAiRequestSize(request.aspectRatio),
  };

  if (!supportsOutputControls('openai', request.model)) {
    body.response_format = 'b64_json';
    return body;
  }

  const outputFormat = request.outputFormat || 'webp';

  body.quality = request.outputQuality || 'high';
  body.output_format = outputFormat;
  body.moderation = 'auto';

  if (outputFormat !== 'png') {
    body.output_compression = request.outputCompression ?? 100;
  }

  return body;
}

function readImageGenerationResponse(
  payload: unknown,
  requestedFormat?: ImageOutputFormat,
): ReadImageGenerationResponse {
  if (!payload || typeof payload !== 'object') {
    return {
      images: [],
      metadata: [],
    };
  }

  const response = payload as ImageGenerationResponse;
  const outputFormat = readImageOutputFormat(response.output_format);
  const mediaType = getMediaType(outputFormat || requestedFormat || 'png');
  const data = Array.isArray(response.data) ? response.data : [];
  const images: Array<{ base64: string; mediaType: string }> = [];
  const metadata: Array<{ revisedPrompt?: string }> = [];

  for (const entry of data) {
    const image = readImageEntry(entry);

    if (!image) {
      continue;
    }

    images.push({
      base64: image.base64,
      mediaType,
    });
    metadata.push({
      revisedPrompt: image.revisedPrompt,
    });
  }

  return {
    images,
    metadata,
    outputFormat,
    quality: typeof response.quality === 'string' ? response.quality : undefined,
    size: typeof response.size === 'string' ? response.size : undefined,
  };
}

function readImageEntry(entry: unknown):
  | {
      base64: string;
      revisedPrompt?: string;
    }
  | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const image = entry as ImageGenerationImage;

  if (typeof image.b64_json !== 'string') {
    return undefined;
  }

  return {
    base64: image.b64_json,
    revisedPrompt:
      typeof image.revised_prompt === 'string'
        ? image.revised_prompt
        : undefined,
  };
}

function resolveResponseFormat(
  response: ReadImageGenerationResponse,
  request: ImageOperationRequest,
): ImageOutputFormat {
  return response.outputFormat || request.outputFormat || 'png';
}

function readOutputCompression(
  request: ImageOperationRequest,
  outputFormat: ImageOutputFormat,
): number | undefined {
  if (outputFormat === 'png') {
    return undefined;
  }

  return request.outputCompression ?? 100;
}

function getMediaType(format: ImageOutputFormat): string {
  if (format === 'jpeg') {
    return 'image/jpeg';
  }

  return `image/${format}`;
}

function readImageOutputFormat(value: unknown): ImageOutputFormat | undefined {
  if (value === 'png' || value === 'jpeg' || value === 'webp') {
    return value;
  }

  return undefined;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function createProviderError(response: Response, payload: unknown): Error {
  const message = readProviderErrorMessage(payload);
  const error = new Error(
    message || `OpenAI returned ${response.status}.`,
  ) as Error & { status?: number };

  error.status = response.status;

  return error;
}

function readProviderErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const error = (payload as { error?: unknown }).error;

  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const message = (error as { message?: unknown }).message;

  return typeof message === 'string' ? message : undefined;
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
      details.message ||
      `Something went wrong while talking to ${providerLabel}.`,
  };
}
