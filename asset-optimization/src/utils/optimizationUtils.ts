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
  width?: number;
  height?: number;
  alt?: string;
  title?: string;
  customData?: Record<string, unknown>;
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
  useLossless: false,  // Default to not using lossless compression
  useChromaSubsampling: false, // Default to standard JPEG chroma subsampling (420)
  preserveColorProfile: true, // Default to preserve color profiles for accurate colors
};

/**
 * Generates Imgix optimization parameters based on asset size and settings
 * @param asset - The asset to optimize
 * @param settings - Optimization settings to apply
 * @returns Optimization parameters as a URL query string or null if optimization not possible
 */
export function getOptimizationParams(asset: Asset, settings: OptimizationSettings): string | null {
  // Only proceed if the asset is an image
  if (!asset.is_image) {
    return null;
  }

  // Using the size directly in bytes when comparing to thresholds
  const largeThresholdBytes = settings.largeAssetThreshold * 1024 * 1024;
  const veryLargeThresholdBytes = settings.veryLargeAssetThreshold * 1024 * 1024;
  
  // Determine asset size category
  const isLargeAsset = asset.size >= largeThresholdBytes;
  const isVeryLargeAsset = asset.size >= veryLargeThresholdBytes;
  
  // Base parameters
  let params = '?';
  
  // Auto compression if enabled
  if (settings.useAutoCompress) {
    params += 'auto=compress';
  }
  
  // Quality parameter based on asset size
  if (isVeryLargeAsset) {
    params += params.length > 1 ? '&' : '';
    params += `q=${settings.qualityVeryLarge}`;
  } else if (isLargeAsset) {
    params += params.length > 1 ? '&' : '';
    params += `q=${settings.qualityLarge}`;
  } else {
    // For images smaller than the large threshold
    // Don't apply any quality reduction - skip optimization
    return null;
  }
  
  // Resize large images if enabled and dimensions are available
  if (settings.resizeLargeImages && asset.width && asset.height) {
    const largerDimension = Math.max(asset.width, asset.height);
    const maxDimension = isVeryLargeAsset ? 
                        settings.resizeDimensionVeryLarge : 
                        (isLargeAsset ? settings.resizeDimensionLarge : null);
    
    if (maxDimension && largerDimension > maxDimension) {
      if (asset.width >= asset.height) {
        params += params.length > 1 ? '&' : '';
        params += `max-w=${maxDimension}`;
      } else {
        params += params.length > 1 ? '&' : '';
        params += `h=${maxDimension}`;
      }
    }
  }
  
  // Format conversion if enabled and not preserving original format
  if (settings.targetFormat && !settings.preserveOriginalFormat) {
    params += params.length > 1 ? '&' : '';
    params += `fm=${settings.targetFormat}`;
  }
  
  // Use DPR=2 for very large images if enabled
  if (isVeryLargeAsset && settings.useDpr) {
    params += params.length > 1 ? '&' : '';
    params += 'dpr=2';
  }
  
  // Use lossless compression if enabled
  if (settings.useLossless) {
    params += params.length > 1 ? '&' : '';
    params += 'lossless=1';
  }

  // Apply higher quality chroma subsampling if enabled (444 instead of default 420)
  if (settings.useChromaSubsampling) {
    params += params.length > 1 ? '&' : '';
    params += 'chromasub=444';
  }

  // Preserve original color profile if enabled
  if (settings.preserveColorProfile) {
    params += params.length > 1 ? '&' : '';
    params += 'cs=origin';
  }
  
  return params;
}
