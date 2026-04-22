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
): NormalizedGeneratedImage[] {
  return images.map((image, index) => ({
    kind: 'success',
    id: buildImageId(createdAt, index + 1),
    base64: image.base64,
    mediaType: image.mediaType,
    previewSrc: `data:${image.mediaType};base64,${image.base64}`,
    position: index + 1,
    ...getMetadata?.(index),
  }));
}

export function createGenerationBatch(
  request: ImageOperationRequest,
  createdAt: string,
  images: NormalizedGeneratedImage[],
  errorMessage = 'This image could not be generated.',
): NormalizedGenerationBatch {
  const expectedImageCount = request.variationCount;
  const imagesWithFailures = fillMissingImages(
    images,
    createdAt,
    expectedImageCount,
    errorMessage,
  );

  return {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    request,
    images: imagesWithFailures,
  };
}

export function createFailedGenerationBatch(
  request: ImageOperationRequest,
  createdAt: string,
  errorMessage: string,
): NormalizedGenerationBatch {
  return {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    request,
    images: createFailedImages(createdAt, request.variationCount, errorMessage),
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
  images: NormalizedGeneratedImage[],
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

function buildImageId(createdAt: string, position: number): string {
  return `${createdAt}-${position}`;
}
