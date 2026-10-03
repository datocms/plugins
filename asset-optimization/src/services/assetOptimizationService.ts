import {
  ApiError,
  buildClient,
  type Client,
  type SimpleSchemaTypes,
} from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import {
  createBoundedCmaFetch,
  replaceAssetFromBlob,
} from '../utils/assetReplacer';
import {
  CmaRequestScheduler,
  retryCmaRead,
  throwIfAborted,
} from '../utils/cmaRequests';
import { formatFileSize } from '../utils/formatters';
import {
  downloadOptimizedImage,
  getOptimizedFilename,
  ImageSizeLimitError,
  MAX_OPTIMIZED_IMAGE_BYTES,
} from '../utils/imageTransfer';
import {
  type Asset,
  type AssetOptimizerResult,
  getOptimizationParams,
  normalizeSettings,
  type OptimizationSettings,
} from '../utils/optimizationUtils';

export interface OptimizationProgress {
  phase: 'loading' | 'processing';
  current: number;
  total: number;
  asset?: Asset;
}

interface OptimizationOptions {
  preview?: boolean;
  collectionId?: string;
  signal?: AbortSignal;
  concurrency?: number;
  addLog?: (message: string) => void;
  addSizeComparisonLog?: (
    path: string,
    originalSize: number,
    optimizedSize: number,
  ) => void;
  onProgress?: (progress: OptimizationProgress) => void;
}

export interface OptimizationDependencies {
  scheduler?: CmaRequestScheduler;
  download?: typeof downloadOptimizedImage;
  filename?: typeof getOptimizedFilename;
  replace?: typeof replaceAssetFromBlob;
}

function uploadToAsset(upload: SimpleSchemaTypes.Upload): Asset {
  return {
    id: upload.id,
    is_image: upload.is_image,
    size: upload.size,
    url: upload.url,
    path: upload.path,
    basename: upload.basename,
    width: upload.width ?? undefined,
    height: upload.height ?? undefined,
    md5: upload.md5,
    updated_at: upload.updated_at,
    format: upload.format ?? undefined,
  };
}

function assertAssetCollection(
  upload: SimpleSchemaTypes.Upload,
  collectionId?: string,
): void {
  if (collectionId && upload.upload_collection?.id !== collectionId)
    throw new Error(
      'An asset outside the selected collection was returned. No assets were replaced.',
    );
}

export async function collectOptimizableAssets(
  client: Client,
  threshold: number,
  scheduler: CmaRequestScheduler,
  signal?: AbortSignal,
  onLoaded?: (count: number) => void,
  collectionId?: string,
): Promise<Asset[]> {
  const assets: Asset[] = [];
  const seen = new Set<string>();
  // Replacing during offset pagination shrinks the size filter and skips uploads.
  // Complete discovery first; retain only lightweight metadata, never image data.
  for (let offset = 0; ; offset += 500) {
    // biome-ignore lint/performance/noAwaitInLoops: Discover sequential pages before writing to the filtered collection.
    const page = await retryCmaRead(
      () =>
        client.uploads.list({
          filter: {
            fields: {
              type: { eq: 'image' },
              // The CMA accepts integer byte counts, including decimal MB settings.
              size: { gte: Math.ceil(threshold) },
            },
            ...(collectionId ? { collection_id: { eq: collectionId } } : {}),
          },
          order_by: 'id_ASC',
          page: { limit: 500, offset },
        }),
      scheduler,
      signal,
    );
    for (const upload of page) {
      assertAssetCollection(upload, collectionId);
      if (seen.has(upload.id)) continue;
      seen.add(upload.id);
      if (upload.is_image && upload.size >= threshold)
        assets.push(uploadToAsset(upload));
    }
    onLoaded?.(assets.length);
    if (page.length < 500) break;
  }
  return assets;
}

function emptyResult(): AssetOptimizerResult {
  return {
    optimized: 0,
    skipped: 0,
    failed: 0,
    totalAssets: 0,
    optimizedAssets: [],
    skippedAssets: [],
    failedAssets: [],
  };
}

function assetRef(asset: Asset) {
  return { id: asset.id, path: asset.path, url: asset.url };
}

