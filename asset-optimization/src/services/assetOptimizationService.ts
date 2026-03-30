import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import type { SimpleSchemaTypes } from '@datocms/cma-client-browser';
import { getOptimizationParams } from '../utils/optimizationUtils';
import type { Asset, AssetOptimizerResult, OptimizationSettings } from '../utils/optimizationUtils';

/**
 * Interface for an asset optimization task
 */
interface AssetOptimizationTask {
  asset: Asset;
  retryCount: number;
}

/**
 * Process a single asset for optimization
 * 
 * @param asset The asset to optimize
 * @param settings Optimization settings
 * @param client The DatoCMS client
 * @param addLog Function to add log entries
 * @param addSizeComparisonLog Function to add size comparison log entries
 * @returns Result object with optimization details or null if skipped
 */
async function processAsset(
  asset: Asset,
  settings: OptimizationSettings,
  client: ReturnType<typeof buildClient>,
  addLog: (message: string) => void,
  addSizeComparisonLog: (assetPath: string, originalSize: number, optimizedSize: number) => void
): Promise<{
  status: 'optimized' | 'skipped' | 'failed';
  asset: Asset;
  optimizedSize?: number;
  error?: string;
}> {
  try {
    addLog(`Processing asset: ${asset.path} (${formatFileSize(asset.size)})`);
    
    // Determine optimization parameters based on image type and size
    const optimizationParams = getOptimizationParams(asset, settings);
    
    if (!optimizationParams) {
      addLog(`Skipping asset ${asset.path}: No suitable optimization parameters found.`);
      return { status: 'skipped', asset };
    }
    
    // Create URL with optimization parameters
    const optimizedUrl = `${asset.url}${optimizationParams}`;
    addLog(`Optimizing with parameters: ${optimizationParams}`);
    
    // Fetch the optimized image
    const response = await fetch(optimizedUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch optimized image: ${response.statusText}`);
    }
    
    const optimizedImageBlob = await response.blob();
    addLog(`Optimized image size: ${formatFileSize(optimizedImageBlob.size)}`);
    
    // Skip if optimized image is not smaller by the minimum reduction percentage
    const minimumSizeThreshold = asset.size * (1 - settings.minimumReduction / 100);
    if (optimizedImageBlob.size > minimumSizeThreshold) {
      addLog(`Skipping asset ${asset.path}: Optimization didn't achieve minimum ${settings.minimumReduction}% reduction.`);
      return { status: 'skipped', asset };
    }
    
    // Upload the optimized image back to DatoCMS
    await client.uploads.createFromFileOrBlob({
      fileOrBlob: optimizedImageBlob,
      filename: asset.basename,
      onProgress: () => {
        // Progress callback can be used to update upload progress if needed
      },
      default_field_metadata: {
        en: { 
          alt: asset.alt || '',
          title: asset.title || '',
          custom_data: asset.customData || {}
        }
      },
      tags: asset.tags || []
    });
    
    addSizeComparisonLog(asset.path, asset.size, optimizedImageBlob.size);
    return { 
      status: 'optimized', 
      asset, 
      optimizedSize: optimizedImageBlob.size 
    };
  } catch (error) {
    addLog(`Error optimizing asset ${asset.path}: ${error instanceof Error ? error.message : String(error)}`);
    return { 
      status: 'failed', 
      asset, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Sleep for a specified duration
 * 
 * @param {number} ms - Time to sleep in milliseconds
 * @returns {Promise<void>}
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Handle the optimization process for assets with parallel processing
 * @param ctx DatoCMS context
 * @param settings Optimization settings
 * @param addLog Function to add log entries
 * @param addSizeComparisonLog Function to add size comparison log entries
 * @param setProgress Function to update the progress percentage
 * @param concurrency Number of concurrent optimizations to perform
 * @returns The result of the optimization process
 */
export async function optimizeAssets(
  ctx: RenderPageCtx,
  settings: OptimizationSettings,
  addLog: (message: string) => void,
  addSizeComparisonLog: (assetPath: string, originalSize: number, optimizedSize: number) => void,
  setProgress: (progress: number) => void,
  concurrency = 3
): Promise<AssetOptimizerResult> {
  // Initialize counters and result arrays
  let optimized = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;
  const optimizedAssets: Array<{path: string, url: string, id: string, originalSize: number, optimizedSize: number}> = [];
  const skippedAssets: Array<{path: string, url: string, id: string}> = [];
  const failedAssets: Array<{path: string, url: string, id: string}> = [];
  
  // Get access token from the plugin context
  const token = ctx.currentUserAccessToken;
  
  if (!token) {
    addLog('Error: Access token not available');
    return {
      optimized,
      skipped,
      failed,
      totalAssets: 0,
      optimizedAssets,
      skippedAssets,
      failedAssets,
    };
  }

  // Initialize CMA client
  const client = buildClient({
    apiToken: token,
    environment: ctx.environment
  });

  try {
    // Fetch all assets from the site
    const assets = await client.items.list({
      filter: {
        type: 'asset',
      },
      page: {
        // Get all assets
        limit: 100,
        offset: 0,
      },
    });

    const totalAssets = assets.length;
    addLog(`Found ${totalAssets} assets to process.`);
    setProgress(0);

    /**
     * Converts a DatoCMS CMA Upload object to our internal Asset type
     */
    function uploadToAsset(upload: SimpleSchemaTypes.Upload): Asset {
      return {
        id: upload.id,
        is_image: upload.is_image || false,
        size: upload.size || 0,
        url: upload.url || '',
        path: upload.path || '',
        basename: upload.basename || '',
        width: upload.width || undefined,
        height: upload.height || undefined,
        alt: upload.default_field_metadata?.en?.alt || undefined,
        title: upload.default_field_metadata?.en?.title || undefined,
        customData: upload.default_field_metadata?.en?.custom_data || {},
        tags: upload.tags || []
      };
    }

    // Filter out assets that are not images or don't have URLs
    const uploadAssets = [];
    
    for (const item of assets) {
      // Check if the item has the expected upload properties
      if (
        'url' in item && 
        'is_image' in item && 
        'size' in item && 
        'path' in item && 
        'basename' in item && 
        typeof item.url === 'string' && 
        typeof item.is_image === 'boolean' && 
        item.is_image && 
        item.url
      ) {
        // This item has the properties we expect from a Upload
        // Use a type-safe two-step cast by going through unknown first
        uploadAssets.push(item);
      }
    }
    
    // We've verified these items have Upload properties, so we can safely map them
    // Use a two-step cast through unknown first to satisfy TypeScript
    const optimizableAssets = uploadAssets.map(item => uploadToAsset(item as unknown as SimpleSchemaTypes.Upload));

    addLog(`Found ${optimizableAssets.length} optimizable images.`);
    
    // Create a queue of assets to process
    const queue: AssetOptimizationTask[] = optimizableAssets.map(asset => ({ asset, retryCount: 0 }));
    let activeCount = 0;

    // Function to update progress
    const updateProgress = () => {
      processed++;
      const progressPercentage = Math.floor((processed / optimizableAssets.length) * 100);
      setProgress(progressPercentage);
    };

    // Process queue until empty
    const processQueue = async () => {
      // Process assets concurrently up to the concurrency limit
      const promises: Promise<void>[] = [];

      // Start processing assets up to the concurrency limit
      while (queue.length > 0 && activeCount < concurrency) {
        const task = queue.shift();
        if (!task) continue;

        activeCount++;

        const processPromise = (async () => {
          try {
            // Add a small delay between starting tasks to avoid overwhelming the API
            if (activeCount > 1) {
              await sleep(500);
            }

            const result = await processAsset(
              task.asset,
              settings,
              client,
              addLog,
              addSizeComparisonLog
            );

            // Handle the result based on status
            if (result.status === 'optimized' && result.optimizedSize) {
              optimizedAssets.push({
                path: task.asset.path,
                url: task.asset.url,
                id: task.asset.id,
                originalSize: task.asset.size,
                optimizedSize: result.optimizedSize
              });
              optimized++;
            } else if (result.status === 'skipped') {
              skippedAssets.push({
                path: task.asset.path,
                url: task.asset.url,
                id: task.asset.id
              });
              skipped++;
            } else {
              failedAssets.push({
                path: task.asset.path,
                url: task.asset.url,
                id: task.asset.id
              });
              failed++;
            }

            // Update progress
            updateProgress();
          } catch (error) {
            // If we get here, there was an unexpected error processing the task
            addLog(`Unexpected error processing ${task.asset.path}: ${error instanceof Error ? error.message : String(error)}`);
            failedAssets.push({
              path: task.asset.path,
              url: task.asset.url,
              id: task.asset.id
            });
            failed++;
            updateProgress();
          } finally {
            activeCount--;
          }
        })();

        promises.push(processPromise);
      }

      // Wait for all active processes to complete
      await Promise.all(promises);

      // If there are still items in the queue, continue processing
      if (queue.length > 0) {
        return processQueue();
      }
    };

    // Start the parallel processing
    await processQueue();

    // Ensure progress bar reaches 100%
    setProgress(100);

    // Return the final result
    return {
      optimized,
      skipped,
      failed,
      totalAssets: optimizableAssets.length,
      optimizedAssets,
      skippedAssets,
      failedAssets,
    };
  } catch (error) {
    addLog(`Error fetching assets: ${error instanceof Error ? error.message : String(error)}`);
    
    // Return the result with the error
    return {
      optimized,
      skipped,
      failed,
      totalAssets: 0,
      optimizedAssets,
      skippedAssets,
      failedAssets,
    };
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
