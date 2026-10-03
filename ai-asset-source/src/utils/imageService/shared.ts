import {
  MAX_GENERATED_IMAGE_BASE64_LENGTH,
  MAX_GENERATED_IMAGE_BYTES,
  MAX_GENERATED_IMAGES,
} from './generationValidation';
import type {
  ImageOperationRequest,
  NormalizedFailedImage,
  NormalizedGeneratedImage,
  NormalizedGenerationBatch,
  NormalizedGenerationImage,
} from './types';

type GeneratedImageSource = {
  base64: string;
  mediaType: string;
};

type GeneratedImageMetadata = Pick<
  NormalizedGeneratedImage,
  | 'revisedPrompt'
  | 'returnedFormat'
  | 'returnedQuality'
  | 'returnedSize'
  | 'returnedCompression'
>;

export function normalizeGeneratedImages(
  images: GeneratedImageSource[],
  createdAt: string,
  getMetadata?: (index: number) => GeneratedImageMetadata | undefined,
): NormalizedGenerationImage[] {
  const namespace = buildBatchId(createdAt);

  return images.slice(0, MAX_GENERATED_IMAGES).map((image, index) => {
    const errorMessage = readGeneratedImageError(image);
    const identity = {
      id: buildImageId(namespace, index + 1),
      position: index + 1,
    };

    if (errorMessage) {
      return { kind: 'error', ...identity, errorMessage };
    }

    return {
      kind: 'success',
      ...identity,
      base64: image.base64,
      mediaType: image.mediaType,
      previewSrc: `data:${image.mediaType};base64,${image.base64}`,
      ...getMetadata?.(index),
    };
  });
}

export function createGenerationBatch(
  request: ImageOperationRequest,
  createdAt: string,
  images: NormalizedGenerationImage[],
  errorMessage = 'This image could not be generated.',
  returnedImageCount = images.length,
): NormalizedGenerationBatch {
  const batchId = buildBatchId(createdAt);
  const expectedImageCount = getExpectedImageCount(request);
  const identifiedImages = images
    .slice(0, MAX_GENERATED_IMAGES)
    .map((image, index) => ({
      ...image,
      id: buildImageId(batchId, index + 1),
      position: index + 1,
    }));
  const imagesWithFailures = fillMissingImages(
    identifiedImages,
    batchId,
    expectedImageCount,
    errorMessage,
  );

  const warnings: string[] = [];

  if (returnedImageCount > MAX_GENERATED_IMAGES) {
    warnings.push(
      `The provider returned ${returnedImageCount} images. Only the first ${MAX_GENERATED_IMAGES} are retained by this plugin's memory limit. The request was not repeated.`,
    );
  } else if (returnedImageCount > expectedImageCount) {
    warnings.push(
      `The provider returned ${returnedImageCount} images instead of ${expectedImageCount}. All returned images are shown.`,
    );
  }

  return {
    id: batchId,
    createdAt,
    request,
    images: imagesWithFailures,
    ...(warnings.length ? { warnings } : {}),
  };
}

export function createFailedGenerationBatch(
  request: ImageOperationRequest,
  createdAt: string,
  errorMessage: string,
): NormalizedGenerationBatch {
  const batchId = buildBatchId(createdAt);

  return {
    id: batchId,
    createdAt,
    request,
    images: createFailedImages(
      batchId,
      getExpectedImageCount(request),
      errorMessage,
    ),
  };
}

export function readProviderErrorDetails(error: unknown): {
  message?: string;
  status?: number;
} {
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

function fillMissingImages(
  images: NormalizedGenerationImage[],
  createdAt: string,
  expectedImageCount: number,
  errorMessage: string,
): NormalizedGenerationImage[] {
  if (images.length >= expectedImageCount) {
    return images;
  }

  return [
    ...images,
    ...createFailedImages(
      createdAt,
      expectedImageCount - images.length,
      errorMessage,
      images.length + 1,
    ),
  ];
}

function createFailedImages(
  createdAt: string,
  count: number,
  errorMessage: string,
  startPosition = 1,
): NormalizedFailedImage[] {
  return Array.from({ length: count }, (_, index) => {
    const position = startPosition + index;

    return {
      kind: 'error',
      id: buildImageId(createdAt, position),
      position,
      errorMessage,
    };
  });
}

function buildBatchId(createdAt: string): string {
  return `${createdAt}-${crypto.randomUUID()}`;
}

function buildImageId(namespace: string, position: number): string {
  return `${namespace}-${position}`;
}

function getExpectedImageCount(request: ImageOperationRequest): number {
  return Number.isInteger(request.variationCount) && request.variationCount > 0
    ? Math.min(request.variationCount, MAX_GENERATED_IMAGES)
    : 1;
}

function readGeneratedImageError(
  image: GeneratedImageSource,
): string | undefined {
  const base64 = image.base64;
  const format = image.mediaType;

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(format)) {
    return 'The provider returned an unsupported image format. The request was not repeated.';
  }

  if (typeof base64 !== 'string' || !base64.length) {
    return 'The provider returned an empty image. The request was not repeated.';
  }

  const decodedBytes = getDecodedImageBytes(base64);

  if (
    base64.length > MAX_GENERATED_IMAGE_BASE64_LENGTH ||
    decodedBytes > MAX_GENERATED_IMAGE_BYTES
  ) {
    return "The generated image exceeds this plugin's 16 MiB image limit. The request was not repeated.";
  }

  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return 'The provider returned invalid image data. The request was not repeated.';
  }

  return hasValidImageHeader(base64, format)
    ? undefined
    : 'The provider returned image data with an invalid format. The request was not repeated.';
}

function getDecodedImageBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;

  return (base64.length * 3) / 4 - padding;
}

function hasValidImageHeader(base64: string, format: string): boolean {
  let header: string;
  try {
    header = atob(base64.slice(0, 16));
  } catch {
    return false;
  }

  return format === 'image/png'
    ? header.startsWith('\x89PNG\r\n\x1a\n')
    : format === 'image/jpeg'
      ? header.startsWith('\xff\xd8\xff')
      : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
}