async function processAsset(
  asset: Asset,
  settings: OptimizationSettings,
  client: Client,
  scheduler: CmaRequestScheduler,
  options: OptimizationOptions,
  dependencies: OptimizationDependencies,
  result: AssetOptimizerResult,
): Promise<void> {
  const log = options.addLog ?? (() => {});
  const params = getOptimizationParams(asset, settings);
  const maxBytes = Math.min(
    MAX_OPTIMIZED_IMAGE_BYTES,
    Math.floor(asset.size * (1 - settings.minimumReduction / 100)),
  );
  if (!params || maxBytes <= 0) {
    result.skipped++;
    result.skippedAssets.push(assetRef(asset));
    return;
  }
  const optimizedUrl = new URL(asset.url);
  for (const [key, value] of new URLSearchParams(params))
    optimizedUrl.searchParams.set(key, value);
  log(`Processing asset: ${asset.path} (${formatFileSize(asset.size)})`);
  let blob: Blob;
  try {
    blob = await (dependencies.download ?? downloadOptimizedImage)(
      optimizedUrl.toString(),
      maxBytes,
      options.signal,
    );
  } catch (error) {
    if (!(error instanceof ImageSizeLimitError)) throw error;
    result.skipped++;
    result.skippedAssets.push(assetRef(asset));
    log(
      `Skipping ${asset.path}: insufficient size reduction or image exceeds memory limit.`,
    );
    return;
  }
  throwIfAborted(options.signal);
  if (blob.size === 0) throw new Error('The optimized image is empty');
  if (blob.size > maxBytes || blob.size >= asset.size) {
    result.skipped++;
    result.skippedAssets.push(assetRef(asset));
    log(
      `Skipping ${asset.path}: insufficient size reduction or image exceeds memory limit.`,
    );
    return;
  }
  let reference = assetRef(asset);
  let optimizedSize = blob.size;
  if (!options.preview) {
    const filename = await (dependencies.filename ?? getOptimizedFilename)(
      asset,
      blob,
    );
    const updated = await (dependencies.replace ?? replaceAssetFromBlob)(
      asset,
      blob,
      filename,
      client,
      {
        signal: options.signal,
        beforeRequest: (signal?: AbortSignal) =>
          scheduler.beforeRequest(signal),
        onRateLimit: (ms: number) => scheduler.onRateLimit(ms),
      },
    );
    reference = { id: updated.id, path: updated.path, url: updated.url };
    optimizedSize = updated.size;
  }
  result.optimized++;
  result.optimizedAssets.push({
    ...reference,
    originalSize: asset.size,
    optimizedSize,
  });
  options.addSizeComparisonLog?.(asset.path, asset.size, optimizedSize);
}

function recordFailure(
  asset: Asset,
  error: unknown,
  result: AssetOptimizerResult,
  options: OptimizationOptions,
): boolean {
  if (
    options.signal?.aborted &&
    error instanceof Error &&
    error.name === 'AbortError'
  )
    return false;
  const message = error instanceof Error ? error.message : String(error);
  result.failed++;
  result.failedAssets.push({ ...assetRef(asset), error: message });
  options.addLog?.(`Error processing ${asset.path}: ${message}`);
  if (error instanceof ApiError && error.response.status === 401)
    result.stoppedReason =
      'API access expired. No further assets were scheduled.';
  return true;
}

export async function runAssetOptimization(
  client: Client,
  inputSettings: OptimizationSettings,
  options: OptimizationOptions = {},
  dependencies: OptimizationDependencies = {},
): Promise<AssetOptimizerResult> {
  const settings = normalizeSettings(inputSettings);
  const scheduler = dependencies.scheduler ?? new CmaRequestScheduler();
  const result = emptyResult();
  let assets: Asset[];
  try {
    assets = await collectOptimizableAssets(
      client,
      settings.largeAssetThreshold * 1024 * 1024,
      scheduler,
      options.signal,
      (total) => {
        result.totalAssets = total;
        options.onProgress?.({ phase: 'loading', current: 0, total });
      },
      options.collectionId,
    );
  } catch (error) {
    if (!options.signal?.aborted) throw error;
    return {
      ...result,
      cancelled: true,
      unprocessed: result.totalAssets,
      inventoryIncomplete: true,
    };
  }
  result.totalAssets = assets.length;
  options.addLog?.(`Found ${assets.length} optimizable images.`);
  options.onProgress?.({
    phase: 'processing',
    current: 0,
    total: assets.length,
    asset: assets[0],
  });
  const requestedConcurrency = options.concurrency ?? 2;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.min(3, Math.max(1, Math.floor(requestedConcurrency)))
    : 2;
  let nextIndex = 0;
  let processed = 0;
  let lastProgressAt = 0;
  const reportProgress = (asset: Asset) => {
    processed++;
    if (Date.now() - lastProgressAt < 200 && processed !== assets.length)
      return;
    lastProgressAt = Date.now();
    options.onProgress?.({
      phase: 'processing',
      current: processed,
      total: assets.length,
      asset,
    });
  };
  const worker = async () => {
    while (!options.signal?.aborted && !result.stoppedReason) {
      const index = nextIndex++;
      const asset = assets[index];
      if (!asset) return;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Each worker holds at most one image and releases it before taking another.
        await processAsset(
          asset,
          settings,
          client,
          scheduler,
          options,
          dependencies,
          result,
        );
      } catch (error) {
        if (!recordFailure(asset, error, result, options)) return;
      }
      reportProgress(asset);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, assets.length) }, worker),
  );
  result.cancelled = options.signal?.aborted ?? false;
  result.unprocessed = assets.length - processed;
  options.onProgress?.({
    phase: 'processing',
    current: processed,
    total: assets.length,
  });
  return result;
}

export async function optimizeAssets(
  ctx: RenderPageCtx,
  settings: OptimizationSettings,
  addLog: (message: string) => void,
  addSizeComparisonLog: (
    path: string,
    originalSize: number,
    optimizedSize: number,
  ) => void,
  setProgress: (progress: number) => void,
  concurrency = 2,
): Promise<AssetOptimizerResult> {
  if (!ctx.currentUserAccessToken)
    throw new Error('Access token not available');
  const client = buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
    autoRetry: false,
    requestTimeout: 30_000,
    fetchFn: createBoundedCmaFetch(),
  });
  return runAssetOptimization(client, settings, {
    concurrency,
    addLog,
    addSizeComparisonLog,
    onProgress: ({ phase, current, total }) =>
      setProgress(
        phase === 'processing' ? (total ? (current / total) * 100 : 100) : 0,
      ),
  });
}
