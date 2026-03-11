import type { InputImage } from './imageService';

export type WorkingImage = InputImage & {
  originalWidth: number;
  originalHeight: number;
};

export type AreaSelectionRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const DEFAULT_WORKING_IMAGE_MAX_EDGE = 2048;

export async function readImageFiles(
  files: File[] | FileList,
): Promise<InputImage[]> {
  return Promise.all(Array.from(files).map(readSingleImageFile));
}

export async function readImageFromUrl(
  url: string,
  name: string,
  dimensions?: { width?: number | null; height?: number | null },
): Promise<InputImage> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to load ${name}.`);
  }

  const blob = await response.blob();
  const dataUrl = await readBlobAsDataUrl(blob);
  const measuredDimensions = await readImageDimensions(dataUrl);

  return {
    id: createImageId(),
    name,
    mediaType: blob.type || 'image/png',
    dataUrl,
    width: measuredDimensions.width ?? dimensions?.width ?? undefined,
    height: measuredDimensions.height ?? dimensions?.height ?? undefined,
  };
}

export async function createWorkingImage(
  source: InputImage,
  maxEdge = DEFAULT_WORKING_IMAGE_MAX_EDGE,
): Promise<WorkingImage> {
  const measuredDimensions = await readImageDimensions(source.dataUrl);
  const originalWidth = measuredDimensions.width ?? source.width ?? maxEdge;
  const originalHeight = measuredDimensions.height ?? source.height ?? maxEdge;
  const longestEdge = Math.max(originalWidth, originalHeight);

  if (!longestEdge || longestEdge <= maxEdge) {
    return {
      ...source,
      width: originalWidth,
      height: originalHeight,
      originalWidth,
      originalHeight,
    };
  }

  const scale = maxEdge / longestEdge;
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const image = await loadImageElement(source.dataUrl);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to prepare the working image.');
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const mediaType = resolveOutputMediaType(source.mediaType);
  const dataUrl = canvas.toDataURL(
    mediaType,
    mediaType === 'image/jpeg' || mediaType === 'image/webp' ? 0.92 : undefined,
  );

  return {
    id: source.id,
    name: source.name,
    mediaType,
    dataUrl,
    width,
    height,
    originalWidth,
    originalHeight,
  };
}

export async function buildProviderMaskImage(
  maskDataUrl: string,
  sourceImage: WorkingImage,
): Promise<InputImage | undefined> {
  const width = sourceImage.width ?? sourceImage.originalWidth;
  const height = sourceImage.height ?? sourceImage.originalHeight;
  const image = await loadImageElement(maskDataUrl);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Unable to prepare the mask image.');
  }

  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  let hasPaint = false;

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const alpha = imageData.data[index + 3];
    const painted = alpha > 0 && !(red >= 250 && green >= 250 && blue >= 250);

    if (painted) {
      hasPaint = true;
      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
      imageData.data[index + 3] = 0;
      continue;
    }

    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = 255;
  }

  if (!hasPaint) {
    return undefined;
  }

  context.putImageData(imageData, 0, 0);

  return {
    id: createImageId(),
    name: buildMaskFilename(sourceImage.name),
    mediaType: 'image/png',
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
  };
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, payload] = dataUrl.split(',');
  const mimeMatch = header.match(/data:(.*?)(;base64)?$/);
  const mimeType = mimeMatch?.[1] || 'image/png';
  const binary = atob(payload || '');
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], filename, { type: mimeType });
}

export function createImageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readSingleImageFile(file: File): Promise<InputImage> {
  const dataUrl = await readFileAsDataUrl(file);
  const dimensions = await readImageDimensions(dataUrl);

  return {
    id: createImageId(),
    name: file.name,
    mediaType: file.type || 'image/png',
    dataUrl,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read the image.'));
    reader.readAsDataURL(blob);
  });
}

async function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the image.'));
    image.src = dataUrl;
  });
}

function readImageDimensions(
  dataUrl: string,
): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => resolve({});
    image.src = dataUrl;
  });
}

function buildMaskFilename(name: string) {
  const baseName = name.replace(/\.[a-z0-9]+$/i, '') || 'mask';
  return `${baseName}-mask.png`;
}

function resolveOutputMediaType(mediaType: string) {
  if (
    mediaType === 'image/png' ||
    mediaType === 'image/jpeg' ||
    mediaType === 'image/webp'
  ) {
    return mediaType;
  }

  return 'image/png';
}

export async function buildProviderMaskImageFromSelection(
  selection: AreaSelectionRect,
  sourceImage: WorkingImage,
): Promise<InputImage | undefined> {
  const width = sourceImage.width ?? sourceImage.originalWidth;
  const height = sourceImage.height ?? sourceImage.originalHeight;

  if (!selection.width || !selection.height) {
    return undefined;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to prepare the selection mask.');
  }

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.clearRect(selection.x, selection.y, selection.width, selection.height);

  return {
    id: createImageId(),
    name: buildMaskFilename(sourceImage.name),
    mediaType: 'image/png',
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
  };
}
