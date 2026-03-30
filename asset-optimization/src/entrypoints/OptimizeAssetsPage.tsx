import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { buildClient } from '@datocms/cma-client-browser';
import type { SimpleSchemaTypes } from '@datocms/cma-client-browser';
import { useState, useEffect } from 'react';

import s from './styles.module.css';

// Import components
import SettingsForm from '../components/asset-optimization/SettingsForm';
import ActivityLog, { type LogEntry } from '../components/asset-optimization/ActivityLog';
import ProgressIndicator from '../components/asset-optimization/ProgressIndicator';
import ResultsStats from '../components/asset-optimization/ResultsStats';
import AssetList from '../components/asset-optimization/AssetList';

// Import types and utilities from shared utils file
import type { AssetOptimizerResult, Asset, OptimizationSettings, OptimizedAsset, ProcessedAsset } from '../utils/optimizationUtils';
import { defaultSettings, getOptimizationParams } from '../utils/optimizationUtils';
import { formatFileSize } from '../utils/formatters';

/**
 * Convert DatoCMS Upload object to our internal Asset type
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

/**
 * Convert Asset to ProcessedAsset type
 */
function assetToProcessedAsset(asset: Asset): ProcessedAsset {
  return {
    id: asset.id,
    path: asset.path,
    url: asset.url
  };
}

/**
 * Convert Asset to OptimizedAsset type with size information
 */
function assetToOptimizedAsset(asset: Asset, originalSize: number, optimizedSize: number): OptimizedAsset {
  return {
    id: asset.id,
    path: asset.path,
    url: asset.url,
    originalSize,
    optimizedSize
  };
}

/**
 * Sleep for a specified duration
 * 
 * @param {number} ms - Time to sleep in milliseconds
 * @returns {Promise<void>}
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Process a single asset for optimization or preview
 * 
 * @param asset Asset to process
 * @param settings Optimization settings
 * @param addLog Function to add logs
 * @param addSizeComparisonLog Function to add size comparison logs
 * @param isPreview Whether this is a preview operation
 * @param apiToken DatoCMS API token
 * @param environment DatoCMS environment
 * @returns Result of processing the asset
 */
