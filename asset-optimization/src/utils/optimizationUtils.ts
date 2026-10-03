/**
 * Utility functions and types for asset optimization
 */

/**
 * Represents an asset from DatoCMS
 */
export interface Asset {
  id: string;
  is_image: boolean;
  size: number;
  url: string;
  path: string;
  basename: string;
  md5?: string;
  updated_at?: string | null;
  format?: string;
  width?: number;
  height?: number;
  tags?: string[];
  originalSize?: number;
  optimizedSize?: number;
  savingsPercentage?: number;
}

/**
 * Represents a simplified asset object used for optimization results
 */
export interface OptimizedAsset {
  id: string;
  path: string;
  url: string;
  originalSize: number;
  optimizedSize: number;
}

/**
 * Represents a simplified asset object used for skipped/failed assets
 */
export interface ProcessedAsset {
  id: string;
  path: string;
  url: string;
  error?: string;
}

/**
 * Results of the asset optimization process
 */
export interface AssetOptimizerResult {
  optimized: number;
  skipped: number;
  failed: number;
  totalAssets: number;
  optimizedAssets: OptimizedAsset[];
  skippedAssets: ProcessedAsset[];
  failedAssets: ProcessedAsset[];
  cancelled?: boolean;
  unprocessed?: number;
  stoppedReason?: string;
  inventoryIncomplete?: boolean;
}

/**
 * Settings for the asset optimization process
 */
export interface OptimizationSettings {
  largeAssetThreshold: number;
  veryLargeAssetThreshold: number;
  qualityLarge: number;
  qualityVeryLarge: number;
  resizeDimensionLarge: number;
  resizeDimensionVeryLarge: number;
  minimumReduction: number;
  targetFormat: string;
  preserveOriginalFormat: boolean;
  resizeLargeImages: boolean;
  useAutoCompress: boolean;
  useDpr: boolean;
  useLossless: boolean;
  useChromaSubsampling: boolean;
  preserveColorProfile: boolean;
}

/**
 * Default optimization settings
 */
export const defaultSettings: OptimizationSettings = {
  largeAssetThreshold: 3, // 3MB threshold
  veryLargeAssetThreshold: 8, // 8MB threshold
  qualityLarge: 85, // Quality for large images (higher = better quality)
  qualityVeryLarge: 80, // Quality for very large images (higher = better quality)
  resizeDimensionLarge: 2400, // Max dimension for large images
  resizeDimensionVeryLarge: 2000, // Max dimension for very large images
  minimumReduction: 10, // At least 10% reduction in size
  targetFormat: 'avif',
  preserveOriginalFormat: false, // Default to not preserving original format
  resizeLargeImages: true,
  useAutoCompress: true,
  useDpr: true, // Use DPR=2 for very large images
  useLossless: false, // Default to not using lossless compression
  useChromaSubsampling: false, // Default to standard JPEG chroma subsampling (420)
  preserveColorProfile: true, // Default to preserve color profiles for accurate colors
};

function normalizeNumber(
  key: keyof OptimizationSettings,
  value: number,
): number {
  const minimum = key.includes('Threshold')
    ? 0.1
    : key.includes('Dimension')
      ? 1
      : 0;
  const maximum =
    key.includes('quality') || key === 'minimumReduction'
      ? 100
      : Number.MAX_SAFE_INTEGER;
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeSetting(key: keyof OptimizationSettings, candidate: unknown) {
  const fallback = defaultSettings[key];
  if (typeof fallback === 'boolean')
    return typeof candidate === 'boolean' ? candidate : fallback;
  if (typeof fallback === 'number')
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? normalizeNumber(key, candidate)
      : fallback;
  return candidate === 'webp' || candidate === 'avif' ? candidate : fallback;
}

export function normalizeSettings(value: unknown): OptimizationSettings {
  const settings = { ...defaultSettings };
  if (!value || typeof value !== 'object') return settings;
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(
    defaultSettings,
  ) as (keyof OptimizationSettings)[]) {
    Object.assign(settings, { [key]: normalizeSetting(key, input[key]) });
  }
  settings.veryLargeAssetThreshold = Math.max(
    settings.largeAssetThreshold,
    settings.veryLargeAssetThreshold,
  );
  return settings;
}

type AssetSizeCategory = 'small' | 'large' | 'very-large';

const getAssetSizeCategory = (
  assetSize: number,
  settings: OptimizationSettings,
): AssetSizeCategory => {
  const veryLargeThresholdBytes =
    settings.veryLargeAssetThreshold * 1024 * 1024;
  const largeThresholdBytes = settings.largeAssetThreshold * 1024 * 1024;

  if (assetSize >= veryLargeThresholdBytes) {
    return 'very-large';
  }
  if (assetSize >= largeThresholdBytes) {
    return 'large';
  }
  return 'small';
};

const buildResizeParam = (
  asset: Asset,
  sizeCategory: AssetSizeCategory,
  settings: OptimizationSettings,
): string | null => {
  if (!settings.resizeLargeImages || !asset.width || !asset.height) {
    return null;
  }

  const maxDimension =
    sizeCategory === 'very-large'
      ? settings.resizeDimensionVeryLarge
      : settings.resizeDimensionLarge;

  const largerDimension = Math.max(asset.width, asset.height);
  if (largerDimension <= maxDimension) {
    return null;
  }

  if (asset.width >= asset.height) {
    return `max-w=${maxDimension}`;
  }
  return `h=${maxDimension}`;
};

function getOutputFormat(
  asset: Asset,
  settings: OptimizationSettings,
): string | undefined {
  if (!settings.preserveOriginalFormat) return settings.targetFormat;
  const format = (asset.format ?? asset.path.split('.').pop())?.toLowerCase();
  if (
    !format ||
    !['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(format)
  )
    return undefined;
  return format === 'jpeg' ? 'jpg' : format;
}

const collectOptimizationParamParts = (
  asset: Asset,
  settings: OptimizationSettings,
  sizeCategory: AssetSizeCategory,
): string[] => {
  const parts: string[] = [];

  if (settings.useAutoCompress) {
    parts.push('auto=compress');
  }

  const qualityValue =
    sizeCategory === 'very-large'
      ? settings.qualityVeryLarge
      : settings.qualityLarge;
  parts.push(`q=${qualityValue}`);

  const resizeParam = buildResizeParam(asset, sizeCategory, settings);
  if (resizeParam) {
    parts.push(resizeParam);
  }

  const format = getOutputFormat(asset, settings);
  if (format) parts.push(`fm=${format}`);

  if (sizeCategory === 'very-large' && settings.useDpr) {
    parts.push('dpr=2');
  }

  if (settings.useLossless) {
    parts.push('lossless=1');
  }

  if (settings.useChromaSubsampling) {
    parts.push('chromasub=444');
  }

  if (settings.preserveColorProfile) {
    parts.push('cs=origin');
  }

  return parts;
};

/**
 * Generates Imgix optimization parameters based on asset size and settings
 * @param asset - The asset to optimize
 * @param settings - Optimization settings to apply
 * @returns Optimization parameters as a URL query string or null if optimization not possible
 */
export function getOptimizationParams(
  asset: Asset,
  settings: OptimizationSettings,
): string | null {
  if (!asset.is_image) {
    return null;
  }
  if (settings.preserveOriginalFormat && !getOutputFormat(asset, settings))
    return null;

  const sizeCategory = getAssetSizeCategory(asset.size, settings);

  if (sizeCategory === 'small') {
    return null;
  }

  const parts = collectOptimizationParamParts(asset, settings, sizeCategory);
  return `?${parts.join('&')}`;
}
