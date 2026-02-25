import { ASPECT_RATIO_OPTIONS } from '../constants';
import type { WidthValue } from '../types';
import { resolveWidthValue } from './width';

export function parseAspectRatio(value: string): number | null {
  // Handle predefined ratios
  const predefined = ASPECT_RATIO_OPTIONS.find((opt) => opt.value === value);
  if (predefined && predefined.ratio !== null) {
    return predefined.ratio;
  }

  // Handle custom format "W:H" or "W/H"
  const match = value.match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/);
  if (match) {
    const w = parseFloat(match[1]);
    const h = parseFloat(match[2]);
    if (h > 0) {
      return w / h;
    }
  }

  return null;
}

export function calculateHeight(width: number, aspectRatio: number): number {
  return Math.round(width / aspectRatio);
}

export function calculateWidth(height: number, aspectRatio: number): number {
  return Math.round(height * aspectRatio);
}

export function formatDimensions(width: number, aspectRatio: number): string {
  const height = calculateHeight(width, aspectRatio);
  return `${width} × ${height} px`;
}

export function validateCustomAspectRatio(value: string): string | undefined {
  if (!value) {
    return 'Please enter a custom aspect ratio';
  }

  const ratio = parseAspectRatio(value);
  if (ratio === null || ratio <= 0) {
    return 'Invalid format. Use W:H (e.g., 2.35:1)';
  }

  return undefined;
}

export function getEffectiveRatio(
  aspectRatio: string,
  customAspectRatio?: string,
  originalWidth?: number | null,
  originalHeight?: number | null
): number | null {
  if (aspectRatio === 'original') {
    if (originalWidth && originalHeight && originalHeight > 0) {
      return originalWidth / originalHeight;
    }
    return null;
  }
  if (aspectRatio === 'custom') {
    return customAspectRatio ? parseAspectRatio(customAspectRatio) : null;
  }
  return parseAspectRatio(aspectRatio);
}

export function calculateOutputHeight(
  width: WidthValue,
  aspectRatio: string,
  customAspectRatio?: string,
  originalWidth?: number | null,
  originalHeight?: number | null
): number {
  const ratio = getEffectiveRatio(aspectRatio, customAspectRatio, originalWidth, originalHeight);
  const resolvedWidth = resolveWidthValue(width, originalWidth);
  if (resolvedWidth && ratio && ratio > 0) {
    return Math.round(resolvedWidth / ratio);
  }
  // Fallback: if we can't determine ratio or width, use width (1:1)
  if (resolvedWidth) {
    return resolvedWidth;
  }
  if (width === 'original' && originalHeight) {
    return originalHeight;
  }
  return 0;
}