async function processAsset(
  asset: Asset,
  settings: OptimizationSettings,
  addLog: (message: string) => void,
  addSizeComparisonLog: (assetPath: string, originalSize: number, optimizedSize: number) => void,
  isPreview: boolean,
  apiToken?: string,
  environment?: string
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
      addLog(`Optimization not significant enough for ${asset.path}. Skipping.`);
      return { status: 'skipped', asset };
    }
    
    // If this is just a preview, don't actually replace the asset
    if (isPreview) {
      addSizeComparisonLog(asset.path, asset.size, optimizedImageBlob.size);
      return { 
        status: 'optimized', 
        asset, 
        optimizedSize: optimizedImageBlob.size
      };
    }
    
    // For actual optimization, replace the asset
    if (!apiToken) {
      throw new Error('API token is required for asset replacement');
    }
    
    // Use our asset replacement utility to properly replace the asset
    addLog(`Replacing asset ${asset.path}...`);
    
    // Import dynamically to avoid circular dependency
    // We need to use default export directly for backward compatibility
    const { default: replaceAssetFromUrl } = await import('../utils/assetReplacer');
    
    await replaceAssetFromUrl(
      asset.id,
      optimizedUrl,
      apiToken,
      environment || 'master',
      asset.basename
    );
    
    addSizeComparisonLog(asset.path, asset.size, optimizedImageBlob.size);
    addLog(`Successfully replaced asset ${asset.path}`);
    
    return { 
      status: 'optimized', 
      asset, 
      optimizedSize: optimizedImageBlob.size
    };
  } catch (error) {
    addLog(`Error ${isPreview ? 'optimizing' : 'replacing'} asset ${asset.path}: ${error instanceof Error ? error.message : String(error)}`);
    return { 
      status: 'failed', 
      asset, 
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

type Props = {
  ctx: RenderPageCtx;
};

/**
 * OptimizeAssetsPage component - main entrypoint for the asset optimization plugin
 * 
 * This component allows users to configure and run asset optimization processes
 * for DatoCMS media library assets.
 * 
 * @param ctx - DatoCMS plugin context
 */
const OptimizeAssetsPage = ({ ctx }: Props) => {
  // UI state management
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<AssetOptimizerResult | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<OptimizationSettings>({ ...defaultSettings });
  const [currentAsset, setCurrentAsset] = useState<Asset | undefined>(undefined);
  const [selectedCategory, setSelectedCategory] = useState<'optimized' | 'skipped' | 'failed' | null>(null);
  // Concurrency control - default to 10 concurrent operations
  const concurrency = 10;

  // Load saved settings from plugin parameters on component mount
  useEffect(() => {
    const loadSavedSettings = async () => {
      try {
        // Access parameters from ctx.plugin.attributes.parameters as advised by the user
        const parameters = ctx.plugin.attributes.parameters;
        if (parameters && typeof parameters.optimization_settings === 'string') {
          try {
            const savedSettings = JSON.parse(parameters.optimization_settings);
            setSettings(savedSettings);
            console.log('Loaded settings from plugin parameters:', savedSettings);
          } catch (parseError) {
            console.error('Error parsing saved settings:', parseError);
          }
        } else {
          console.log('No saved settings found, using defaults');
        }
      } catch (error) {
        console.error('Error accessing plugin parameters:', error);
      }
    };
    
    loadSavedSettings();
  }, [ctx]);

  // Add beforeunload event listener to prevent accidental navigation during optimization
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isOptimizing) {
        // Standard way to show a confirmation dialog
        const message = 'Optimization is in progress. Leaving the page now may cause you to lose assets! Are you sure you want to leave?';
        event.preventDefault();
        event.returnValue = message; // This is required for Chrome
        return message; // For other browsers
      }
    };

    // Add the event listener
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Clean up the event listener when the component unmounts
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isOptimizing]); // Only re-run when isOptimizing changes

  const addLog = (message: string) => {
    setLogEntries((prevLog) => [{ text: `[${new Date().toISOString()}] ${message}` }, ...prevLog]);
  };

  const addSizeComparisonLog = (assetPath: string, originalSize: number, optimizedSize: number) => {
    const sizeDifference = originalSize - optimizedSize;
    const savingsPercentage = Math.round((sizeDifference / originalSize) * 100);
    
    setLogEntries((prevLog) => [{ 
      text: `[${new Date().toISOString()}] Successfully optimized asset: ${assetPath} `,
      originalSize,
      optimizedSize,
      savingsPercentage
    }, ...prevLog]);
  };

  /**
   * Process assets in parallel using a task queue
   * 
   * @param assets Assets to process
   * @param isPreview Whether this is a preview operation
   * @returns Results of processing
   */
  const processAssetsInParallel = async (assets: Asset[], isPreview: boolean) => {
    // Initialize counters and arrays for optimization results
    let optimized = 0;
    let skipped = 0;
    let failed = 0;
    let processed = 0;
    const optimizedAssets: OptimizedAsset[] = [];
    const skippedAssets: ProcessedAsset[] = [];
    const failedAssets: ProcessedAsset[] = [];
    let originalSizeTotal = 0;
    let optimizedSizeTotal = 0;
    
    // Set initial state
    setTotal(assets.length);
    setCurrent(0);
    
    // Create a queue of assets to process
    const queue = [...assets];
    let activeCount = 0;
    
    // Get API token for actual optimization (not needed for preview)
    const apiToken = isPreview ? undefined : ctx.currentUserAccessToken;
    
    const updateProgress = () => {
      processed++;
      setCurrent(processed);
    };
    
    // Process the queue until empty
    const processQueue = async () => {
      const promises: Promise<void>[] = [];
      
      // Start processing assets up to the concurrency limit
      while (queue.length > 0 && activeCount < concurrency) {
        const asset = queue.shift();
        if (!asset) continue;
        
        activeCount++;
        originalSizeTotal += asset.size;
        setCurrentAsset(asset);
        
        const processPromise = (async () => {
          try {
            // Add a small delay between tasks to avoid overwhelming the API
            if (activeCount > 1) {
              await sleep(300);
            }
            
            const result = await processAsset(
              asset,
              settings,
              addLog,
              addSizeComparisonLog,
              isPreview,
              apiToken || undefined,
              ctx.environment
            );
            
            // Handle result based on status
            if (result.status === 'optimized' && result.optimizedSize) {
              optimizedAssets.push(assetToOptimizedAsset(asset, asset.size, result.optimizedSize));
              optimizedSizeTotal += result.optimizedSize;
              optimized++;
            } else if (result.status === 'skipped') {
              skippedAssets.push(assetToProcessedAsset(asset));
              skipped++;
            } else {
              failedAssets.push(assetToProcessedAsset(asset));
              failed++;
            }
          } catch (error) {
            // Handle any unexpected errors
            addLog(`Unexpected error processing ${asset.path}: ${error instanceof Error ? error.message : String(error)}`);
            failedAssets.push(assetToProcessedAsset(asset));
            failed++;
          } finally {
            updateProgress();
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
    
    // Return the results
    return {
      optimized,
      skipped,
      failed,
      totalAssets: assets.length,
      optimizedAssets,
      skippedAssets,
      failedAssets,
      originalSizeTotal,
      optimizedSizeTotal
    };
  };

  /**
   * Start a preview of the optimization process (no actual asset replacement)
   */
  const startPreview = async () => {
    try {
      // Reset any previous results
      resetState();
      setIsPreviewing(true);
      setIsProcessing(true);
      addLog('Starting asset optimization preview...');
      
      // Create DatoCMS client
      const client = buildClient({
        apiToken: ctx.currentUserAccessToken ?? '',
        environment: ctx.environment
      });
      
      // Fetch all assets from DatoCMS
      addLog('Fetching assets from DatoCMS for preview...');
      
      // Calculate size threshold in bytes (convert MB to bytes)
      const largeAssetThresholdBytes = settings.largeAssetThreshold * 1024 * 1024;
      
      // Use listPagedIterator to properly retrieve all uploads with pagination
      const optimizableAssets: Asset[] = [];
      let assetCount = 0;
      
      // Iterate through all pages of upload results with size filter
      for await (const upload of client.uploads.listPagedIterator({
        filter: {
          fields: {
            type: {
              eq: "image"
            },
            size: {
              gte: largeAssetThresholdBytes
            }
          }
        }
      })) {
        assetCount++;
        // We can now skip the size check since we're filtering by API
        optimizableAssets.push(uploadToAsset(upload));
      }
      
      addLog(`Found ${assetCount} assets larger than ${settings.largeAssetThreshold}MB.`);
      addLog(`Found ${optimizableAssets.length} optimizable images.`);
      
      // Process assets in parallel
      const processResult = await processAssetsInParallel(optimizableAssets, true);
      
      // Set the final result
      setResult({
        optimized: processResult.optimized,
        skipped: processResult.skipped,
        failed: processResult.failed,
        totalAssets: assetCount,
        optimizedAssets: processResult.optimizedAssets,
        skippedAssets: processResult.skippedAssets,
        failedAssets: processResult.failedAssets
      });
      
      // Set overall processing stats
      addLog(`Optimization preview complete. Optimized: ${processResult.optimized}, Skipped: ${processResult.skipped}, Failed: ${processResult.failed}`);
      if (processResult.optimized > 0) {
        const sizeDifference = processResult.originalSizeTotal - processResult.optimizedSizeTotal;
        const savingsPercentage = Math.round((sizeDifference / processResult.originalSizeTotal) * 100);
        addLog(`Total size savings: ${formatFileSize(sizeDifference)} (${savingsPercentage}%)`);
      }
      
      addLog('Asset optimization preview completed!');
      ctx.notice('Asset optimization preview completed!');
      
    } catch (error) {
      addLog(`Error during optimization preview: ${error instanceof Error ? error.message : String(error)}`);
      ctx.alert(`Error during optimization preview: ${error instanceof Error ? error.message : String(error)}`);
      setIsPreviewing(false); // Only set to false on error
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Start the optimization process
   */
  const startOptimization = async () => {
    try {
      // Ask for confirmation before proceeding with optimization
      const confirmResult = await ctx.openConfirm({
        title: 'Confirm Asset Optimization',
        content: 'WARNING: This is a destructive action that will permanently replace all assets that fall into the optimization thresholds. This action is non-reversible and original assets cannot be recovered once replaced. Are you sure you want to proceed?',
        choices: [
          {
            label: 'Proceed to Final Confirmation',
            value: 'confirm',
            intent: 'positive',
          }
        ],
        cancel: {
          label: 'Cancel',
          value: false,
        },
      });

      // If the user didn't confirm, return early
      if (confirmResult !== 'confirm') {
        return;
      }
      
      // Second confirmation dialog for extra safety
      const finalConfirmResult = await ctx.openConfirm({
        title: 'Final Confirmation Required',
        content: 'ARE YOU ABSOLUTELY SURE? This will immediately replace your original assets with optimized versions. Your original assets will be PERMANENTLY DELETED and CANNOT be recovered. This may affect the visual quality of your images if not configured correctly.\n\nWe STRONGLY RECOMMEND testing this first in a sandbox environment, so you can fine-tune the thresholds and optimization settings to your liking, make sure everything works with your project, and then promote the sandbox environment once you are satisfied with the results.',
        choices: [
          {
            label: 'Yes, Replace My Assets',
            value: 'confirm',
            intent: 'positive',
          }
        ],
        cancel: {
          label: 'No, Cancel Operation',
          value: false,
        },
      });
      
      // If the user didn't confirm the second dialog, return early
      if (finalConfirmResult !== 'confirm') {
        return;
      }

      // Reset any previous results
      resetState();
      setIsOptimizing(true);
      setIsProcessing(true);
      addLog('Starting asset optimization process...');
      
      // Create DatoCMS client
      const client = buildClient({
        apiToken: ctx.currentUserAccessToken ?? '',
        environment: ctx.environment
      });
      
      // Fetch all assets from DatoCMS
      addLog('Fetching assets from DatoCMS...');
      
      // Calculate size threshold in bytes (convert MB to bytes)
      const largeAssetThresholdBytes = settings.largeAssetThreshold * 1024 * 1024;
      
      // Use listPagedIterator to properly retrieve all uploads with pagination
      const optimizableAssets: Asset[] = [];
      let assetCount = 0;
      
      // Iterate through all pages of upload results with size filter
      for await (const upload of client.uploads.listPagedIterator({
        filter: {
          fields: {
            type: {
              eq: "image"
            },
            size: {
              gte: largeAssetThresholdBytes
            }
          }
        }
      })) {
        assetCount++;
        // We can now skip the size check since we're filtering by API
        optimizableAssets.push(uploadToAsset(upload));
      }
      
      addLog(`Found ${assetCount} assets larger than ${settings.largeAssetThreshold}MB.`);
      addLog(`Found ${optimizableAssets.length} optimizable images.`);
      
      // Process assets in parallel
      const processResult = await processAssetsInParallel(optimizableAssets, false);
      
      // Set the final result
      setResult({
        optimized: processResult.optimized,
        skipped: processResult.skipped,
        failed: processResult.failed,
        totalAssets: assetCount,
        optimizedAssets: processResult.optimizedAssets,
        skippedAssets: processResult.skippedAssets,
        failedAssets: processResult.failedAssets
      });
      
      // Set overall processing stats
      addLog(`Optimization complete. Optimized: ${processResult.optimized}, Skipped: ${processResult.skipped}, Failed: ${processResult.failed}`);
      if (processResult.optimized > 0) {
        const sizeDifference = processResult.originalSizeTotal - processResult.optimizedSizeTotal;
        const savingsPercentage = Math.round((sizeDifference / processResult.originalSizeTotal) * 100);
        addLog(`Total size savings: ${formatFileSize(sizeDifference)} (${savingsPercentage}%)`);
      }
      
      addLog('Asset optimization process completed!');
      ctx.notice('Asset optimization process completed!');
      
    } catch (error) {
      addLog(`Error during optimization process: ${error instanceof Error ? error.message : String(error)}`);
      ctx.alert(`Error during optimization process: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsOptimizing(false);
      setIsProcessing(false);
    }
  };
  
  const resetState = () => {
    setIsOptimizing(false);
    setIsPreviewing(false);
    setIsProcessing(false);
    setResult(null);
    setLogEntries([]);
    setCurrent(0);
    setTotal(0);
    setCurrentAsset(undefined);
  };

  return (
    <Canvas ctx={ctx}>
      <div className={s.container}>
        <h1 className={s.title}>Asset Optimization</h1>
        
        {/* Settings Form */}
        {!isProcessing && !result && (
          <div className={s.settingsContainer}>
            <SettingsForm 
              settings={settings} 
              onSettingsChange={setSettings} 
              onStartOptimization={startOptimization}
              onPreviewOptimization={startPreview}
              ctx={ctx}
            />
          </div>
        )}
        
        {/* Progress Indicator */}
        <ProgressIndicator 
          current={current} 
          total={total} 
          isVisible={isProcessing}
          assetSizeCategory={settings.veryLargeAssetThreshold > 0 ? 'large and very large' : 'large'}
          currentAsset={currentAsset}
          isPreview={isPreviewing}
        />
        
        {/* Results Statistics */}
        {result && (
          <>
            <ResultsStats 
              result={result}
              setSelectedCategory={setSelectedCategory}
              resetState={resetState}
              largeAssetThreshold={settings.largeAssetThreshold}
              isPreview={isPreviewing}
            />
            
            {/* Asset List showing optimized/skipped/failed assets */}
            {selectedCategory && (
              <AssetList 
                assets={selectedCategory === 'optimized' ? result.optimizedAssets :
                        selectedCategory === 'skipped' ? result.skippedAssets :
                        result.failedAssets}
                category={selectedCategory}
                onClose={() => setSelectedCategory(null)}
                ctx={ctx}
              />
            )}
          </>
        )}
        
        {/* Activity Log */}
        <ActivityLog log={logEntries} />
      </div>
    </Canvas>
  );
};

export default OptimizeAssetsPage;
